import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gitFingerprint, normalizeRemote } from './git.ts';
import { git, initRepo, sandbox } from '../../test/fixtures/kit.ts';

test('normalizeRemote', () => {
  for (const u of ['git@GitHub.com:Foo/Bar.git', 'https://user:pw@github.com/foo/bar.git/', 'git+ssh://git@github.com/foo/bar', 'HTTPS://github.com/foo/bar'])
    assert.equal(normalizeRemote(u), 'github.com/foo/bar');
});

test('gitFingerprint: repo, clone, empty repo, no repo', async () => {
  const sb = sandbox();
  const a = initRepo(sb.dir('a'), 'git@github.com:u/r.git');
  const fp = await gitFingerprint(a);
  assert.deepEqual(fp, { rootCommits: git(a, 'rev-list', '--max-parents=0', 'HEAD').split('\n').sort(), remote: 'github.com/u/r' });
  const empty = sb.dir('empty');
  git(empty, 'init', '-q');
  assert.deepEqual(await gitFingerprint(empty), { rootCommits: [] });
  assert.equal(await gitFingerprint(sb.dir('plain')), null);
});
