import { eq, inArray, sql } from "drizzle-orm";
import { type Db, type Job, items, jobs, usageLog } from "../db/index.ts";
import { newId } from "../ids.ts";
import { type Usage, costUsd } from "../openai/client.ts";

// The spend ledger. Everything that calls a paid API lands here as a row per model: pipeline stages (from the
// UsageTracker each stage carries), namespace-summary refreshes, and chat turns (from the AI SDK's usage). Per item,
// "how much did this cost, in tokens and dollars, including everything" is then a sum over rows.

export type UsageTotals = { input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number; audio_seconds: number; requests: number; cost_usd: number };
export type UsageSource = "pipeline" | "summary" | "chat" | "namespace_chat";
export type ItemUsage = {
  total: UsageTotals;
  pipeline: UsageTotals;
  chat: UsageTotals & { turns: number };
  /** Pipeline work by stage and model (summed across re-ingests), pipeline order. */
  stages: Array<{ stage: string; model: string } & UsageTotals>;
  /** Everything by model. */
  models: Record<string, UsageTotals>;
};

export const zeroTotals = (): UsageTotals => ({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, audio_seconds: 0, requests: 0, cost_usd: 0 });
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
export function addTotals(a: UsageTotals, b: Partial<UsageTotals>): UsageTotals {
  const out = { ...a };
  for (const k of ["input_tokens", "cached_input_tokens", "output_tokens", "audio_seconds", "requests", "cost_usd"] as const) out[k] = round6(out[k] + (b[k] ?? 0));
  out.total_tokens = out.input_tokens + out.output_tokens;
  return out;
}

const METRICS = ["input_tokens", "cached_input_tokens", "output_tokens", "audio_seconds", "web_search_calls", "requests"] as const;
/** UsageTracker flattens to "<model>.<metric>"; model names contain dots, so split on the known metric suffix. */
export function splitTrackerUsage(flat: Record<string, number> | undefined): Record<string, Usage> {
  const out: Record<string, Usage> = {};
  for (const [key, v] of Object.entries(flat ?? {})) {
    const metric = METRICS.find((m) => key.endsWith(`.${m}`));
    if (!metric || typeof v !== "number") continue;
    const model = key.slice(0, -(metric.length + 1));
    const u = (out[model] ??= {});
    u[metric] = (u[metric] ?? 0) + v;
  }
  return out;
}

/** The AI SDK's usage (v7 `LanguageModelUsage`, or a provider's nested shape) → our Usage. */
export function normalizeSdkUsage(raw: unknown): Usage {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const nested = (x: unknown, k: string) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined);
  const input = typeof o.inputTokens === "number" ? o.inputTokens : num(nested(o.inputTokens, "total"));
  const cached = num(nested(o.inputTokenDetails, "cacheReadTokens") ?? o.cachedInputTokens ?? nested(o.inputTokens, "cacheRead"));
  const output = typeof o.outputTokens === "number" ? o.outputTokens : num(nested(o.outputTokens, "total"));
  return { input_tokens: input, cached_input_tokens: cached, output_tokens: output, requests: 1 };
}

const toRow = (u: Usage) => ({ inputTokens: u.input_tokens ?? 0, cachedInputTokens: u.cached_input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, audioSeconds: u.audio_seconds ?? 0, requests: u.requests ?? 0 });

/** A pipeline stage's spend (one row per model; a retried stage replaces its rows). */
export async function recordPipelineUsage(db: Db, input: { itemId: string; namespaceId: string; jobId: string; stage: string; source?: UsageSource; usage: Record<string, number> | undefined }): Promise<number> {
  const byModel = splitTrackerUsage(input.usage);
  let n = 0;
  for (const [model, u] of Object.entries(byModel)) {
    const cost = round6(costUsd(model, u));
    const numbers = { ...toRow(u), costUsd: cost, ts: new Date() };
    await db
      .insert(usageLog)
      .values({ id: newId("use"), itemId: input.itemId, namespaceId: input.namespaceId, jobId: input.jobId, stage: input.stage, source: input.source ?? "pipeline", model, ...numbers })
      .onConflictDoUpdate({ target: [usageLog.jobId, usageLog.stage, usageLog.model], set: numbers });
    n++;
  }
  return n;
}

/** A chat turn's spend (item chat or namespace chat). */
export async function recordChatUsage(db: Db, input: { itemId?: string | null; namespaceId?: string | null; userId?: string | null; model: string; usage: unknown; source: "chat" | "namespace_chat" }): Promise<void> {
  const u = normalizeSdkUsage(input.usage);
  await db.insert(usageLog).values({ id: newId("use"), itemId: input.itemId ?? null, namespaceId: input.namespaceId ?? null, userId: input.userId ?? null, jobId: null, source: input.source, stage: null, model: input.model, ...toRow(u), costUsd: round6(costUsd(input.model, u)) });
}

const rowTotals = (r: { inputTokens: number; cachedInputTokens: number; outputTokens: number; audioSeconds: number; requests: number; costUsd: number }): Partial<UsageTotals> => ({
  input_tokens: r.inputTokens,
  cached_input_tokens: r.cachedInputTokens,
  output_tokens: r.outputTokens,
  audio_seconds: r.audioSeconds,
  requests: r.requests,
  cost_usd: r.costUsd,
});

/** Everything an item has cost, with the breakdown the item page shows. */
export async function itemUsage(db: Db, itemId: string): Promise<ItemUsage> {
  const rows = await db.select().from(usageLog).where(eq(usageLog.itemId, itemId)).orderBy(usageLog.ts);
  let total = zeroTotals();
  let pipeline = zeroTotals();
  let chat = zeroTotals();
  let turns = 0;
  const stages = new Map<string, { stage: string; model: string } & UsageTotals>();
  const models: Record<string, UsageTotals> = {};
  for (const r of rows) {
    const t = rowTotals(r);
    total = addTotals(total, t);
    models[r.model] = addTotals(models[r.model] ?? zeroTotals(), t);
    if (r.source === "chat" || r.source === "namespace_chat") {
      chat = addTotals(chat, t);
      turns++;
    } else {
      pipeline = addTotals(pipeline, t);
      const key = `${r.stage ?? r.source}|${r.model}`;
      const prev = stages.get(key);
      stages.set(key, { stage: r.stage ?? r.source, model: r.model, ...addTotals(prev ?? zeroTotals(), t) });
    }
  }
  return { total, pipeline, chat: { ...chat, turns }, stages: Array.from(stages.values()), models };
}

/** Cost + tokens per item for lists (inbox, library). */
export async function usageByItem(db: Db, itemIds: string[]): Promise<Map<string, { cost_usd: number; tokens: number }>> {
  const out = new Map<string, { cost_usd: number; tokens: number }>();
  if (itemIds.length === 0) return out;
  const rows = await db
    .select({ itemId: usageLog.itemId, cost: sql<number>`sum(${usageLog.costUsd})::float8`, tokens: sql<number>`sum(${usageLog.inputTokens} + ${usageLog.outputTokens})::int` })
    .from(usageLog)
    .where(inArray(usageLog.itemId, itemIds))
    .groupBy(usageLog.itemId);
  for (const r of rows) if (r.itemId) out.set(r.itemId, { cost_usd: round6(Number(r.cost)), tokens: Number(r.tokens) });
  return out;
}

/** Totals of a job's stage records (what the document carries as `pipeline.usage`). */
export function jobTotals(job: Pick<Job, "stages">): UsageTotals {
  let t = zeroTotals();
  for (const rec of Object.values(job.stages)) {
    if (!rec) continue;
    for (const [model, u] of Object.entries(splitTrackerUsage(rec.usage))) t = addTotals(t, { input_tokens: u.input_tokens, cached_input_tokens: u.cached_input_tokens, output_tokens: u.output_tokens, audio_seconds: u.audio_seconds, requests: u.requests, cost_usd: costUsd(model, u) });
  }
  return t;
}

/** Jobs from before the ledger existed: derive their rows from the stage records they already carry. Idempotent. */
export async function backfillUsageFromJobs(db: Db, log?: (m: string) => void): Promise<number> {
  const rows = await db
    .select({ job: jobs, namespaceId: items.namespaceId })
    .from(jobs)
    .innerJoin(items, eq(items.id, jobs.itemId))
    .where(sql`not exists (select 1 from ${usageLog} where ${usageLog.jobId} = ${jobs.id})`);
  let n = 0;
  for (const { job, namespaceId } of rows) {
    for (const [stage, rec] of Object.entries(job.stages)) {
      if (!rec?.usage || Object.keys(rec.usage).length === 0) continue;
      n += await recordPipelineUsage(db, { itemId: job.itemId, namespaceId, jobId: job.id, stage, usage: rec.usage });
    }
  }
  if (n) log?.(`usage ledger: added ${n} row(s) from ${rows.length} earlier job(s)`);
  return n;
}

const thousands = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** One line for the log: "12,400 in / 1,900 out (3,200 cached) · 10.8 min audio · $0.0648". */
export function describeUsage(u: Usage | UsageTotals): string {
  const parts: string[] = [];
  const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
  if (tokens) parts.push(`${thousands(u.input_tokens ?? 0)} in / ${thousands(u.output_tokens ?? 0)} out${u.cached_input_tokens ? ` (${thousands(u.cached_input_tokens)} cached)` : ""}`);
  if (u.audio_seconds) parts.push(`${(u.audio_seconds / 60).toFixed(1)} min audio`);
  const cost = "cost_usd" in u ? u.cost_usd : null;
  if (cost !== null) parts.push(`$${cost.toFixed(4)}`);
  return parts.join(" · ") || "no API calls";
}
