import { lstat, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pidAlive, readOpenSessions } from './claudeData.ts';
import { readAutoMemory } from './automemory.ts';
import { HubError } from './paths.ts';
import { readRegistry, updateRegistry } from './registry.ts';
import { listTopics } from './store.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function size(p: string): Promise<number> {
  const st = await lstat(p);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of await readdir(p)) n += await size(join(p, e));
  return n;
}

/** Existing files of one session (ADR 0007); telemetry is deliberately excluded. */
export async function sessionFiles(claudeHome: string, claudeDir: string, sessionId: string): Promise<{ paths: string[]; bytes: number }> {
  if (!UUID.test(sessionId)) throw new HubError('invalid_input', `identifiant de session invalide : ${sessionId}`);
  if (!claudeDir || claudeDir === '.' || claudeDir === '..' || /[\\/]/.test(claudeDir)) throw new HubError('invalid_input', `dossier Claude invalide : ${claudeDir}`);
  const root = resolve(claudeHome);
  const candidates = [
    join(root, 'projects', claudeDir, `${sessionId}.jsonl`),
    join(root, 'projects', claudeDir, sessionId),
    join(root, 'file-history', sessionId),
    join(root, 'session-env', sessionId),
  ].map((p) => resolve(p));
  const paths: string[] = [];
  let bytes = 0;
  for (const p of candidates) {
    if (!p.startsWith(root + sep)) throw new HubError('invalid_input', `chemin hors de CLAUDE_HOME : ${p}`);
    try { bytes += await size(p); paths.push(p); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return { paths, bytes };
}

export async function isSessionLive(claudeHome: string, sessionId: string, isAlive = pidAlive): Promise<boolean> {
  return (await readOpenSessions(claudeHome, isAlive)).some((s) => s.sessionId === sessionId && s.alive);
}

const badSegment = (d: string) => !d || d === '.' || d === '..' || /[\\/]/.test(d);

/** Everything an orphan owns (ADR 0007 amendment): session files, Claude folders, hub folder; existing paths only, no nested duplicate. */
export async function orphanFiles(claudeHome: string, hubHome: string, id: string, sessions: { sessionId: string; claudeDir: string }[]): Promise<{ paths: string[]; bytes: number; topics: number; notes: number }> {
  const { reg } = await readRegistry(hubHome);
  const entry = Object.hasOwn(reg.projects, id) ? reg.projects[id]! : undefined;
  if (!entry) throw new HubError('invalid_input', `projet inconnu : ${id}`);
  if (entry.paths.length) throw new HubError('invalid_input', `${entry.name} a encore un dossier : ce n'est pas un orphelin`);
  // A Claude folder also used by a live project (old path recreated) stays: trashing it would take that project's sessions.
  const live = new Set(Object.entries(reg.projects).filter(([k, e]) => k !== id && e.paths.length).flatMap(([, e]) => e.claudeDirs.map((d) => d.toLowerCase())));
  const own = entry.claudeDirs.filter((cd) => !live.has(cd.toLowerCase()));
  const root = resolve(claudeHome);
  const hubRoot = resolve(hubHome);
  const all: string[] = [];
  for (const s of sessions) if (own.some((cd) => cd.toLowerCase() === s.claudeDir.toLowerCase())) all.push(...(await sessionFiles(claudeHome, s.claudeDir, s.sessionId)).paths);
  let notes = 0;
  const dirs: string[] = [];
  for (const cd of own) {
    if (badSegment(cd)) throw new HubError('invalid_input', `dossier Claude invalide : ${cd}`);
    const d = resolve(root, 'projects', cd);
    if (!d.startsWith(root + sep)) throw new HubError('invalid_input', `chemin hors de CLAUDE_HOME : ${d}`);
    dirs.push(d);
    notes += (await readAutoMemory(join(d, 'memory'))).notes.length;
  }
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new HubError('invalid_input', `identifiant de projet invalide : ${id}`);
  const hubDir = resolve(hubRoot, 'projects', id);
  if (!hubDir.startsWith(hubRoot + sep)) throw new HubError('invalid_input', `chemin hors de HUB_HOME : ${hubDir}`);
  const topics = (await listTopics({ hubHome, projectId: id }, 'project')).filter((t) => t.valid).length;
  const paths: string[] = [];
  let bytes = 0;
  for (const p of [...dirs, hubDir, ...all]) {
    if (paths.some((q) => p === q || p.startsWith(q + sep))) continue;
    try { bytes += await size(p); paths.push(p); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return { paths, bytes, topics, notes };
}

/** Last step of an orphan deletion: drop the entry (and its id from the others' `dismissed`) once the files are gone. */
export async function forgetProject(hubHome: string, id: string): Promise<void> {
  await updateRegistry(hubHome, async (reg) => {
    const e = Object.hasOwn(reg.projects, id) ? reg.projects[id] : undefined;
    if (!e) throw new HubError('invalid_input', `projet inconnu : ${id}`);
    if (e.paths.length) throw new HubError('invalid_input', `${e.name} a encore un dossier : ce n'est pas un orphelin`);
    delete reg.projects[id];
    for (const o of Object.values(reg.projects)) o.dismissed = o.dismissed.filter((d) => d !== id);
  });
}
