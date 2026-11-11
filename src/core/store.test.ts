import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendTopic, listTopics, readTopic, writeTopic } from './store.ts';

async function setup() {
  const hubHome = await mkdtemp(join(tmpdir(), 'hub-store-'));
  return { ctx: { hubHome, projectId: 'p-1' }, done: () => rm(hubHome, { recursive: true, force: true }) };
}
const input = { title: 'Titre', summary: 'Résumé', body: 'Corps' };

test('create, read, then replace with the right revision', async () => {
  const { ctx, done } = await setup();
  const c = await writeTopic(ctx, 'project:t', { ...input, tags: ['a'] });
  assert.equal(c.created, true);
  const t = await readTopic(ctx, 'project:t');
  assert.equal(t.revision, c.revision);
  assert.deepEqual([t.title, t.body, t.tags], ['Titre', 'Corps', ['a']]);
  const r = await writeTopic(ctx, 'project:t', { ...input, body: 'Neuf', baseRevision: c.revision });
  assert.equal(r.created, false);
  assert.notEqual(r.revision, c.revision);
  assert.equal((await readTopic(ctx, 'project:t')).body, 'Neuf');
  await done();
});

test('exists, conflict (with current revision), not_found', async () => {
  const { ctx, done } = await setup();
  const c = await writeTopic(ctx, 'global:g', input);
  await assert.rejects(writeTopic(ctx, 'global:g', input), { code: 'exists' });
  await assert.rejects(writeTopic(ctx, 'global:g', { ...input, baseRevision: 'deadbeef0000' }),
    (e: any) => e.code === 'conflict' && e.currentRevision === c.revision);
  await assert.rejects(writeTopic(ctx, 'global:zz', { ...input, baseRevision: c.revision }), { code: 'not_found' });
  await assert.rejects(readTopic(ctx, 'global:zz'), { code: 'not_found' });
  await assert.rejects(appendTopic(ctx, 'global:zz', 'x'), { code: 'not_found' });
  await done();
});

test('input validation: refs, project id, sizes, secrets', async () => {
  const { ctx, done } = await setup();
  await assert.rejects(writeTopic(ctx, 'bad', input), { code: 'invalid_ref' });
  await assert.rejects(writeTopic({ hubHome: ctx.hubHome }, 'project:t', input), { code: 'invalid_input' });
  await assert.rejects(writeTopic(ctx, 'global:t', { ...input, title: '' }), { code: 'invalid_input' });
  await assert.rejects(writeTopic(ctx, 'global:t', { ...input, body: 'x'.repeat(20_001) }), { code: 'too_large' });
  await assert.rejects(writeTopic(ctx, 'global:t', { ...input, body: `clé AKIA${'0'.repeat(16)}` }), { code: 'secret_detected' });
  await assert.rejects(writeTopic(ctx, 'global:t', { ...input, title: `sk-ant-${'x'.repeat(20)}` }), { code: 'secret_detected' });
  await done();
});

test('append: section format, limits, secrets', async () => {
  const { ctx, done } = await setup();
  await writeTopic(ctx, 'global:a', input);
  await appendTopic(ctx, 'global:a', 'ligne');
  const b = (await readTopic(ctx, 'global:a')).body;
  assert.match(b, /^Corps\n\n### \d{4}-\d\d-\d\dT\d\d:\d\dZ\nligne$/);
  await assert.rejects(appendTopic(ctx, 'global:a', 'x'.repeat(4_001)), { code: 'too_large' });
  await assert.rejects(appendTopic(ctx, 'global:a', ' '), { code: 'invalid_input' });
  await assert.rejects(appendTopic(ctx, 'global:a', `ghp_${'a'.repeat(36)}`), { code: 'secret_detected' });
  for (let i = 0; i < 12; i++) await appendTopic(ctx, 'global:a', 'y'.repeat(4_000));
  await assert.rejects(appendTopic(ctx, 'global:a', 'y'.repeat(4_000)), { code: 'too_large' });
  await done();
});

test('write keeps unknown keys and importedFrom', async () => {
  const { ctx, done } = await setup();
  const dir = join(ctx.hubHome, 'global', 'topics');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'k.md'), '---\ntitle: T\nsummary: S\nimportedFrom: C:\\x\\m.md\nowner: moi\n---\ncorps');
  const { revision } = await readTopic(ctx, 'global:k');
  await writeTopic(ctx, 'global:k', { ...input, baseRevision: revision });
  const raw = await readFile(join(dir, 'k.md'), 'utf8');
  assert.match(raw, /^owner: moi$/m);
  assert.match(raw, /^importedFrom: C:\\x\\m\.md$/m);
  await done();
});

test('write records importedFrom given by the caller', async () => {
  const { ctx, done } = await setup();
  await writeTopic(ctx, 'global:imp', { ...input, importedFrom: 'C:\\mem\\note.md' });
  assert.equal((await readTopic(ctx, 'global:imp')).importedFrom, 'C:\\mem\\note.md');
  await done();
});

test('invalid file: listed as invalid, never rewritten', async () => {
  const { ctx, done } = await setup();
  const dir = join(ctx.hubHome, 'global', 'topics');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'bad.md'), 'pas de frontmatter');
  await writeFile(join(dir, 'Not A Slug.md'), 'x');
  await writeTopic(ctx, 'global:ok', input);
  const list = await listTopics(ctx, 'global');
  assert.deepEqual(list.map((e) => [e.ref, e.valid]).sort(), [['global:bad', false], ['global:ok', true]]);
  await assert.rejects(readTopic(ctx, 'global:bad'), { code: 'invalid_file' });
  await assert.rejects(appendTopic(ctx, 'global:bad', 'x'), { code: 'invalid_file' });
  await assert.rejects(writeTopic(ctx, 'global:bad', { ...input, baseRevision: 'x' }), { code: 'invalid_file' });
  assert.equal(await readFile(join(dir, 'bad.md'), 'utf8'), 'pas de frontmatter');
  await done();
});

test('listTopics: scopes and mtime order', async () => {
  const { ctx, done } = await setup();
  await writeTopic(ctx, 'global:g', input);
  await writeTopic(ctx, 'project:p', input);
  assert.deepEqual((await listTopics(ctx)).map((e) => e.ref).sort(), ['global:g', 'project:p']);
  assert.deepEqual((await listTopics(ctx, 'project')).map((e) => e.ref), ['project:p']);
  assert.deepEqual((await listTopics({ hubHome: ctx.hubHome })).map((e) => e.ref), ['global:g']);
  assert.deepEqual(await listTopics({ hubHome: join(ctx.hubHome, 'nope') }), []);
  await done();
});

test('concurrency: 2 child processes x 50 appends lose nothing', { timeout: 120_000 }, async () => {
  const { ctx, done } = await setup();
  await writeTopic(ctx, 'global:c', input);
  const child = fileURLToPath(new URL('./store.child.ts', import.meta.url));
  const run = (tag: string) => new Promise<void>((res, rej) =>
    execFile(process.execPath, [child, ctx.hubHome, 'global:c', '50', tag], (err, _o, stderr) => (err ? rej(new Error(stderr)) : res())));
  await Promise.all([run('A'), run('B')]);
  const body = (await readTopic(ctx, 'global:c')).body;
  assert.equal(body.split('\n').filter((l) => l.startsWith('### ')).length, 100);
  for (const tag of ['A', 'B']) for (let i = 0; i < 50; i++) assert.ok(body.includes(`\n${tag}-${i}`), `${tag}-${i}`);
  await done();
});
