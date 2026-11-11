import { lstat, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pidAlive, readOpenSessions } from './claudeData.ts';
import { HubError } from './paths.ts';

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
