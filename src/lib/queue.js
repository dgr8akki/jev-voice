/**
 * Serialises transcript handling so only one Jev request is in flight at a time.
 *
 * Speech recognition emits a partial transcript for every new word. While a
 * request is running, newer partials replace older queued ones (only the
 * latest wording matters); final transcripts are never dropped.
 *
 * @module lib/queue
 */

/**
 * @template T
 * @param {(item: T & { final: boolean }) => Promise<void>} handler
 * @returns {{ push: (item: T & { final: boolean }) => Promise<void> }}
 */
export function createTranscriptQueue(handler) {
  /** @type {Array<T & { final: boolean }>} */
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
