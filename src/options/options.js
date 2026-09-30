/**
 * Settings page, opened on install: picks the Jev provider and connects its
 * key. A saved key is never put back into the input; it shows as a masked
 * badge with Test, Replace and Remove.
 */

import { DEFAULT_PROVIDER, JevError, PROVIDERS, createJevClient, maskKey } from '../lib/jev.js';

/** Setup steps per provider. Trusted constants, so innerHTML is fine. */
const link = (href, text) => `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
const STEPS = {
  vercel: [
    `${link(PROVIDERS.vercel.keysUrl, 'Create an AI Gateway API key')} in the Vercel dashboard.`,
    `Set a ${link('https://vercel.com/docs/ai-gateway/observability-and-spend/budgets', 'spend limit')} on it (optional, recommended).`,
    'Paste it here.',
  ],
  typesafe: [`${link(PROVIDERS.typesafe.keysUrl, 'Create an API key')} in the TypeSafe console.`, 'Paste it here.'],
};

const form = document.getElementById('key-form');
const input = document.getElementById('api-key');
const cancel = document.getElementById('cancel');
const connected = document.getElementById('connected');
const formStatus = document.getElementById('key-status');
const connectedStatus = document.getElementById('connected-status');
const radios = [...form.elements.provider];

let { apiKey = '', provider = DEFAULT_PROVIDER } = await chrome.storage.local.get(['apiKey', 'provider']);
if (!PROVIDERS[provider]) provider = DEFAULT_PROVIDER;
render();

const selected = () => radios.find((radio) => radio.checked)?.value ?? provider;

/** Steps, placeholder and privacy line follow the provider being shown. */
function showProvider(id) {
  document.getElementById('steps').innerHTML = STEPS[id].map((step) => `<li><span>${step}</span></li>`).join('');
  input.placeholder = PROVIDERS[id].placeholder;
  document.getElementById('host').textContent = PROVIDERS[id].host;
}

function render(editing = false) {
  const showForm = editing || !apiKey;
  form.hidden = !showForm;
  connected.hidden = showForm;
  cancel.hidden = !apiKey;
  input.value = '';
  radios.forEach((radio) => (radio.checked = radio.value === provider));
  showProvider(provider);
  input.removeAttribute('aria-invalid');
  document.getElementById('current').hidden = !(editing && apiKey);
  for (const id of ['provider-label', 'current-provider']) {
    document.getElementById(id).textContent = PROVIDERS[provider].label;
  }
  for (const id of ['masked', 'current-masked']) document.getElementById(id).textContent = maskKey(apiKey);
  if (showForm) input.focus();
}

radios.forEach((radio) =>
  radio.addEventListener('change', () => {
    showProvider(selected());
    setStatus(formStatus, '');
    input.focus();
  }),
);

/** Resolves with a JevError, or null when the key works. */
async function test(id, key) {
  try {
    const answers = await createJevClient({ getKey: () => key, getProvider: () => id }).evaluate({
      state: 'ping',
      questions: {
        ok: { type: 'choice', instructions: 'Is this a test message?', criteria: { yes: 'Yes', no: 'No' } },
      },
    });
    // The client checks that every question got an answer; a key check also needs that answer to be a pick.
    if (typeof answers.ok?.choice !== 'string') {
      return new JevError(`Unexpected reply from ${PROVIDERS[id].host}.`, { status: 200 });
    }
    return null;
  } catch (error) {
    // A busy provider still accepted the key.
    if (error.busy) return null;
    if (error instanceof JevError) return error;
    console.error('Jev Voice: key check failed', error);
    return new JevError('Something went wrong. Try again.');
  }
}

/** @param {'ok' | 'error' | 'info' | 'progress'} [tone] Picks the icon shown with the text. */
function setStatus(el, text, tone = 'info') {
  el.textContent = text;
  el.className = `status ${tone}`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = selected();
  const key = input.value.trim();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  input.removeAttribute('aria-invalid');
  setStatus(formStatus, `Checking key with ${PROVIDERS[id].label}…`, 'progress');
  const error = await test(id, key);
  button.disabled = false;
  if (error) {
    // Only a provider verdict says anything about the key; offline or a garbled reply does not.
    if (error.status >= 400) input.setAttribute('aria-invalid', 'true');
    return setStatus(formStatus, error.message, 'error');
  }
  apiKey = key;
  provider = id;
  await chrome.storage.local.set({ apiKey, provider });
  setStatus(formStatus, '');
  render();
  // The form (and the button that had focus) is gone; land on the card's heading, not <body>.
  document.getElementById('connected-title').focus();
  setStatus(connectedStatus, `Key works. ${document.body.dataset.next}`, 'ok');
});

document.getElementById('test').addEventListener('click', async () => {
  setStatus(connectedStatus, 'Checking key…', 'progress');
  const error = await test(provider, apiKey);
  setStatus(connectedStatus, error ? error.message : 'Key works.', error ? 'error' : 'ok');
});

document.getElementById('replace').addEventListener('click', () => render(true));
cancel.addEventListener('click', () => {
  render();
  document.getElementById('replace').focus();
});

document.getElementById('remove').addEventListener('click', async () => {
  await chrome.storage.local.remove('apiKey');
  apiKey = '';
  setStatus(formStatus, 'Key removed from this browser.');
  render();
});
