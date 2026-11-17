import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '../..');
const version = (f: string) => (JSON.parse(readFileSync(join(root, f), 'utf8')) as { version: string }).version;

// Claude Code only refreshes its plugin cache when plugin.json's version changes: it must move with the extension.
test('plugin.json version equals the extension version', () => {
  assert.equal(version('claude-plugin/projects-hub/.claude-plugin/plugin.json'), version('package.json'));
});
