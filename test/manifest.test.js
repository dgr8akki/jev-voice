import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { describeSharedManifest } from './manifest-shared.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('src/manifest.json', root), 'utf8'));

describe('manifest', () => {
  describeSharedManifest(root);

  it('asks only for the permissions it uses', () => {
    assert.deepEqual([...manifest.permissions].sort(), ['scripting', 'sidePanel', 'storage']);
  });
});
