/**
 * Provisions a fresh Vultr instance entirely from user-data (cloud-init).
 *
 * Vultr Alpine images ship without cloud-init, so the bot targets Debian by
 * default (configurable via OS_NAME). The script installs Xray, wires a
 * systemd unit, turns on BBR and then calls back to the worker.
 */

export interface ProvisionParams {
  uuid: string;
  privateKey: string;
  shortId: string;
  sni: string;
  callbackUrl: string;
  secret: string;
}

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

/** Vultr expects user-data as base64. */
export function encodeUserData(script: string): string {
  return btoa(script);
}
