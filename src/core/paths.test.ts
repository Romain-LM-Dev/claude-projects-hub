import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { hubHome, isValidSlug, parseRef, topicFile } from './paths.ts';

test('hubHome: env override, else ~/.claude-projects-hub', () => {
  assert.equal(hubHome({ CLAUDE_PROJECTS_HUB_HOME: 'X' }), 'X');
  assert.match(hubHome({}), /\.claude-projects-hub$/);
});

test('parseRef accepts valid refs', () => {
  assert.deepEqual(parseRef('project:ports-docker'), { scope: 'project', slug: 'ports-docker' });
  assert.deepEqual(parseRef('global:a1'), { scope: 'global', slug: 'a1' });
});

test('parseRef rejects bad refs with invalid_ref', () => {
  const bad = ['', 'foo', 'other:abc', 'global:', 'global:A', 'global:a--b', 'global:-a', 'global:a-', 'global:a_b',
    'global:a/b', 'global:..', `global:${'a'.repeat(65)}`, 'global:con', 'global:nul', 'global:com1', 'global:lpt9', 'global:aux', 'global:prn'];
  for (const r of bad) assert.throws(() => parseRef(r), { code: 'invalid_ref' }, r);
  assert.throws(() => parseRef(undefined), { code: 'invalid_ref' });
  assert.equal(isValidSlug('a'.repeat(64)), true);
  assert.equal(isValidSlug('com10'), true);
  assert.equal(isValidSlug('com0'), true);
});

test('topicFile: layout and project id requirement', () => {
  assert.equal(topicFile('H', { scope: 'global', slug: 's' }), join('H', 'global', 'topics', 's.md'));
  assert.equal(topicFile('H', { scope: 'project', slug: 's' }, 'p-1'), join('H', 'projects', 'p-1', 'topics', 's.md'));
  assert.throws(() => topicFile('H', { scope: 'project', slug: 's' }), { code: 'invalid_input' });
  assert.throws(() => topicFile('H', { scope: 'project', slug: 's' }, '../x'), { code: 'invalid_input' });
});
