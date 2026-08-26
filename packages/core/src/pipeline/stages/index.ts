import type { StageTable } from "../types.ts";
import { articleStage } from "./article.ts";
import { diarizeStage } from "./diarize.ts";
import { enrichStage } from "./enrich.ts";
import { fetchStage } from "./fetch.ts";
import { framesStage } from "./frames.ts";
import { languageStage } from "./language.ts";
import { noveltyStage } from "./novelty.ts";
import { segmentStage } from "./segment.ts";
import { transcribeStage } from "./transcribe.ts";
import { visionStage } from "./vision.ts";

export const STAGES: StageTable = {
  fetch: fetchStage,
  transcribe: transcribeStage,
  diarize: diarizeStage,
  frames: framesStage,
  vision: visionStage,
  article: articleStage,
  enrich: enrichStage,
  segment: segmentStage,
  language: languageStage,
  novelty: noveltyStage,
};
