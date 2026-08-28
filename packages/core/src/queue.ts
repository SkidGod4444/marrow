import { PgBoss } from "pg-boss";
import { stripSslParams } from "./db/index.ts";

export const INGEST_QUEUE = "ingest";

export type JobHandler = (jobId: string) => Promise<void>;

/** STACK:queue — pg-boss in production (same Postgres), an in-process serial queue when there is no DATABASE_URL. */
export type QueueStartOptions = { concurrency?: number };

export interface JobQueue {
  /** Begin taking jobs; `concurrency` jobs may run at once (default 1). */
  start(handler: JobHandler, opts?: QueueStartOptions): Promise<void>;
  enqueue(jobId: string): Promise<void>;
  /** STACK:cron — run `fn` every `everyMinutes` (pg-boss cron on Postgres, a timer in-process). */
  schedule(name: string, everyMinutes: number, fn: () => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export class PgBossQueue implements JobQueue {
  private boss: PgBoss;
  constructor(connectionString: string, ssl?: false | { rejectUnauthorized: boolean; ca?: string }) {
    this.boss = new PgBoss({ connectionString: stripSslParams(connectionString), schema: "pgboss", ...(ssl ? { ssl } : {}) });
  }
  async start(handler: JobHandler, opts: QueueStartOptions = {}) {
    (this.boss as unknown as NodeJS.EventEmitter).on("error", (err: Error) => console.error("[pg-boss]", err));
    await this.boss.start();
    await this.boss.createQueue(INGEST_QUEUE);
    await this.releaseOrphans();
    // Each `work` registration is an independent worker; N of them = N jobs in flight.
    const workers = Math.max(1, opts.concurrency ?? 1);
    for (let i = 0; i < workers; i++) {
      await this.boss.work<{ jobId: string }>(INGEST_QUEUE, { batchSize: 1, pollingIntervalSeconds: 2 }, async (jobs: Array<{ data: { jobId: string } }>) => {
        for (const j of jobs) await handler(j.data.jobId);
      });
    }
  }
  /**
   * A fresh process has no workers yet, so any job the broker still shows as `active` belonged to a process that died
   * mid-run (a deploy restart, a crash). Left alone it would sit there until it expires — an hour — before a retry.
   * Cancel them now; `recoverJobs` re-sends whatever the jobs table says is unfinished, and the runner resumes at the
   * interrupted stage.
   */
  private async releaseOrphans() {
    const res = await this.boss.getDb().executeSql(`select id from pgboss.job where name = $1 and state = 'active'`, [INGEST_QUEUE]);
    const ids = (res.rows as Array<{ id: string }>).map((r) => r.id);
    if (ids.length) {
      await this.boss.cancel(INGEST_QUEUE, ids);
      console.log(`[pg-boss] released ${ids.length} job(s) left active by the previous process`);
    }
  }
  async enqueue(jobId: string) {
    // singletonKey: one broker job per pipeline job at a time. expireInSeconds bounds a hung stage (a stuck download)
    // before the job is retried; a normal hour-long video finishes well inside it.
    await this.boss.send(INGEST_QUEUE, { jobId }, { singletonKey: jobId, retryLimit: 2, retryDelay: 30, expireInSeconds: 3600 });
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
  private concurrency = 1;
  private waiting: string[] = [];
  private pending = new Set<string>(); // waiting or running
  private active = 0;
  private drained: Array<() => void> = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  async start(handler: JobHandler, opts: QueueStartOptions = {}) {
    this.handler = handler;
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
  }
  async enqueue(jobId: string) {
    if (!this.handler) throw new Error("queue not started");
    if (this.pending.has(jobId)) return;
    this.pending.add(jobId);
    this.waiting.push(jobId);
    this.pump();
  }
  private pump() {
    while (this.active < this.concurrency && this.waiting.length) {
      const id = this.waiting.shift()!;
      this.active++;
      void this.handler!(id)
        .catch((err) => console.error(`[queue] job ${id} failed:`, err))
        .finally(() => {
          this.pending.delete(id);
          this.active--;
          this.pump();
          if (this.active === 0 && this.waiting.length === 0) for (const r of this.drained.splice(0)) r();
        });
    }
  }
  async schedule(_name: string, everyMinutes: number, fn: () => Promise<void>) {
    const t = setInterval(() => void fn().catch((err) => console.error("[queue] scheduled task failed:", err)), Math.max(1, everyMinutes) * 60_000);
    this.timers.push(t);
  }
  /** Stops the timers and waits for every job that was queued or running. */
  async stop() {
    for (const t of this.timers) clearInterval(t);
    if (this.active > 0 || this.waiting.length > 0) await new Promise<void>((r) => this.drained.push(r));
  }
}
