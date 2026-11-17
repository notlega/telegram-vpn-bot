# Clients

The bot posts two things per server: a `vless://` link and a QR code PNG. Either
is enough to import.

## Desktop (v2rayN)

1. Copy the link from the bot message.
2. v2rayN → **Servers → Import bulk URL from clipboard**.
3. Select the new node, press **Enter** (or Set as active server).
4. System proxy: v2rayN tray → **System proxy → Set system proxy**.

Updating when the IP changes: either edit the existing node (double-click →
change address) or delete it and import the fresh link.

Check the tunnel:

```sh
curl -s -x http://127.0.0.1:10808 ifconfig.me
```

## Android (v2rayNG)

1. Open the QR code image from the bot on another screen.
2. v2rayNG → **+** → **Scan QR code**.
3. Tap the imported profile → **Connect**.
4. Verify in a browser: `ifconfig.me` shows the server IP.

Alternative without a second screen: bot message → long-press link → copy →
v2rayNG → **+** → **Import from clipboard**.

## Terminal proxy toggles (zsh)

Append to `~/.zshrc`:

```sh
proxy_on() {
  export http_proxy=http://127.0.0.1:10808
  export https_proxy=http://127.0.0.1:10808
  export all_proxy=socks5://127.0.0.1:10808
  export no_proxy=localhost,127.0.0.1
  echo "proxy ON  -> 127.0.0.1:10808"
}
proxy_off() {
  unset http_proxy https_proxy all_proxy no_proxy
  echo "proxy OFF -> direct"
}
proxy_status() {
  if [ -n "$http_proxy" ]; then echo "proxy ON: $http_proxy"; else echo "proxy OFF"; fi
}
```

Notes:

- Port `10808` matches the default v2rayN mixed listener. Change it if your
  client uses another.
- `curl` ignores the desktop's system proxy setting; it only honours these
  environment variables.
- Some package managers need extra config (`npm config set proxy …`), the
  environment variables cover most CLI tools.

## Multiple servers

Each `/up` yields a distinct profile. Keep the old profile until the new one is
verified, then `/down` the old instance and delete its profile. Two active
profiles pointing at dead servers cause confusing timeouts.
