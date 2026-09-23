/**
 * Functions injected into the active tab with `chrome.scripting.executeScript`.
 *
 * Chrome serialises each function on its own, so every function here must be
 * self-contained: no imports, no references to module scope.
 *
 * Elements are addressed by the index `snapshot()` assigned, stored in a
 * `data-jev-voice` attribute until the next snapshot.
 *
 * @module lib/page
 */

/**
 * Lists the interactive elements visible in the viewport, top to bottom, as
 * short labels such as "link: Pricing" or "field: Email address".
 *
 * @returns {string[]}
 */
export function snapshot() {
  const ATTR = 'data-jev-voice';
  const LIMIT = 100;
  for (const el of document.querySelectorAll(`[${ATTR}]`)) el.removeAttribute(ATTR);

  const selector =
    'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [contenteditable=true]';
  const visible = [...document.querySelectorAll(selector)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  });

  return visible.slice(0, LIMIT).map((el, i) => {
    el.setAttribute(ATTR, String(i));
    const kind = el.matches('input, textarea, select, [contenteditable=true]')
      ? 'field'
      : el.matches('a, [role=link]')
        ? 'link'
        : 'button';
    const text =
      el.getAttribute('aria-label') ||
      el.labels?.[0]?.textContent ||
      (el.innerText ?? el.textContent) ||
      el.getAttribute('placeholder') ||
      el.value ||
      el.getAttribute('title') ||
      el.querySelector('img')?.getAttribute('alt') ||
      '';
    return `${kind}: ${text.replace(/\s+/g, ' ').trim().slice(0, 80) || '(unlabeled)'}`;
  });
}

/**
 * Glides a drawn cursor to an element and outlines it. Extensions can't move
 * the real pointer, so this shows the user what is about to be clicked.
 *
 * @param {number} index
 */
export async function moveCursor(index) {
  const el = document.querySelector(`[data-jev-voice="${index}"]`);
  if (!el) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });

  let cursor = document.getElementById('jev-voice-cursor');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = 'jev-voice-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l6.5 18 2.3-7.2L20 10.5z" fill="#1f2328" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    cursor.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(50vw,50vh);transition:transform 320ms cubic-bezier(.2,.8,.2,1),opacity 250ms';
    document.documentElement.append(cursor);
    cursor.getBoundingClientRect(); // commit the start position so the first move animates
  }

  const r = el.getBoundingClientRect();
  cursor.style.transition = reduceMotion ? 'none' : cursor.style.transition;
  cursor.style.opacity = '1';
  cursor.style.transform = `translate(${r.left + r.width / 2 - 4}px, ${r.top + r.height / 2 - 2}px)`;

  const previousOutline = el.style.outline;
  el.style.outline = '2px solid #3b5bdb';
  await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 50 : 360));
  setTimeout(() => {
    el.style.outline = previousOutline;
    cursor.style.opacity = '0';
  }, 1200);
}

/**
 * Clicks an element. Returns the URL instead for links that open a new tab,
 * which Chrome would block as a pop-up when clicked from a script.
 *
 * @param {number} index
 * @returns {string | null}
 */
export function clickElement(index) {
  const el = document.querySelector(`[data-jev-voice="${index}"]`);
  if (!el) return null;
  if (el.matches('a[target=_blank]')) return el.href;
  el.click();
  el.focus?.();
  return null;
}

/**
 * Types into an element (or the focused one) so frameworks see the change,
 * optionally submitting its form. Marks it so a correction can move the text.
 *
 * @param {number | null} index
 * @param {string} text
 * @param {boolean} submit
 */
export function typeInto(index, text, submit) {
  const el = (index !== null && document.querySelector(`[data-jev-voice="${index}"]`)) || document.activeElement;
  if (!el || el === document.body) return;
  for (const marked of document.querySelectorAll('[data-jev-voice-typed]'))
    marked.removeAttribute('data-jev-voice-typed');
  el.setAttribute('data-jev-voice-typed', '');
  el.focus();

  if (el.isContentEditable) {
    el.textContent = text;
  } else {
    // The native setter, so React and Vue controlled inputs register the change.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  if (submit) {
    if (el.form) el.form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
}

/**
 * Clears the field typed into last and returns what it held, so the text can be
 * moved to another field ("no, that's the first name").
 *
 * @returns {string | null}
 */
export function clearLastTyped() {
  const el = document.querySelector('[data-jev-voice-typed]');
  if (!el) return null;
  const text = el.isContentEditable ? el.textContent : el.value;

  if (el.isContentEditable) {
    el.textContent = '';
  } else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.removeAttribute('data-jev-voice-typed');
  return text || null;
}

/**
 * Scrolls by most of a screen.
 *
 * @param {1 | -1} direction
 */
export function scrollPage(direction) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scrollBy({ top: direction * innerHeight * 0.8, behavior: reduceMotion ? 'auto' : 'smooth' });
}
