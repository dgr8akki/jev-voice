/**
 * Side panel controller: microphone, typed commands, settings and the activity
 * log. Transcripts are handled by the service worker (background.js).
 */

import { createJevClient } from '../lib/jev.js';
import { createTranscriptQueue } from '../lib/queue.js';
import { createListener } from '../lib/speech.js';

const $ = (id) => document.getElementById(id);
const MAX_ACTIVITY = 30;

// ---------------------------------------------------------------------------
// Settings

const { apiKey = '' } = await chrome.storage.local.get('apiKey');
$('api-key').value = apiKey;
if (!apiKey) toggleSettings(true);

$('settings-toggle').addEventListener('click', () => toggleSettings());
$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = $('api-key').value.trim();
  await chrome.storage.local.set({ apiKey: key });
  setKeyStatus('Checking key…');
  try {
    const jev = createJevClient({ getKey: () => key });
    await jev.evaluate({
      state: 'ping',
      questions: { ok: { type: 'boolean', instructions: 'Is this a test message?' } },
    });
    setKeyStatus('Key saved and working.', 'ok');
  } catch (error) {
    setKeyStatus(error.message, 'error');
  }
});

function toggleSettings(open = $('settings').hidden) {
  $('settings').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
}

function setKeyStatus(text, tone) {
  $('key-status').textContent = text;
  $('key-status').className = tone ? `hint status-${tone}` : 'hint';
}

// ---------------------------------------------------------------------------
// Commands

const queue = createTranscriptQueue(async (transcript) => {
  const outcome = await chrome.runtime
    .sendMessage({ type: 'transcript', ...transcript })
    .catch(() => ({ error: 'The extension restarted. Try again.' }));
  if (outcome?.error) logActivity(transcript.text, outcome.error, true);
  else if (outcome?.did) {
    logActivity(transcript.text, `${outcome.did} in ${outcome.ms} ms${outcome.early ? ', before you finished' : ''}`);
  }
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
 * @param {string | null} said What the user said, or null for system messages.
 * @param {string} result
 */
function logActivity(said, result, isError = false) {
  const item = document.createElement('li');
  if (said) item.append(Object.assign(document.createElement('span'), { className: 'said', textContent: `“${said}”` }));
  item.append(
    Object.assign(document.createElement('span'), { className: isError ? 'error' : 'result', textContent: result }),
  );
  $('activity').prepend(item);
  $('activity-empty').hidden = true;
  while ($('activity').children.length > MAX_ACTIVITY) $('activity').lastChild.remove();
}

// ---------------------------------------------------------------------------
// Microphone

const listener = createListener({
  onTranscript(transcript) {
    $('heard').textContent = transcript.text;
    queue.push(transcript);
  },
  onError({ code, message }) {
    if (code === 'not-allowed') {
      chrome.tabs.create({ url: chrome.runtime.getURL('permission/permission.html') });
      logActivity(null, `${message} Allow it in the tab that just opened, then start listening again.`, true);
      return;
    }
    logActivity(null, message, true);
  },
  onStatus({ listening, mode }) {
    $('mic').setAttribute('aria-pressed', String(listening));
    $('mic-label').textContent = listening ? 'Listening' : 'Start listening';
    $('status-dot').classList.toggle('listening', listening);
    $('heard').textContent = listening
      ? `Listening with ${mode === 'on-device' ? 'on-device' : 'cloud'} speech recognition`
      : '';
  },
  onNotice(message) {
    $('heard').textContent = message;
  },
});

$('mic').addEventListener('click', () => (listener.listening ? listener.stop() : listener.start()));
