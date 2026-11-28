import { type Api, Bot, InputFile } from "grammy";
import type { Env, InstanceRecord } from "./env";
import {
  getInstance,
  getInstanceBySecret,
  listPendingIds,
  listRebootingIds,
  saveInstance,
} from "./kv";
import { getInstance as getLinodeInstance } from "./linode";
import {
  failedMessage,
  readyMessage,
  recordLink,
  restartedMessage,
  restartUnconfirmedMessage,
} from "./messages";
import { qrPng } from "./qr";

/** publish without waiting for the callback once an instance has run this long */
const READY_FALLBACK_MS = 8 * 60_000;

/** mark provisioning failed when nothing arrives within this window */
const TIMEOUT_MS = 15 * 60_000;

/** how long a reboot must have been requested before "running" counts as back */
const REBOOT_GRACE_MS = 30_000;

/** give up waiting for a reboot confirmation after this long */
const REBOOT_TIMEOUT_MS = 10 * 60_000;

/**
 * edits the original status message, falling back to a new message when the
 * edit fails (for example after the message was deleted)
 *
 * @param api — grammY API client
 * @param record — record holding `chatId` and `messageId`
 * @param text — new message body
 */
async function replaceOrSend(
  api: Api,
  record: InstanceRecord,
  text: string,
  options?: { parse_mode?: "HTML" },
): Promise<void> {
  try {
    await api.editMessageText(record.chatId, record.messageId, text, options);
  } catch (editError) {
    console.warn("message edit failed, sending a new one", editError);
    await api
      .sendMessage(record.chatId, text, options)
      .catch((error) => console.error("publish message failed", error));
  }
}

/**
 * announces a ready server: edits the status message, then sends the QR code
 *
 * @param env — worker bindings
 * @param record — record with a resolved IP and credentials
 * @param note — optional warning shown above the link
 */
export async function publishReady(env: Env, record: InstanceRecord, note?: string): Promise<void> {
  const bot = new Bot(env.BOT_TOKEN);
  const link = recordLink(record);

  await replaceOrSend(bot.api, record, readyMessage(record, link, note), {
    parse_mode: "HTML",
  });

  const png = await qrPng(link);
  await bot.api
    .sendPhoto(record.chatId, new InputFile(png, `vpn-${record.region}.png`), {
      caption: `${record.regionLabel} · ${record.ip}`,
    })
    .catch((error) => console.warn("qr photo send failed", error));
}

/**
 * handles the cloud-init completion callback `GET /ready?token=…&ip=…`
 *
 * resolves the record through the token index, stores the reported IP, flips
 * the state to `ready` and publishes the link. saving in any state other than
 * `provisioning` burns the token, so a repeated callback returns `unknown token`
 *
 * @param env — worker bindings
 * @param request — incoming callback request
 * @returns HTTP 200 `ok`, 400 for a missing token, 404 for an unknown token
 */
export async function handleReady(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const ip = url.searchParams.get("ip") ?? "";

  if (!token) {
    return new Response("missing token", { status: 400 });
  }

  const record = await getInstanceBySecret(env.KV, token);

  if (!record) {
    return new Response("unknown token", { status: 404 });
  }

  if (record.state === "ready") {
    return new Response("already ready");
  }

  const updated: InstanceRecord = {
    ...record,
    ip: ip || record.ip,
    state: "ready",
    readyAt: Date.now(),
  };

  await saveInstance(env.KV, updated);
  await publishReady(env, updated).catch((error) => console.error("publishReady failed", error));
  return new Response("ok");
}

/**
 * marks a record as failed and reports the reason in chat
 *
 * @param env — worker bindings
 * @param record — record being abandoned
 * @param reason — short explanation for the operator
 */
async function markFailed(env: Env, record: InstanceRecord, reason: string): Promise<void> {
  const updated: InstanceRecord = { ...record, state: "failed", error: reason };
  await saveInstance(env.KV, updated);
  await replaceOrSend(new Bot(env.BOT_TOKEN).api, record, failedMessage(record, reason));
}

/**
 * cron entry point: advances provisioning records and pending reboot
 * confirmations
 *
 * reads the `pending` and `rebooting` indexes first, so a tick with nothing to
 * do costs two KV reads. Provisioning records are published once their instance
 * is running past the fallback window, failed when the instance disappeared and
 * timed out after 15 minutes. rebooting records are confirmed once linode
 * reports them running again
 *
 * @param env — worker bindings
 */
export async function reconcile(env: Env): Promise<void> {
  const [ids, rebooting] = await Promise.all([listPendingIds(env.KV), listRebootingIds(env.KV)]);

  if (ids.length === 0 && rebooting.length === 0) {
    return;
  }

  if (rebooting.length > 0) {
    await reconcileReboots(env, rebooting);
  }

  if (ids.length === 0) {
    return;
  }

  const records: InstanceRecord[] = [];

  for (const id of ids) {
    const record = await getInstance(env.KV, id);

    if (record && record.state === "provisioning") {
      records.push(record);
    }
  }

  records.sort((a, b) => a.createdAt - b.createdAt);

  for (const record of records) {
    let instance = null;
    const age = Date.now() - record.createdAt;

    try {
      instance = await getLinodeInstance(env.LINODE_API_TOKEN, Number(record.id));
    } catch (error) {
      console.error("reconcile: linode lookup failed", error);
    }

    if (!instance) {
      await markFailed(env, record, "instance vanished from linode");
      continue;
    }

    const ip = instance.ipv4[0] ?? record.ip;

    if (instance.status === "running" && ip !== "pending" && age > READY_FALLBACK_MS) {
      const updated: InstanceRecord = { ...record, ip, state: "ready", readyAt: Date.now() };
      await saveInstance(env.KV, updated);
      await publishReady(
        env,
        updated,
        "note: bootstrap callback was not received; link uses the linode ip",
      ).catch((error) => console.error("publishReady fallback failed", error));
      continue;
    }

    if (age > TIMEOUT_MS) {
      await markFailed(env, record, "no completion callback within 15 minutes");
    }
  }
}

/**
 * confirms or abandons reboots waiting for the server to come back
 *
 * a reboot counts as done once linode reports `running` and at least
 * {@link REBOOT_GRACE_MS} has passed — the grace guards against the stale
 * `running` status read before the reboot actually starts. when nothing
 * confirms within {@link REBOOT_TIMEOUT_MS}, the operator is told to check
 * `/status`
 *
 * @param env — worker bindings
 * @param ids — record ids taken from the `rebooting` index
 */
async function reconcileReboots(env: Env, ids: string[]): Promise<void> {
  const api = new Bot(env.BOT_TOKEN).api;

  for (const id of ids) {
    const record = await getInstance(env.KV, id);

    if (!record || record.rebootedAt === undefined) {
      continue;
    }

    let status: string | null = null;
    const elapsed = Date.now() - record.rebootedAt;

    try {
      const instance = await getLinodeInstance(env.LINODE_API_TOKEN, Number(record.id));
      status = instance?.status ?? null;
    } catch (error) {
      console.warn("reconcile: linode status lookup failed", error);
    }

    if (status === "running" && elapsed > REBOOT_GRACE_MS) {
      await saveInstance(env.KV, { ...record, rebootedAt: undefined });
      await replaceOrSend(api, record, restartedMessage(record, elapsed));
      continue;
    }

    if (elapsed > REBOOT_TIMEOUT_MS) {
      await saveInstance(env.KV, { ...record, rebootedAt: undefined });
      await replaceOrSend(api, record, restartUnconfirmedMessage());
    }
  }
}
