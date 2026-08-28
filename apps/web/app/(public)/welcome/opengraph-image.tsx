import { OG_SIZE, renderOg } from "@/lib/og";

export const alt = "Marrow — talks, lectures and podcasts, turned into searchable knowledge";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOg({
    eyebrow: "Talks · Lectures · Podcasts",
    title: "The marrow of every talk.",
    meta: ["Word-timestamped transcripts", "Articles with references", "Chat that cites to the second"],
    timecodes: ["00:00", "12:34", "1:02:07"],
    footer: "Read · Ask · Cite",
  });
}
