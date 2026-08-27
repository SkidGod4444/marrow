import { PgBoss } from "pg-boss";

export const INGEST_QUEUE = "ingest";

export type JobHandler = (jobId: string) => Promise<void>;

/** STACK:queue — pg-boss in production (same Postgres), an in-process serial queue when there is no DATABASE_URL. */
export interface JobQueue {
  start(handler: JobHandler): Promise<void>;
  enqueue(jobId: string): Promise<void>;
  /** STACK:cron — run `fn` every `everyMinutes` (pg-boss cron on Postgres, a timer in-process). */
  schedule(name: string, everyMinutes: number, fn: () => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export class PgBossQueue implements JobQueue {
  private boss: PgBoss;
  constructor(connectionString: string, ssl?: false | { rejectUnauthorized: boolean; ca?: string }) {
    this.boss = new PgBoss({ connectionString, schema: "pgboss", ...(ssl ? { ssl } : {}) });
  }
  async start(handler: JobHandler) {
    (this.boss as unknown as NodeJS.EventEmitter).on("error", (err: Error) => console.error("[pg-boss]", err));
    await this.boss.start();
    await this.boss.createQueue(INGEST_QUEUE);
    await this.boss.work<{ jobId: string }>(INGEST_QUEUE, { batchSize: 1, pollingIntervalSeconds: 2 }, async (jobs: Array<{ data: { jobId: string } }>) => {
      for (const j of jobs) await handler(j.data.jobId);
    });
  }
  async enqueue(jobId: string) {
    await this.boss.send(INGEST_QUEUE, { jobId }, { singletonKey: jobId, retryLimit: 2, retryDelay: 30, expireInSeconds: 4 * 3600 });
  }
  async schedule(name: string, everyMinutes: number, fn: () => Promise<void>) {
    const m = Math.max(1, Math.min(59, Math.round(everyMinutes)));
    const cron = everyMinutes >= 60 ? `0 */${Math.max(1, Math.round(everyMinutes / 60))} * * *` : `*/${m} * * * *`;
    await this.boss.createQueue(name);
    await this.boss.work(name, { batchSize: 1 }, async () => {
      await fn();
    });
    await this.boss.schedule(name, cron);
  }
  async stop() {
    await this.boss.stop({ graceful: true });
  }
}

export class InProcessQueue implements JobQueue {
  private handler: JobHandler | null = null;
  private chain: Promise<void> = Promise.resolve();
  private pending = new Set<string>();
  private timers: ReturnType<typeof setInterval>[] = [];
  async start(handler: JobHandler) {
    this.handler = handler;
  }
  async enqueue(jobId: string) {
    if (!this.handler) throw new Error("queue not started");
    if (this.pending.has(jobId)) return;
    this.pending.add(jobId);
    const h = this.handler;
    this.chain = this.chain
      .then(() => h(jobId))
      .catch((err) => console.error(`[queue] job ${jobId} failed:`, err))
      .finally(() => this.pending.delete(jobId));
  }
  async schedule(_name: string, everyMinutes: number, fn: () => Promise<void>) {
    const t = setInterval(() => void fn().catch((err) => console.error("[queue] scheduled task failed:", err)), Math.max(1, everyMinutes) * 60_000);
    this.timers.push(t);
  }
  async stop() {
    for (const t of this.timers) clearInterval(t);
    await this.chain;
  }
}
