import { webhookCallback } from "grammy";
import { createBot } from "./bot";
import type { Env } from "./env";
import { Gatekeeper } from "./gatekeeper";
import { handleReady, reconcile } from "./reconcile";

/**
 * worker entry point
 *
 * routes: `/telegram` (webhook), `/ready` (cloud-init callback) and `/`
 * (health check). The scheduled handler reconciles provisioning records
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ready") {
      return handleReady(env, request);
    }

    if (url.pathname === "/telegram") {
      if (env.WEBHOOK_SECRET) {
        const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token");

        if (provided !== env.WEBHOOK_SECRET) {
          console.warn("webhook rejected: secret token mismatch");
          return new Response("forbidden", { status: 403 });
        }
      }

      return webhookCallback(createBot(env, url.origin), "cloudflare-mod")(request);
    }

    if (url.pathname === "/") {
      return new Response("telegram-vpn-bot up\n");
    }

    return new Response("not found\n", { status: 404 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(reconcile(env));
  },
};

export { Gatekeeper };
