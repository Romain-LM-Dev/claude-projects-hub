import assert from 'node:assert/strict';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ProjectInfo } from './claudeData.ts';
import { ensureProject } from './identity.ts';
import { reconcile, undoMerge } from './relocate.ts';
import { initRepo, sandbox } from '../../test/fixtures/kit.ts';

const info = (cwd: string, dir: string): ProjectInfo => ({ cwd, claudeDirs: [dir], sessions: [] });

// QA T11: two repos moved, merged in ONE pass (one .bak), undone one after the other as the extension does (reverse order).
test('two merges in one pass: undoing both keeps both refusals (next scan merges nothing)', async () => {
  const sb = sandbox();
  const rec = (ps: ProjectInfo[]) => reconcile(ps, { hubHome: sb.hub, exclude: sb.exclude });
  const a1 = initRepo(sb.dir('a1'), 'https://github.com/u/a1.git', 'one');
  const a2 = initRepo(sb.dir('a2'), 'https://github.com/u/a2.git', 'two');
  await rec([info(a1, 'a1'), info(a2, 'a2')]);
  const b1 = join(sb.base, 'w', 'b1'), b2 = join(sb.base, 'w', 'b2');
  renameSync(a1, b1); renameSync(a2, b2);
  await ensureProject(b1, { hubHome: sb.hub, git: false, exclude: sb.exclude });
  await ensureProject(b2, { hubHome: sb.hub, git: false, exclude: sb.exclude });
  const ps = [info(a1, 'a1'), info(a2, 'a2'), info(b1, 'b1'), info(b2, 'b2')];
  const res = await rec(ps);
  assert.equal(res.merges.length, 2, 'precondition: two certain merges in one pass');
  await undoMerge(sb.hub, res.merges);
  assert.deepEqual((await rec(ps)).merges, [], 'a refused pair was merged again');
});
