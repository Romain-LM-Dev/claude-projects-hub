import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ProjectInfo } from './claudeData.ts';
import { ensureProject, markerFile } from './identity.ts';
import { attachProject, copyAutoMemory, detachDir, dismiss, reconcile, undoMerge } from './relocate.ts';
import { readRegistry, registryFile } from './registry.ts';
import { listTopics, writeTopic } from './store.ts';
import { initRepo, sandbox, type Sandbox } from '../../test/fixtures/kit.ts';

const info = (cwd: string, dir: string): ProjectInfo => ({ cwd, claudeDirs: [dir], sessions: [] });
const rec = (sb: Sandbox, ps: ProjectInfo[]) => reconcile(ps, { hubHome: sb.hub, exclude: sb.exclude });
const ens = (sb: Sandbox, d: string) => ensureProject(d, { hubHome: sb.hub, git: false, exclude: sb.exclude });
const markerId = (d: string) => JSON.parse(readFileSync(markerFile(d), 'utf8')).id as string;
const topic = (sb: Sandbox, pid: string, slug: string, body = 'b') =>
  writeTopic({ hubHome: sb.hub, projectId: pid }, `project:${slug}`, { title: slug, summary: 's', body });

test('moved repo without marker: session creates C, scan merges automatically, undo restores everything', async () => {
  const sb = sandbox();
  const a = initRepo(sb.dir('old'), 'https://github.com/u/r.git');
  await rec(sb, [info(a, 'old-enc')]);
  const oid = Object.keys((await readRegistry(sb.hub)).reg.projects)[0]!;
  const b = join(sb.base, 'w', 'new');
  renameSync(a, b);
  const c = (await ens(sb, b))!;
  assert.notEqual(c.id, oid);

  const res = await rec(sb, [info(a, 'old-enc'), info(b, 'new-enc')]);
  assert.equal(res.merges.length, 1);
  const { reg } = await readRegistry(sb.hub);
  assert.deepEqual(Object.keys(reg.projects), [oid]);
  assert.deepEqual(reg.projects[oid]!.paths, [b]);
  assert.deepEqual(reg.projects[oid]!.claudeDirs, ['old-enc', 'new-enc']);
  assert.equal(markerId(b), oid);

  await undoMerge(sb.hub, res.merges[0]!);
  const after = (await readRegistry(sb.hub)).reg;
  assert.deepEqual(after.projects[oid]!.dismissed, [c.id]);
  assert.deepEqual(after.projects[c.id]!.paths, [b]);
  assert.deepEqual(after.projects[oid]!.paths, []);
  assert.equal(markerId(b), c.id);
});

test('undo of a merge whose C was created by the scan itself: C keeps its id, pair dismissed, next scan does not merge again', async () => {
  const sb = sandbox();
  const a = initRepo(sb.dir('old'), 'https://github.com/u/r.git');
  await rec(sb, [info(a, 'old-enc')]);
  const oid = Object.keys((await readRegistry(sb.hub)).reg.projects)[0]!;
  const b = join(sb.base, 'w', 'new');
  renameSync(a, b);
  const ps = [info(a, 'old-enc'), info(b, 'new-enc')];
  const res = await rec(sb, ps);
  assert.equal(res.merges.length, 1);
  const cid = res.merges[0]!.removedId;
  await undoMerge(sb.hub, res.merges[0]!);
  const { reg } = await readRegistry(sb.hub);
  assert.deepEqual(reg.projects[cid]!.paths, [b]);
  assert.deepEqual(reg.projects[oid]!.dismissed, [cid]);
  assert.deepEqual((await rec(sb, ps)).merges, []);
});

test('undoMerge refuses (conflict) when a later pass rewrote the .bak; registry untouched', async () => {
  const sb = sandbox();
  const a = initRepo(sb.dir('old'), 'https://github.com/u/r.git');
  await rec(sb, [info(a, 'old-enc')]);
  const b = join(sb.base, 'w', 'new');
  renameSync(a, b);
  await ens(sb, b);
  const res = await rec(sb, [info(a, 'old-enc'), info(b, 'new-enc')]);
  assert.equal(res.merges.length, 1);
  const x = sb.dir('x'), y = sb.dir('y');
  await rec(sb, [info(b, 'new-enc'), info(x, 'x'), info(y, 'y')]);
  const ids = (await readRegistry(sb.hub)).reg.projects;
  const [ix, iy] = [Object.keys(ids).find((i) => ids[i]!.paths.includes(x))!, Object.keys(ids).find((i) => ids[i]!.paths.includes(y))!];
  await attachProject(sb.hub, ix, iy);
  const before = readFileSync(registryFile(sb.hub), 'utf8');
  await assert.rejects(undoMerge(sb.hub, res.merges[0]!), { code: 'conflict' });
  assert.equal(readFileSync(registryFile(sb.hub), 'utf8'), before);
});

test('fingerprints of registry entries missing git are computed without the registry lock', async () => {
  const sb = sandbox();
  const d = initRepo(sb.dir('hookrepo'), 'https://github.com/u/h.git');
  const e = (await ens(sb, d))!;
  assert.ok(!('git' in (await readRegistry(sb.hub)).reg.projects[e.id]!));
  let calls = 0;
  await reconcile([], {
    hubHome: sb.hub, exclude: sb.exclude,
    fingerprint: async () => { calls++; assert.ok(!existsSync(registryFile(sb.hub) + '.lock')); return { rootCommits: ['r'], remote: 'x' }; },
  });
  assert.ok(calls >= 1);
  assert.ok((await readRegistry(sb.hub)).reg.projects[e.id]!.git);
});

test('two candidate clones -> proposals, no merge; two live clones stay two projects', async () => {
  const sb = sandbox();
  const o = initRepo(sb.dir('orig'), 'https://github.com/u/r.git');
  const c1 = join(sb.base, 'w', 'c1');
  const c2 = join(sb.base, 'w', 'c2');
  await rec(sb, [info(o, 'o')]);
  const oid = Object.keys((await readRegistry(sb.hub)).reg.projects)[0]!;
  renameSync(o, c1);
  mkdirSync(c2);
  // c2 is a second copy of the same history: reuse c1's .git by cloning
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['clone', '-q', c1, join(c2, 'x')]);
  execFileSync('git', ['-C', join(c2, 'x'), 'remote', 'set-url', 'origin', 'https://github.com/u/r.git']);
  const c2r = join(c2, 'x');
  await ens(sb, c1); await ens(sb, c2r);
  const res = await rec(sb, [info(o, 'o'), info(c1, 'c1'), info(c2r, 'c2')]);
  assert.equal(res.merges.length, 0);
  assert.deepEqual(res.proposals.map((p) => p.reason), ['root-commit', 'root-commit']);
  assert.ok(res.proposals.every((p) => p.orphanId === oid));
  const { reg } = await readRegistry(sb.hub);
  assert.equal(Object.keys(reg.projects).length, 3);

  // once the orphan is gone from the picture, the two live clones are still two projects
  await dismiss(sb.hub, oid);
  const again = await rec(sb, [info(c1, 'c1'), info(c2r, 'c2')]);
  assert.equal(again.proposals.length, 0);
  assert.equal(Object.values((await readRegistry(sb.hub)).reg.projects).filter((p) => p.paths.length).length, 2);
});

test('git-less folder renamed identically elsewhere -> proposal; dismissed candidate not proposed again', async () => {
  const sb = sandbox();
  const a = sb.dir('one', 'shared-name');
  await rec(sb, [info(a, 'a')]);
  const oid = Object.keys((await readRegistry(sb.hub)).reg.projects)[0]!;
  const b = sb.dir('two', 'Shared-Name');
  const cid = (await ens(sb, b))!.id;
  const ps = [info(a, 'a'), info(b, 'b')];
  renameSync(a, join(sb.base, 'w', 'gone'));
  const r1 = await rec(sb, ps);
  assert.deepEqual(r1.proposals, [{ orphanId: oid, candidateId: cid, reason: 'same-name' }]);
  assert.deepEqual(r1.orphans, [oid]);
  await dismiss(sb.hub, oid, cid);
  assert.deepEqual((await rec(sb, ps)).proposals, []);
});

test('detach gives a fresh identity and rewrites the marker; topics stay', async () => {
  const sb = sandbox();
  const d = sb.dir('p');
  const id = (await ens(sb, d))!.id;
  await topic(sb, id, 'note');
  const nid = await detachDir(sb.hub, d);
  assert.notEqual(nid, id);
  assert.equal(markerId(d), nid);
  const { reg } = await readRegistry(sb.hub);
  assert.deepEqual(reg.projects[id]!.paths, []);
  assert.deepEqual(reg.projects[nid]!.paths, [d]);
  assert.equal((await listTopics({ hubHome: sb.hub, projectId: id }, 'project')).length, 1);
  await assert.rejects(() => detachDir(sb.hub, sb.dir('nope')), { code: 'not_found' });
});

test('manual attach with slug collision: suffix, nothing overwritten, undo moves back', async () => {
  const sb = sandbox();
  const k = (await ens(sb, sb.dir('k')))!.id;
  const x = (await ens(sb, sb.dir('x')))!.id;
  await topic(sb, k, 'same', 'kept');
  await topic(sb, x, 'same', 'other');
  await topic(sb, x, 'only', 'only');
  const m = await attachProject(sb.hub, k, x);
  const refs = (await listTopics({ hubHome: sb.hub, projectId: k }, 'project')).map((t) => t.ref).sort();
  assert.deepEqual(refs, ['project:only', `project:same-${x.slice(0, 4)}`, 'project:same'].sort());
  assert.match(readFileSync(join(sb.hub, 'projects', k, 'topics', 'same.md'), 'utf8'), /kept/);
  assert.equal(markerId(join(sb.base, 'w', 'x')), k);
  assert.deepEqual(Object.keys((await readRegistry(sb.hub)).reg.projects), [k]);
  await undoMerge(sb.hub, m);
  assert.equal((await listTopics({ hubHome: sb.hub, projectId: x }, 'project')).length, 2);
  assert.equal(markerId(join(sb.base, 'w', 'x')), x);
  assert.equal(Object.keys((await readRegistry(sb.hub)).reg.projects).length, 2);
});

test('copyAutoMemory: copies absent notes and index lines, never overwrites; refuses > 200 chars and autoMemoryDirectory', async () => {
  const sb = sandbox();
  const ch = join(sb.base, 'claude');
  const src = join(ch, 'projects', 'old-enc', 'memory');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'a.md'), 'A-src');
  writeFileSync(join(src, 'b.md'), 'B-src');
  writeFileSync(join(src, 'MEMORY.md'), '- [a](a.md)\n- [b](b.md)\n');
  const np = 'C:\\new\\folder';
  const dst = join(ch, 'projects', 'C--new-folder', 'memory');
  mkdirSync(dst, { recursive: true });
  writeFileSync(join(dst, 'a.md'), 'A-dst');
  writeFileSync(join(dst, 'MEMORY.md'), '- [a](a.md)');
  const r = await copyAutoMemory(ch, 'old-enc', np);
  assert.deepEqual(r.copied, ['b.md']);
  assert.equal(r.indexLinesAdded, 1);
  assert.equal(readFileSync(join(dst, 'a.md'), 'utf8'), 'A-dst');
  assert.equal(readFileSync(join(dst, 'MEMORY.md'), 'utf8'), '- [a](a.md)\n- [b](b.md)\n');
  assert.deepEqual((await copyAutoMemory(ch, 'old-enc', np)).copied, []);

  await assert.rejects(() => copyAutoMemory(ch, 'old-enc', 'C:\\' + 'x'.repeat(200)), { code: 'invalid_input' });
  writeFileSync(join(ch, 'settings.json'), JSON.stringify({ autoMemoryDirectory: 'D:\\mem' }));
  await assert.rejects(() => copyAutoMemory(ch, 'old-enc', np), { code: 'invalid_input' });
  assert.ok(!existsSync(join(ch, 'projects', 'C--x')));
});
