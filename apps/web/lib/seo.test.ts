import { describe, expect, it } from "vitest";
import { describe as describeText, isoDuration, jsonLdFor, youtubeIdOf } from "./seo";

describe("seo helpers", () => {
  it("durations and ids", () => {
    expect(isoDuration(649)).toBe("PT10M49S");
    expect(isoDuration(3600)).toBe("PT1H");
    expect(isoDuration(0)).toBe("PT0S");
    expect(youtubeIdOf("https://www.youtube.com/watch?v=LaULblUJfxA")).toBe("LaULblUJfxA");
    expect(youtubeIdOf("https://cdn.example.com/ep3.mp3")).toBeNull();
  });
  it("meta description cuts at a word", () => {
    expect(describeText("  short  ", "fallback")).toBe("short");
    expect(describeText("", "fallback")).toBe("fallback");
    const long = describeText("word ".repeat(80), "x");
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });
  it("structured data follows the source type", () => {
    const item = { id: "vid_1", createdAt: new Date("2026-08-28T00:00:00Z"), updatedAt: new Date("2026-08-28T06:00:00Z") };
    const article = { summary: "A DIY actuator.", takeaways: [], sections: [] } as never;
    const video = jsonLdFor(item, { source_type: "youtube_video", source_url: "https://www.youtube.com/watch?v=LaULblUJfxA", title: "Robot actuator", channel: "Koshiro", author: "", published_at: "2026-08-01T00:00:00Z", duration_s: 649, article, transcript: [{ text: "hello" }, { text: "world" }] }, "https://x/items/vid_1/read");
    expect(video).toMatchObject({ "@type": "VideoObject", name: "Robot actuator", duration: "PT10M49S", embedUrl: "https://www.youtube.com/embed/LaULblUJfxA", author: { "@type": "Organization", name: "Koshiro" }, transcript: "hello world", uploadDate: "2026-08-01T00:00:00.000Z" });
    const pod = jsonLdFor(item, { source_type: "podcast_episode", source_url: "https://cdn.example.com/ep3.mp3", title: "Ep 3", channel: "Robot Talk", author: "", published_at: null, duration_s: 1500, article: null as never, transcript: null }, "https://x/items/vid_1/read");
    expect(pod).toMatchObject({ "@type": "PodcastEpisode", timeRequired: "PT25M", associatedMedia: { contentUrl: "https://cdn.example.com/ep3.mp3" } });
    const post = jsonLdFor(item, { source_type: "captured_post", source_url: "https://blog.example.com/p", title: "Why sim to real fails", channel: "blog.example.com", author: "Ada", published_at: null, duration_s: 0, article: null as never, transcript: null }, "https://x/items/vid_1/read");
    expect(post).toMatchObject({ "@type": "Article", headline: "Why sim to real fails", author: { "@type": "Person", name: "Ada" } });
  });
});
