#!/usr/bin/env bun
/**
 * Registers or removes the Telegram webhook.
 *
 * Usage:
 *   bun scripts/set-webhook.ts https://<worker>.workers.dev
 *   bun scripts/set-webhook.ts --delete
 *
 * Reads BOT_TOKEN and WEBHOOK_SECRET from .env (Bun loads it automatically).
 */

const args = process.argv.slice(2);
const deleteMode = args.includes("--delete");
const baseUrl = args.find((arg) => !arg.startsWith("--"));

const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;

if (!token) {
  console.error("BOT_TOKEN missing. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const api = (method: string): string => `https://api.telegram.org/bot${token}/${method}`;

async function call(method: string, payload: Record<string, unknown> = {}): Promise<void> {
  const response = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = (await response.json()) as { ok: boolean; description?: string };
  if (!result.ok) {
    console.error(`${method} failed: ${result.description ?? JSON.stringify(result)}`);
    process.exit(1);
  }
}

if (deleteMode) {
  await call("deleteWebhook");
  console.log("webhook removed");
  process.exit(0);
}

if (!baseUrl) {
  console.error("usage: bun scripts/set-webhook.ts https://<worker>.workers.dev [--delete]");
  process.exit(1);
}

const endpoint = new URL("/telegram", baseUrl).toString();
const payload: Record<string, unknown> = {
  url: endpoint,
  allowed_updates: ["message", "callback_query"],
};

if (secret) payload.secret_token = secret;

await call("setWebhook", payload);
console.log(`webhook set: ${endpoint}${secret ? " (secret token enabled)" : ""}`);

export {};
