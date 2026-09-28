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
 * Glides the cue mark (a ring and tick) beside an element and outlines it.
 * Extensions can't move the real pointer, so this shows the user what is about
 * to be clicked or typed into. Every stroke is keylined (light over a dark
 * halo) so it reads on any page.
 *
 * @param {number} index
 * @param {'click' | 'type'} [kind] Click lands past the lower-right corner with
 *   a pulse; type lands at the field's text start with a caret and no pulse.
 */
export async function moveCursor(index, kind = 'click') {
  const el = document.querySelector(`[data-jev-voice="${index}"]`);
  if (!el) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });

  let cursor = document.getElementById('jev-voice-cursor');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = 'jev-voice-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    const halo = 'stroke="#161826" stroke-opacity=".8" stroke-width="5"';
    const line = 'stroke="#e7e5fe" stroke-width="2"';
    cursor.innerHTML =
      '<svg width="36" height="36" viewBox="0 0 36 36" style="overflow:visible;display:block">' +
      '<g fill="none" stroke-linecap="round">' +
      '<circle class="pulse" cx="18" cy="18" r="11" stroke="#b5abfc" stroke-width="1.5" opacity="0"/>' +
      `<g class="ring"><circle cx="18" cy="18" r="11" ${halo}/><circle cx="18" cy="18" r="11" ${line}/></g>` +
      `<path d="M26 10l5-5" ${halo}/><path d="M26 10l5-5" ${line}/></g>` +
      '<circle class="dot" cx="18" cy="18" r="4" fill="#9184d9" stroke="#161826" stroke-width="1.5"/>' +
      '<rect class="caret" x="16.5" y="11" width="3" height="14" rx="1.5" fill="#9184d9" stroke="#161826" stroke-width="1.25"/>' +
      '</svg>';
    cursor.style.cssText =
      'position:fixed;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;z-index:2147483647;' +
      'pointer-events:none;opacity:0;transform:translate(100vw,50vh);' +
      'transition:transform 320ms cubic-bezier(.2,.8,.2,1),opacity 240ms ease';
    for (const part of cursor.querySelectorAll('.pulse, .ring')) {
      part.style.transformBox = 'fill-box';
      part.style.transformOrigin = 'center';
    }
    document.documentElement.append(cursor);
    cursor.getBoundingClientRect(); // commit the start position (the panel edge) so the first move animates
  }
  cursor.jevRestore?.();
  cursor.querySelector('.dot').style.display = kind === 'click' ? '' : 'none';
  cursor.querySelector('.caret').style.display = kind === 'type' ? '' : 'none';

  const r = el.getBoundingClientRect();
  const x = kind === 'type' ? r.left + (parseFloat(getComputedStyle(el).paddingLeft) || 0) : r.right + 10;
  const y = kind === 'type' ? r.top + r.height / 2 : r.bottom + 10;
  const clamp = (v, max) => Math.min(Math.max(v, 18), max - 18);
  cursor.style.transition = reduceMotion
    ? 'opacity 120ms ease'
    : 'transform 320ms cubic-bezier(.2,.8,.2,1),opacity 240ms ease';
  cursor.style.transform = `translate(${clamp(x, innerWidth)}px, ${clamp(y, innerHeight)}px)`;
  cursor.style.opacity = '1';

  await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 120 : 320));

  // Outline the target, keeping the page's own inline values to restore.
  const saved = [el.style.outline, el.style.outlineOffset, el.style.boxShadow];
  el.style.outline = '2px solid #b5abfc';
  el.style.outlineOffset = '2px';
  el.style.boxShadow = (saved[2] ? saved[2] + ', ' : '') + '0 0 0 6px rgba(22,24,38,.72)';
  if (kind === 'click' && !reduceMotion) {
    cursor
      .querySelector('.ring')
      .animate?.([{ transform: 'scale(1)' }, { transform: 'scale(.73)' }, { transform: 'scale(1)' }], 280);
    cursor.querySelector('.pulse').animate?.(
      [
        { transform: 'scale(1)', opacity: 0.6 },
        { transform: 'scale(1.55)', opacity: 0 },
      ],
      260,
    );
  }

  const hide = setTimeout(
    () => {
      cursor.jevRestore?.();
      cursor.style.transition = 'opacity 240ms ease';
      cursor.style.opacity = '0';
    },
    reduceMotion ? 1200 : 900,
  );
  cursor.jevRestore = () => {
    clearTimeout(hide);
    [el.style.outline, el.style.outlineOffset, el.style.boxShadow] = saved;
    cursor.jevRestore = null;
  };
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
