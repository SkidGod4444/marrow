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
  // Audio chunks transcribed in parallel (API-bound); 3 keeps a 2-hour podcast under a few minutes without tripping rate limits.
  STT_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  // Ingest jobs run at the same time. Each one runs ffmpeg/yt-dlp: on a 1 GB box keep it at 1–2, on 2 GB+ 2–3.
  INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  YTDLP_BIN: z.string().default("yt-dlp"),
  // YouTube flags cloud addresses ("Sign in to confirm you're not a bot"). A Netscape cookies file exported from a
  // signed-in browser, and/or a proxy, are what yt-dlp offers for that (docs/DEPLOY.md). Extra args: an escape hatch.
  YTDLP_COOKIES: z.string().optional(),
  YTDLP_PROXY: z.string().optional(),
  YTDLP_EXTRA_ARGS: z.string().optional(),
  // A bgutil PO-token provider (docker-compose.prod.yml runs one): YouTube trusts tokened requests more, so the bot check
  // on cloud addresses stops being a coin toss. Plugin lives in the server image; this just tells it where the server is.
  YTDLP_POT_PROVIDER_URL: z.string().optional(),
  FFMPEG_BIN: z.string().default("ffmpeg"),
  FFPROBE_BIN: z.string().default("ffprobe"),

  // Retrieval (PRD §8): hybrid vector + FTS merged with RRF, over-fetch SEARCH_OVERFETCH×k, optional LLM rerank.
  SEARCH_OVERFETCH: z.coerce.number().default(4),
  SEARCH_RERANK: z.enum(["rrf", "llm"]).default("rrf"),

  // Subscriptions (PRD §6.4): poll playlists/channels every N minutes; 0 disables the schedule.
  POLL_EVERY_MINUTES: z.coerce.number().default(30),
  // RSS/podcast feeds: at most this many new entries are ingested per poll (a fresh subscription doesn't pull a whole back-catalogue).
  FEED_MAX_PER_POLL: z.coerce.number().default(5),

  // Capture (PRD §7): plain server-side fetch of a public URL.
  CAPTURE_FETCH_TIMEOUT_MS: z.coerce.number().default(15_000),
  CAPTURE_MAX_BYTES: z.coerce.number().default(8 * 1024 * 1024),
  // Inbound email (STACK:inbound_email): the provider's webhook posts to /inbound/email/<INBOUND_EMAIL_TOKEN>;
  // mails route to the namespace in the recipient's plus-tag (anything+<namespace>@…) or to INBOUND_EMAIL_NAMESPACE.
  INBOUND_EMAIL_TOKEN: z.string().optional(),
  INBOUND_EMAIL_NAMESPACE: z.string().optional(),

  // Server
  PORT: z.coerce.number().default(3001),
  MARROW_API_KEY: z.string().optional(),
  // Set by the Docker build (GIT_SHA build arg, see scripts/deploy-ec2.sh); GET /health reports it. Unset in development.
  MARROW_COMMIT: z.string().optional(),
  // Owner login (Better Auth, docs/DEPLOY.md): the browser-facing origin of the web app (cookies + CSRF) and the
  // signing secret. Sign-up is open; every account gets a workspace. MARROW_AUTH=off removes the web gate (local dev only).
  MARROW_WEB_URL: z.string().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().optional(),
  MARROW_AUTH: z.enum(["on", "off"]).default("on"),
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
