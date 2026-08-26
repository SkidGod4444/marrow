import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(prefix: string, length = 20): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${prefix}_${out}`;
}

export const MEDIA_SOURCE_TYPES = ["youtube_video", "podcast_episode", "uploaded_media"] as const;
export const TEXT_SOURCE_TYPES = ["captured_post", "newsletter", "paper", "note"] as const;
export const SOURCE_TYPES = [...MEDIA_SOURCE_TYPES, ...TEXT_SOURCE_TYPES] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export function isMediaSource(t: SourceType): boolean {
  return (MEDIA_SOURCE_TYPES as readonly string[]).includes(t);
}

/** Item ids: `vid_` for media documents (PRD §4.3), `txt_` for text sources. */
export function newItemId(sourceType: SourceType): string {
  return newId(isMediaSource(sourceType) ? "vid" : "txt");
}
