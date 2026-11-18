import { type Api, Bot, InputFile } from "grammy";
import type { Env, InstanceRecord } from "./env";
import { getInstanceBySecret, listInstanceRecords, saveInstance } from "./kv";
import { failedMessage, readyMessage, recordLink } from "./messages";
import { qrPng } from "./qr";
import { getInstance } from "./vultr";

/** publish without waiting for the callback once an instance has run this long */
const READY_FALLBACK_MS = 8 * 60_000;
/** mark provisioning failed when nothing arrives within this window */
const TIMEOUT_MS = 15 * 60_000;

/**
 * edits the original status message, falling back to a new message when the
 * edit fails (for example after the message was deleted)
 *
 * @param api — grammY API client
 * @param record — record holding `chatId` and `messageId`
 * @param text — new message body
 */
async function replaceOrSend(api: Api, record: InstanceRecord, text: string): Promise<void> {
  try {
    await api.editMessageText(record.chatId, record.messageId, text);
  } catch (editError) {
    console.warn("message edit failed, sending a new one", editError);
    await api
      .sendMessage(record.chatId, text)
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

  await replaceOrSend(bot.api, record, readyMessage(record, link, note));

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
 * Resolves the record through the token index, stores the reported IP, flips
 * the state to `ready` and publishes the link. Idempotent: repeated callbacks
 * return `already ready`
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
 * cron entry point: advances every record still in `provisioning`
 *
 * Publishes records whose instance is running past the fallback window, fails
 * records whose instance disappeared, and times out records older than 15
 * minutes. Does nothing when no record is provisioning
 *
 * @param env — worker bindings
 */
export async function reconcile(env: Env): Promise<void> {
  const records = await listInstanceRecords(env.KV);
  const pending = records.filter((record) => record.state === "provisioning");

  if (pending.length === 0) {
    return;
  }

  for (const record of pending) {
    const age = Date.now() - record.createdAt;

    let instance = null;

    try {
      instance = await getInstance(env.VULTR_API_TOKEN, record.id);
    } catch (error) {
      console.error("reconcile: vultr lookup failed", error);
    }

    if (!instance) {
      await markFailed(env, record, "instance vanished from Vultr");
      continue;
    }

    const ip = instance.main_ip && instance.main_ip !== "0.0.0.0" ? instance.main_ip : record.ip;

    if (instance.power_status === "running" && ip !== "pending" && age > READY_FALLBACK_MS) {
      const updated: InstanceRecord = { ...record, ip, state: "ready", readyAt: Date.now() };
      await saveInstance(env.KV, updated);
      await publishReady(
        env,
        updated,
        "note: bootstrap callback was not received; link uses the Vultr ip",
      ).catch((error) => console.error("publishReady fallback failed", error));
      continue;
    }

    if (age > TIMEOUT_MS) {
      await markFailed(env, record, "no completion callback within 15 minutes");
    }
  }
}
