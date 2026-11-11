import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse, serialize } from './frontmatter.ts';

const doc = '---\ntitle: Ports Docker\nsummary: PostgreSQL sur 5433\ntags: [infra, docker]\n---\nCorps\n\nsuite\n';

test('round trip of a canonical file', () => {
  const { fm, body } = parse(doc);
  assert.deepEqual(fm.tags, ['infra', 'docker']);
  assert.equal(serialize(fm, body), doc);
});

test('values needing quotes round trip', () => {
  const fm = { title: '[x] "q" \\ y', summary: 'a: b', tags: [], importedFrom: "'z'", extra: [] };
  const text = serialize(fm, 'b');
  assert.match(text, /^title: "\[x\] \\"q\\" \\\\ y"$/m);
  assert.match(text, /^summary: "a: b"$/m);
  const back = parse(text);
  assert.equal(back.fm.title, fm.title);
  assert.equal(back.fm.summary, fm.summary);
  assert.equal(back.fm.importedFrom, "'z'");
  assert.equal(serialize(back.fm, back.body), text);
});

test('unknown key kept on rewrite', () => {
  const text = '---\ntitle: T\nsummary: S\nowner: moi: ici\n---\n';
  const { fm, body } = parse(text);
  assert.deepEqual(fm.extra, ['owner: moi: ici']);
  assert.match(serialize(fm, body), /owner: moi: ici/);
});

test('invalid files throw invalid_file', () => {
  const bad = [
    'pas de frontmatter',
    '---\ntitle: T\nsummary: S\n',
    '---\ntitle: T\n---\n',
    '---\nsummary: S\n---\n',
    '---\ntitle: T\ntitle: U\nsummary: S\n---\n',
    '---\ntitle: T\nsummary: S\ntags: a, b\n---\n',
    '---\ntitle: T\nsummary: S\ntags: [A]\n---\n',
    `---\ntitle: T\nsummary: S\ntags: [${'a,'.repeat(8)}b]\n---\n`,
    '---\ntitle: "T\nsummary: S\n---\n',
    '---\ntitle: "a"b"\nsummary: S\n---\n',
    '---\ntitle: T\nsummary: S\n  indent\n---\n',
    `---\ntitle: ${'t'.repeat(81)}\nsummary: S\n---\n`,
    `---\ntitle: T\nsummary: ${'s'.repeat(201)}\n---\n`,
  ];
  for (const t of bad) assert.throws(() => parse(t), { code: 'invalid_file' }, t);
});

test('serialize rejects bad input as invalid_input only through validate (multi-line title)', async () => {
  const { validate } = await import('./frontmatter.ts');
  assert.throws(() => validate({ title: 'a\nb', summary: 's', tags: [], extra: [] }, 'invalid_input'), { code: 'invalid_input' });
});
