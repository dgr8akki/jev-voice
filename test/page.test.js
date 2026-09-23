import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { clearLastTyped, clickElement, moveCursor, snapshot, typeInto } from '../src/lib/page.js';
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
    assert.equal(clickElement(4), 'https://example.org/');
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
  it('draws one cursor over the target and outlines it', async () => {
    const document = load(FORM);
    snapshot();
    await moveCursor(0);
    await moveCursor(1);
    assert.equal(document.querySelectorAll('#jev-voice-cursor').length, 1);
    assert.match(document.getElementById('last').style.outline, /2px solid/);
  });
});
