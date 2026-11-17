export interface Env {
  KV: KVNamespace;
  BOT_TOKEN: string;
  VULTR_API_TOKEN: string;
  ALLOWED_USER_ID: string;
  SNI: string;
  REGIONS: string;
  PLAN: string;
  OS_NAME: string;
  WEBHOOK_SECRET?: string;
}

export type InstanceState = "provisioning" | "ready" | "failed";

export interface InstanceRecord {
  /** Vultr instance id (SUBID). */
  id: string;
  region: string;
  regionLabel: string;
  ip: string;
  state: InstanceState;
  chatId: number;
  messageId: number;
  /** One-time token used by the provisioning script to report completion. */
  secret: string;
  uuid: string;
  publicKey: string;
  privateKey: string;
  shortId: string;
  sni: string;
  createdAt: number;
  readyAt?: number;
  error?: string;
}

export interface Region {
  id: string;
  label: string;
}
