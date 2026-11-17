import type { InstanceRecord } from "./env";
import { buildVlessLink } from "./link";

export function formatAge(createdAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

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

export function failedMessage(record: InstanceRecord, reason: string): string {
  return [
    `❌ ${record.regionLabel} provisioning failed`,
    `instance: ${record.id}`,
    `reason: ${reason}`,
    "",
    "Check /status, then /down to remove the instance.",
  ].join("\n");
}

export function instanceLine(record: InstanceRecord, liveState?: string): string {
  const state = liveState ? `${record.state}/${liveState}` : record.state;
  return `${record.regionLabel} · ${record.ip} · ${formatAge(record.createdAt)} · ${state}`;
}

export function statusMessage(records: InstanceRecord[], live: Map<string, string>): string {
  if (records.length === 0) return "No servers tracked. Use /up to create one.";
  const lines = records.map((record) => instanceLine(record, live.get(record.id)));
  return ["Tracked servers:", ...lines, "", "/up — create, /down — destroy"].join("\n");
}
