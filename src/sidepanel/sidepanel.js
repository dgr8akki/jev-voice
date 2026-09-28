/**
 * Side panel controller: microphone, typed commands, settings and the activity
 * log. Transcripts are handled by the service worker (background.js).
 */

import { mountConnection } from '../lib/connection.js';
import { createTranscriptQueue } from '../lib/queue.js';
import { createListener } from '../lib/speech.js';

const $ = (id) => document.getElementById(id);
const MAX_ACTIVITY = 30;

let connected = false;

// ---------------------------------------------------------------------------
// Live line: what the recognizer heard, word by word

/** The transcript on screen, and how many of its words an early action fired on. */
let heard = null;
let fired = { id: null, words: 0 };

function renderHeard() {
  $('heard').replaceChildren();
  if (!heard) return;
  const words = heard.text.split(/\s+/);
  const firedWords = fired.id === heard.id ? fired.words : 0;
  words.forEach((word, i) => {
    const span = document.createElement('span');
    span.textContent = word;
    if (i < firedWords) span.className = 'fired';
    else if (!heard.final && i === words.length - 1) span.className = 'partial';
    $('heard').append(span);
  });
}

/** @param {string} text @param {'mode' | 'problem'} [kind] */
function setNotice(text, kind = 'mode') {
  $('notice').textContent = text;
  $('notice').className = `notice ${kind}`;
}

// ---------------------------------------------------------------------------
// Commands

const queue = createTranscriptQueue(async (transcript) => {
  const outcome = await chrome.runtime
    .sendMessage({ type: 'transcript', ...transcript })
    .catch(() => ({ error: 'The extension restarted. Try again.' }));
  if (outcome?.error) return logActivity(transcript.text, outcome.error, { kind: 'error' });
  if (!outcome?.did) return;
  if (outcome.early) {
    fired = { id: transcript.id, words: transcript.text.split(/\s+/).length };
    renderHeard();
  }
  const kind = outcome.miss ? 'miss' : outcome.did === 'Ignored' ? 'ignored' : 'ok';
  logActivity(transcript.text, outcome.did, { kind, ms: outcome.ms, early: outcome.early });
});

let typedCount = 0;
$('command-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('command').value.trim();
  if (!text) return;
  queue.push({ text, final: true, id: `typed:${typedCount++}` });
  $('command').value = '';
});

/**
 * Prepends an entry; CSS turns the newest one into the last-action card.
 *
 * @param {string | null} said What the user said, or null for system messages.
 * @param {string} text Outcome in plain past tense, or an error.
 * @param {{ kind: 'ok' | 'miss' | 'error' | 'ignored', ms?: number, early?: boolean }} details
 */
function logActivity(said, text, { kind, ms, early }) {
  const item = $('entry').content.firstElementChild.cloneNode(true);
  item.dataset.kind = kind;
  if (early) item.dataset.early = '';
  item.querySelector('.said').textContent = said ? `“${said}”` : '';
  item.querySelector('.outcome').classList.add(kind === 'error' ? 'error' : 'result');
  item.querySelector('.text').textContent = text;
  if (ms !== undefined) {
    const tail = item.querySelector('.tail');
    tail.textContent = `in ${ms} ms`;
    if (early) {
      tail.append(
        Object.assign(document.createElement('span'), {
          className: 'early-text',
          textContent: ', before you finished',
        }),
      );
    }
  }
  $('activity').prepend(item);
  $('activity-empty').hidden = true;
  $('examples').open = false;
  while ($('activity').children.length > MAX_ACTIVITY) $('activity').lastChild.remove();
}

// ---------------------------------------------------------------------------
// Microphone

let micBlocked = false;

const listener = createListener({
  onTranscript(transcript) {
    heard = transcript;
    renderHeard();
    queue.push(transcript);
  },
  onError({ code, message }) {
    micBlocked = code === 'not-allowed' || code === 'audio-capture';
    renderMic();
    if (code === 'not-allowed') {
      chrome.tabs.create({ url: chrome.runtime.getURL('permission/permission.html') });
      logActivity(null, `${message} Allow it in the tab that just opened, then start listening again.`, {
        kind: 'error',
      });
      return;
    }
    logActivity(null, message, { kind: 'error' });
  },
  onStatus({ listening, mode }) {
    if (listening) micBlocked = false;
    heard = null;
    renderHeard();
    renderMic();
    setNotice(listening ? `Listening with ${mode === 'on-device' ? 'on-device' : 'cloud'} speech recognition` : '');
  },
  onNotice(message) {
    setNotice(message);
  },
});

/** Mic states: idle, listening, off (no key, or no speech recognition) and error (blocked). */
function renderMic() {
  const listening = listener.listening;
  const state = listening ? 'listening' : !listener.supported || !connected ? 'off' : micBlocked ? 'error' : 'idle';
  const mic = $('mic');
  mic.dataset.state = state;
  mic.toggleAttribute('data-slash', !listener.supported);
  mic.setAttribute('aria-pressed', String(listening));
  mic.setAttribute('aria-disabled', String(state === 'off'));
  $('mic-label').textContent = listening ? 'Listening' : 'Start listening';
  $('status-dot').classList.toggle('listening', listening);
  document.body.classList.toggle('listening', listening);
  document.body.classList.toggle('typing-first', !listener.supported || micBlocked);
}

$('mic').addEventListener('click', () => {
  if (!connected) return toggleSettings(true);
  if (listener.listening) listener.stop();
  else listener.start();
});

if (!listener.supported) {
  // Brave and friends: typing becomes the main control, without moving anything.
  setNotice("Speech recognition isn't available in this browser. Type commands instead.", 'problem');
  $('command').focus();
}

// ---------------------------------------------------------------------------
// Settings

connected = await mountConnection($('connection'), $('open-settings'), (isConnected) => {
  connected = isConnected;
  $('settings').dataset.connected = String(isConnected);
  if (!isConnected) toggleSettings(true);
  renderMic();
});

$('settings-toggle').addEventListener('click', () => toggleSettings());

function toggleSettings(open = $('settings').hidden) {
  $('settings').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
}
