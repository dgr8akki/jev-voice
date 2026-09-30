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
 * Labels only: no field values, no page text. PRIVACY.md promises exactly
 * this, so change it too if this ever sends more.
 *
 * @returns {string[]}
 */
export function snapshot() {
  const ATTR = 'data-jev-voice';
  const LIMIT = 100;
  for (const el of document.querySelectorAll(`[${ATTR}]`)) el.removeAttribute(ATTR);

  const selector =
    'a[href], button, input:not([type=hidden]):not([type=password]), textarea, select, summary, ' +
    '[role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=combobox], [contenteditable=true]';
  const visible = [...document.querySelectorAll(selector)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  });

  return visible.slice(0, LIMIT).map((el, i) => {
    el.setAttribute(ATTR, String(i));
    const field = el.matches('input, textarea, select, [role=combobox], [contenteditable=true]');
    const kind = field ? 'field' : el.matches('a, [role=link]') ? 'link' : 'button';
    // aria-labelledby names other elements; their text is a label, not a value.
    const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      // A label that is itself a field or an editor holds the user's words, not a name.
      .filter(
        (node) =>
          node &&
          !node.closest('[contenteditable]:not([contenteditable=false])') &&
          !node.matches('input, textarea, select'),
      )
      .map((node) => node.textContent)
      .join(' ')
      .trim();
    // A field's content is the user's, so its label can only come from attributes
    // and its <label>: never value, never the text inside an editor or a select.
    const text = field
      ? labelledBy ||
        el.getAttribute('aria-label') ||
        el.labels?.[0]?.textContent ||
        el.getAttribute('placeholder') ||
        el.getAttribute('data-placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('name') ||
        ''
      : labelledBy ||
        el.getAttribute('aria-label') ||
        (el.innerText ?? el.textContent) ||
        el.querySelector('svg > title')?.textContent ||
        el.getAttribute('title') ||
        el.querySelector('img')?.getAttribute('alt') ||
        '';
    return `${kind}: ${text.replace(/\s+/g, ' ').trim().slice(0, 80) || '(unlabeled)'}`;
  });
}

/**
 * Glides the ring-and-tick marker beside an element and outlines it; strokes
 * are keylined (light over a dark halo) so it shows on dark pages too.
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

  // Highlight the target with a box laid over it, not by restyling it: the
  // page's own focus ring must still show the moment the click lands.
  let box = document.getElementById('jev-voice-target');
  if (!box) {
    box = document.createElement('div');
    box.id = 'jev-voice-target';
    box.setAttribute('aria-hidden', 'true');
    document.documentElement.append(box);
  }
  box.style.cssText =
    `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;` +
    'border:2px solid #b5abfc;border-radius:6px;box-shadow:0 0 0 6px rgba(22,24,38,.72);' +
    'pointer-events:none;z-index:2147483646';
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
      // Gone once faded, so nothing of ours stays in the page's DOM.
      setTimeout(() => {
        if (cursor.isConnected && cursor.style.opacity === '0') cursor.remove();
        box.remove();
      }, 260);
    },
    reduceMotion ? 1200 : 900,
  );
  cursor.jevRestore = () => {
    clearTimeout(hide);
    box.remove();
    cursor.jevRestore = null;
  };
}

/**
 * Removes the index markers once an action has run. The marker and its
 * highlight stay for their own ~900 ms so the user sees where the action
 * landed; their hide timer removes them from the page afterwards.
 */
export function clearMarkers() {
  for (const el of document.querySelectorAll('[data-jev-voice]')) el.removeAttribute('data-jev-voice');
}

/**
 * Clicks an element. For links that open a new tab (the element itself or a
 * link around it), returns the address instead, because Chrome blocks a
 * scripted click on those as a pop-up; the service worker opens the tab.
 * Only http(s) addresses are handed over: `tabs.create` refuses the rest.
 *
 * @param {number} index
 * @returns {{ clicked: true } | { newTab: string } | { blocked: string } | null} null when the marker is gone.
 */
export function clickElement(index) {
  const el = document.querySelector(`[data-jev-voice="${index}"]`);
  if (!el) return null;
  const link = el.closest('a[href]');
  if (link && link.target === '_blank') {
    const url = new URL(link.href); // the .href property is already absolute
    return /^https?:$/.test(url.protocol) ? { newTab: url.href } : { blocked: url.protocol };
  }
  el.click();
  el.focus?.();
  return { clicked: true };
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
