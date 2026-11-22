import type { InstanceRecord } from "./env";
import { buildVlessLink } from "./link";

/**
 * formats how long ago a record was created
 *
 * @param createdAt — creation timestamp in epoch milliseconds
 * @returns compact age such as `12m`, `5h` or `3d`
 */
export function formatAge(createdAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.floor(hours / 24)}d`;
}

/**
 * formats an elapsed duration for chat copy
 *
 * @param ms — elapsed milliseconds
 * @returns compact duration such as `42 s` or `2m 05s`
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 60) {
    return `${seconds} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

/**
 * builds the share link for a tracked instance
 *
 * @param record — instance record with a resolved IP
 * @returns the `vless://` link clients import
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
 * renders the link as a Telegram HTML code block so clients can copy it with
 * one tap
 *
 * @param link — the `vless://` link
 * @returns HTML fragment, safe because the link cannot contain markup
 */
function linkBlock(link: string): string {
  return `<pre>${link.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
}

/**
 * renders the "server ready" chat message
 *
 * the result is HTML with the link inside a code block; send it with
 * `parse_mode: "HTML"`
 *
 * @param record — instance that finished provisioning
 * @param link — share link for the client
 * @param note — optional warning appended above the link, used when the
 *   bootstrap callback was missed
 * @returns HTML message body
 */
export function readyMessage(record: InstanceRecord, link: string, note?: string): string {
  return [
    `✅ ${record.regionLabel} server ready`,
    `ip: ${record.ip}`,
    `instance: ${record.id}`,
    note ? `\n${note}\n` : "",
    "import in v2rayN: servers → import from clipboard.",
    "",
    linkBlock(link),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/**
 * renders the restart-confirmed chat message
 *
 * @param record — instance that came back online
 * @param elapsedMs — time between the reboot request and the confirmation
 * @returns plain-text message body
 */
export function restartedMessage(record: InstanceRecord, elapsedMs: number): string {
  return `✅ ${record.regionLabel} (${record.ip}) restarted in ${formatDuration(elapsedMs)}.`;
}

/**
 * renders the message shown when a reboot never confirmed
 *
 * @returns plain-text message body
 */
export function restartUnconfirmedMessage(): string {
  return "⚠️ restart not confirmed after 10 minutes, check /status.";
}

/**
 * renders the provisioning-failure chat message
 *
 * @param record — instance that failed
 * @param reason — short explanation shown to the operator
 * @returns plain-text message body
 */
export function failedMessage(record: InstanceRecord, reason: string): string {
  return [
    `❌ ${record.regionLabel} provisioning failed`,
    `instance: ${record.id}`,
    `reason: ${reason}`,
    "",
    "check /status, then /destroy to remove the instance.",
  ].join("\n");
}

/**
 * renders one line of the `/status` list
 *
 * the live suffix is dropped when it repeats the record state: `running` for a
 * ready server
 *
 * @param record — tracked instance
 * @param liveState — optional live status from the linode api
 * @returns single line such as `Seoul · 203.0.113.10 · 12m · ready`
 */
export function instanceLine(record: InstanceRecord, liveState?: string): string {
  const quiet = liveState !== undefined && record.state === "ready" && liveState === "running";
  const state = liveState && !quiet ? `${record.state}/${liveState}` : record.state;

  return `${record.regionLabel} · ${record.ip} · ${formatAge(record.createdAt)} · ${state}`;
}

/**
 * renders the full `/status` reply
 *
 * @param records — tracked instances
 * @param live — live power states keyed by instance id; missing keys fall back
 *   to the KV state
 * @returns plain-text message body
 */
export function statusMessage(records: InstanceRecord[], live: Map<string, string>): string {
  if (records.length === 0) {
    return "no servers tracked. use /create to create one.";
  }

  const lines = records.map((record) => instanceLine(record, live.get(record.id)));

  return [
    "tracked servers:",
    ...lines,
    "",
    "/create — new server, /restart — reboot a server",
    "/destroy — remove",
  ].join("\n");
}
