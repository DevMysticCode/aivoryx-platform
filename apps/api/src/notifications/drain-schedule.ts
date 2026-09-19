import type { Queue } from 'bullmq';

export const DRAIN_JOB_NAME = 'drain';

/** Below this the outbox poll is a needlessly hot loop (it is a Postgres query, not Redis). */
export const DRAIN_SAFE_MIN_MS = 5000;

/**
 * Remove every BullMQ repeatable `drain` schedule from the notifications queue.
 *
 * The outbox drain used to be a BullMQ repeatable job (`every` = the poll
 * interval, 2s by default). Each tick costs ~60–90 Redis commands, so on a
 * metered Redis (Upstash) it burned the whole allowance within hours. The poll
 * now runs as an in-process timer against Postgres (zero Redis traffic when
 * idle; Redis is used only for real `deliver` jobs).
 *
 * BullMQ keys a repeat by (name, jobId, `every`), and repeat schedules live in
 * Redis, so every deployment that ever registered one keeps firing it until it
 * is explicitly removed — including duplicates created when the interval was
 * changed. Startup therefore deletes all of them (also each one's pending
 * delayed job). Safe to run on every boot: with nothing registered it is a read.
 */
export async function removeStaleDrainSchedules(
  queue: Pick<Queue, 'getRepeatableJobs' | 'removeRepeatableByKey'>,
): Promise<number> {
  const stale = (await queue.getRepeatableJobs()).filter((j) => j.name === DRAIN_JOB_NAME);
  for (const job of stale) await queue.removeRepeatableByKey(job.key);
  return stale.length;
}

/**
 * A self-rescheduling timer: the next run is scheduled only after the previous
 * one finishes, so slow drains never overlap, and errors never stop the loop.
 */
export function startPoller(
  run: () => Promise<unknown>,
  everyMs: number,
  onError: (err: unknown) => void,
): { stop: () => void; runNow: () => Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    try {
      await run();
    } catch (err) {
      onError(err);
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), everyMs);
      timer.unref?.();
    }
  };
  void tick();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    runNow: () => tick(),
  };
}
