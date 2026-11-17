import type { InstanceRecord } from "./env";
import { buildVlessLink } from "./link";

/**
 * Formats how long ago a record was created.
 *
 * @param createdAt — creation timestamp in epoch milliseconds.
 * @returns compact age such as `12m`, `5h` or `3d`.
 */
export function formatAge(createdAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Builds the share link for a tracked instance.
 *
 * @param record — instance record with a resolved IP.
 * @returns the `vless://` link clients import.
 */
export function recordLink(record: InstanceRecord): string {
  return buildVlessLink({
    host: record.ip,
    uuid: record.uuid,
    publicKey: record.publicKey,
    shortId: record.shortId,
    sni: record.sni,
    label: `VPN-${record.regionLabel.replace(/\s+/g, "")}`,
  });
}

/**
 * Renders the "server ready" chat message.
 *
 * @param record — instance that finished provisioning.
 * @param link — share link for the client.
 * @param note — optional warning appended above the link, used when the
 *   bootstrap callback was missed.
 * @returns plain-text message body.
 */
export function readyMessage(record: InstanceRecord, link: string, note?: string): string {
  return [
    `✅ ${record.regionLabel} server ready`,
    `IP: ${record.ip}`,
    `instance: ${record.id}`,
    note ? `\n${note}\n` : "",
    "Import in v2rayN: Servers → Import from clipboard.",
    "",
    link,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/**
 * Renders the provisioning-failure chat message.
 *
 * @param record — instance that failed.
 * @param reason — short explanation shown to the operator.
 * @returns plain-text message body.
 */
export function failedMessage(record: InstanceRecord, reason: string): string {
  return [
    `❌ ${record.regionLabel} provisioning failed`,
    `instance: ${record.id}`,
    `reason: ${reason}`,
    "",
    "Check /status, then /down to remove the instance.",
  ].join("\n");
}

/**
 * Renders one line of the `/status` list.
 *
 * @param record — tracked instance.
 * @param liveState — optional live power state from the Vultr API.
 * @returns single line such as `Seoul · 203.0.113.10 · 12m · ready/running`.
 */
export function instanceLine(record: InstanceRecord, liveState?: string): string {
  const state = liveState ? `${record.state}/${liveState}` : record.state;
  return `${record.regionLabel} · ${record.ip} · ${formatAge(record.createdAt)} · ${state}`;
}

/**
 * Renders the full `/status` reply.
 *
 * @param records — tracked instances.
 * @param live — live power states keyed by instance id; missing keys fall back
 *   to the KV state.
 * @returns plain-text message body.
 */
export function statusMessage(records: InstanceRecord[], live: Map<string, string>): string {
  if (records.length === 0) return "No servers tracked. Use /up to create one.";
  const lines = records.map((record) => instanceLine(record, live.get(record.id)));
  return ["Tracked servers:", ...lines, "", "/up — create, /down — destroy"].join("\n");
}
