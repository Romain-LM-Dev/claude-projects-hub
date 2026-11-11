import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSessionPage } from './transcript.ts';

const FILE = join(import.meta.dirname, '../../test/fixtures/claude-home/projects/C--proj-a/aaaa0001.jsonl');

test('rendu : texte clôturé (clôture plus longue que les backticks), thinking omis, tool_use résumé', async () => {
  const { markdown, hasNext } = await renderSessionPage(FILE, 1);
  assert.equal(hasNext, false);
  assert.ok(markdown.includes('````text\nReponse avec ``` clos\n````'));
  assert.ok(markdown.includes('Read {"file_path":"/x"}'));
  assert.ok(!markdown.includes('secret'));
});

test('pagination : pages de N entrées et lien page suivante', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-pg-'));
  const f = join(dir, 's.jsonl');
  const lines = Array.from({ length: 5 }, (_, i) => JSON.stringify({ type: 'user', message: { role: 'user', content: `m${i}` } }));
  writeFileSync(f, lines.join('\n') + '\n');
  const p1 = await renderSessionPage(f, 1, 2);
  assert.ok(p1.hasNext && p1.markdown.includes('m1') && !p1.markdown.includes('m2') && p1.markdown.includes('?page=2'));
  const p3 = await renderSessionPage(f, 3, 2);
  assert.ok(!p3.hasNext && p3.markdown.includes('m4'));
});

test('tool_result coupé à 1 500 caractères', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-tr-'));
  const f = join(dir, 's.jsonl');
  writeFileSync(f, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'y'.repeat(5000) }] } }) + '\n');
  const { markdown } = await renderSessionPage(f, 1);
  assert.ok(markdown.includes('y'.repeat(1500) + '…') && !markdown.includes('y'.repeat(1501)));
});
