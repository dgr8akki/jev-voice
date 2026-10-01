// Continuous speech recognition, one transcript per new word. On-device first (Chrome 139+), cloud otherwise; Brave has the API without a backend and is reported as unsupported.

// Errors that only mean "nobody talked" and must not stop listening.
const BENIGN_ERRORS = new Set(['no-speech', 'aborted']);

// @type {Record<string, string>}
const ERROR_MESSAGES = {
  'not-allowed': 'Microphone access is blocked.',
  'audio-capture': 'No microphone was found.',
  network: "Speech recognition can't reach Google's servers and on-device recognition isn't available.",
  'language-not-supported': 'English speech recognition is not available in this browser.',
  'start-failed': "Couldn't start listening. Try again.",
  'restart-failed': 'Listening stopped and could not be resumed. Press Start listening again.',
};

// Timings; overridable for tests.
const DEFAULTS = {
  /** `recognition.start()` throws InvalidStateError while the last session is still tearing down. */
  restartDelayMs: 250,
  maxRestarts: 3,
  /** Brave never settles `available()`; give it this long before assuming cloud. */
  availabilityTimeoutMs: 3_000,
  installTimeoutMs: 60_000,
};

/**
 * @param {object} callbacks
 * @param {(t: { text: string, final: boolean, id: string }) => void} callbacks.onTranscript
 * @param {(error: { code: string, message: string }) => void} callbacks.onError
 * @param {(status: { listening: boolean, mode?: 'on-device' | 'cloud' }) => void} [callbacks.onStatus]
 * @param {(message: string) => void} [callbacks.onNotice] One-off progress messages.
 * @param {string} [lang]
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function createListener(
  { onTranscript, onError, onStatus = () => {}, onNotice = () => {} },
  lang = 'en-US',
  options = {},
) {
  const { restartDelayMs, maxRestarts, availabilityTimeoutMs, installTimeoutMs } = { ...DEFAULTS, ...options };
  const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  const unsupportedReason = navigator.brave
    ? 'Brave has no working speech recognition. Use Google Chrome, or type commands instead.'
    : !Recognition
      ? 'This browser has no speech recognition. Type commands instead.'
      : null;

  let recognition = null;
  let listening = false;
  let starting = false; // between start() and the recognizer accepting; a second click in that window is ignored
  let mode = null;
  let session = 0;
  let lastWordCount = 0;
  let restarts = 0;

  async function chooseMode() {
    if (mode) return;
    mode = 'cloud';
    if (!Recognition.available) return;
    const options = { langs: [lang], processLocally: true };
    let state = await within(Recognition.available(options), availabilityTimeoutMs, 'unavailable');
    if (state === 'downloadable' || state === 'downloading') {
      onNotice('Downloading the on-device speech model. This happens once.');
      state = (await within(Recognition.install(options), installTimeoutMs, false)) ? 'available' : 'unavailable';
    }
    if (state === 'available') mode = 'on-device';
  }

  function build() {
    const r = new Recognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.processLocally = mode === 'on-device';
    r.onstart = () => {
      session += 1;
      lastWordCount = 0;
      restarts = 0;
    };
    r.onresult = (event) => {
      const index = event.results.length - 1;
      const result = event.results[index];
      const text = result[0].transcript.trim();
      if (!text) return;
      const words = text.split(/\s+/).length;
      // Interim results repeat constantly; only a new word (or the final) is news.
      if (!result.isFinal && words === lastWordCount) return;
      lastWordCount = result.isFinal ? 0 : words;
      onTranscript({ text, final: result.isFinal, id: `${session}:${index}` });
    };
    // Chrome ends continuous recognition after a stretch of silence.
    r.onend = () => {
      if (listening) restart();
    };
    r.onerror = (event) => {
      if (BENIGN_ERRORS.has(event.error)) return;
      stop();
      onError({
        code: event.error,
        message: ERROR_MESSAGES[event.error] ?? `Speech recognition error: ${event.error}.`,
      });
    };
    return r;
  }

  /**
   * Starts again after Chrome ended the session. start() throws while the old
   * session is still tearing down, so one failure waits a moment and tries
   * again; repeated failures stop, so the button never claims to listen while
   * nothing is being heard.
   */
  function restart() {
    try {
      recognition.start();
    } catch {
      if (restarts >= maxRestarts) {
        stop();
        onError({ code: 'restart-failed', message: ERROR_MESSAGES['restart-failed'] });
        return;
      }
      restarts += 1;
      setTimeout(() => listening && restart(), restartDelayMs);
    }
  }

  async function start() {
    if (unsupportedReason) return onError({ code: 'unsupported', message: unsupportedReason });
    if (listening || starting) return;
    starting = true;
    try {
      await chooseMode();
      recognition ??= build();
      try {
        recognition.start();
      } catch {
        return onError({ code: 'start-failed', message: ERROR_MESSAGES['start-failed'] });
      }
      listening = true;
      onStatus({ listening, mode });
    } finally {
      starting = false;
    }
  }

  function stop() {
    if (!listening) return;
    listening = false;
    recognition?.stop();
    onStatus({ listening, mode });
  }

  return {
    start,
    stop,
    get listening() {
      return listening;
    },
    get supported() {
      return !unsupportedReason;
    },
  };
}

/** Resolves with `fallback` if `promise` hasn't settled in `ms` (Brave never settles). */
function within(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(resolve, ms, fallback)),
  ]);
}
