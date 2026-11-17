/**
 * Registers or removes the Telegram webhook
 *
 * Usage:
 *   bun scripts/set-webhook.ts <workers-url>
 *   bun scripts/set-webhook.ts --delete
 *
 * Reads BOT_TOKEN and WEBHOOK_SECRET from .env (bun loads it automatically)
 */

interface SetWebhookPayload {
  url: string;
  allowed_updates: string[];
  secret_token?: string;
}

type WebhookRequest =
  | { method: "deleteWebhook" }
  | { method: "setWebhook"; payload: SetWebhookPayload };

interface TelegramResponse {
  ok: boolean;
  description?: string;
}

const USAGE = [
  "usage: bun scripts/set-webhook.ts <workers-url>",
  "       bun scripts/set-webhook.ts --delete",
].join("\n");

const args = process.argv.slice(2);
const deleteMode = args.includes("--delete");
const positionals = args.filter((arg) => !arg.startsWith("--"));
const unknownFlags = args.filter((arg) => arg.startsWith("--") && arg !== "--delete");

if (unknownFlags.length > 0 || positionals.length > 1 || (deleteMode && positionals.length > 0)) {
  console.error(`unexpected arguments: ${args.join(" ")}`);
  console.error(USAGE);
  process.exit(1);
}

const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;

if (!token) {
  console.error("BOT_TOKEN missing. copy .env.example to .env and fill it in.");
  process.exit(1);
}

const api = (method: string): string => `https://api.telegram.org/bot${token}/${method}`;

/**
 * Calls one Telegram Bot API method and exits on failure.
 *
 * @param request — discriminated request describing the method and its payload.
 */
async function call(request: WebhookRequest): Promise<void> {
  const response = await fetch(api(request.method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify("payload" in request ? request.payload : {}),
  });

  const result = (await response.json()) as TelegramResponse;

  if (!result.ok) {
    console.error(`${request.method} failed: ${result.description ?? "unknown error"}`);
    process.exit(1);
  }
}

/**
 * Validates a worker origin and appends the webhook path.
 *
 * @param value — base URL, must use https.
 * @returns the final webhook endpoint.
 */
function buildEndpoint(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    console.error(`invalid workers url: ${value}`);
    process.exit(1);
  }

  if (url.protocol !== "https:") {
    console.error(`telegram webhooks require https, got "${url.protocol}"`);
    process.exit(1);
  }

  return new URL("/telegram", url).toString();
}

if (deleteMode) {
  await call({ method: "deleteWebhook" });
  console.log("webhook removed");
  process.exit(0);
}

const baseUrl = positionals[0];

if (!baseUrl) {
  console.error(USAGE);
  process.exit(1);
}

const endpoint = buildEndpoint(baseUrl);

const payload: SetWebhookPayload = {
  url: endpoint,
  allowed_updates: ["message", "callback_query"],
};

if (secret) {
  payload.secret_token = secret;
}

await call({ method: "setWebhook", payload });
console.log(`webhook set: ${endpoint}${secret ? " (secret token enabled)" : ""}`);

export {};
