// Pipeline steps in the words a person reads (PRD §5 stage names → what is happening).
export const STAGE_LABEL: Record<string, string> = {
  fetch: "Fetching",
  transcribe: "Transcribing",
  diarize: "Finding speakers",
  frames: "Picking keyframes",
  vision: "Reading the slides",
  article: "Writing the article",
  enrich: "Resolving references",
  segment: "Indexing",
  language: "Extracting expressions",
  novelty: "Checking what's new",
};
export const stageLabel = (stage: string | null | undefined) => (stage ? (STAGE_LABEL[stage] ?? stage) : "");
