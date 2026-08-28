import type { LanguageModel } from "ai";
import type { Auth } from "./auth.ts";
import type { Principal } from "./principal.ts";
import {
  type Config, type Db, type Feed, type JobQueue, type PageContent, type PlaylistListing, type PollDeps, type SourceKind, type Storage, type SummaryDeps, RERANK_SYSTEM, RerankSchema, UsageTracker,
  embedTexts, fetchFeed, fetchPage, generateStructured, listPlaylistEntries, search, type SearchInput,
} from "@marrow/core";

/** Everything both skins (REST + MCP) need. `embedQuery`/`rerank` are injectable so tests never call OpenAI. */
export type ServerDeps = {
  /** Live health of things the pipeline needs (set by index.ts; tests may omit). */
  health?: { storage: () => "ok" | "error" | "unknown"; youtube?: () => string; keeper?: () => Promise<unknown> };
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
  /** PRD §7 capture: readable text of a public page/PDF (plain fetch in production, a fake in tests). */
  fetchPage: (url: string) => Promise<PageContent>;
  /** RSS/Atom feed for subscription polling. */
  fetchFeed: (url: string) => Promise<Feed>;
  /** Accounts/workspaces (Better Auth); optional so unit tests that don't touch auth can omit it. */
  auth?: Auth;
  /** stdio MCP: the fixed caller (instance principal, optionally in one workspace via MARROW_ORG). */
  mcpPrincipal?: Principal;
};

/** Everything `pollSource`/`pollAllSources` need, from the server deps. */
export function pollDeps(deps: ServerDeps): PollDeps {
  return { db: deps.db, queue: deps.queue, storage: deps.storage, listEntries: deps.listEntries, fetchFeed: deps.fetchFeed, fetchPage: deps.fetchPage, maxPerPoll: deps.config.FEED_MAX_PER_POLL };
}

export function captureDeps(deps: ServerDeps) {
  return { db: deps.db, storage: deps.storage, queue: deps.queue, fetchPage: deps.fetchPage };
}

export function realRetrieval(config: Config): Pick<ServerDeps, "embedQuery" | "rerank" | "listEntries" | "generate" | "fetchPage" | "fetchFeed"> {
  return {
    listEntries: (url) => listPlaylistEntries(config, url),
    fetchPage: (url) => fetchPage(url, { timeoutMs: config.CAPTURE_FETCH_TIMEOUT_MS, maxBytes: config.CAPTURE_MAX_BYTES }),
    fetchFeed: (url) => fetchFeed(url),
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
