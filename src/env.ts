import type { Gatekeeper } from "./gatekeeper";

/**
 * bindings and configuration the worker receives from `wrangler.toml` and the
 * Cloudflare secret store
 */
export interface Env {
  /** Workers KV namespace holding instance records and callback tokens */
  KV: KVNamespace;

  /** per-sender abuse gate for updates outside the allowlist */
  GATEKEEPER: DurableObjectNamespace<Gatekeeper>;

  /** Telegram bot token issued by @BotFather. Secret */
  BOT_TOKEN: string;

  /** linode api token with read/write access. Secret */
  LINODE_API_TOKEN: string;

  /** optional comma separated Telegram user ids allowed to control the bot. secret */
  ALLOWED_USER_ID?: string;

  /** REALITY camouflage host. Its TLS handshake is what an unauthenticated peer sees */
  SNI: string;

  /** `id:label` pairs offered in the `/create` menu, for example `icn:Seoul,nrt:Tokyo` */
  REGIONS: string;

  /** linode plan id used for new instances, for example `g6-nanode-1` */
  TYPE: string;

  /** linode image id, must support cloud-init, for example `linode/debian13` */
  IMAGE: string;

  /** when set, webhook requests must carry this `X-Telegram-Bot-Api-Secret-Token` */
  WEBHOOK_SECRET?: string;
}

/** lifecycle state of a tracked server */
export type InstanceState = "provisioning" | "ready" | "failed";

/**
 * everything the bot needs to remember about one linode instance. Stored in KV
 * under `inst:<id>`; the `secret` field is additionally indexed as
 * `secret:<secret>` so the bootstrap callback can authenticate itself
 */
export interface InstanceRecord {
  /** linode instance id */
  id: string;

  /** linode region id the instance was created in, for example `jp-tyo-3` */
  region: string;

  /** human readable region name used in chat messages */
  regionLabel: string;

  /** public IPv4 address, or `pending` until the instance reports one */
  ip: string;

  /** current lifecycle state */
  state: InstanceState;

  /** Telegram chat that owns the status message */
  chatId: number;

  /** Telegram message id the bot edits when the state changes */
  messageId: number;

  /** one-time token used by the provisioning script to report completion */
  secret: string;

  /** VLESS user id handed to Xray and embedded in the share link */
  uuid: string;

  /** X25519 public key in base64url; published in the share link as `pbk` */
  publicKey: string;

  /** X25519 private key in base64url; only ever written to the server config */
  privateKey: string;

  /** REALITY short id in hex */
  shortId: string;

  /** REALITY camouflage host active on this instance */
  sni: string;

  /** creation timestamp in epoch milliseconds */
  createdAt: number;

  /** timestamp in epoch milliseconds when the instance reported ready */
  readyAt?: number;

  /** failure reason when `state` is `failed` */
  error?: string;
}

/** A region button offered in the `/create` menu */
export interface Region {
  /** linode region id, for example `jp-tyo-3` */
  id: string;

  /** display name shown on the inline keyboard */
  label: string;
}
