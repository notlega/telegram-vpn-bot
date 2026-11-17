export interface VlessParams {
  host: string;
  port?: number;
  uuid: string;
  publicKey: string;
  shortId: string;
  sni: string;
  label: string;
  flow?: string;
}

/** Builds a VLESS + REALITY share link importable by v2rayN / v2rayNG. */
export function buildVlessLink(params: VlessParams): string {
  const query = new URLSearchParams({
    type: "tcp",
    security: "reality",
    encryption: "none",
    flow: params.flow ?? "xtls-rprx-vision",
    sni: params.sni,
    fp: "chrome",
    pbk: params.publicKey,
    sid: params.shortId,
  });

  const port = params.port ?? 443;
  return `vless://${params.uuid}@${params.host}:${port}?${query.toString()}#${encodeURIComponent(params.label)}`;
}
