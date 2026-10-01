/**
 * Side panel controller: microphone, typed commands, settings and the activity
 * log. Transcripts are handled by the service worker (background.js).
 */

import { mountConnection } from '../lib/connection.js';
import { createTranscriptQueue } from '../lib/queue.js';
import { createListener } from '../lib/speech.js';

const $ = (id) => document.getElementById(id);
const MAX_ACTIVITY = 30;
// Recognizers emit a partial per word; waiting this long after the last one saves a request per word.
const PARTIAL_PAUSE_MS = 250;

// Live line: what the recognizer heard, word by word

let heard = null;
let fired = { id: null, words: 0 };

// Not a live region: it changes on every word. The final phrase is announced once from #heard-final.
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
    // Spacing is CSS gap; without a real space the accessible name reads "gotowikipedia".
    if (i) $('heard').append(' ');
    $('heard').append(span);
  });
  if (heard.final) $('heard-final').textContent = `Heard: ${heard.text}`;
}

function setNotice(text, kind = 'mode') {
  $('notice').textContent = text;
  $('notice').className = `notice ${kind}`;
}

// Commands

const queue = createTranscriptQueue(async (transcript) => {
  // A final is a request the user is waiting on: show it working, then fill the same card in.
  // Partials stay silent until one of them acts.
  const pending = transcript.final
    ? logActivity(transcript.text, `Working on "${transcript.text}"...`, { kind: 'pending' })
    : null;
  $('activity').setAttribute('aria-busy', String(Boolean(pending)));
  // A partial that finds the worker asleep is not worth an error line; the worker itself stays quiet on partials too.
  const outcome = await chrome.runtime
    .sendMessage({ type: 'transcript', ...transcript })
    .catch(() => (transcript.final ? { error: 'The extension restarted. Try again.' } : {}));
  if (pending) $('activity').setAttribute('aria-busy', 'false');
  if (outcome?.error) return logActivity(transcript.text, outcome.error, { kind: 'error', into: pending });
  if (!outcome?.did) return pending?.remove();
  if (outcome.early) {
    fired = { id: transcript.id, words: transcript.text.split(/\s+/).length };
    renderHeard();
  }
  const kind = outcome.miss ? 'miss' : outcome.did === 'Ignored' ? 'ignored' : 'ok';
  logActivity(transcript.text, outcome.did, { kind, ms: outcome.ms, early: outcome.early, into: pending });
});

// "What can I say?" folds away once the first command lands, unless the user has
// opened or closed it themselves: then it is theirs and stays put.
let examplesTouched = false;
$('examples')
  .querySelector('summary')
  .addEventListener('click', () => (examplesTouched = true));

let typedCount = 0;
$('command-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('command').value.trim();
  if (!text) return;
  queue.push({ text, final: true, id: `typed:${typedCount++}` });
  $('command').value = '';
});

// Prepends an entry, or fills in a pending one; CSS turns the newest into the last-action card.
function logActivity(said, text, { kind, ms, early, into = null }) {
  const item = into?.isConnected ? into : $('entry').content.firstElementChild.cloneNode(true);
  item.dataset.kind = kind;
  if (early) item.dataset.early = '';
  item.querySelector('.said').textContent = said ? `"${said}"` : '';
  item.querySelector('.outcome').classList.remove('error', 'result');
  item.querySelector('.outcome').classList.add(kind === 'error' ? 'error' : 'result');
  item.querySelector('.text').textContent = text;
  item.querySelector('.tail').textContent = '';
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
  if (item !== into) $('activity').prepend(item);
  $('activity-empty').hidden = true;
  if (!examplesTouched) $('examples').open = false;
  while ($('activity').children.length > MAX_ACTIVITY) $('activity').lastChild.remove();
  return item;
}

// Microphone

let micBlocked = false;
let pendingPartial = null;

const listener = createListener({
  onTranscript(transcript) {
    heard = transcript;
    renderHeard();
    // The screen follows every word; the worker only hears from us once the words pause, or at the final.
    clearTimeout(pendingPartial);
    if (transcript.final) queue.push(transcript);
    else pendingPartial = setTimeout(() => queue.push(transcript), PARTIAL_PAUSE_MS);
  },
  onError({ code, message }) {
    micBlocked = code === 'not-allowed' || code === 'audio-capture';
    renderMic();
    if (code === 'not-allowed') {
      chrome.tabs.create({ url: chrome.runtime.getURL('permission/permission.html') });
      logActivity(
        null,
        'Chrome needs your OK for the microphone. Allow it in the tab that just opened, then press Start listening.',
        {
          kind: 'error',
        },
      );
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

// idle, listening, off (no speech recognition) or error (blocked). Never aria-disabled: off explains
// itself when pressed. State lives in the label alone, not doubled as aria-pressed.
function renderMic() {
  const listening = listener.listening;
  const state = listening ? 'listening' : !listener.supported ? 'off' : micBlocked ? 'error' : 'idle';
  const mic = $('mic');
  mic.dataset.state = state;
  mic.toggleAttribute('data-slash', !listener.supported);
  $('mic-label').textContent = listening ? 'Stop listening' : 'Start listening';
  $('status-dot').classList.toggle('listening', listening);
  document.body.classList.toggle('listening', listening);
  document.body.classList.toggle('typing-first', !listener.supported || micBlocked);
}

$('mic').addEventListener('click', () => {
  if (listener.listening) listener.stop();
  else listener.start();
});

if (!listener.supported) {
  // Brave and friends: typing becomes the main control, without moving anything.
  setNotice("Speech recognition isn't available in this browser. Type commands instead.", 'problem');
  $('command').focus();
}

// Settings

// Without a key the panel still scrolls, navigates and manages tabs; the banner says what a key adds.
await mountConnection($('connection'), $('open-settings'), {
  onChange(isConnected) {
    $('settings').dataset.connected = String(isConnected);
    $('connect-banner').hidden = isConnected;
  },
});
$('connect-banner-button').addEventListener('click', () => chrome.runtime.openOptionsPage());
renderMic();

$('settings-toggle').addEventListener('click', () => toggleSettings());

function toggleSettings(open = $('settings').hidden) {
  $('settings').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
}
