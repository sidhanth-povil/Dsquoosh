import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('vendored webp encoder module exists', () => {
  const p = fileURLToPath(new URL('../../ds-webp-squoosh/assets/vendor/@jsquash/webp/encode.js', import.meta.url));
  assert.ok(existsSync(p), p);
});
