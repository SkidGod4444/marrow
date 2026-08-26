import { z } from "zod";
import type { Config } from "../config.ts";
import type { UsageTracker } from "./client.ts";
import { generateStructured } from "./text.ts";

export const FrameDescriptionSchema = z.object({
  caption: z.string().describe("One sentence: what is on screen (slide title, diagram, code, speaker, demo…)."),
  ocr_text: z.string().describe("All legible on-screen text, verbatim, newline-separated. Empty string if none."),
});
export type FrameDescription = z.infer<typeof FrameDescriptionSchema>;

const SYSTEM = `You describe a single keyframe from a technical talk, lecture, or podcast video for a searchable index.
Return a one-sentence caption that names the kind of content (slide, chart, code, terminal, whiteboard, speaker on camera, demo UI…)
and its subject, plus an OCR transcription of all legible text. Do not speculate beyond what is visible.`;

/** STACK:vlm_cheap — gpt-5.6-luna with image input, reasoning effort "none". */
export async function describeFrame(cfg: Config, jpeg: Uint8Array, usage: UsageTracker): Promise<FrameDescription> {
  const b64 = Buffer.from(jpeg).toString("base64");
  return generateStructured(
    cfg,
    {
      system: SYSTEM,
      user: [
        { type: "input_text", text: "Describe this keyframe." },
        { type: "input_image", image_url: `data:image/jpeg;base64,${b64}`, detail: "auto" },
      ],
      schema: FrameDescriptionSchema,
      schemaName: "frame_description",
      effort: "none",
      verbosity: "low",
    },
    usage,
  );
}
