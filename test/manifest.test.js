import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { describeSharedManifest } from './manifest-shared.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('src/manifest.json', root), 'utf8'));

/** Resolves `__MSG_key__` through the default locale, as Chrome does before showing the name or summary. */
function localised(value) {
  const messages = JSON.parse(
    readFileSync(new URL(`src/_locales/${manifest.default_locale}/messages.json`, root), 'utf8'),
  );
  return value.replace(/__MSG_(\w+)__/g, (_, key) => messages[key].message);
}

describe('manifest', () => {
  describeSharedManifest(root);

  it('uses straight quotes in UI strings', () => {
    for (const file of [
      'src/sidepanel/sidepanel.html',
      'src/sidepanel/sidepanel.js',
      'src/permission/permission.html',
      'src/options/options.html',
    ]) {
      assert.doesNotMatch(readFileSync(new URL(file, root), 'utf8'), /[\u2018\u2019\u201c\u201d]/, file);
    }
  });

  it('declares color-scheme on every page so form controls do not flash the wrong colours', () => {
    for (const page of ['src/options/options.html', 'src/sidepanel/sidepanel.html', 'src/permission/permission.html']) {
      const html = readFileSync(new URL(page, root), 'utf8');
      assert.match(html, /<meta name="color-scheme" content="light dark" \/>/, page);
      assert.doesNotMatch(html, /theme-color/, `${page}: theme-color does nothing in an extension page`);
    }
  });

  it('keeps the localised name and summary within the store limits, in every locale', () => {
    assert.equal(manifest.default_locale, 'en');
    for (const locale of ['en', 'en_GB']) {
      const messages = JSON.parse(readFileSync(new URL(`src/_locales/${locale}/messages.json`, root), 'utf8'));
      assert.ok(messages.appName.message.length <= 45, `${locale} name ${messages.appName.message.length} chars`);
      assert.ok(messages.appShortName.message.length <= 12, `${locale} short name`);
      assert.ok(messages.appDesc.message.length <= 132, `${locale} summary ${messages.appDesc.message.length} chars`);
      assert.doesNotMatch(messages.appName.message, /chrome/i, 'the title does not name Chrome');
    }
    const en = JSON.parse(readFileSync(new URL('src/_locales/en/messages.json', root), 'utf8'));
    assert.equal(localised(manifest.name), en.appName.message, 'the manifest name resolves to the en title');
    assert.equal(localised(manifest.description), en.appDesc.message);
  });

  it('asks only for the permissions it uses', () => {
    assert.deepEqual([...manifest.permissions].sort(), ['scripting', 'sidePanel', 'storage']);
    // Web pages only: file:// and other schemes are never scripted, so they are not requested.
    assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  });
});
