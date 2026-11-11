import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ProjectInfo } from './claudeData.ts';
import { ensureProject, markerFile } from './identity.ts';
import { withLock } from './lock.ts';
import { attachProject, detachDir, reconcile } from './relocate.ts';
import { readRegistry } from './registry.ts';
import { topicsDir } from './paths.ts';
import { listTopics, writeTopic } from './store.ts';
import { initRepo, sandbox, type Sandbox } from '../../test/fixtures/kit.ts';

const info = (cwd: string, dir: string): ProjectInfo => ({ cwd, claudeDirs: [dir], sessions: [] });
const rec = (sb: Sandbox, ps: ProjectInfo[]) => reconcile(ps, { hubHome: sb.hub, exclude: sb.exclude });
const ens = (sb: Sandbox, d: string) => ensureProject(d, { hubHome: sb.hub, git: false, exclude: sb.exclude });
const topic = (sb: Sandbox, pid: string, slug: string, body = 'b') =>
  writeTopic({ hubHome: sb.hub, projectId: pid }, `project:${slug}`, { title: slug, summary: 's', body });
const markerId = (d: string) => JSON.parse(readFileSync(markerFile(d), 'utf8')).id as string;

test('review 2: a dead folder with the cwd of a hook-created entry adds its claudeDirs, no duplicate orphan', async () => {
  const sb = sandbox();
  const d = sb.dir('gone');
  const id = (await ens(sb, d))!.id;
  renameSync(d, join(sb.base, 'w', 'elsewhere'));
  await rec(sb, [info(d, 'enc-gone')]);
  const { reg } = await readRegistry(sb.hub);
  assert.deepEqual(Object.keys(reg.projects), [id]);
  assert.deepEqual(reg.projects[id]!.claudeDirs, ['enc-gone']);
});

test('review 4: detachDir refuses a subfolder resolved by a parent marker', async () => {
  const sb = sandbox();
  const r = initRepo(sb.dir('repo'));
  await ens(sb, r);
  const sub = join(r, 'sub');
  mkdirSync(sub);
  await rec(sb, [info(sub, 'enc-sub')]);
  await assert.rejects(() => detachDir(sb.hub, sub), { code: 'invalid_input' });
});

test('review 5: failed topic move leaves topics and markers as they were', async () => {
  const sb = sandbox();
  const k = (await ens(sb, sb.dir('k')))!.id;
  const x = (await ens(sb, sb.dir('x')))!.id;
  await topic(sb, x, 'a');
  await topic(sb, x, 'b');
  await topic(sb, k, 'b');
  for (const len of [4, 8, 36]) await topic(sb, k, `b-${x.slice(0, len)}`); // every candidate target of `b` is taken
  await assert.rejects(() => attachProject(sb.hub, k, x), { code: 'exists' });
  assert.deepEqual((await listTopics({ hubHome: sb.hub, projectId: x }, 'project')).map((t) => t.ref).sort(), ['project:a', 'project:b']);
  assert.equal(markerId(join(sb.base, 'w', 'x')), x);
  assert.equal(Object.keys((await readRegistry(sb.hub)).reg.projects).length, 2);
});

test('review 6: a topic written on the target under its lock is not overwritten by the move', async () => {
  const sb = sandbox();
  const k = (await ens(sb, sb.dir('k')))!.id;
  const x = (await ens(sb, sb.dir('x')))!.id;
  await topic(sb, x, 'same', 'moved');
  const dst = join(topicsDir(sb.hub, 'project', k), 'same.md');
  mkdirSync(topicsDir(sb.hub, 'project', k), { recursive: true });
  let attach!: Promise<unknown>;
  await withLock(dst, async () => {
    attach = attachProject(sb.hub, k, x);
    await new Promise((r) => setTimeout(r, 300)); // the move now waits on the target lock
    writeFileSync(dst, 'concurrent');
  });
  await attach;
  assert.equal(readFileSync(dst, 'utf8'), 'concurrent');
  assert.ok(existsSync(join(topicsDir(sb.hub, 'project', k), `same-${x.slice(0, 4)}.md`)));
});
