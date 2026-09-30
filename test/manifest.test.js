import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const src = new URL('../src/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', src), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('manifest', () => {
  it('is Manifest V3 with the package version', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, pkg.version);
  });

  it('references only files that exist', () => {
    const files = [
      manifest.background.service_worker,
      manifest.side_panel.default_path,
      manifest.options_ui.page,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
    ];
    for (const file of files) assert.ok(existsSync(new URL(file, src)), `missing ${file}`);
  });

  it('asks only for the permissions it uses', () => {
    assert.deepEqual([...manifest.permissions].sort(), ['scripting', 'sidePanel', 'storage']);
  });

  it('keeps the store description within 132 characters', () => {
    assert.ok(manifest.description.length <= 132, `${manifest.description.length} chars`);
  });

  it('only calls storage.setAccessLevel inside a try block below Chrome 140', () => {
    // Older Chrome exposes setAccessLevel on storage.local but throws for that
    // area, so `?.` is no guard. An uncaught throw at the top of the service
    // worker means onMessage never registers and every command fails with
    // "The extension restarted". Only a try/catch around the call counts.
    const background = readFileSync(new URL(manifest.background.service_worker, src), 'utf8');
    if (Number(manifest.minimum_chrome_version) >= 140) return;
    const outsideTry = background.replace(/try\s*\{[\s\S]*?\}\s*catch\b/g, '');
    assert.doesNotMatch(outsideTry, /setAccessLevel(\?\.)?\(/, 'wrap setAccessLevel in try/catch');
  });
});
