import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes"].includes(v.toLowerCase())));

/**
 * Managed databases hand out passwords with `? < : ( ) #`… which break URL parsing (RDS auto-generated ones do).
 * Percent-encode the password part so `postgres://user:p?ss@host/db` works as pasted; already-encoded values pass
 * through unchanged. RDS forbids `@` and `/` in passwords, so the last `@` is the host separator.
 */
export function normalizeDatabaseUrl(url: string): string {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return url;
  const scheme = url.slice(0, schemeEnd + 3);
  const rest = url.slice(scheme.length);
  const at = rest.lastIndexOf("@");
  if (at === -1) return url;
  const cred = rest.slice(0, at);
  const colon = cred.indexOf(":");
  if (colon === -1) return url;
  const pass = cred.slice(colon + 1);
  let decoded = pass;
  try {
    decoded = decodeURIComponent(pass);
  } catch {
    /* a literal % — treat as raw */
  }
  return `${scheme}${cred.slice(0, colon)}:${encodeURIComponent(decoded)}@${rest.slice(at + 1)}`;
}

export const ConfigSchema = z.object({
  // Database: real Postgres (RDS / docker-compose) when set, PGlite otherwise.
  DATABASE_URL: z
    .string()
    .optional()
    .transform((v) => (v ? normalizeDatabaseUrl(v) : v)),
  // TLS to Postgres: auto = encrypt for any non-local host (verify against DATABASE_SSL_CA when the file exists,
  // e.g. the RDS bundle baked into the Docker image), require = encrypt without CA check, verify-full, off.
  DATABASE_SSL: z.enum(["auto", "require", "verify-full", "off"]).default("auto"),
  DATABASE_SSL_CA: z.string().default("/etc/ssl/certs/rds-global-bundle.pem"),
  PGLITE_DIR: z.string().default(".marrow/pglite"),
  PGLITE_MEMORY: bool.default(false),

  // Object storage: "s3" (AWS S3 or MinIO) or "local" filesystem.
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
  S3_BUCKET: z.string().default("marrow"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  LOCAL_STORAGE_DIR: z.string().default(".marrow/storage"),
  WORK_DIR: z.string().default(".marrow/work"),

  // OpenAI (STACK: stt / vlm_cheap / llm_cheap / embeddings / chat)
  OPENAI_API_KEY: z.string().optional(),
  STT_MODEL: z.string().default("whisper-1"),
  STT_MAX_BYTES: z.coerce.number().default(25 * 1024 * 1024),
  // STACK:diarization — second STT pass for multi-speaker audio. auto = podcast/interview heuristics or namespace flag.
  DIARIZE: z.enum(["auto", "always", "off"]).default("auto"),
  DIARIZE_MODEL: z.string().default("gpt-4o-transcribe-diarize"),
  DIARIZE_CHUNK_S: z.coerce.number().default(420),
  LLM_MODEL_CHEAP: z.string().default("gpt-5.6-luna"),
  LLM_MODEL_CHAT: z.string().default("gpt-5.6-terra"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMS: z.coerce.number().default(1536),

  // Pipeline knobs
  FRAMES_PER_HOUR: z.coerce.number().default(120),
  SCENE_THRESHOLD: z.coerce.number().default(0.3),
  FRAME_MIN_GAP_S: z.coerce.number().default(2),
  // Density floor: when scene detection finds fewer than one cut per this many seconds, sample evenly too.
  FRAME_FLOOR_EVERY_S: z.coerce.number().default(90),
  FRAME_WIDTH: z.coerce.number().default(1280),
  MAX_VIDEO_HEIGHT: z.coerce.number().default(720),
  VISION_CONCURRENCY: z.coerce.number().default(6),
  YTDLP_BIN: z.string().default("yt-dlp"),
  FFMPEG_BIN: z.string().default("ffmpeg"),
  FFPROBE_BIN: z.string().default("ffprobe"),

  // Retrieval (PRD §8): hybrid vector + FTS merged with RRF, over-fetch SEARCH_OVERFETCH×k, optional LLM rerank.
  SEARCH_OVERFETCH: z.coerce.number().default(4),
  SEARCH_RERANK: z.enum(["rrf", "llm"]).default("rrf"),

  // Subscriptions (PRD §6.4): poll playlists/channels every N minutes; 0 disables the schedule.
  POLL_EVERY_MINUTES: z.coerce.number().default(30),

  // Server
  PORT: z.coerce.number().default(3001),
  MARROW_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(ConfigSchema.shape)) {
    const v = env[key];
    if (v !== undefined && v !== "") raw[key] = v;
  }
  return ConfigSchema.parse(raw);
}
