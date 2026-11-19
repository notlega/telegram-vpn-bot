# Operations

## Daily use

| Task            | Do this                  |
| --------------- | ------------------------ |
| New server      | `/up` → region           |
| Check fleet     | `/status`                |
| Remove a server | `/down` → pick → confirm |
| See your TG id  | `/id`                    |

Provisioning takes roughly 2 minutes: instance boot (~30 s), `apt-get` + Xray
download (~60 s), callback. The bot edits its status message when done.

## IP burned / blocked: the lifecycle

Budget cloud IPs get blocked by the GFW eventually. Typical symptoms:

- Proxy connects but pages time out, or handshake fails
- Direct probes from a mainland connection show TCP 443 dead while the linode
  console is healthy
- A mobile-network hotspot (different path) still works. That points at a
  path-specific block.

Replacement flow:

1. `/up` in a different region (or the same region; a new instance gets a
   new IP)
2. Wait for link + QR
3. Verify with the new profile **before** destroying anything
4. `/down` the old instance

Nothing else to do. New keys, UUID, short id and IP come automatically, and
client profiles are per-link, so add the new one and delete the old one.

## Cost

| Item                                | Cost                          |
| ----------------------------------- | ----------------------------- |
| Cloudflare Workers + KV + cron      | $0 (free tier)                |
| linode `g6-nanode-1` (1 vCPU, 1 GB) | ≈ $5/month per running server |
| Destroyed instances                 | $0                            |

The bot itself is free; only live instances bill. Destroy old instances
promptly, and use `/status` as the inventory.

## Troubleshooting

| Symptom                                | Check                                                         | Fix                                                              |
| -------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/up` replies with a linode error      | cloud.linode.com → profile → api tokens                       | Token needs read/write scopes                                    |
| "type not available"                   | `TYPE` in `wrangler.toml`                                     | Pick a type available in that region                             |
| Vultr blocked the worker with html 403 | error body starts with `<html>` and an nginx footer           | Vultr blocks cloudflare egress, that is why this bot uses linode |
| No link after 3 min                    | `/status` state                                               | Wait for the 8-minute cron fallback                              |
| Failed after 15 min                    | linode lish console → `/var/log/vpn-setup.log`                | Look for `apt-get` or `curl` failures (transient mirror/network) |
| Link imported, no traffic              | Client log, then `curl -x http://127.0.0.1:10808 ifconfig.me` | If empty, likely blocked IP → `/up` new server                   |
| Bot silent                             | `bunx wrangler tail`                                          | Webhook secret mismatch → re-run `bun run set-webhook`           |
| Webhook 403                            | `WEBHOOK_SECRET` vs Telegram registration                     | Re-register with the same secret                                 |
| Slow throughput                        | `mtr -T -P 443 -n -r -c 5 <server ip>`                        | routes are congestion-prone; try another region                  |

## Inspecting a provisioned server

The bot installs no SSH key, so use the linode lish console (or add a key later if you
want shell access). Run these on the provisioned server:

```sh
systemctl status xray
journalctl -u xray -n 50 --no-pager
cat /var/log/vpn-setup.log
/usr/local/bin/xray -test -c /usr/local/etc/xray/config.json
```

## Maintenance

- The bootstrap downloads the latest Xray release at provision time. Older
  servers keep whatever they installed; recreate to upgrade.
- `IMAGE` is a fixed linode image id, bump it when a new Debian release lands.
- linode occasionally changes plan availability per region. A 4xx in chat means
  update `TYPE` or `REGIONS`.
- If a camouflage host stops working, change `SNI`, redeploy, and create new
  servers. Existing servers keep the old SNI.
- Mux is incompatible with `xtls-rprx-vision`. Do not enable it in client
  profiles.

## Limits

- Single linode account, no multi-tenant isolation
- No automatic block detection; humans decide when to rotate IPs
- No SSH provisioning path; if cloud-init is unavailable the bootstrap cannot
  run (see `IMAGE` note in [Deployment](deployment))
- One region per instance; there is no load balancing
