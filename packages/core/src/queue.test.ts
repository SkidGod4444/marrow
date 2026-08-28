import { describe, expect, it } from "vitest";
import { InProcessQueue } from "./queue.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("InProcessQueue", () => {
  it("runs up to `concurrency` jobs at once, de-duplicates, and stop() waits for the last one", async () => {
    const q = new InProcessQueue();
    let active = 0;
    let peak = 0;
    const done: string[] = [];
    await q.start(
      async (id) => {
        active++;
        peak = Math.max(peak, active);
        await sleep(30);
        active--;
        done.push(id);
      },
      { concurrency: 2 },
    );
    for (const id of ["a", "b", "c", "d", "a"]) await q.enqueue(id); // "a" twice → once
    await q.stop();
    expect(done.sort()).toEqual(["a", "b", "c", "d"]);
    expect(peak).toBe(2);
  });
  it("defaults to one at a time and keeps going after a failure", async () => {
    const q = new InProcessQueue();
    let peak = 0;
    let active = 0;
    const seen: string[] = [];
    await q.start(async (id) => {
      active++;
      peak = Math.max(peak, active);
      await sleep(10);
      active--;
      seen.push(id);
      if (id === "bad") throw new Error("boom");
    });
    await q.enqueue("bad");
    await q.enqueue("good");
    await q.stop();
    expect([seen, peak]).toEqual([["bad", "good"], 1]);
  });
});
