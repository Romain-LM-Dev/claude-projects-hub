import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '../..');
const json = (f: string): Record<string, string> => JSON.parse(readFileSync(join(root, f), 'utf8'));
const holes = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();

test('every vscode.l10n.t literal has a French translation with the same placeholders, and no key is stale', () => {
  const fr = json('l10n/bundle.l10n.fr.json');
  const used = new Set<string>();
  for (const f of readdirSync(import.meta.dirname).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    const src = readFileSync(join(import.meta.dirname, f), 'utf8');
    // A non-literal key could not be checked here, nor found by the bundle.
    assert.ok(!/l10n\.t\((?!")/.test(src), `${f}: l10n.t takes a double-quoted literal`);
    for (const m of src.matchAll(/l10n\.t\("((?:[^"\\]|\\.)*)"/g)) used.add(JSON.parse(`"${m[1]}"`));
  }
  for (const k of used) {
    assert.ok(k in fr, `missing French translation: ${k}`);
    assert.equal(holes(fr[k]!), holes(k), `placeholders differ: ${k}`);
  }
  assert.deepEqual(Object.keys(fr).filter((k) => !used.has(k)), [], 'stale keys in bundle.l10n.fr.json');
});

test('package.json %keys% exist in package.nls.json and package.nls.fr.json', () => {
  const keys = [...readFileSync(join(root, 'package.json'), 'utf8').matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]!).sort();
  const en = json('package.nls.json'), fr = json('package.nls.fr.json');
  assert.ok(keys.length > 20);
  assert.deepEqual(Object.keys(en).sort(), keys);
  assert.deepEqual(Object.keys(fr).sort(), keys);
  assert.equal(json('package.json').l10n as unknown, './l10n');
});
