import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { newDocument } from "../document.ts";
import { buildVideoChatSystem, htmlToText, withPlaybackPosition } from "./chat.ts";

function doc() {
  const d = newDocument({ id: "vid_1", namespace_id: "ns_1", source_type: "youtube_video", source_url: "https://www.youtube.com/watch?v=x", version: 1 });
  d.title = "KV cache talk";
  d.duration_s = 900;
  d.chapters = [{ title: "Intro", t_start: 0, t_end: 300 }];
  d.transcript = [
    { t_start: 0, t_end: 10, speaker: "S1", text: "Hello and welcome.", words: [] },
    { t_start: 754, t_end: 760, speaker: "S1", text: "The KV cache is the bottleneck.", words: [] },
  ];
  d.frames = [{ id: "frm_1", t: 750, s3_key: "frames/vid_1/750.jpg", caption: "Slide: KV cache layout" }];
  d.references = [{ kind: "paper", name: "PagedAttention", raw_mention: "the vLLM paper", t: 755, resolved_url: "https://arxiv.org/abs/2309.06180" }];
  return d;
}

describe("per-video chat context (PRD §6.1)", () => {
  it("builds a static prefix: instructions, [MM:SS] transcript, frames as text, references", () => {
    const sys = buildVideoChatSystem(doc());
    expect(sys).toContain("[12:34] The KV cache is the bottleneck.");
    expect(sys).toContain("Title: KV cache talk");
    expect(sys).toContain("- [00:00] Intro");
    expect(sys).toContain("KEYFRAMES");
    expect(sys).toContain("[12:30] Slide: KV cache layout");
    expect(sys).not.toContain("base64");
    expect(sys).toContain("PagedAttention (paper) @ 12:35 — https://arxiv.org/abs/2309.06180");
    // Deterministic → prompt-cacheable.
    expect(buildVideoChatSystem(doc())).toBe(sys);
  });

  it("appends the playback position to the last user message only", () => {
    const msgs: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "hello" }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "what is on screen?" }] },
    ];
    const out = withPlaybackPosition(msgs, 754.8);
    expect(out[0]!.parts[0]).toEqual({ type: "text", text: "hi" });
    expect((out[2]!.parts[0] as { text: string }).text).toBe("what is on screen?\n\n(Player is at [12:34], t=754s.)");
    expect(withPlaybackPosition(msgs, null)).toBe(msgs);
  });

  it("strips html to text for fetch_url", () => {
    expect(htmlToText("<html><head><style>p{}</style><script>x()</script></head><body><h1>Title</h1><p>Hello &amp; <b>world</b></p></body></html>")).toBe("Title\nHello & world");
  });
});
