import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHeader, buildInjection, formatTopicLine, projectLabel } from './injection.ts';

const mk = (i: number, summary = 'résumé du topic') => ({ ref: `project:t${i}`, title: `Titre ${i}`, summary, mtimeMs: new Date(2026, 10, 5, 23, 30).getTime() }); // late local evening: a UTC date would roll over east of UTC
const header = buildHeader(projectLabel('demo'));

test('aucun topic : en-tête seul', () => {
  assert.equal(buildInjection(header, [], [], 4000), header);
  assert.ok(header.includes('Projet : «demo»'));
});

test('100 topics : longueur <= 4000 et pied de page exact', () => {
  const topics = Array.from({ length: 100 }, (_, i) => mk(i));
  const out = buildInjection(header, topics, [], 4000);
  assert.ok(out.length <= 4000);
  const shown = out.split('\n').filter((l) => l.startsWith('- ')).length;
  assert.ok(shown > 0 && shown < 100);
  assert.ok(out.endsWith(`… ${100 - shown} autres topics : memory_list`));
});

test('ligne : tags, date, coupe à 180', () => {
  assert.equal(formatTopicLine({ ...mk(1), tags: ['a', 'b'] }), '- project:t1 — Titre 1 : résumé du topic [a, b] (2026-11-05)');
  assert.ok(!formatTopicLine(mk(1)).includes('['));
  const long = formatTopicLine(mk(1, 'x'.repeat(500)));
  assert.equal(long.length, 180);
  assert.ok(long.endsWith('…'));
});

test('sections : projet puis global, section vide omise', () => {
  const out = buildInjection(header, [mk(1)], [], 4000);
  assert.ok(out.includes('### Projet') && !out.includes('### Global'));
  assert.ok(buildInjection(header, [mk(1)], [{ ...mk(2), ref: 'global:g' }], 4000).includes('### Global\n- global:g'));
});
