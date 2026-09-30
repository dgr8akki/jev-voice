import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { clearLastTyped, clearMarkers, clickElement, moveCursor, snapshot, typeInto } from '../src/lib/page.js';
import { installDom } from './helpers.js';

let restore = () => {};
afterEach(() => restore());

/** Loads a page where every element is "visible" unless it has `data-offscreen`. */
function load(html, { reduceMotion = true } = {}) {
  restore = installDom(html);
  const { window } = globalThis;
  window.matchMedia = globalThis.matchMedia = () => ({ matches: reduceMotion });
  window.HTMLElement.prototype.getBoundingClientRect = function rect() {
    const top = this.hasAttribute('data-offscreen') ? 5000 : 10;
    return { top, bottom: top + 20, left: 10, right: 110, width: 100, height: 20 };
  };
  globalThis.innerHeight = window.innerHeight = 800;
  return window.document;
}

const FORM = `<form id="signup">
  <label for="first">First name</label><input id="first" />
  <label for="last">Surname</label><input id="last" />
  <input type="hidden" name="token" />
  <textarea aria-label="Bio"></textarea>
  <a href="/pricing">Pricing</a>
  <a href="https://example.org" target="_blank">Docs</a>
  <button type="submit">Create account</button>
  <a href="/far" data-offscreen>Far away</a>
</form>`;

describe('snapshot', () => {
  it('labels visible interactive elements from labels, aria-label and text', () => {
    load(FORM);
    assert.deepEqual(snapshot(), [
      'field: First name',
      'field: Surname',
      'field: Bio',
      'link: Pricing',
      'link: Docs',
      'button: Create account',
    ]);
  });

  it('tags elements by index and clears old tags on the next snapshot', () => {
    const document = load(FORM);
    snapshot();
    assert.equal(document.getElementById('last').getAttribute('data-jev-voice'), '1');
    document.getElementById('first').remove();
    snapshot();
    assert.equal(document.getElementById('last').getAttribute('data-jev-voice'), '0');
  });

  it('caps the list at 100 elements', () => {
    load(`<div>${'<button>Go</button>'.repeat(150)}</div>`);
    assert.equal(snapshot().length, 100);
  });

  it('resolves aria-labelledby, SVG titles and the roles voice users need', () => {
    load(`<span id="lbl-a">Email</span> <span id="lbl-b">address</span>
      <input aria-labelledby="lbl-a lbl-b" value="ada@example.com" />
      <button><svg><title>Search</title><path d="M0 0" /></svg></button>
      <div role="checkbox" aria-checked="false">Remember me</div>
      <div role="switch" aria-checked="true">Dark mode</div>
      <div role="combobox" aria-label="Country"></div>
      <details><summary>More options</summary><p>hidden</p></details>`);
    assert.deepEqual(snapshot(), [
      'field: Email address',
      'button: Search',
      'button: Remember me',
      'button: Dark mode',
      'field: Country',
      'button: More options',
    ]);
  });

  it('never uses what the user typed as a label', () => {
    load(`<input value="hunter2" /><textarea>my private notes</textarea>`);
    assert.deepEqual(snapshot(), ['field: (unlabeled)', 'field: (unlabeled)']);
  });

  it('leaves password fields out entirely', () => {
    load(`<label for="pw">Password</label><input id="pw" type="password" value="hunter2" /><button>Log in</button>`);
    const labels = snapshot();
    assert.deepEqual(labels, ['button: Log in']);
    assert.ok(!labels.join(' ').includes('hunter2'));
  });

  it('labels editors from their attributes, never their text', () => {
    load(`<div contenteditable="true" aria-label="Message">secret draft</div>
      <div contenteditable="true" data-placeholder="Write a reply">another secret</div>
      <div contenteditable="true">just a draft</div>
      <select name="country"><option>Ireland</option></select>`);
    const labels = snapshot();
    assert.deepEqual(labels, ['field: Message', 'field: Write a reply', 'field: (unlabeled)', 'field: country']);
    assert.ok(!labels.join(' ').includes('secret'));
  });
});

describe('clearMarkers', () => {
  it('removes every trace the extension left on the page', async () => {
    const document = load(FORM);
    snapshot();
    await moveCursor(0);
    assert.ok(document.querySelector('[data-jev-voice]'));
    clearMarkers();
    assert.equal(document.querySelectorAll('[data-jev-voice], #jev-voice-cursor, #jev-voice-target').length, 0);
    assert.equal(document.getElementById('first').style.outline, '');
  });
});

describe('clickElement', () => {
  it('clicks the element', () => {
    const document = load(FORM);
    snapshot();
    let clicked = false;
    document.querySelector('a[href="/pricing"]').addEventListener('click', (e) => {
      e.preventDefault();
      clicked = true;
    });
    assert.equal(clickElement(3), null);
    assert.ok(clicked);
  });

  it('returns the URL of links that open a new tab instead of clicking', () => {
    load(FORM);
    snapshot();
    assert.deepEqual(clickElement(4), { newTab: 'https://example.org/' });
  });

  it('reads target from an ancestor link and hands over only http(s) addresses', () => {
    const document = load(`<a href="https://example.org/deep" target="_blank"><span role="button">Inner</span></a>
      <a href="javascript:void(0)" target="_blank">Script link</a>
      <a href="mailto:hi@example.org" target="_blank">Mail</a>`);
    snapshot();
    // The inner control is the listed element; the link around it decides how it opens.
    assert.deepEqual(clickElement(1), { newTab: 'https://example.org/deep' });
    let clicked = 0;
    document.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => (e.preventDefault(), clicked++)));
    assert.deepEqual(clickElement(2), { blocked: 'javascript:' });
    assert.deepEqual(clickElement(3), { blocked: 'mailto:' });
    assert.equal(clicked, 0, 'a new-tab link Chrome would refuse is not clicked either');
  });
});

describe('typeInto and clearLastTyped', () => {
  it('sets the value, fires input events and remembers the field', () => {
    const document = load(FORM);
    snapshot();
    const inputs = [];
    document.getElementById('last').addEventListener('input', (e) => inputs.push(e.target.value));
    typeInto(1, 'Akash', false);
    assert.equal(document.getElementById('last').value, 'Akash');
    assert.deepEqual(inputs, ['Akash']);

    assert.equal(clearLastTyped(), 'Akash');
    assert.equal(document.getElementById('last').value, '');
    assert.equal(clearLastTyped(), null, 'forgets after moving');
  });

  it('submits the form when asked', () => {
    const document = load(FORM);
    snapshot();
    let submitted = false;
    document.getElementById('signup').addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    typeInto(0, 'Ada', true);
    assert.ok(submitted);
  });

  it('types into a textarea', () => {
    const document = load(FORM);
    snapshot();
    typeInto(2, 'Hello there', false);
    assert.equal(document.querySelector('textarea').value, 'Hello there');
  });
});

describe('moveCursor', () => {
  it('draws one cursor and one highlight box over the target without touching its styles', async () => {
    const document = load(FORM);
    document.getElementById('last').style.outline = '3px dotted red'; // the page's own focus style
    snapshot();
    await moveCursor(0);
    await moveCursor(1);
    assert.equal(document.querySelectorAll('#jev-voice-cursor').length, 1);
    const box = document.querySelectorAll('#jev-voice-target');
    assert.equal(box.length, 1, 'one overlay box, moved between targets');
    assert.equal(box[0].getAttribute('aria-hidden'), 'true');
    assert.match(box[0].style.cssText, /position: fixed/);
    assert.match(box[0].style.cssText.replace(/\s/g, ''), /rgba\(22,24,38/, 'keeps the dark halo');
    assert.equal(document.getElementById('last').style.outline, '3px dotted red', 'page styles are left alone');
    assert.equal(document.getElementById('first').style.outline, '');
  });

  it('shows a caret for typing and a dot for clicking', async () => {
    const document = load(FORM);
    snapshot();
    await moveCursor(0, 'type');
    const cursor = document.getElementById('jev-voice-cursor');
    assert.equal(cursor.querySelector('.dot').style.display, 'none');
    assert.equal(cursor.querySelector('.caret').style.display, '');
    await moveCursor(0, 'click');
    assert.equal(cursor.querySelector('.caret').style.display, 'none');
  });
});
