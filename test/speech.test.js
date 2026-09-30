import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createListener } from '../src/lib/speech.js';

/** A recognizer double. `plan` is a list of what each start() call does: 'ok' or 'throw'. */
function fakeRecognition(plan = []) {
  const instances = [];
  const Recognition = class {
    constructor() {
      instances.push(this);
      this.starts = 0;
    }
    start() {
      const step = plan.shift() ?? 'ok';
      this.starts += 1;
      if (step === 'throw') throw new DOMException('already started', 'InvalidStateError');
      queueMicrotask(() => this.onstart?.());
    }
    stop() {
      this.stopped = true;
    }
  };
  globalThis.SpeechRecognition = Recognition;
  return { instances, Recognition };
}

afterEach(() => {
  delete globalThis.SpeechRecognition;
});

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds a listener that records every callback. */
function listenerWith(options) {
  const events = { errors: [], statuses: [], transcripts: [] };
  const listener = createListener(
    {
      onTranscript: (t) => events.transcripts.push(t),
      onError: (e) => events.errors.push(e),
      onStatus: (s) => events.statuses.push(s),
    },
    'en-US',
    options,
  );
  return { listener, events };
}

describe('createListener', () => {
  it('reports a start that throws instead of showing "Listening" with no audio', async () => {
    fakeRecognition(['throw']);
    const { listener, events } = listenerWith();
    await listener.start();
    assert.equal(listener.listening, false);
    assert.deepEqual(events.statuses, []);
    assert.equal(events.errors[0]?.code, 'start-failed');
  });

  it('retries a failed restart once after a pause, then keeps listening', async () => {
    const { instances } = fakeRecognition(['ok', 'throw', 'ok']);
    const { listener, events } = listenerWith({ restartDelayMs: 5 });
    await listener.start();
    assert.equal(listener.listening, true);
    instances[0].onend(); // Chrome ended the session; the immediate restart throws
    await tick(20);
    assert.equal(instances[0].starts, 3, 'start, failed restart, delayed retry');
    assert.equal(listener.listening, true);
    assert.deepEqual(events.errors, []);
  });

  it('ignores the errors that only mean nobody spoke, and restarts when Chrome ends a session', async () => {
    const { instances } = fakeRecognition();
    const { listener, events } = listenerWith();
    await listener.start();
    const [r] = instances;
    r.onerror({ error: 'no-speech' });
    r.onerror({ error: 'aborted' });
    assert.equal(listener.listening, true);
    assert.deepEqual(events.errors, []);
    r.onend();
    assert.equal(r.starts, 2, 'continuous listening resumes after silence');
    assert.equal(r.stopped, undefined);
  });

  it('stops and explains a blocked microphone', async () => {
    const { instances } = fakeRecognition();
    const { listener, events } = listenerWith();
    await listener.start();
    instances[0].onerror({ error: 'not-allowed' });
    assert.equal(listener.listening, false);
    assert.equal(instances[0].stopped, true);
    assert.deepEqual(events.errors, [{ code: 'not-allowed', message: 'Microphone access is blocked.' }]);
    assert.equal(events.statuses.at(-1).listening, false);
  });

  it('emits a transcript per new word, and the final once', async () => {
    const { instances } = fakeRecognition();
    const { listener, events } = listenerWith();
    await listener.start();
    const result = (transcript, isFinal) => ({ results: [Object.assign([{ transcript }], { isFinal })] });
    instances[0].onresult(result('go to', false));
    instances[0].onresult(result('go to ', false)); // same words again: not news
    instances[0].onresult(result('go to wikipedia', false));
    instances[0].onresult(result('go to wikipedia', true));
    assert.deepEqual(
      events.transcripts.map((t) => [t.text, t.final]),
      [
        ['go to', false],
        ['go to wikipedia', false],
        ['go to wikipedia', true],
      ],
    );
    assert.equal(new Set(events.transcripts.map((t) => t.id)).size, 1, 'one id for the whole phrase');
  });

  it('falls back to cloud recognition when available() never settles, as in Brave', async () => {
    const { Recognition } = fakeRecognition();
    Recognition.available = () => new Promise(() => {}); // never resolves
    const { listener, events } = listenerWith({ availabilityTimeoutMs: 10 });
    await listener.start();
    assert.equal(events.statuses[0].mode, 'cloud');
  });

  it('uses on-device recognition when Chrome has the model', async () => {
    const { Recognition, instances } = fakeRecognition();
    Recognition.available = async () => 'available';
    const { listener, events } = listenerWith();
    await listener.start();
    assert.equal(events.statuses[0].mode, 'on-device');
    assert.equal(instances[0].processLocally, true);
  });

  it('reports Brave as unsupported and never builds a recognizer', async () => {
    const { instances } = fakeRecognition();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const brave = Object.create(globalThis.navigator, { brave: { value: {}, configurable: true } });
    Object.defineProperty(globalThis, 'navigator', { value: brave, configurable: true, writable: true });
    try {
      const { listener, events } = listenerWith();
      assert.equal(listener.supported, false);
      await listener.start();
      assert.equal(instances.length, 0);
      assert.match(events.errors[0].message, /Brave/);
    } finally {
      Object.defineProperty(globalThis, 'navigator', original);
    }
  });

  it('gives up after repeated restart failures and says so', async () => {
    const { instances } = fakeRecognition(['ok', 'throw', 'throw', 'throw', 'throw']);
    const { listener, events } = listenerWith({ restartDelayMs: 5, maxRestarts: 2 });
    await listener.start();
    instances[0].onend();
    await tick(40);
    assert.equal(listener.listening, false);
    assert.equal(events.errors.at(-1)?.code, 'restart-failed');
    assert.equal(events.statuses.at(-1)?.listening, false, 'stop() ran, so the UI leaves the listening state');
  });
});
