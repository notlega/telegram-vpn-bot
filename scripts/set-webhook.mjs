#!/usr/bin/env node
/**
 * Registers the Telegram webhook.
 *
 * Usage:
 *   node scripts/set-webhook.mjs https://<worker>.workers.dev
 *
 * Reads BOT_TOKEN and WEBHOOK_SECRET from .dev.vars (or the environment).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDevVars() {
  const file = resolve(process.cwd(), ".dev.vars");
  const vars = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Fall back to process env only.
  }
  return vars;
}

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("usage: node scripts/set-webhook.mjs https://<worker>.workers.dev");
  process.exit(1);
}

const vars = { ...loadDevVars(), ...process.env };
const token = vars.BOT_TOKEN;
const secret = vars.WEBHOOK_SECRET;

if (!token) {
  console.error("BOT_TOKEN missing (set in .dev.vars or environment)");
  process.exit(1);
}

const endpoint = new URL("/telegram", baseUrl).toString();
const body = { url: endpoint, allowed_updates: ["message", "callback_query"] };
if (secret) body.secret_token = secret;

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const result = await response.json();
if (!result.ok) {
  console.error("setWebhook failed", result);
  process.exit(1);
}

console.log(`webhook set: ${endpoint}${secret ? " (secret token enabled)" : ""}`);
