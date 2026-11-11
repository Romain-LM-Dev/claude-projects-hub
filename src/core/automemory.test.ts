import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readAutoMemory } from './automemory.ts';

test('auto-mémoire : frontmatter à plat et sous metadata', async () => {
  const m = await readAutoMemory(join(import.meta.dirname, '../../test/fixtures/claude-home/projects/C--proj-a/memory'));
  assert.ok(m.index?.includes('flat.md'));
  const by = Object.fromEntries(m.notes.map((n) => [n.name, n]));
  assert.equal(by.flat!.type, 'project');
  assert.equal(by.flat!.description, 'Note a plat');
  assert.equal(by.nested!.type, 'feedback');
  assert.equal(by.nested!.body.trim(), 'Corps imbrique');
});

test('dossier absent : mémoire vide', async () => {
  assert.deepEqual(await readAutoMemory(join(import.meta.dirname, 'nope')), { notes: [] });
});
