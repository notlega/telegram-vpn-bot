# telegram-vpn-bot

Serverless Telegram bot that provisions, reboots and destroys **VLESS + REALITY**
proxy servers on Linode. Runs entirely on Cloudflare Workers: webhook in, Linode
API out, fresh credentials per server, no always-on process to babysit.

## What it does

| Command            | Action                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/create [region]` | provision a server (Tokyo / Osaka / Singapore) by region argument or button, then get the `vless://` link in a copyable code block + QR code |
| `/restart [ip]`    | reboot a server by ip or button; the link survives, and the bot reports the time the reboot took                                             |     |
| `/destroy [ip]`    | destroy a tracked instance by ip (no prompt) or by button (two-step confirmation); both report the lifetime cost                             |
| `/status`          | tracked servers with age, live power state and accrued cost (usd), plus a fleet total                                                        |

Commands are slash-only. the bot registers no text matchers, so plain chat text
never reaches a handler.

Every server gets a new X25519 key pair, UUID and short id, generated with
WebCrypto inside the worker. Workers KV holds the registry, and each share link
is a bearer credential, so treat it as a secret.

## Stack

- Cloudflare Workers (free tier) + [grammY](https://grammy.dev/)
- Workers KV for instance registry
- Cron trigger (`*/2 * * * *`) for provisioning reconciliation
- Linode API v4 for instance lifecycle
- Linode metadata user-data (cloud-init) for zero-touch Xray install on Debian
- Bun for tooling, Biome for lint and format

## Quick start

Install dependencies and log in. Wrangler is pinned as a project devDependency.

```sh
bun install
bunx wrangler login
```

Copy the wrangler example to `wrangler.toml`, create the KV namespace, then
paste the printed id into the file.

```sh
cp wrangler.toml.example wrangler.toml
bunx wrangler kv namespace create KV
```

Copy the env example, fill in the values, and push them to Cloudflare.

```sh
cp .env.example .env
bun run secrets
```

Deploy, then register the webhook with the printed `<workers-url>`. the same
script also sets the Telegram command menu.

```sh
bun run deploy
bun run set-webhook -- <workers-url>
```

Open the bot and send `/create`.

Full walkthrough: [Deployment](deployment)

## Docs

| Page                         | Contents                                                |
| ---------------------------- | ------------------------------------------------------- |
| [Architecture](architecture) | request flow, KV schema, reconciliation, security model |
| [Deployment](deployment)     | zero → live runbook                                     |
| [Clients](clients)           | importing links into v2rayN / v2rayNG                   |
| [Operations](operations)     | IP-burn lifecycle, cost, troubleshooting                |
