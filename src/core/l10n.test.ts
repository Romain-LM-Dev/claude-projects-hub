import assert from 'node:assert/strict';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { sandbox } from '../../test/fixtures/kit.ts';
import { l10n, readLanguage, setLanguage, settingsFile, toLang, writeLanguage } from './l10n.ts';

test('toLang: any French tag is fr, the rest en', () => {
  assert.deepEqual(['fr', 'fr-FR', 'FR-ca', 'en', 'de', '', undefined, 42].map(toLang), ['fr', 'fr', 'fr', 'en', 'en', 'en', 'en', 'en']);
});

test('l10n.t: English by default, French from the bundle, {n} filled, other braces kept', () => {
  assert.equal(l10n.t('topic not found: {0}', 'global:a'), 'topic not found: global:a');
  setLanguage('fr');
  try {
    assert.equal(l10n.t('topic not found: {0}', 'global:a'), 'topic introuvable : global:a');
    assert.equal(l10n.t('no such key {0}', 1), 'no such key 1', 'missing key: English source');
    assert.ok(l10n.t('## Shared memory (projects-hub)\nTopics shared between sessions. Project: {0}. Read: {1} {ref}. Create or replace: …memory_write; append: …memory_append; list: …memory_list. Write a topic when a decision, a convention or the state of a piece of work must outlive the session; global = useful to every project, no secrets or client data.', 'P', 'T').includes('Projet : P. Lire : T {ref}.'));
  } finally { setLanguage('en'); }
});

test('settings.json: absent or broken = en; written once, then left alone while unchanged', async () => {
  const { hub } = sandbox();
  assert.equal(readLanguage(hub), 'en');
  await writeLanguage(hub, 'fr');
  assert.equal(readLanguage(hub), 'fr');
  const m = statSync(settingsFile(hub)).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await writeLanguage(hub, 'fr');
  assert.equal(statSync(settingsFile(hub)).mtimeMs, m, 'unchanged: not rewritten');
  await writeLanguage(hub, 'en');
  assert.equal(readLanguage(hub), 'en');
  writeFileSync(join(hub, 'settings.json'), '{oops');
  assert.equal(readLanguage(hub), 'en');
});
