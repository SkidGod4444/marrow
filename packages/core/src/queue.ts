import { PgBoss } from "pg-boss";

export const INGEST_QUEUE = "ingest";

export type JobHandler = (jobId: string) => Promise<void>;

/** STACK:queue — pg-boss in production (same Postgres), an in-process serial queue when there is no DATABASE_URL. */
export interface JobQueue {
  start(handler: JobHandler): Promise<void>;
  enqueue(jobId: string): Promise<void>;
  stop(): Promise<void>;
}

export class PgBossQueue implements JobQueue {
  private boss: PgBoss;
  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString, schema: "pgboss" });
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
  async stop() {
    await this.boss.stop({ graceful: true });
  }
}

export class InProcessQueue implements JobQueue {
  private handler: JobHandler | null = null;
  private chain: Promise<void> = Promise.resolve();
  private pending = new Set<string>();
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
  async stop() {
    await this.chain;
  }
}
