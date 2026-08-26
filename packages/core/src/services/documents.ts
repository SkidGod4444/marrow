import type { VideoDocument } from "../document.ts";
import { loadDocument } from "../pipeline/runner.ts";
import type { Storage } from "../storage/index.ts";

// Small TTL cache in front of object storage: search/context/frame lookups hit the same documents repeatedly.
const TTL_MS = 5 * 60_000;
const MAX = 32;
const cache = new Map<string, { doc: VideoDocument; at: number }>();

export async function getDocument(storage: Storage, itemId: string, opts: { fresh?: boolean } = {}): Promise<VideoDocument | null> {
  const hit = cache.get(itemId);
  if (hit && !opts.fresh && Date.now() - hit.at < TTL_MS) return hit.doc;
  const doc = await loadDocument(storage, itemId);
  if (doc) {
    cache.set(itemId, { doc, at: Date.now() });
    if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  }
  return doc;
}

export function invalidateDocument(itemId: string): void {
  cache.delete(itemId);
}

/** Trim a document for API/MCP responses: transcript optional/truncated, word timestamps optional. */
export function presentDocument(
  doc: VideoDocument,
  opts: { transcript?: "full" | "none"; maxEntries?: number; includeWords?: boolean } = {},
): Omit<VideoDocument, "transcript"> & { transcript: VideoDocument["transcript"] | null; transcript_entries: number; transcript_truncated: boolean } {
  const total = doc.transcript.length;
  let transcript: VideoDocument["transcript"] | null = null;
  let truncated = false;
  if ((opts.transcript ?? "full") === "full") {
    const slice = opts.maxEntries ? doc.transcript.slice(0, opts.maxEntries) : doc.transcript;
    truncated = slice.length < total;
    transcript = opts.includeWords ? slice : slice.map((e) => ({ ...e, words: [] }));
  }
  const { transcript: _t, ...rest } = doc;
  return { ...rest, transcript, transcript_entries: total, transcript_truncated: truncated };
}
