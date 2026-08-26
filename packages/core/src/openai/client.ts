import OpenAI from "openai";
import type { Config } from "../config.ts";

let cached: OpenAI | null = null;

export function getOpenAI(cfg: Config): OpenAI {
  if (!cfg.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  if (!cached) cached = new OpenAI({ apiKey: cfg.OPENAI_API_KEY, maxRetries: 3 });
  return cached;
}

// ---- Cost accounting (PRD §13: every stage logs API spend to `jobs`) ----

export type Usage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  audio_seconds?: number;
  web_search_calls?: number;
  requests?: number;
};

/** USD per 1M tokens (input / cached input / output), per minute of audio, or per tool call. Verified 2026-08-27. */
export const PRICING: Record<string, { in?: number; cached?: number; out?: number; perMinute?: number; perCall?: number }> = {
  "gpt-5.6-luna": { in: 0.2, cached: 0.02, out: 1.2 },
  "gpt-5.6-terra": { in: 2.0, cached: 0.2, out: 12.0 },
  "gpt-5.6-sol": { in: 5.0, cached: 0.5, out: 30.0 },
  "text-embedding-3-small": { in: 0.02 },
  "text-embedding-3-large": { in: 0.13 },
  "whisper-1": { perMinute: 0.006 },
  web_search: { perCall: 0.01 },
};

export function costUsd(model: string, u: Usage): number {
  const p = PRICING[model];
  if (!p) return 0;
  let c = 0;
  const cachedTokens = u.cached_input_tokens ?? 0;
  const uncached = Math.max(0, (u.input_tokens ?? 0) - cachedTokens);
  if (p.in) c += (uncached / 1e6) * p.in;
  if (p.cached) c += (cachedTokens / 1e6) * p.cached;
  if (p.out) c += ((u.output_tokens ?? 0) / 1e6) * p.out;
  if (p.perMinute) c += ((u.audio_seconds ?? 0) / 60) * p.perMinute;
  if (p.perCall) c += (u.web_search_calls ?? 0) * p.perCall;
  return c;
}

/** Accumulates usage + cost for one pipeline stage. */
export class UsageTracker {
  usage: Record<string, number> = {};
  cost = 0;

  add(model: string, u: Usage) {
    for (const [k, v] of Object.entries(u)) {
      if (typeof v !== "number") continue;
      const key = `${model}.${k}`;
      this.usage[key] = (this.usage[key] ?? 0) + v;
    }
    const c = costUsd(model, u);
    this.cost += c;
    return c;
  }
}
