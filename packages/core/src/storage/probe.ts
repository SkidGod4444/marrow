import type { Storage } from "./index.ts";

// Can the server actually read and write its object store? Checked at boot and every few minutes, reported on
// GET /health as `storage`: "ok" | "error". Empty S3 credentials on a fresh box are the classic silent failure —
// every ingest would die at its first storage call with the reason buried in the broker.
export type StorageStatus = "ok" | "error" | "unknown";

export async function probeStorage(storage: Storage): Promise<{ status: StorageStatus; error?: string }> {
  const key = `health/probe-${Date.now()}.txt`;
  try {
    await storage.put(key, "ok", "text/plain");
    await storage.delete(key);
    return { status: "ok" };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
