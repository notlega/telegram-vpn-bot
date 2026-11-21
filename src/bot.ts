import { type Api, Bot, InlineKeyboard } from "grammy";
import type { Env, InstanceRecord, Region } from "./env";
import { deleteInstanceRecord, getInstance, listInstanceRecords } from "./kv";
import { destroyInstance, listInstances, ProviderError, rebootInstance } from "./linode";
import { statusMessage } from "./messages";
import { describeProvisioning, findRegion, parseRegions, provisionServer } from "./provision";

/**
 * builds the help text
 *
 * @param restricted — true when an allowlist is configured
 * @returns plain text shown by /start and /help
 */
function welcomeText(restricted: boolean): string {
  const lines = [
    "telegram-vpn-bot",
    "",
    "/create — create a VLESS + REALITY server",
    "/restart — reboot a server",
    "/destroy — destroy a server",
    "/status — list tracked servers",
    "/id — show your Telegram id",
  ];

  if (restricted) {
    lines.push("", "only allowlisted users can control the vpn servers");
  }

  return lines.join("\n");
}

/**
 * extracts a human readable message from an unknown thrown value
 *
 * @param error value caught from a promise or try block
 * @returns `error.message` for `Error` instances, `String(error)` otherwise
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * renders the one-line server label used on inline buttons
 *
 * @param record — tracked instance
 * @returns `region · ip`
 */
function serverLabel(record: InstanceRecord): string {
  return `${record.regionLabel} · ${record.ip}`;
}

/**
 * posts a placeholder, provisions the server, then replaces the placeholder
 * with either the progress description or the failure reason
 *
 * @param api — grammY API client
 * @param env — worker bindings
 * @param publicUrl — worker origin used for the completion callback
 * @param chatId — chat that receives progress updates
 * @param region — region to deploy in
 */
async function startProvision(
  api: Api,
  env: Env,
  publicUrl: string,
  chatId: number,
  region: Region,
): Promise<void> {
  const placeholder = await api.sendMessage(chatId, `🛠 creating ${region.label} server…`);

  try {
    const record = await provisionServer(env, publicUrl, chatId, placeholder.message_id, region);
    await api.editMessageText(chatId, placeholder.message_id, describeProvisioning(record));
  } catch (error) {
    console.error("provision failed", error);
    await api
      .editMessageText(chatId, placeholder.message_id, `❌ ${region.label}: ${errorText(error)}`)
      .catch((notifyError) => console.warn("provision failure notice failed", notifyError));
  }
}

/**
 * builds the bot: optional allowlist middleware, command handlers, callback
 * handlers and the error boundary. Stateless — one instance is created per
 * webhook request. access control is opt-in: set ALLOWED_USER_ID to restrict,
 * leave it empty for an open bot
 *
 * @param env — worker bindings
 * @param publicUrl — worker origin used when provisioning new servers
 * @returns a grammY bot ready to receive updates
 */
export function createBot(env: Env, publicUrl: string): Bot {
  const bot = new Bot(env.BOT_TOKEN);
  const allowed = new Set(
    (env.ALLOWED_USER_ID ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const restricted = allowed.size > 0;

  bot.use(async (context, next) => {
    if (!restricted) {
      await next();
      return;
    }

    const userId = context.from?.id;

    if (userId !== undefined && allowed.has(String(userId))) {
      await next();
      return;
    }

    if (userId === undefined) {
      return;
    }

    const gate = env.GATEKEEPER.get(env.GATEKEEPER.idFromName(String(userId)));
    const verdict = await gate.check();

    console.warn(`unauthorized update from ${userId}: ${verdict}`);
  });

  const welcome = welcomeText(restricted);

  bot.command("start", (context) => context.reply(welcome));
  bot.command("help", (context) => context.reply(welcome));
  bot.command("id", (context) => context.reply(`your Telegram id: ${context.from?.id}`));

  bot.command("create", async (context) => {
    const argument = context.match.trim();

    if (!argument) {
      const keyboard = new InlineKeyboard();

      parseRegions(env).forEach((region, index) => {
        if (index > 0 && index % 2 === 0) {
          keyboard.row();
        }

        keyboard.text(region.label, `create:${region.id}`);
      });

      await context.reply("choose a region:", { reply_markup: keyboard });
      return;
    }

    const region =
      findRegion(env, argument) ??
      parseRegions(env).find(
        (candidate) => candidate.label.toLowerCase() === argument.toLowerCase(),
      );

    if (!region) {
      await context.reply(
        `unknown region "${argument}". try: ${parseRegions(env)
          .map((r) => r.id)
          .join(", ")}`,
      );
      return;
    }

    await startProvision(context.api, env, publicUrl, context.chat.id, region);
  });

  bot.callbackQuery(/^create:(.+)$/, async (context) => {
    const region = findRegion(env, context.match[1] ?? "");

    await context.answerCallbackQuery(region ? `creating ${region.label}…` : "unknown region.");

    if (!region || !context.chat) {
      return;
    }

    await startProvision(context.api, env, publicUrl, context.chat.id, region);
  });

  bot.command("restart", async (context) => {
    const records = await listInstanceRecords(env.KV);
    const running = records.filter((record) => record.state === "ready");

    if (running.length === 0) {
      await context.reply("no running servers to restart.");
      return;
    }

    const keyboard = new InlineKeyboard();

    for (const record of running) {
      keyboard.text(serverLabel(record), `restart:${record.id}`).row();
    }

    await context.reply("restart which server?", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^restart:(.+)$/, async (context) => {
    const record = await getInstance(env.KV, context.match[1] ?? "");

    if (!record) {
      await context.answerCallbackQuery("server is gone.");
      return;
    }

    await context.answerCallbackQuery("restarting…");

    try {
      await rebootInstance(env.LINODE_API_TOKEN, Number(record.id));
      await context
        .editMessageText(`🔄 restarting ${serverLabel(record)}, back online in ~1 minute.`)
        .catch((error) => console.warn("restart notice failed", error));
    } catch (error) {
      console.error("restart failed", error);
      await context
        .editMessageText(`❌ restart failed: ${errorText(error)}`)
        .catch((noticeError) => console.warn("restart failure notice failed", noticeError));
    }
  });

  bot.command("destroy", async (context) => {
    const records = await listInstanceRecords(env.KV);

    if (records.length === 0) {
      await context.reply("nothing to destroy.");
      return;
    }

    const keyboard = new InlineKeyboard();

    for (const record of records) {
      keyboard.text(`${serverLabel(record)} · ${record.state}`, `destroy:${record.id}`).row();
    }

    await context.reply("destroy which server?", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^destroy:(.+)$/, async (context) => {
    const record = await getInstance(env.KV, context.match[1] ?? "");

    if (!record) {
      await context.answerCallbackQuery("server is gone.");
      return;
    }

    await context.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text("Yes, destroy", `confirm:${record.id}`)
      .text("Cancel", `cancel:${record.id}`);

    await context
      .editMessageText(`destroy ${serverLabel(record)}?\nthis cannot be undone.`, {
        reply_markup: keyboard,
      })
      .catch((error) => console.warn("destroy confirmation render failed", error));
  });

  bot.callbackQuery(/^confirm:(.+)$/, async (context) => {
    const id = context.match[1] ?? "";
    const record = await getInstance(env.KV, id);

    if (!record) {
      await context.answerCallbackQuery("already gone.");
      return;
    }

    await context.answerCallbackQuery("destroying…");

    try {
      await destroyInstance(env.LINODE_API_TOKEN, Number(id)).catch((error: unknown) => {
        if (error instanceof ProviderError && error.status === 404) {
          return;
        }

        throw error;
      });
      await deleteInstanceRecord(env.KV, record);
      await context
        .editMessageText(`🗑 destroyed ${serverLabel(record)}.`)
        .catch((error) => console.warn("destroyed notice failed", error));
    } catch (error) {
      console.error("destroy failed", error);
      await context
        .editMessageText(`❌ destroy failed: ${errorText(error)}`)
        .catch((noticeError) => console.warn("destroy failure notice failed", noticeError));
    }
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (context) => {
    await context.answerCallbackQuery("cancelled.");
    await context
      .editMessageText("cancelled.")
      .catch((error) => console.warn("cancel notice failed", error));
  });

  bot.command("status", async (context) => {
    const records = await listInstanceRecords(env.KV);
    const live = new Map<string, string>();

    try {
      for (const instance of await listInstances(env.LINODE_API_TOKEN)) {
        live.set(String(instance.id), instance.status);
      }
    } catch (error) {
      console.warn("live instance fetch failed, showing cached state", error);
    }

    await context.reply(statusMessage(records, live));
  });

  bot.catch(async (error) => {
    console.error("bot error", error);
    const chatId = error.ctx.chat?.id;

    if (chatId) {
      await error.ctx.api
        .sendMessage(chatId, `⚠️ ${errorText(error.error)}`)
        .catch((notifyError) => console.warn("error notice failed", notifyError));
    }
  });

  return bot;
}
