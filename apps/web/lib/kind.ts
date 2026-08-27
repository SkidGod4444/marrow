// Source-type helpers shared by the inbox, library and item pages (PRD §4.2).
export const TEXT_KINDS = new Set(["captured_post", "newsletter", "paper", "note"]);

export const KIND_LABEL: Record<string, string> = {
  youtube_video: "Video",
  podcast_episode: "Podcast",
  uploaded_media: "Upload",
  captured_post: "Post",
  newsletter: "Newsletter",
  paper: "Paper",
  note: "Note",
};

export const isTextKind = (t: string) => TEXT_KINDS.has(t);
export const kindLabel = (t: string) => KIND_LABEL[t] ?? t.replace(/_/g, " ");
/** Only real web URLs get an "open source" link; pasted text and emails have synthetic marrow: ids. */
export const isWebUrl = (u: string) => /^https?:\/\//i.test(u);
