# Deployment

Zero → live in about ten minutes.

## 1. Prerequisites

| Item                           | Where                                                      |
| ------------------------------ | ---------------------------------------------------------- |
| Cloudflare account (free plan) | dash.cloudflare.com                                        |
| Vultr account + API token      | Vultr → Account → API (enable IPv4 + Instances read/write) |
| Telegram bot token             | [@BotFather](https://t.me/BotFather) → `/newbot`           |
| Telegram user id               | [@userinfobot](https://t.me/userinfobot)                   |

The API token is only used server-side, inside the worker. Do not paste it into
chat.

## 2. Local tooling

Install [Bun](https://bun.sh), then let the project's devDependency supply
wrangler. Pinning it per checkout is what Cloudflare recommends.

```sh
git clone git@github.com:notlega/telegram-vpn-bot.git
cd telegram-vpn-bot
bun install
bunx wrangler --version
bunx wrangler login
```

## 3. Create the KV namespace

```sh
bunx wrangler kv namespace create KV
```

Copy the printed `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "<paste-here>"
```

## 4. Secrets

```sh
cp .env.example .env
```

Fill in:

```
BOT_TOKEN=123456789:AA...
VULTR_API_TOKEN=...
ALLOWED_USER_ID=123456789
WEBHOOK_SECRET=any-long-random-string
```

`ALLOWED_USER_ID` accepts a comma-separated list. `WEBHOOK_SECRET` can be
generated with `openssl rand -hex 32`.

Push every value to the worker in one step:

```sh
bun run secrets
```

The helper pipes each `.env` value into `wrangler secret put` and reports which
names were skipped. `.env` is git-ignored; never commit it.

In CI or any non-interactive shell, export `CLOUDFLARE_API_TOKEN` instead of
relying on `wrangler login`; both `bun run secrets` and `bun run deploy` use it.

## 5. Configuration

`wrangler.toml` `[vars]`:

| Var       | Default                             | Meaning                                            |
| --------- | ----------------------------------- | -------------------------------------------------- |
| `REGIONS` | `icn:Seoul,nrt:Tokyo,sgp:Singapore` | region buttons in `/up`                            |
| `PLAN`    | `vc2-1c-1g`                         | Vultr plan id (≈$5/mo, backups disabled)           |
| `OS_NAME` | `Debian`                            | OS family prefix, resolved to the newest x64 image |
| `SNI`     | `www.yahoo.com`                     | REALITY camouflage destination                     |

Change a value → `bun run deploy` again.

> Debian (not Alpine) because the bootstrap depends on cloud-init user-data;
> Vultr's Alpine images do not ship cloud-init.

## 6. Deploy

```sh
bun run deploy
```

Note the printed URL, referred to below as `<workers-url>`. it looks like
`https://telegram-vpn-bot.<subdomain>.workers.dev`.

## 7. Register the webhook

```sh
bun run set-webhook -- <workers-url>
```

Expected: `webhook set: ... (secret token enabled)`.

## 8. Verification checklist

1. `curl <workers-url>/` → `telegram-vpn-bot up`
2. Bot `/id` → matches `ALLOWED_USER_ID`
3. Bot `/up` → pick a region → status message appears
4. ~2 minutes later → link + QR arrive
5. Import the link in a client (see [Clients](clients)) and load `ifconfig.me`. It
   must show the new server IP
6. Bot `/status` → shows `ready/running`
7. Bot `/down` → confirm → instance disappears from the Vultr console

If step 4 fails, open the instance in the Vultr console and read
`/var/log/vpn-setup.log`, then see the troubleshooting table in [Operations](operations).

## Updates

```sh
git pull
bun install
bun run deploy
```

Secret rotation: edit `.env`, then `bun run secrets` again. Re-run
`bun run set-webhook` only if `WEBHOOK_SECRET` changed.

## Removing the deployment

```sh
bun run set-webhook -- --delete
bunx wrangler delete
bunx wrangler kv namespace delete --namespace-id <id>
```

Destroy all Vultr instances first with `/down`; deleting the worker leaves any
running instance billing silently.
