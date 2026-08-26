import { OG_SIZE, renderOg } from "@/lib/og";

export const alt = "Marrow — video-first research knowledge base";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOg({
    eyebrow: "Research knowledge base",
    title: "Turn talks, lectures and podcasts into searchable, citable knowledge.",
    meta: ["transcripts", "keyframes", "citations", "graph"],
    footer: "marrow",
  });
}
