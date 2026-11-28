import { type Api, Bot, type Context, InlineKeyboard } from "grammy";
import type { Env, InstanceRecord, Region } from "./env";
import { deleteInstanceRecord, getInstance, listInstanceRecords, saveInstance } from "./kv";
import { destroyInstance, listInstances, ProviderError, rebootInstance } from "./linode";
import {
  accruedUsd,
  costNote,
  costNoteFallback,
  destroyedMessage,
  destroyPrompt,
  statusMessage,
} from "./messages";
import {
  describeProvisioning,
  findRegion,
  loadTypePrice,
  parseRegions,
  provisionServer,
} from "./provision";

/**
 * builds the help text
 *
 * @param priceLine — price sentence, or `undefined` when the plan price is unknown
 * @returns plain text shown by /start and /help
 */
function welcomeText(priceLine?: string): string {
  const lines = [
    "telegram-vpn-bot",
    "",
    "/create — create a VLESS + REALITY server",
    "/restart — reboot a server",
    "/destroy — destroy a server",
    "/status — list tracked servers",
  ];

  if (priceLine) {
    lines.push("", priceLine);
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
 * reboots a ready server and arms the cron confirmation
 *
 * works from both the `/restart <ip>` command and the inline keyboard: the
 * notice is edited into the current message when there is one, or sent as a
 * reply otherwise
 *
 * @param context — grammY update context
 * @param env — worker bindings
 * @param record — ready instance to reboot
 */
async function startReboot(context: Context, env: Env, record: InstanceRecord): Promise<void> {
  const notify = (text: string) => context.editMessageText(text).catch(() => context.reply(text));

  try {
    await rebootInstance(env.LINODE_API_TOKEN, Number(record.id));
    await saveInstance(env.KV, { ...record, rebootedAt: Date.now() });
    await notify(
      `🔁 restarting ${serverLabel(record)} — the bot will confirm when it is back online.`,
    ).catch((error) => console.warn("restart notice failed", error));
  } catch (error) {
    console.error("restart failed", error);
    await notify(`❌ restart failed: ${errorText(error)}`).catch((noticeError) =>
      console.warn("restart failure notice failed", noticeError),
    );
  }
}

/**
 * destroys a server and its record without further confirmation
 *
 * used by both the `/destroy <ip>` command and the confirmation button; the
 * notice is edited into the current message when there is one, or sent as a
 * reply otherwise
 *
 * @param context — grammY update context
 * @param env — worker bindings
 * @param record — instance to destroy
 */
async function performDestroy(context: Context, env: Env, record: InstanceRecord): Promise<void> {
  const notify = (text: string) => context.editMessageText(text).catch(() => context.reply(text));
  const price = await loadTypePrice(env);
  const cost = accruedUsd(record, price ?? undefined);

  try {
    await destroyInstance(env.LINODE_API_TOKEN, Number(record.id)).catch((error: unknown) => {
      if (error instanceof ProviderError && error.status === 404) {
        return;
      }

      throw error;
    });
    await deleteInstanceRecord(env.KV, record);
    await notify(destroyedMessage(record, cost)).catch((error) =>
      console.warn("destroyed notice failed", error),
    );
  } catch (error) {
    console.error("destroy failed", error);
    await notify(`❌ destroy failed: ${errorText(error)}`).catch((noticeError) =>
      console.warn("destroy failure notice failed", noticeError),
    );
  }
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
 * builds the bot: command handlers, callback handlers and the error boundary
 * stateless — one instance is created per webhook request. access control is
 * telegram's job: restrict who can message the bot in the BotFather settings,
 * the bot itself never checks sender ids
 *
 * @param env — worker bindings
 * @param publicUrl — worker origin used when provisioning new servers
 * @returns a grammY bot ready to receive updates
 */
export function createBot(env: Env, publicUrl: string): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  bot.command("start", async (context) => {
    const price = await loadTypePrice(env);
    const priceLine = price ? costNote(price.hourly, price.monthly, price.id) : costNoteFallback();

    await context.reply(welcomeText(priceLine));
  });

  bot.command("help", async (context) => {
    const price = await loadTypePrice(env);
    const priceLine = price ? costNote(price.hourly, price.monthly, price.id) : costNoteFallback();

    await context.reply(welcomeText(priceLine));
  });

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

      await context.reply("🌐 choose a region:", { reply_markup: keyboard });
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
    const argument = context.match.trim();
    const records = await listInstanceRecords(env.KV);

    if (argument) {
      const record = records.find((candidate) => candidate.ip === argument);

      if (record?.state !== "ready") {
        await context.reply(`❓ no running server with ip ${argument}.`);
      } else {
        await startReboot(context, env, record);
      }

      return;
    }

    const running = records.filter((record) => record.state === "ready");

    if (running.length === 0) {
      await context.reply("no running servers to restart.");
      return;
    }

    const keyboard = new InlineKeyboard();

    for (const record of running) {
      keyboard.text(serverLabel(record), `restart:${record.id}`).row();
    }

    await context.reply("🔁 restart which server?", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^restart:(.+)$/, async (context) => {
    const record = await getInstance(env.KV, context.match[1] ?? "");

    if (record?.state !== "ready") {
      await context.answerCallbackQuery("server is not running.");
      return;
    }

    await startReboot(context, env, record);
  });

  bot.command("destroy", async (context) => {
    const argument = context.match.trim();
    const records = await listInstanceRecords(env.KV);

    if (argument) {
      const record = records.find((candidate) => candidate.ip === argument);

      if (!record) {
        await context.reply(`❓ no server with ip ${argument}.`);
      } else {
        await performDestroy(context, env, record);
      }

      return;
    }

    if (records.length === 0) {
      await context.reply("nothing to destroy.");
      return;
    }

    const keyboard = new InlineKeyboard();

    for (const record of records) {
      keyboard.text(`${serverLabel(record)} · ${record.state}`, `destroy:${record.id}`).row();
    }

    await context.reply("🗑 destroy which server?", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^destroy:(.+)$/, async (context) => {
    const record = await getInstance(env.KV, context.match[1] ?? "");

    if (!record) {
      await context.answerCallbackQuery("server is gone.");
      return;
    }

    await context.answerCallbackQuery();
    const price = await loadTypePrice(env);
    const keyboard = new InlineKeyboard()
      .text("Yes, destroy", `confirm:${record.id}`)
      .text("Cancel", `cancel:${record.id}`);

    await context
      .editMessageText(destroyPrompt(record, price ?? undefined), {
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

    await context.answerCallbackQuery("🗑 destroying…");
    await performDestroy(context, env, record);
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

    const price = await loadTypePrice(env);
    await context.reply(statusMessage(records, live, price ?? undefined));
  });

  bot.catch(async (error) => {
    const chatId = error.ctx.chat?.id;

    console.error("bot error", error);

    if (chatId) {
      await error.ctx.api
        .sendMessage(chatId, `⚠️ ${errorText(error.error)}`)
        .catch((notifyError) => console.warn("error notice failed", notifyError));
    }
  });

  return bot;
}
