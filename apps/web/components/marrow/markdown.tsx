"use client";

import { Streamdown } from "streamdown";
import { markdownComponents } from "./timestamp-link";

/** Render stored markdown (namespace summaries, article bodies) consistently — never as raw text. */
export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <Streamdown components={markdownComponents}>{children}</Streamdown>
    </div>
  );
}
