import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTranscriptQueue } from '../src/lib/queue.js';

describe('createTranscriptQueue', () => {
  it('runs one item at a time, keeps only the newest partial and never drops finals', async () => {
    const seen = [];
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const queue = createTranscriptQueue(async (item) => {
      seen.push(item.text);
      if (item.text === 'go') await gate; // hold the first request "in flight"
    });

    const done = queue.push({ text: 'go', final: false });
    queue.push({ text: 'go to', final: false });
    queue.push({ text: 'go to step', final: true });
    queue.push({ text: 'next', final: false });
    queue.push({ text: 'next step', final: false });
    release();
    await done;

    assert.deepEqual(seen, ['go', 'go to step', 'next step']);
  });
});
