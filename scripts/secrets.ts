#!/usr/bin/env bun
/**
 * Pushes worker secrets from .env to Cloudflare.
 *
 * Usage: bun scripts/secrets.ts
 *
 * Requires the wrangler CLI on PATH (bun i -g wrangler or npm i -g wrangler).
 */

const SECRETS = ["BOT_TOKEN", "VULTR_API_TOKEN", "ALLOWED_USER_ID", "WEBHOOK_SECRET"] as const;

const wrangler = Bun.which("wrangler");
if (!wrangler) {
  console.error("wrangler not found on PATH. Install it globally: bun i -g wrangler");
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
  console.log(`pushed ${name}`);
}

console.log(`done: ${pushed} pushed, ${skipped} skipped`);
if (pushed === 0) process.exit(1);

export {};
