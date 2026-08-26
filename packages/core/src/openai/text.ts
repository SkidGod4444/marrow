import type { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type OpenAI from "openai";
import type { Config } from "../config.ts";
import { getOpenAI, type UsageTracker } from "./client.ts";

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type GenerateOpts<T extends z.ZodType> = {
  model?: string;
  system: string;
  user: string | OpenAI.Responses.ResponseInputContent[];
  schema: T;
  schemaName: string;
  effort?: ReasoningEffort;
  verbosity?: "low" | "medium" | "high";
  webSearch?: boolean;
  maxOutputTokens?: number;
};

/**
 * Structured generation via the Responses API (zod → JSON schema). Used for every cheap-LLM pipeline pass
 * (STACK:llm_cheap = gpt-5.6-luna). `webSearch: true` attaches the hosted `web_search` tool (reference resolution).
 */
export async function generateStructured<T extends z.ZodType>(cfg: Config, opts: GenerateOpts<T>, usage: UsageTracker): Promise<z.infer<T>> {
  const openai = getOpenAI(cfg);
  const model = opts.model ?? cfg.LLM_MODEL_CHEAP;
  const userContent: OpenAI.Responses.ResponseInputItem = {
    role: "user",
    content: typeof opts.user === "string" ? opts.user : opts.user,
  };
  const res = await openai.responses.parse({
    model,
    reasoning: { effort: opts.effort ?? "low" },
    text: { format: zodTextFormat(opts.schema, opts.schemaName), verbosity: opts.verbosity ?? "medium" },
    input: [{ role: "system", content: opts.system }, userContent],
    tools: opts.webSearch ? [{ type: "web_search" }] : undefined,
    max_output_tokens: opts.maxOutputTokens,
    store: false,
  });
  const searchCalls = res.output.filter((o) => o.type === "web_search_call").length;
  usage.add(model, {
    input_tokens: res.usage?.input_tokens ?? 0,
    cached_input_tokens: res.usage?.input_tokens_details?.cached_tokens ?? 0,
    output_tokens: res.usage?.output_tokens ?? 0,
    requests: 1,
  });
  if (searchCalls) usage.add("web_search", { web_search_calls: searchCalls });
  if (!res.output_parsed) {
    throw new Error(`structured output missing (${opts.schemaName}): ${res.output_text?.slice(0, 200) ?? "no text"}`);
  }
  return res.output_parsed as z.infer<T>;
}
