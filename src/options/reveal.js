/**
 * Show/Hide for the API key field, so a pasted key can be read back before
 * Connect. Page-specific: options.js is shared and knows nothing about it.
 */

const input = document.getElementById('api-key');
const reveal = document.getElementById('reveal');

function setShown(shown) {
  input.type = shown ? 'text' : 'password';
  reveal.setAttribute('aria-pressed', String(shown));
  reveal.textContent = shown ? 'Hide' : 'Show';
}

reveal.addEventListener('click', () => setShown(input.type === 'password'));

// options.js marks the body connected once a key is saved; a shown key goes back under cover then.
new MutationObserver(() => {
  if (document.body.dataset.state === 'connected') setShown(false);
}).observe(document.body, { attributes: true, attributeFilter: ['data-state'] });
