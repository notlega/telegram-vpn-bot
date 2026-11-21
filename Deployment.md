# Deployment

Zero → live in about ten minutes.

## 1. Prerequisites

| Item                           | Where                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| Cloudflare account (free plan) | dash.cloudflare.com                                          |
| Linode account + api token     | cloud.linode.com → profile → api tokens (read/write)         |
| Telegram bot token             | [@BotFather](https://t.me/BotFather) → `/newbot`             |
| Telegram user id (optional)    | [@userinfobot](https://t.me/userinfobot), for access control |

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
cp wrangler.toml.example wrangler.toml
bunx wrangler kv namespace create KV
```

Copy the printed `id` into `wrangler.toml`. The binding name stays `KV`; the code
and local test commands reference it.

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
LINODE_API_TOKEN=...
ALLOWED_USER_ID=123456789
WEBHOOK_SECRET=any-long-random-string
```

`ALLOWED_USER_ID` is optional and accepts a comma-separated list. leave it empty
for an open bot. botfather has no per-user restriction setting, so this value is
the only allowlist. `WEBHOOK_SECRET` can be generated with `openssl rand -hex 32`.

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

| Var       | Default                                          | Meaning                                  |
| --------- | ------------------------------------------------ | ---------------------------------------- |
| `REGIONS` | `jp-tyo-3:Tokyo,jp-osa:Osaka,sg-sin-2:Singapore` | region buttons in `/create`              |
| `TYPE`    | `g6-nanode-1`                                    | linode plan id (≈$5/mo)                  |
| `IMAGE`   | `linode/debian13`                                | linode image id, must support cloud-init |
| `SNI`     | `www.yahoo.com`                                  | REALITY camouflage destination           |

Change a value → `bun run deploy` again.

> Debian (not Alpine) because the bootstrap depends on cloud-init user-data;
> the bot rejects images without cloud-init support, so Alpine needs a custom
> golden image before it can be used.

The `[triggers]` cron runs every two minutes; reconciliation windows are 8 and
15 minutes, so the slack is intentional.

## 6. Deploy

```sh
bun run deploy
```

Note the printed URL, referred to below as `<workers-url>`. it looks like
`https://telegram-vpn-bot.<subdomain>.workers.dev`.

## 7. Register the webhook and command menu

```sh
bun run set-webhook -- <workers-url>
```

Expected: `webhook set: ... (secret token enabled)` and a `command menu set:`
line listing `/create`, `/restart`, `/destroy`, `/status`, `/id`.

## 8. Verification checklist

1. `curl <workers-url>/` → `telegram-vpn-bot up`
2. Bot `/id` → matches `ALLOWED_USER_ID`
3. Bot `/create` → pick a region → status message appears
4. ~2 minutes later → link + QR arrive
5. Import the link in a client (see [Clients](Clients)) and load `ifconfig.me`. It
   must show the new server IP
6. Bot `/status` → shows `ready`
7. Bot `/restart` → server reboots, the same link works again
8. Bot `/destroy` → confirm → instance disappears from the linode console

If step 4 fails, open the instance in the linode lish console and read
`/var/log/vpn-setup.log`, then see the troubleshooting table in [Operations](Operations).

## Updates

A redeploy updates the existing worker in place: same url, same bindings, new
version. It does not create a second worker.

```sh
git pull
bun install
bun run check
bun run deploy
```

Secret rotation: edit `.env`, then `bun run secrets` again. Re-run
`bun run set-webhook` only if `WEBHOOK_SECRET` changed.

Roll back to the previous version when an update breaks something:

```sh
bunx wrangler deployments list
bunx wrangler rollback
bunx wrangler tail
```

## Removing the deployment

```sh
bun run set-webhook -- --delete
bunx wrangler delete
bunx wrangler kv namespace delete --namespace-id <id>
```

Dead config left behind over time: list and delete extra secrets and unused kv
namespaces, and remove old workers by name.

```sh
bunx wrangler secret list
bunx wrangler secret delete NAME
bunx wrangler kv namespace list
bunx wrangler kv namespace delete --namespace-id <id>
wrangler delete --name <old-worker>
```

Destroy all linode instances first with `/destroy`; deleting the worker leaves
any existing instance billing silently. `/restart` does not stop billing either.
Only `/destroy` does.
