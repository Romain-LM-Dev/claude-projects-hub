// Sonde en lecture seule du vrai CLAUDE_HOME ; le cache va dans un dossier temporaire.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { scanClaudeData } from '../src/core/claudeData.ts';
import { claudeHome as resolveClaudeHome } from '../src/core/paths.ts';
import type { ScanStats } from '../src/core/transcript.ts';

const claudeHome = resolveClaudeHome();
const cachePath = join(mkdtempSync(join(tmpdir(), 'hub-probe-')), 'sessions-v1.json');

const stats: ScanStats = { types: {}, bytesRead: 0 };
let t = performance.now();
const cold = await scanClaudeData(claudeHome, { cachePath, stats });
const coldMs = performance.now() - t;
t = performance.now();
const warmStats: ScanStats = { types: {}, bytesRead: 0 };
await scanClaudeData(claudeHome, { cachePath, stats: warmStats });
const warmMs = performance.now() - t;

console.log(`CLAUDE_HOME : ${claudeHome}`);
console.log(`dossiers Claude : ${cold.dirCount} ; projets (par cwd) : ${cold.projects.length} ; sessions : ${cold.sessions.length}`);
console.log('histogramme des types de ligne (tête + queue) :');
for (const [k, v] of Object.entries(stats.types).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(7)}  ${k}`);
console.log(`lignes illisibles : ${cold.sessions.reduce((n, s) => n + s.parseErrors, 0)}`);
const titles: Record<string, number> = {};
for (const s of cold.sessions) titles[s.titleSource] = (titles[s.titleSource] ?? 0) + 1;
console.log(`sources de titre : ${JSON.stringify(titles)}`);
console.log(`sous-agents : ${cold.sessions.reduce((n, s) => n + s.subagents.length, 0)} ; sessions vivantes : ${cold.sessions.filter((s) => s.live).length}`);
console.log(`octets lus à froid : ${(stats.bytesRead / 1e6).toFixed(2)} Mo (cible < 20 Mo) ; avec cache : ${warmStats.bytesRead}`);
console.log(`scan à froid : ${coldMs.toFixed(0)} ms (cible < 2000) ; avec cache : ${warmMs.toFixed(0)} ms (cible < 300)`);
