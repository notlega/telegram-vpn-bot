/**
 * pushes worker secrets from .env to Cloudflare
 *
 * usage: bun scripts/secrets.ts
 *
 * uses the project-local wrangler from node_modules (installed by `bun install`)
 */

const SECRETS = ["BOT_TOKEN", "LINODE_API_TOKEN", "WEBHOOK_SECRET"] as const;

const wrangler = new URL("../node_modules/.bin/wrangler", import.meta.url).pathname;
const wranglerExists = await Bun.file(wrangler).exists();

if (!wranglerExists) {
  console.error("wrangler not found. run `bun install`, then `bunx wrangler login`");
  process.exit(1);
}

let pushed = 0;
let skipped = 0;

for (const name of SECRETS) {
  const value = process.env[name];

  if (!value) {
    console.warn(`skip ${name}: not set in .env`);
    skipped += 1;
    continue;
  }

  const proc = Bun.spawn([wrangler, "secret", "put", name], {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });

  proc.stdin.write(`${value}\n`);
  await proc.stdin.end();

  const code = await proc.exited;

  if (code !== 0) {
    console.error(`failed to push ${name} (exit ${code})`);
    process.exit(1);
  }

  pushed += 1;
  console.info(`pushed ${name}`);
}

console.info(`done: ${pushed} pushed, ${skipped} skipped`);

if (pushed === 0) {
  process.exit(1);
}

export {};
