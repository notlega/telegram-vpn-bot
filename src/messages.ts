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
 * formats a us dollar amount for chat copy
 *
 * @param usd — amount in us dollars
 * @returns `$0.42` for amounts of a cent or more, `$0.0075` below that
 */
export function formatCost(usd: number): string {
  if (usd >= 0.01) {
    return `$${usd.toFixed(2)}`;
  }

  const fixed = usd.toFixed(4).replace(/0+$/, "");

  if (fixed.endsWith(".")) {
    return "$0.00";
  }

  return `$${fixed}`;
}

/** plan price used to fill gaps for records created before prices were stamped */
export interface PriceHint {
  /** hourly price in us dollars */
  hourly: number;

  /** monthly price in us dollars, the billing cap */
  monthly: number;
}

/** hours in a billing month, the divisor linode uses for its hourly rate */
const HOURS_PER_MONTH = 730;

/**
 * computes what an instance has billed since creation
 *
 * linode bills hourly, capped at the monthly price per started month, which is
 * why chat copy prefixes the result with `≈`
 *
 * @param record — tracked instance
 * @param fallback — plan price used for records created before the price was
 *   stamped
 * @returns accrued us dollars, or `null` when no price is known
 */
export function accruedUsd(record: InstanceRecord, fallback?: PriceHint): number | null {
  const hourly = record.priceHourly ?? fallback?.hourly;

  if (hourly === undefined) {
    return null;
  }

  const monthly = record.priceMonthly ?? fallback?.monthly;
  const hours = Math.max(0, Date.now() - record.createdAt) / 3_600_000;
  const raw = hours * hourly;

  if (monthly === undefined) {
    return raw;
  }

  const months = Math.max(1, Math.ceil(hours / HOURS_PER_MONTH));

  return Math.min(raw, months * monthly);
}

/**
 * renders the price note shown by `/start` and `/help`
 *
 * @param hourly — hourly price in us dollars
 * @param monthly — monthly price in us dollars
 * @param type — plan id shown to the operator
 * @returns chat copy line ending with a period
 */
export function costNote(hourly: number, monthly: number, type: string): string {
  return `instances cost ≈${formatCost(hourly)} per hour (≈${formatCost(monthly)} per month) on \`${type}\`.`;
}

/**
 * renders the fallback price note for a cold cache
 *
 * @returns chat copy line ending with a period
 */
export function costNoteFallback(): string {
  return "instances bill from creation until /destroy.";
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
 * @param price — plan price used for records created before the price was
 *   stamped
 * @returns single line such as `Seoul · 203.0.113.10 · 12m · ready · ≈$0.09`
 */
export function instanceLine(
  record: InstanceRecord,
  liveState?: string,
  price?: PriceHint,
): string {
  const quiet = liveState !== undefined && record.state === "ready" && liveState === "running";
  const state = liveState && !quiet ? `${record.state}/${liveState}` : record.state;
  const cost = accruedUsd(record, price);
  const line = `${record.regionLabel} · ${record.ip} · ${formatAge(record.createdAt)} · ${state}`;

  return cost === null ? line : `${line} · ≈${formatCost(cost)}`;
}

/**
 * renders the full `/status` reply
 *
 * @param records — tracked instances
 * @param live — live power states keyed by instance id; missing keys fall back
 *   to the KV state
 * @param price — plan price used for records created before the price was
 *   stamped
 * @returns plain-text message body
 */
export function statusMessage(
  records: InstanceRecord[],
  live: Map<string, string>,
  price?: PriceHint,
): string {
  if (records.length === 0) {
    return "no servers tracked. use /create to create one.";
  }

  const lines = records.map((record) => instanceLine(record, live.get(record.id), price));
  const costs = records
    .map((record) => accruedUsd(record, price))
    .filter((cost): cost is number => cost !== null);
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  const footer = ["/create — new server, /restart — reboot a server", "/destroy — remove"];

  if (costs.length > 0) {
    footer.push(`total accrued ≈${formatCost(total)}`);
  }

  return ["tracked servers:", ...lines, "", ...footer].join("\n");
}

/**
 * renders the destroy confirmation prompt
 *
 * @param record — instance about to be destroyed
 * @param price — plan price used for records created before the price was
 *   stamped
 * @returns chat copy with the accrued cost when it is known
 */
export function destroyPrompt(record: InstanceRecord, price?: PriceHint): string {
  const cost = accruedUsd(record, price);
  const priceLine = cost === null ? "" : `\naccrued ≈${formatCost(cost)} so far.`;

  return `⚠️ destroy ${record.regionLabel} · ${record.ip}?${priceLine}\nthis cannot be undone.`;
}

/**
 * renders the destroyed notice with the instance lifetime cost
 *
 * @param record — instance that was destroyed
 * @param cost — lifetime cost in us dollars, or `null` when no price is known
 * @returns chat copy ending with a period
 */
export function destroyedMessage(record: InstanceRecord, cost: number | null): string {
  const priceLine = cost === null ? "" : ` lifetime cost ≈${formatCost(cost)}.`;

  return `🗑 destroyed ${record.regionLabel} · ${record.ip}.${priceLine}`;
}
