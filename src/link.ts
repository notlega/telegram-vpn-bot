/**
 * share-link construction for the provisioned servers
 */

/** inputs needed to build a client-importable VLESS + REALITY link */
export interface VlessParams {
  /** server address, IPv4 or hostname */
  host: string;

  /** TCP port; defaults to 443 */
  port?: number;

  /** VLESS user id (UUID) */
  uuid: string;

  /** REALITY public key in base64url, sent as `pbk` */
  publicKey: string;

  /** REALITY short id in hex, sent as `sid` */
  shortId: string;

  /** REALITY camouflage host, sent as `sni` */
  sni: string;

  /** display name shown by the client after import */
  label: string;

  /** XTLS flow control; defaults to `xtls-rprx-vision` */
  flow?: string;
}

/**
 * builds a VLESS + REALITY share link importable by v2rayN and v2rayNG
 *
 * the link hard-codes the settings this bot provisions: TCP transport, REALITY
 * security, `chrome` fingerprint and XTLS Vision flow
 *
 * @param params — server address and credentials
 * @returns a `vless://` URL. Treat it as a bearer credential
 * @example
 * buildVlessLink({ host: "203.0.113.10", uuid, publicKey, shortId, sni, label });
 * // vless://<uuid>@203.0.113.10:443?type=tcp&security=reality&…#VPN-Seoul
 */
export function buildVlessLink(params: VlessParams): string {
  const port = params.port ?? 443;
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

  return `vless://${params.uuid}@${params.host}:${port}?${query.toString()}#${encodeURIComponent(params.label)}`;
}
