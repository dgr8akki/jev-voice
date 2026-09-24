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
});
