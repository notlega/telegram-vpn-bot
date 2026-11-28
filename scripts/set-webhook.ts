/**
 * registers or removes the Telegram webhook
 *
 * usage:
 *   bun scripts/set-webhook.ts <workers-url>
 *   bun scripts/set-webhook.ts --delete
 *
 * reads BOT_TOKEN and WEBHOOK_SECRET from .env (bun loads it automatically)
 */

/** body sent to `setWebhook` */
interface SetWebhookPayload {
  /** webhook url including the `/telegram` path */
  url: string;

  /** update types telegram should deliver */
  allowed_updates: string[];

  /** shared secret telegram echoes back in `X-Telegram-Bot-Api-Secret-Token` */
  secret_token?: string;
}

/** one entry in the Telegram command menu */
interface BotCommand {
  /** command name without the leading slash */
  command: string;

  /** menu description */
  description: string;
}

/** one telegram api call this script can make */
type WebhookRequest =
  | { method: "deleteWebhook" }
  | { method: "setWebhook"; payload: SetWebhookPayload }
  | { method: "setMyCommands"; payload: { commands: BotCommand[] } };

/** command menu shown by Telegram clients; mirrors the handlers in src/bot.ts */
const COMMANDS: BotCommand[] = [
  { command: "create", description: "create a VLESS + REALITY server" },
  { command: "restart", description: "reboot a server" },
  { command: "destroy", description: "destroy a server" },
  { command: "status", description: "list tracked servers" },
];

/** reply envelope shared by every telegram api call */
interface TelegramResponse {
  /** whether the api call succeeded */
  ok: boolean;

  /** error description when `ok` is false */
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
  console.error("BOT_TOKEN missing. copy .env.example to .env and fill it in");
  process.exit(1);
}

const api = (method: string): string => `https://api.telegram.org/bot${token}/${method}`;

/**
 * calls one Telegram Bot API method and exits on failure
 *
 * @param request — discriminated request describing the method and its payload
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
 * validates a worker origin and appends the webhook path
 *
 * @param value — base URL, must use https
 * @returns the final webhook endpoint
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
  console.info("webhook removed");
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
await call({ method: "setMyCommands", payload: { commands: COMMANDS } });
console.info(`webhook set: ${endpoint}${secret ? " (secret token enabled)" : ""}`);
console.info(`command menu set: ${COMMANDS.map((entry) => `/${entry.command}`).join(", ")}`);

export {};
