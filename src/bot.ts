import { type Api, Bot, InlineKeyboard } from "grammy";
import type { Env, Region } from "./env";
import { deleteInstanceRecord, getInstance, listInstanceRecords } from "./kv";
import { statusMessage } from "./messages";
import { describeProvisioning, findRegion, parseRegions, provisionServer } from "./provision";
import { destroyInstance, listInstances, VultrError } from "./vultr";

const WELCOME = [
  "telegram-vpn-bot",
  "",
  "/up — create a VLESS + REALITY server",
  "/down — destroy a server",
  "/status — list tracked servers",
  "/id — show your Telegram id",
  "",
  "Only allowlisted users can control the vpn servers.",
].join("\n");

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function startProvision(
  api: Api,
  env: Env,
  publicUrl: string,
  chatId: number,
  region: Region,
): Promise<void> {
  const placeholder = await api.sendMessage(chatId, `🛠 Creating ${region.label} server…`);

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

export function createBot(env: Env, publicUrl: string): Bot {
  const bot = new Bot(env.BOT_TOKEN);
  const allowed = new Set(
    env.ALLOWED_USER_ID.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  bot.use(async (context, next) => {
    if (!context.from || !allowed.has(String(context.from.id))) {
      if (context.chat)
        await context
          .reply(`Unauthorized. Your id: ${context.from?.id ?? "unknown"}`)
          .catch((error) => console.warn("unauthorized notice failed", error));
      return;
    }
    await next();
  });

  bot.command("start", (context) => context.reply(WELCOME));
  bot.command("help", (context) => context.reply(WELCOME));
  bot.command("id", (context) => context.reply(`Your Telegram id: ${context.from?.id}`));

  bot.command("up", async (context) => {
    const argument = context.match.trim();
    if (!argument) {
      const keyboard = new InlineKeyboard();
      parseRegions(env).forEach((region, index) => {
        if (index > 0 && index % 2 === 0) keyboard.row();
        keyboard.text(region.label, `up:${region.id}`);
      });
      await context.reply("Choose a region:", { reply_markup: keyboard });
      return;
    }

    const region =
      findRegion(env, argument) ??
      parseRegions(env).find(
        (candidate) => candidate.label.toLowerCase() === argument.toLowerCase(),
      );

    if (!region) {
      await context.reply(
        `Unknown region "${argument}". Try: ${parseRegions(env)
          .map((r) => r.id)
          .join(", ")}`,
      );
      return;
    }

    await startProvision(context.api, env, publicUrl, context.chat.id, region);
  });

  bot.callbackQuery(/^up:(.+)$/, async (context) => {
    const region = findRegion(env, context.match[1] ?? "");
    await context.answerCallbackQuery(region ? `Creating ${region.label}…` : "Unknown region");
    if (!region || !context.chat) return;
    await startProvision(context.api, env, publicUrl, context.chat.id, region);
  });

  bot.command("down", async (context) => {
    const records = await listInstanceRecords(env.KV);
    if (records.length === 0) {
      await context.reply("Nothing to destroy.");
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const record of records) {
      keyboard.text(`${record.regionLabel} · ${record.ip}`, `down:${record.id}`).row();
    }
    await context.reply("Destroy which server?", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^down:(.+)$/, async (context) => {
    const record = await getInstance(env.KV, context.match[1] ?? "");
    if (!record) {
      await context.answerCallbackQuery("Server is gone");
      return;
    }
    await context.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text("Yes, destroy", `confirm:${record.id}`)
      .text("Cancel", `cancel:${record.id}`);
    await context
      .editMessageText(`Destroy ${record.regionLabel} (${record.ip})?\nThis cannot be undone.`, {
        reply_markup: keyboard,
      })
      .catch((error) => console.warn("destroy confirmation render failed", error));
  });

  bot.callbackQuery(/^confirm:(.+)$/, async (context) => {
    const id = context.match[1] ?? "";
    const record = await getInstance(env.KV, id);
    if (!record) {
      await context.answerCallbackQuery("Already gone");
      return;
    }
    await context.answerCallbackQuery("Destroying…");
    try {
      await destroyInstance(env.VULTR_API_TOKEN, id).catch((error: unknown) => {
        if (error instanceof VultrError && error.status === 404) return;
        throw error;
      });
      await deleteInstanceRecord(env.KV, record);
      await context
        .editMessageText(`🗑 Destroyed ${record.regionLabel} (${record.ip})`)
        .catch((error) => console.warn("destroyed notice failed", error));
    } catch (error) {
      console.error("destroy failed", error);
      await context
        .editMessageText(`❌ Destroy failed: ${errorText(error)}`)
        .catch((noticeError) => console.warn("destroy failure notice failed", noticeError));
    }
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (context) => {
    await context.answerCallbackQuery("Cancelled");
    await context
      .editMessageText("Cancelled.")
      .catch((error) => console.warn("cancel notice failed", error));
  });

  bot.command("status", async (context) => {
    const records = await listInstanceRecords(env.KV);
    const live = new Map<string, string>();
    try {
      for (const instance of await listInstances(env.VULTR_API_TOKEN)) {
        live.set(instance.id, instance.power_status);
      }
    } catch (error) {
      console.warn("live instance fetch failed, showing cached state", error);
    }
    await context.reply(statusMessage(records, live));
  });

  bot.catch(async (error) => {
    console.error("bot error", error);
    const chatId = error.ctx.chat?.id;
    if (chatId)
      await error.ctx.api
        .sendMessage(chatId, `⚠️ ${errorText(error.error)}`)
        .catch((notifyError) => console.warn("error notice failed", notifyError));
  });

  return bot;
}
