import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { initRepo, sandbox } from '../../test/fixtures/kit.ts';
import { ensureProject, markerFile } from './identity.ts';
import { adviseOrphan, relinkOrphan } from './orphanAdvice.ts';
import { newEntry, readRegistry, updateRegistry } from './registry.ts';
import { listTopics, writeTopic } from './store.ts';

const base = { sessions: 0, topics: 0, notes: 0 };

test('adviseOrphan: rules in order, first true case wins', () => {
  assert.equal(adviseOrphan({ ...base, candidate: 'X', sessions: 3, topics: 2, daysIdle: 900 }).action, 'attachCandidate');
  assert.equal(adviseOrphan({ ...base }).action, 'dismiss');
  assert.equal(adviseOrphan({ ...base, daysIdle: 900 }).action, 'dismiss', 'empty beats idle');
  assert.equal(adviseOrphan({ ...base, sessions: 2, topics: 1, daysIdle: 900 }).action, 'relink', 'topics beat idle');
  assert.equal(adviseOrphan({ ...base, sessions: 2, notes: 1, daysIdle: 900 }).action, 'relink', 'notes beat idle');
  assert.equal(adviseOrphan({ ...base, sessions: 2, daysIdle: 61 }).action, 'deleteSessions');
  assert.equal(adviseOrphan({ ...base, sessions: 2, daysIdle: 60 }).action, 'relink');
  assert.equal(adviseOrphan({ ...base, sessions: 2 }).action, 'relink');
  assert.ok(adviseOrphan({ ...base, sessions: 2 }).text.length > 10);
});

const mkOrphan = async (sb: ReturnType<typeof sandbox>, name: string) => {
  const id = `orph-${name}`;
  await updateRegistry(sb.hub, async (r) => { const e = newEntry(join(sb.base, 'gone', name)); e.paths = []; e.formerPaths = [join(sb.base, 'gone', name)]; r.projects[id] = e; });
  return id;
};

test('relinkOrphan: new git folder gets the marker, the path and the exclude line; second call is idempotent', async () => {
  const sb = sandbox();
  const id = await mkOrphan(sb, 'a');
  const dir = initRepo(sb.dir('new'));
  const r1 = await relinkOrphan(sb.hub, id, dir, { exclude: sb.exclude });
  assert.deepEqual(r1, { kind: 'linked', id });
  assert.equal(JSON.parse(readFileSync(markerFile(dir), 'utf8')).id, id);
  assert.deepEqual((await readRegistry(sb.hub)).reg.projects[id]!.paths, [dir]);
  assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /^\/\.claude\/projects-hub\.json$/m);
  assert.deepEqual(await relinkOrphan(sb.hub, id, dir, { exclude: sb.exclude }), { kind: 'linked', id });
  assert.deepEqual((await readRegistry(sb.hub)).reg.projects[id]!.paths, [dir]);
  assert.equal(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8').split('\n').filter((l) => l === '/.claude/projects-hub.json').length, 1);
});

test('relinkOrphan: folder of a registered project merges it into the orphan, topics moved', async () => {
  const sb = sandbox();
  const id = await mkOrphan(sb, 'b');
  const dir = sb.dir('live');
  const live = (await ensureProject(dir, { hubHome: sb.hub, git: false, exclude: sb.exclude }))!.id;
  await writeTopic({ hubHome: sb.hub, projectId: live }, 'project:t1', { title: 'T', summary: 's', body: 'b' });
  const r = await relinkOrphan(sb.hub, id, dir, { exclude: sb.exclude });
  assert.equal(r.kind, 'merged');
  const reg = (await readRegistry(sb.hub)).reg;
  assert.ok(reg.projects[id] && !reg.projects[live]);
  assert.deepEqual(reg.projects[id]!.paths, [dir]);
  assert.equal(JSON.parse(readFileSync(markerFile(dir), 'utf8')).id, id);
  assert.equal((await listTopics({ hubHome: sb.hub, projectId: id }, 'project')).length, 1, 'topic moved');
});

test('relinkOrphan: marker not writable -> io, no new registry entry', { skip: process.platform !== 'win32' }, async () => {
  const sb = sandbox();
  const id = await mkOrphan(sb, 'ro');
  const dir = sb.dir('ro-target');
  const before = Object.keys((await readRegistry(sb.hub)).reg.projects).sort();
  execFileSync('icacls', [dir, '/deny', '*S-1-1-0:(OI)(CI)(WD,AD)'], { stdio: 'ignore' });
  try {
    await assert.rejects(relinkOrphan(sb.hub, id, dir, { exclude: sb.exclude }), { code: 'io' });
  } finally { execFileSync('icacls', [dir, '/remove:d', '*S-1-1-0'], { stdio: 'ignore' }); }
  assert.deepEqual(Object.keys((await readRegistry(sb.hub)).reg.projects).sort(), before);
});

test('relinkOrphan: excluded folder is refused, nothing written; unknown orphan refused', async () => {
  const sb = sandbox();
  const id = await mkOrphan(sb, 'c');
  const dir = join(sb.exclude.tmpDir, 'x');
  mkdirSync(dir, { recursive: true });
  await assert.rejects(relinkOrphan(sb.hub, id, dir, { exclude: sb.exclude }), { code: 'excluded' });
  assert.ok(!existsSync(markerFile(dir)));
  await assert.rejects(relinkOrphan(sb.hub, 'nope', sb.dir('y'), { exclude: sb.exclude }), { code: 'not_found' });
});

test('relinkOrphan: marker of another project that is not registered is registered then merged', async () => {
  const sb = sandbox();
  const id = await mkOrphan(sb, 'd');
  const dir = sb.dir('clone');
  const other = (await ensureProject(dir, { hubHome: sb.hub, git: false, exclude: sb.exclude }))!.id;
  await updateRegistry(sb.hub, async (r) => { delete r.projects[other]; });
  writeFileSync(join(dir, '.keep'), '');
  assert.equal((await relinkOrphan(sb.hub, id, dir, { exclude: sb.exclude })).kind, 'merged');
});
