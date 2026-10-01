// One Jev request in flight at a time: newer partials replace queued ones, finals are never dropped.

/**
 * @template T
 * @param {(item: T & { final: boolean }) => Promise<void>} handler
 * @returns {{ push: (item: T & { final: boolean }) => Promise<void> }}
 */
export function createTranscriptQueue(handler) {
  const pending = [];
  let running = null;

  async function drain() {
    while (pending.length) await handler(pending.shift());
    running = null;
  }

  return {
    push(item) {
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (!pending[i].final) pending.splice(i, 1);
      }
      pending.push(item);
      running ??= drain();
      return running;
    },
  };
}
