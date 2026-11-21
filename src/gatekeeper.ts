import { DurableObject } from "cloudflare:workers";

/** strikes older than this are forgotten */
const STRIKE_WINDOW_MS = 60 * 60 * 1000;

/** how long a blocked sender stays blocked */
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000;

/** verdict for one unauthorized update */
export type GateVerdict = "dropped" | "blocked";

/** persisted counter for one sender */
interface GateState {
  /** warnings inside the current window */
  strikes: number;

  /** epoch ms until which the sender is blocked, 0 when not blocked */
  blockedUntil: number;

  /** epoch ms of the last recorded strike */
  lastStrikeAt: number;
}

const EMPTY_STATE: GateState = { strikes: 0, blockedUntil: 0, lastStrikeAt: 0 };

/**
 * per-sender abuse gate for updates from users outside the allowlist
 *
 * One durable object exists per Telegram user id, so counters are strongly
 * consistent and survive isolate churn. the second unauthorized update inside
 * the strike window blocks the sender for a day, with no kv writes involved
 */
export class Gatekeeper extends DurableObject {
  /**
   * records one unauthorized update and reports the verdict
   *
   * @returns `blocked` when the sender is blocked, `dropped` for a fresh strike
   */
  async check(): Promise<GateVerdict> {
    const now = Date.now();
    const state = (await this.ctx.storage.get<GateState>("state")) ?? EMPTY_STATE;

    if (state.blockedUntil > now) {
      return "blocked";
    }

    const windowExpired = now - state.lastStrikeAt > STRIKE_WINDOW_MS;
    const strikes = windowExpired ? 0 : state.strikes;
    const next = strikes + 1;
    const blocked = next > 1;

    const updated: GateState = {
      strikes: blocked ? 0 : next,
      blockedUntil: blocked ? now + BLOCK_DURATION_MS : 0,
      lastStrikeAt: now,
    };

    await this.ctx.storage.put("state", updated);

    return blocked ? "blocked" : "dropped";
  }
}
