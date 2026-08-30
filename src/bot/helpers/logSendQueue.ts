const queues = new Map<number, Promise<unknown>>();

/**
 * Serialize log posts per destination chat so one entry's messages (main line +
 * forwarded blocks) are never interleaved with another entry's. Concurrent callers
 * — a ban, a kick, a multi-message #REPORTE — each wait for the previous task to the
 * same dest to settle. Failures don't break the chain; the next task still runs.
 */
export function enqueueLogSend<T>(dest: number, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(dest) ?? Promise.resolve();
  const run = prev.then(task, task);
  const settled = run.then(
    () => {},
    () => {}
  );
  queues.set(dest, settled);
  settled.then(() => {
    if (queues.get(dest) === settled) queues.delete(dest);
  });
  return run;
}
