import { OG_SIZE, renderOg } from "@/lib/og";

export const alt = "Marrow — a research brain, grown from what you consume";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOg({
    eyebrow: "Podcasts · YouTube · Posts · Newsletters · Papers",
    muted: "A research brain,",
    title: "grown from what you consume.",
    meta: ["Searched to the second", "Answered with citations", "Pushed into research"],
    footer: "marrow — open source, AGPL-3.0",
  });
}
