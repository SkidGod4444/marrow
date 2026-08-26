import type { LanguageModel } from "ai";
import {
  type Config, type Db, type JobQueue, type PlaylistListing, type SourceKind, type Storage, type SummaryDeps, RERANK_SYSTEM, RerankSchema, UsageTracker,
  embedTexts, generateStructured, listPlaylistEntries, search, type SearchInput,
} from "@marrow/core";

/** Everything both skins (REST + MCP) need. `embedQuery`/`rerank` are injectable so tests never call OpenAI. */
export type ServerDeps = {
  db: Db;
  storage: Storage;
  config: Config;
  queue: JobQueue;
  embedQuery: (text: string) => Promise<number[]>;
  rerank?: (query: string, candidates: Array<{ id: string; text: string }>) => Promise<string[]>;
  /** Override the interactive chat model (tests inject `MockLanguageModelV3`). Default: OpenAI LLM_MODEL_CHAT. */
  chatModel?: LanguageModel;
  /** Playlist/channel listing for subscription polling (yt-dlp in production, a fake in tests). */
  listEntries: (url: string, kind: SourceKind) => Promise<PlaylistListing>;
  /** Structured generation for namespace summaries (OpenAI in production, a fake in tests). */
  generate: SummaryDeps["generate"];
};

export function realRetrieval(config: Config): Pick<ServerDeps, "embedQuery" | "rerank" | "listEntries" | "generate"> {
  return {
    listEntries: (url) => listPlaylistEntries(config, url),
    generate: (opts, usage) => generateStructured(config, opts, usage),
    embedQuery: async (text) => (await embedTexts(config, [text], new UsageTracker()))[0]!,
    rerank: async (query, candidates) => {
      const out = await generateStructured(
        config,
        { system: RERANK_SYSTEM, user: JSON.stringify({ query, candidates }), schema: RerankSchema, schemaName: "rerank", effort: "none", verbosity: "low" },
        new UsageTracker(),
      );
      return out.ordered_ids;
    },
  };
}

export function runSearch(deps: ServerDeps, input: SearchInput) {
  return search({ db: deps.db, config: deps.config, embedQuery: deps.embedQuery, rerank: deps.rerank }, input);
}
