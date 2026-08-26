import type { Config } from "../config.ts";
import { S3Storage } from "./s3.ts";
import { LocalStorage } from "./local.ts";

/** Object storage behind the PRD §12 key layout. S3 in production (MinIO locally), filesystem for tests. */
export interface Storage {
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  putFile(key: string, path: string, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  getToFile(key: string, path: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export function createStorage(cfg: Config): Storage {
  if (cfg.STORAGE_DRIVER === "s3") {
    return new S3Storage({
      bucket: cfg.S3_BUCKET,
      region: cfg.S3_REGION,
      endpoint: cfg.S3_ENDPOINT,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE || Boolean(cfg.S3_ENDPOINT),
    });
  }
  return new LocalStorage(cfg.LOCAL_STORAGE_DIR);
}

export { S3Storage, LocalStorage };

export function contentTypeFor(key: string): string {
  if (key.endsWith(".json")) return "application/json";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".ogg")) return "audio/ogg";
  if (key.endsWith(".m4a")) return "audio/mp4";
  if (key.endsWith(".mp4")) return "video/mp4";
  if (key.endsWith(".webm")) return "video/webm";
  if (key.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}
