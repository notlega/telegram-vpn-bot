# Deployment

Zero → live in about ten minutes.

## 1. Prerequisites

| Item | Where |
|---|---|
| Cloudflare account (free plan) | dash.cloudflare.com |
| Vultr account + API token | Vultr → Account → API (enable IPv4 + Instances read/write) |
| Telegram bot token | [@BotFather](https://t.me/BotFather) → `/newbot` |
| Telegram user id | [@userinfobot](https://t.me/userinfobot) |

The API token is only used server-side, inside the worker. Do not paste it into
chat.

## 2. Local tooling

```sh
git clone git@github.com:notlega/telegram-vpn-bot.git
cd telegram-vpn-bot
npm install
npx wrangler login
```

## 3. Create the KV namespace

```sh
npx wrangler kv namespace create KV
```

Copy the printed `id` into `wrangler.toml`:

```toml
[kv_namespaces](kv_namespaces)
binding = "KV"
id = "<paste-here>"
```

## 4. Secrets

```sh
cp .dev.vars.example .dev.vars
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

Push the same values to the worker:

```sh
npx wrangler secret put BOT_TOKEN
npx wrangler secret put VULTR_API_TOKEN
npx wrangler secret put ALLOWED_USER_ID
npx wrangler secret put WEBHOOK_SECRET
```

`.dev.vars` is git-ignored; never commit it.

## 5. Configuration

`wrangler.toml` `[vars]`:

| Var | Default | Meaning |
|---|---|---|
| `REGIONS` | `icn:Seoul,nrt:Tokyo,sgp:Singapore` | region buttons in `/up` |
| `PLAN` | `vc2-1c-1g` | Vultr plan id (≈$6/mo) |
| `OS_NAME` | `Debian` | OS family prefix, resolved to the newest x64 image |
| `SNI` | `www.yahoo.com` | REALITY camouflage destination |

Change a value → `npx wrangler deploy` again.

> Debian (not Alpine) because the bootstrap depends on cloud-init user-data;
> Vultr's Alpine images do not ship cloud-init.

## 6. Deploy

```sh
npx wrangler deploy
```

Note the printed `https://telegram-vpn-bot.<subdomain>.workers.dev` URL.

## 7. Register the webhook

```sh
node scripts/set-webhook.mjs https://telegram-vpn-bot.<subdomain>.workers.dev
```

Expected: `webhook set: ... (secret token enabled)`.

## 8. Verification checklist

1. `curl https://telegram-vpn-bot.<subdomain>.workers.dev/` → `telegram-vpn-bot up`
2. Bot `/id` → matches `ALLOWED_USER_ID`
3. Bot `/up` → pick a region → status message appears
4. ~2 minutes later → link + QR arrive
5. Import the link in a client (see [Clients](Clients)) and load `ifconfig.me`. It
   must show the new server IP
6. Bot `/status` → shows `ready/running`
7. Bot `/down` → confirm → instance disappears from the Vultr console

If step 4 fails, open the instance in the Vultr console and read
`/var/log/vpn-setup.log`, then see the troubleshooting table in [Operations](Operations).

## Updates

```sh
git pull
npm install
npx wrangler deploy
```

Secret rotation: `wrangler secret put …` again, then re-run
`scripts/set-webhook.mjs` only if `WEBHOOK_SECRET` changed.

## Removing the deployment

```sh
node scripts/set-webhook.mjs --delete   # or:
curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
npx wrangler delete
npx wrangler kv namespace delete --namespace-id <id>
```

Destroy all Vultr instances first with `/down`; deleting the worker leaves any
running instance billing silently.
