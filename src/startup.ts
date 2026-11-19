/**
 * provisions a fresh linode instance entirely from user-data (cloud-init)
 *
 * the configured image must support cloud-init or this script never runs. the
 * default is Debian. The script installs Xray, wires a systemd unit, turns on
 * BBR and then calls back to the worker
 */

/** credentials and callback details baked into one instance's bootstrap */
export interface ProvisionParams {
  /** VLESS user id written into the Xray config */
  uuid: string;

  /** REALITY X25519 private key in base64url */
  privateKey: string;

  /** REALITY short id in hex */
  shortId: string;

  /** REALITY camouflage host; also used as the REALITY `dest` */
  sni: string;

  /** absolute worker URL the script calls when Xray is up, usually `<public>/ready` */
  callbackUrl: string;

  /** one-time token appended to the callback URL */
  secret: string;
}

/**
 * builds the Xray server config: one VLESS + REALITY inbound on `:443` with
 * XTLS Vision, direct outbound, private ranges blocked
 *
 * @param params — credentials for this instance
 * @returns pretty-printed JSON ready to write to `config.json`
 */
export function buildServerConfig(params: ProvisionParams): string {
  return JSON.stringify(
    {
      log: { loglevel: "warning", access: "none" },
      inbounds: [
        {
          tag: "vless-reality",
          listen: "0.0.0.0",
          port: 443,
          protocol: "vless",
          settings: {
            clients: [{ id: params.uuid, flow: "xtls-rprx-vision" }],
            decryption: "none",
          },
          streamSettings: {
            network: "tcp",
            security: "reality",
            realitySettings: {
              dest: `${params.sni}:443`,
              serverNames: [params.sni],
              privateKey: params.privateKey,
              shortIds: [params.shortId],
            },
          },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] },
        },
      ],
      outbounds: [
        { tag: "direct", protocol: "freedom" },
        { tag: "block", protocol: "blackhole" },
      ],
      routing: {
        rules: [{ type: "field", ip: ["geoip:private"], outboundTag: "block" }],
      },
    },
    null,
    2,
  );
}

/**
 * builds the cloud-init shell script that prepares a fresh Debian box
 *
 * The script installs curl and unzip, downloads the latest Xray release,
 * writes the config and a systemd unit, enables BBR, then calls the worker back
 * up to six times so provisioning can finish without SSH
 *
 * @param params — credentials and callback details
 * @returns a POSIX shell script suitable for linode metadata user data
 * @example
 * const script = buildUserData({ uuid, privateKey, shortId, sni, callbackUrl, secret });
 */
export function buildUserData(params: ProvisionParams): string {
  const config = buildServerConfig(params);
  const callback = params.callbackUrl.includes("?")
    ? `${params.callbackUrl}&token=${params.secret}`
    : `${params.callbackUrl}?token=${params.secret}`;

  return `#!/bin/sh
set -eu
exec >/var/log/vpn-setup.log 2>&1

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends curl unzip ca-certificates

install -d -m 0755 /usr/local/bin /usr/local/etc/xray
cd /tmp
curl -fsSL --retry 3 -o xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip
unzip -oq xray.zip -d /usr/local/bin
chmod 0755 /usr/local/bin/xray

cat > /usr/local/etc/xray/config.json <<'XRAY_CONFIG'
${config}
XRAY_CONFIG

cat > /etc/systemd/system/xray.service <<'XRAY_SERVICE'
[Unit]
Description=Xray Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/xray run -c /usr/local/etc/xray/config.json
Environment=XRAY_LOCATION_ASSET=/usr/local/bin
Restart=on-failure
RestartSec=3
LimitNOFILE=65535
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
XRAY_SERVICE

systemctl daemon-reload
systemctl enable --now xray

printf '%s\\n' 'net.core.default_qdisc=fq' 'net.ipv4.tcp_congestion_control=bbr' > /etc/sysctl.d/99-bbr.conf
sysctl --system >/dev/null 2>&1 || true

for attempt in 1 2 3 4 5 6; do
  IP=$(curl -fsS --max-time 8 https://api.ipify.org || true)
  if [ -n "\${IP:-}" ] && curl -fsS --max-time 10 "${callback}&ip=\${IP}" >/dev/null 2>&1; then
    break
  fi
  sleep 10
done
`;
}

/**
 * base64 encodes a bootstrap script the way the metadata service expects
 *
 * @param script — plain shell script
 * @returns base64 representation
 */
export function encodeUserData(script: string): string {
  return btoa(script);
}
