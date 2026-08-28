"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Client UI state that outlives a component (Zustand). Server data lives in TanStack Query (lib/queries.ts).

export type GraphLayout = "force" | "radial" | "columns";
type GraphPrefs = { layout: GraphLayout; labels: "auto" | "all" | "none"; minMentions: number; contestedOnly: boolean };
type UiState = {
  graph: GraphPrefs;
  setGraph: (patch: Partial<GraphPrefs>) => void;
  /** The shared page remembers whether the player is hidden. */
  sharedPlayerHidden: boolean;
  setSharedPlayerHidden: (hidden: boolean) => void;
};

/** Preferences that should feel remembered across visits — persisted per browser. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      graph: { layout: "force", labels: "auto", minMentions: 1, contestedOnly: false },
      setGraph: (patch) => set((s) => ({ graph: { ...s.graph, ...patch } })),
      sharedPlayerHidden: false,
      setSharedPlayerHidden: (hidden) => set({ sharedPlayerHidden: hidden }),
    }),
    { name: "marrow:ui", version: 1 },
  ),
);

type PracticeState = {
  /** Cards reviewed in this sitting (progress line on the Practice page). */
  done: number;
  bump: () => void;
  reset: () => void;
};
export const usePracticeStore = create<PracticeState>()((set) => ({ done: 0, bump: () => set((s) => ({ done: s.done + 1 })), reset: () => set({ done: 0 }) }));
