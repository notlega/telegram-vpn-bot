# telegram-vpn-bot

Serverless Telegram bot that provisions and destroys **VLESS + REALITY** proxy
servers on Vultr. Runs entirely on Cloudflare Workers: webhook in, Vultr API
out, fresh credentials per server, no always-on process to babysit.

## What it does

| Command   | Action                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/up`     | Pick a region (Seoul / Tokyo / Singapore), bot creates a Vultr instance, waits for it to bootstrap Xray, then posts an importable `vless://` link + QR code |
| `/down`   | Destroy a tracked instance (two-step confirmation)                                                                                                          |
| `/status` | Tracked servers with age and live power state                                                                                                               |
| `/id`     | Print your Telegram id (setup helper)                                                                                                                       |

Every server gets a new X25519 key pair, UUID and short id, generated with
WebCrypto inside the worker. Workers KV holds the registry, and each share link
is a bearer credential, so treat it as a secret.

## Stack

- Cloudflare Workers (free tier) + [grammY](https://grammy.dev/)
- Workers KV for instance registry
- Cron trigger (`* * * * *`) for provisioning reconciliation
- Vultr API v2 for instance lifecycle
- Vultr user-data (cloud-init) for zero-touch Xray install on Debian
- Bun for tooling, Biome for lint and format

## Quick start

```sh
bun install                                    # installs project-local wrangler
bunx wrangler login
bunx wrangler kv namespace create KV           # paste id into wrangler.toml
cp .env.example .env                           # fill in 4 values
bun run secrets                                # push them to Cloudflare
bun run deploy
bun run set-webhook -- <workers-url>
```

Then open the bot and send `/up`.

Full walkthrough: [Deployment](deployment)

## Docs

| Page                         | Contents                                                |
| ---------------------------- | ------------------------------------------------------- |
| [Architecture](architecture) | request flow, KV schema, reconciliation, security model |
| [Deployment](deployment)     | zero → live runbook                                     |
| [Clients](clients)           | importing links into v2rayN / v2rayNG                   |
| [Operations](operations)     | IP-burn lifecycle, cost, troubleshooting                |
