/**
 * Bindings and configuration the worker receives from `wrangler.toml` and the
 * Cloudflare secret store.
 */
export interface Env {
  /** Workers KV namespace holding instance records and callback tokens. */
  KV: KVNamespace;
  /** Telegram bot token issued by @BotFather. Secret. */
  BOT_TOKEN: string;
  /** Vultr API v2 token with instance and IPv4 read/write access. Secret. */
  VULTR_API_TOKEN: string;
  /** Comma separated Telegram user ids allowed to control the bot. Secret. */
  ALLOWED_USER_ID: string;
  /** REALITY camouflage host. Its TLS handshake is what an unauthenticated peer sees. */
  SNI: string;
  /** `id:label` pairs offered in the `/up` menu, for example `icn:Seoul,nrt:Tokyo`. */
  REGIONS: string;
  /** Vultr plan id used for new instances. */
  PLAN: string;
  /** OS family prefix resolved to the newest matching x64 image, for example `Debian`. */
  OS_NAME: string;
  /** When set, webhook requests must carry this `X-Telegram-Bot-Api-Secret-Token`. */
  WEBHOOK_SECRET?: string;
}

/** Lifecycle state of a tracked server. */
export type InstanceState = "provisioning" | "ready" | "failed";

/**
 * Everything the bot needs to remember about one Vultr instance. Stored in KV
 * under `inst:<id>`; the `secret` field is additionally indexed as
 * `secret:<secret>` so the bootstrap callback can authenticate itself.
 */
export interface InstanceRecord {
  /** Vultr instance id (SUBID). */
  id: string;
  /** Vultr region id the instance was created in, for example `icn`. */
  region: string;
  /** Human readable region name used in chat messages. */
  regionLabel: string;
  /** Public IPv4 address, or `pending` until the instance reports one. */
  ip: string;
  /** Current lifecycle state. */
  state: InstanceState;
  /** Telegram chat that owns the status message. */
  chatId: number;
  /** Telegram message id the bot edits when the state changes. */
  messageId: number;
  /** One-time token used by the provisioning script to report completion. */
  secret: string;
  /** VLESS user id handed to Xray and embedded in the share link. */
  uuid: string;
  /** X25519 public key in base64url; published in the share link as `pbk`. */
  publicKey: string;
  /** X25519 private key in base64url; only ever written to the server config. */
  privateKey: string;
  /** REALITY short id in hex. */
  shortId: string;
  /** REALITY camouflage host active on this instance. */
  sni: string;
  /** Creation timestamp in epoch milliseconds. */
  createdAt: number;
  /** Timestamp in epoch milliseconds when the instance reported ready. */
  readyAt?: number;
  /** Failure reason when `state` is `failed`. */
  error?: string;
}

/** A region button offered in the `/up` menu. */
export interface Region {
  /** Vultr region id, for example `icn`. */
  id: string;
  /** Display name shown on the inline keyboard. */
  label: string;
}
