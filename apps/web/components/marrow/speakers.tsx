// Speaker colour dots — the validated categorical slots, in a fixed order so a speaker keeps its colour everywhere.
const SLOTS = ["var(--kind-paper)", "var(--kind-tool)", "var(--kind-technique)", "var(--kind-dataset)", "var(--kind-person)", "var(--kind-repo)", "var(--kind-other)"];

export function speakerColor(index: number): string {
  return SLOTS[index % SLOTS.length]!;
}

export function SpeakerDot({ index, className = "" }: { index: number; className?: string }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${className}`} style={{ background: speakerColor(index) }} />;
}
