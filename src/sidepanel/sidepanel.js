/**
 * Side panel controller: microphone, typed commands, settings and the activity
 * log. Transcripts are handled by the service worker (background.js).
 */

import { mountConnection } from '../lib/connection.js';
import { createTranscriptQueue } from '../lib/queue.js';
import { createListener } from '../lib/speech.js';

const $ = (id) => document.getElementById(id);
const MAX_ACTIVITY = 30;

// ---------------------------------------------------------------------------
// Settings

await mountConnection($('connection'), $('open-settings'), (connected) => {
  if (!connected) toggleSettings(true);
});

$('settings-toggle').addEventListener('click', () => toggleSettings());

function toggleSettings(open = $('settings').hidden) {
  $('settings').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
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
