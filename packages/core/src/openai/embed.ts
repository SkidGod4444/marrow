import type { Config } from "../config.ts";
import { getOpenAI, type UsageTracker } from "./client.ts";

/** STACK:embeddings — text-embedding-3-small (1536 dims). Batches of 100 inputs. */
export async function embedTexts(cfg: Config, texts: string[], usage: UsageTracker): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = getOpenAI(cfg);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100).map((t) => t.slice(0, 8000 * 4));
    const res = await openai.embeddings.create({ model: cfg.EMBEDDING_MODEL, input: batch, dimensions: cfg.EMBEDDING_DIMS });
    usage.add(cfg.EMBEDDING_MODEL, { input_tokens: res.usage?.prompt_tokens ?? 0, requests: 1 });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
}
