import { Bot, InlineKeyboard, type Api } from "grammy";
import type { Env, Region } from "./env";
import { deleteInstanceRecord, getInstance, listInstanceRecords } from "./kv";
import { statusMessage } from "./messages";
import { describeProvisioning, findRegion, parseRegions, provisionServer } from "./provision";
import { destroyInstance, listInstances, VultrError } from "./vultr";

const WELCOME = [
  "VPN fleet bot",
  "",
  "/up — create a VLESS+REALITY server",
  "/down — destroy a server",
  "/status — list tracked servers",
  "/id — show your Telegram id",
  "",
  "Only allowlisted users can control the fleet.",
].join("\n");

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function startProvision(api: Api, env: Env, publicUrl: string, chatId: number, region: Region): Promise<void> {
  const placeholder = await api.sendMessage(chatId, `🛠 Creating ${region.label} server…`);
  try {
    const record = await provisionServer(env, publicUrl, chatId, placeholder.message_id, region);
    await api.editMessageText(chatId, placeholder.message_id, describeProvisioning(record));
  } catch (error) {
    await api
      .editMessageText(chatId, placeholder.message_id, `❌ ${region.label}: ${errorText(error)}`)
      .catch(() => undefined);
  }
}

export function createBot(env: Env, publicUrl: string): Bot {
  const bot = new Bot(env.BOT_TOKEN);
  const allowed = new Set(
    env.ALLOWED_USER_ID.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  bot.use(async (ctx, next) => {
    if (!ctx.from || !allowed.has(String(ctx.from.id))) {
      if (ctx.chat) await ctx.reply(`Unauthorized. Your id: ${ctx.from?.id ?? "unknown"}`).catch(() => undefined);
      return;
    }
    await next();
  });

  bot.command("start", (ctx) => ctx.reply(WELCOME));
  bot.command("help", (ctx) => ctx.reply(WELCOME));
  bot.command("id", (ctx) => ctx.reply(`Your Telegram id: ${ctx.from?.id}`));

  bot.command("up", async (ctx) => {
    const argument = ctx.match.trim();
    if (!argument) {
      const keyboard = new InlineKeyboard();
      parseRegions(env).forEach((region, index) => {
        if (index > 0 && index % 2 === 0) keyboard.row();
        keyboard.text(region.label, `up:${region.id}`);
      });
      await ctx.reply("Choose a region:", { reply_markup: keyboard });
      return;
    }

    const region =
      findRegion(env, argument) ??
      parseRegions(env).find((candidate) => candidate.label.toLowerCase() === argument.toLowerCase());

    if (!region) {
      await ctx.reply(`Unknown region "${argument}". Try: ${parseRegions(env).map((r) => r.id).join(", ")}`);
      return;
    }

    await startProvision(ctx.api, env, publicUrl, ctx.chat.id, region);
  });

  bot.callbackQuery(/^up:(.+)$/, async (ctx) => {
    const region = findRegion(env, ctx.match[1] ?? "");
    await ctx.answerCallbackQuery(region ? `Creating ${region.label}…` : "Unknown region");
    if (!region || !ctx.chat) return;
    await startProvision(ctx.api, env, publicUrl, ctx.chat.id, region);
  });

  bot.command("down", async (ctx) => {
    const records = await listInstanceRecords(env.KV);
    if (records.length === 0) {
      await ctx.reply("Nothing to destroy.");
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const record of records) {
      keyboard.text(`${record.regionLabel} · ${record.ip}`, `down:${record.id}`).row();
    }
    await ctx.reply("Destroy which server?", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^down:(.+)$/, async (ctx) => {
    const record = await getInstance(env.KV, ctx.match[1] ?? "");
    if (!record) {
      await ctx.answerCallbackQuery("Server is gone");
      return;
    }
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text("Yes, destroy", `confirm:${record.id}`)
      .text("Cancel", `cancel:${record.id}`);
    await ctx.editMessageText(
      `Destroy ${record.regionLabel} (${record.ip})?\nThis cannot be undone.`,
      { reply_markup: keyboard },
    ).catch(() => undefined);
  });

  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    const id = ctx.match[1] ?? "";
    const record = await getInstance(env.KV, id);
    if (!record) {
      await ctx.answerCallbackQuery("Already gone");
      return;
    }
    await ctx.answerCallbackQuery("Destroying…");
    try {
      await destroyInstance(env.VULTR_API_TOKEN, id).catch((error: unknown) => {
        if (error instanceof VultrError && error.status === 404) return;
        throw error;
      });
      await deleteInstanceRecord(env.KV, record);
      await ctx.editMessageText(`🗑 Destroyed ${record.regionLabel} (${record.ip})`).catch(() => undefined);
    } catch (error) {
      await ctx.editMessageText(`❌ Destroy failed: ${errorText(error)}`).catch(() => undefined);
    }
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    await ctx.editMessageText("Cancelled.").catch(() => undefined);
  });

  bot.command("status", async (ctx) => {
    const records = await listInstanceRecords(env.KV);
    const live = new Map<string, string>();
    try {
      for (const instance of await listInstances(env.VULTR_API_TOKEN)) {
        live.set(instance.id, instance.power_status);
      }
    } catch {
      // Live state is best effort; KV state still renders.
    }
    await ctx.reply(statusMessage(records, live));
  });

  bot.catch(async (error) => {
    console.error("bot error", error);
    const chatId = error.ctx.chat?.id;
    if (chatId) await error.ctx.api.sendMessage(chatId, `⚠️ ${errorText(error.error)}`).catch(() => undefined);
  });

  return bot;
}
