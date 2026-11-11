import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { sandbox } from '../../test/fixtures/kit.ts';
import { TOOLS, createServer, sessionDir } from './tools.ts';

async function connect(sb: ReturnType<typeof sandbox>, projectDir: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer({ hubHome: sb.hub, projectDir, exclude: sb.exclude }).connect(b);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(a);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as { text: string }[])[0]!.text };
  };
}
const W = { title: 'T', summary: 'S', body: 'corps' };
const rev = (t: string) => /revision: (\w+)/.exec(t)![1]!;

test('descriptions equal architecture §5 and 4 tools', async () => {
  const doc = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'architecture.md'), 'utf8').replace(/\r\n/g, '\n');
  const sec = doc.slice(doc.indexOf('Descriptions des outils'));
  assert.equal(TOOLS.length, 4);
  for (const t of TOOLS) {
    const m = new RegExp(`- \`${t.name}\` : « ([^»]+) »`).exec(sec)!;
    assert.equal(t.description, m[1]!.replace(/\n\s+/g, ' '), t.name);
  }
});

test('write/read/append/list nominal, global and project', async () => {
  const sb = sandbox();
  const call = await connect(sb, sb.dir('p'));
  let r = await call('memory_write', { ref: 'global:conv', ...W, tags: ['a'] });
  assert.match(r.text, /^ref: global:conv\nrevision: \w{12}\ncreated: true$/);
  r = await call('memory_write', { ref: 'project:ports', ...W });
  assert.equal(r.isError, false);
  r = await call('memory_read', { ref: 'project:ports' });
  assert.match(r.text, /^ref: project:ports\ntitle: T\nsummary: S\ntags: \[\]\nupdated: \d{4}-.*Z\nrevision: \w{12}\n---\ncorps$/);
  r = await call('memory_append', { ref: 'project:ports', text: 'plus' });
  assert.match(r.text, /^ref: project:ports\nrevision: \w{12}$/);
  assert.match((await call('memory_read', { ref: 'project:ports' })).text, /corps\n\n### \d{4}-\d\d-\d\dT\d\d:\d\dZ\nplus$/);
  const l = (await call('memory_list')).text.split('\n');
  assert.match(l[0]!, /^Projet : p \([0-9a-f-]{36}\)$/);
  assert.equal(l.length, 3);
  assert.match(l[1]! + l[2]!, /project:ports — T : S/);
  assert.equal((await call('memory_list', { scope: 'global' })).text.split('\n').length, 2);
  assert.equal((await call('memory_list', { scope: 'project' })).text.split('\n').length, 2);
  assert.equal((await call('memory_list', { query: 'ZZZ' })).text.split('\n').length, 1);
  assert.equal((await call('memory_list', { tag: 'a' })).text.split('\n').length, 2);
  assert.equal((await call('memory_list', { query: 's' })).text.split('\n').length, 3);
});

test('every error code', async () => {
  const sb = sandbox();
  const call = await connect(sb, sb.dir('p'));
  const err = async (code: string, name: string, args: Record<string, unknown>) => {
    const r = await call(name, args);
    assert.ok(r.isError, `${code}: ${r.text}`);
    assert.match(r.text, new RegExp(`^ERREUR ${code} : .+`), r.text);
    return r.text;
  };
  await err('invalid_ref', 'memory_read', { ref: 'Bad Ref' });
  await err('invalid_input', 'memory_write', { ref: 'global:x', ...W, title: '' });
  await err('invalid_input', 'memory_write', { ref: 'global:x', title: 1 });
  await err('not_found', 'memory_read', { ref: 'global:nope' });
  await err('not_found', 'memory_append', { ref: 'global:nope', text: 'x' });
  await err('not_found', 'memory_write', { ref: 'global:nope', ...W, baseRevision: 'abcdef012345' });
  await call('memory_write', { ref: 'global:a', ...W });
  await err('exists', 'memory_write', { ref: 'global:a', ...W });
  await err('conflict', 'memory_write', { ref: 'global:a', ...W, baseRevision: 'abcdef012345' });
  await err('too_large', 'memory_write', { ref: 'global:big', ...W, body: 'x'.repeat(20_001) });
  await err('secret_detected', 'memory_write', { ref: 'global:s', ...W, body: 'sk-ant-' + 'a'.repeat(30) });
  await err('invalid_input', 'memory_append', { ref: 'global:a', text: '' });
  await err('too_large', 'memory_append', { ref: 'global:a', text: 'x'.repeat(4001) });
  mkdirSync(join(sb.hub, 'global', 'topics'), { recursive: true });
  writeFileSync(join(sb.hub, 'global', 'topics', 'broken.md'), 'pas de frontmatter');
  await err('invalid_file', 'memory_read', { ref: 'global:broken' });
});

test('io: topic path is a directory', async () => {
  const sb = sandbox();
  mkdirSync(join(sb.hub, 'global', 'topics', 'a.md'), { recursive: true });
  const call = await connect(sb, sb.dir('p'));
  assert.match((await call('memory_read', { ref: 'global:a' })).text, /^ERREUR io : /);
});

test('excluded and unregistered rules', async () => {
  const sb = sandbox();
  const call = await connect(sb, join(sb.exclude.tmpDir, 'x'));
  for (const [n, a] of [['memory_read', { ref: 'project:a' }], ['memory_append', { ref: 'project:a', text: 'x' }], ['memory_write', { ref: 'project:a', ...W }]] as const) {
    assert.match((await call(n, a)).text, /^ERREUR excluded : /, n);
  }
  assert.equal((await call('memory_write', { ref: 'global:g', ...W })).isError, false);
  const l = await call('memory_list', { scope: 'project' });
  assert.deepEqual([l.isError, l.text], [false, 'Projet : non enregistré']);

  const sb2 = sandbox();
  const call2 = await connect(sb2, sb2.dir('q'));
  assert.match((await call2('memory_read', { ref: 'project:a' })).text, /^ERREUR not_found/);
  assert.match((await call2('memory_append', { ref: 'project:a', text: 'x' })).text, /^ERREUR not_found/);
  assert.equal((await call2('memory_list')).text, 'Projet : non enregistré');
  assert.equal((await call2('memory_write', { ref: 'project:a', ...W })).isError, false); // ensureProject
  assert.match((await call2('memory_list')).text, /^Projet : q \(/);
});

test('sessionDir: CLAUDE_PROJECT_DIR then cwd', () => {
  assert.equal(sessionDir({ CLAUDE_PROJECT_DIR: '/a' }, '/c'), '/a');
  assert.equal(sessionDir({}, '/c'), '/c');
  assert.equal(sessionDir({ CLAUDE_PROJECT_DIR: '' }, '/c'), '/c');
});

test('two clients, same baseRevision: one success, one conflict with current revision', async () => {
  const sb = sandbox();
  const dir = sb.dir('p');
  const c1 = await connect(sb, dir);
  const c2 = await connect(sb, dir);
  const base = rev((await c1('memory_write', { ref: 'global:c', ...W })).text);
  const [r1, r2] = await Promise.all([
    c1('memory_write', { ref: 'global:c', ...W, body: 'un', baseRevision: base }),
    c2('memory_write', { ref: 'global:c', ...W, body: 'deux', baseRevision: base }),
  ]);
  const ok = [r1, r2].filter((r) => !r.isError);
  const ko = [r1, r2].filter((r) => r.isError);
  assert.equal(ok.length, 1);
  assert.equal(ko.length, 1);
  assert.match(ko[0]!.text, /^ERREUR conflict : /);
  assert.ok(ko[0]!.text.includes(rev(ok[0]!.text)), ko[0]!.text);
});
