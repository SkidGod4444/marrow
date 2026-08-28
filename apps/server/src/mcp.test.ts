import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessQueue, createIngest, createNamespace, fakeEmbedding, fakeProviders, runJob, testEnv } from "@marrow/core";
import { createMcpServer } from "./mcp.ts";

const TOPICS = [
  "kv cache compression", "sliding window attention", "paged attention memory", "speculative decoding", "quantization int4 kernels",
  "flash attention tiling", "rotary position embeddings", "mixture of experts routing", "grouped query attention", "continuous batching scheduler",
];

type ToolResult = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
const parse = <T>(r: unknown): T => JSON.parse((r as ToolResult).content.find((c) => c.type === "text")!.text!) as T;

describe("MCP server (Phase 2 acceptance)", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  let client: Client;
  let itemIds: string[] = [];

  beforeEach(async () => {
    env = await testEnv();
    await createNamespace(env.db, { name: "inference", description: "LLM inference systems" });
    const providers = fakeProviders({ durationS: 600 });
    itemIds = [];
    for (const t of TOPICS) {
      const res = await createIngest(env.db, { namespace: "inference", url: `https://www.youtube.com/watch?v=${t.replace(/ /g, "-")}` });
      await runJob({ ...env, providers }, res.job.id);
      itemIds.push(res.item.id);
    }
    const server = createMcpServer({ ...env, queue: new InProcessQueue(), embedQuery: async (q) => fakeEmbedding(q) });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "test", version: "0" });
    await client.connect(ct);
  });
  afterEach(async () => {
    await client.close();
    await env.close();
  });

  it("exposes every PRD §8 tool", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["answer_review", "capture", "export_markdown", "get_context", "get_frame", "get_graph", "get_video_document", "inbox", "ingest", "job_status", "list_expressions", "list_items", "list_namespaces", "list_sources", "lookup_entity", "poll_sources", "review_queue", "save_expression", "search", "subscribe"]);
  });

  it("search over a 10-video namespace returns timestamped, deep-linked segments", async () => {
    const r = parse<{ hits: Array<{ item_id: string; title: string; t_start: number; deep_link: string; text: string; frame_captions: string[]; vector_rank: number | null; fts_rank: number | null }> }>(
      await client.callTool({ name: "search", arguments: { namespace: "inference", query: "speculative decoding", k: 5 } }),
    );
    expect(r.hits.length).toBe(5);
    expect(r.hits[0]!.title).toBe("Talk: speculative decoding");
    for (const h of r.hits) {
      expect(typeof h.t_start).toBe("number");
      expect(h.deep_link).toMatch(/youtube\.com\/watch\?v=.*&t=\d+s$/);
      expect(h.text.length).toBeGreaterThan(50);
    }
    expect(r.hits[0]!.fts_rank).not.toBeNull();
    expect(r.hits[0]!.vector_rank).not.toBeNull();
    expect(r.hits.some((h) => h.frame_captions.length > 0)).toBe(true);

    const filtered = parse<{ hits: unknown[] }>(await client.callTool({ name: "search", arguments: { namespace: "inference", query: "speculative decoding", source_type: "note" } }));
    expect(filtered.hits).toEqual([]);
  });

  it("get_frame returns an image; get_context returns surrounding transcript", async () => {
    const r = parse<{ hits: Array<{ segment_id: string; t_start: number }> }>(await client.callTool({ name: "search", arguments: { namespace: "inference", query: "paged attention memory", k: 3 } }));
    const seg = r.hits[0]!;
    const frame = (await client.callTool({ name: "get_frame", arguments: { id: seg.segment_id } })) as ToolResult;
    expect(frame.isError).toBeFalsy();
    const img = frame.content.find((c) => c.type === "image")!;
    expect(img.mimeType).toBe("image/jpeg");
    expect(Buffer.from(img.data!, "base64").slice(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const ctx = parse<{ context: string; deep_link: string; t_start: number }>(await client.callTool({ name: "get_context", arguments: { segment_id: seg.segment_id, window_s: 30 } }));
    expect(ctx.context).toMatch(/^\[\d\d:\d\d\] /);
    expect(ctx.context.split("\n").length).toBeGreaterThan(3);
    expect(ctx.deep_link).toContain("&t=");
  });

  it("lookup_entity returns cross-video mentions with stances", async () => {
    const r = parse<{ entity: { name: string; url: string | null }; items: number; mentions: Array<{ deep_link: string; t: number }>; stances: { supports: number } }>(
      await client.callTool({ name: "lookup_entity", arguments: { namespace: "inference", name: "domain randomization" } }),
    );
    expect(r.entity.name).toBe("Domain randomization");
    expect(r.items).toBe(10);
    expect(r.stances.supports).toBe(10);
    expect(r.mentions.every((m) => m.deep_link.includes("&t="))).toBe(true);

    const byAlias = parse<{ entity: { name: string } }>(await client.callTool({ name: "lookup_entity", arguments: { namespace: "inference", name: "DR" } }));
    expect(byAlias.entity.name).toBe("Domain randomization");
    const paper = parse<{ entity: { url: string | null } }>(await client.callTool({ name: "lookup_entity", arguments: { namespace: "inference", name: "tobin et al. 2017" } }));
    expect(paper.entity.url).toBe("https://arxiv.org/abs/1703.06907");
    const missing = parse<{ found: boolean }>(await client.callTool({ name: "lookup_entity", arguments: { namespace: "inference", name: "nonexistent thing" } }));
    expect(missing.found).toBe(false);
  });

  it("get_graph returns item and entity nodes joined by stance-weighted mention edges", async () => {
    const g = parse<{ nodes: Array<{ id: string; type: string; label: string; degree: number }>; edges: Array<{ source: string; target: string; weight: number; stances: { supports: number }; t_first: number | null }>; stats: { items: number; entities: number } }>(
      await client.callTool({ name: "get_graph", arguments: { namespace: "inference" } }),
    );
    expect(g.stats).toMatchObject({ items: 10, entities: 2 });
    expect(g.nodes.filter((n) => n.type === "item")).toHaveLength(10);
    const dr = g.nodes.find((n) => n.type === "entity" && n.label === "Domain randomization")!;
    expect(dr.degree).toBe(10);
    expect(g.edges.filter((e) => e.source === dr.id)).toHaveLength(10);
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.target && n.type === "item"))).toBe(true);
    expect(g.edges.find((e) => e.source === dr.id)!.stances.supports).toBe(1);
    expect(typeof g.edges[0]!.t_first).toBe("number");
  });

  it("get_video_document, list_items, job_status, export_markdown, list_namespaces", async () => {
    const doc = parse<{ title: string; transcript: null; transcript_entries: number; article: { sections: unknown[] } }>(
      await client.callTool({ name: "get_video_document", arguments: { video_id: itemIds[0], transcript: "none" } }),
    );
    expect(doc.transcript).toBeNull();
    expect(doc.transcript_entries).toBe(60);
    expect(doc.article.sections.length).toBe(3);
    const withT = parse<{ transcript: Array<{ words: unknown[] }>; transcript_truncated: boolean }>(
      await client.callTool({ name: "get_video_document", arguments: { video_id: itemIds[0], transcript: "full", max_entries: 5 } }),
    );
    expect(withT.transcript.length).toBe(5);
    expect(withT.transcript_truncated).toBe(true);
    expect(withT.transcript[0]!.words).toEqual([]);

    const items = parse<{ items: Array<{ status: string }> }>(await client.callTool({ name: "list_items", arguments: { namespace: "inference", status: "ready" } }));
    expect(items.items.length).toBe(10);

    const ns = parse<{ namespaces: Array<{ name: string; items: number; ready: number }> }>(await client.callTool({ name: "list_namespaces", arguments: {} }));
    expect(ns.namespaces[0]).toMatchObject({ name: "inference", items: 10, ready: 10 });

    const md = (await client.callTool({ name: "export_markdown", arguments: { video_id: itemIds[1] } })) as ToolResult;
    const text = md.content[0]!.text!;
    expect(text).toMatch(/^---\ntitle: "Talk: /); // Obsidian properties block, then the note
    expect(text).toMatch(/\n# Talk: /);
    expect(text).toMatch(/\[05:00\]\(https:\/\/www\.youtube\.com\/watch\?v=[^)]+&t=300s\)/);
    expect(text).toContain("## References");
    expect(text).toContain("[Tobin et al. 2017](https://arxiv.org/abs/1703.06907)");

    const nsMd = (await client.callTool({ name: "export_markdown", arguments: { namespace: "inference" } })) as ToolResult;
    expect(nsMd.content[0]!.text).toContain("## Items (10)");
    expect(nsMd.content[0]!.text).toContain("| Domain randomization | technique |");
  });
});
