import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { cachedSummary, loadCache, saveCache, type SessionCache } from './sessionCache.ts';
import { summarizeTranscript, type ScanStats, type SessionSummary, type SubagentInfo } from './transcript.ts';

export interface OpenSession {
  pid: number;
  sessionId: string;
  cwd?: string;
  status?: string;
  updatedAt?: number;
  entrypoint?: string;
  name?: string;
  alive: boolean;
}

export interface ProjectInfo {
  cwd: string; // cwd de la session la plus récente
  claudeDirs: string[]; // plusieurs si la casse C-/c- diffère
  sessions: SessionSummary[]; // plus récente d'abord
}

export interface ScanOptions {
  cachePath?: string;
  stats?: ScanStats;
  isAlive?: (pid: number) => boolean;
}

/** Vivante si kill(pid, 0) réussit ou lève EPERM. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function readOpenSessions(claudeHome: string, isAlive = pidAlive): Promise<OpenSession[]> {
  let names: string[];
  try {
    names = await readdir(join(claudeHome, 'sessions'));
  } catch {
    return [];
  }
  const out: OpenSession[] = [];
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      const o = JSON.parse(await readFile(join(claudeHome, 'sessions', n), 'utf8')) as Record<string, unknown>;
      if (typeof o.pid !== 'number' || typeof o.sessionId !== 'string') continue;
      const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
      out.push({
        pid: o.pid, sessionId: o.sessionId, cwd: s('cwd'), status: s('status'),
        updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : undefined,
        entrypoint: s('entrypoint'), name: s('name'), alive: isAlive(o.pid),
      });
    } catch { /* fichier illisible : ignoré */ }
  }
  return out;
}

async function readSubagents(dir: string): Promise<SubagentInfo[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: SubagentInfo[] = [];
  for (const n of names.filter((x) => /^agent-.+\.meta\.json$/.test(x)).sort()) {
    const id = n.slice('agent-'.length, -'.meta.json'.length);
    try {
      const o = JSON.parse(await readFile(join(dir, n), 'utf8')) as Record<string, unknown>;
      out.push({
        id,
        agentType: typeof o.agentType === 'string' ? o.agentType : undefined,
        description: typeof o.description === 'string' ? o.description : undefined,
      });
    } catch {
      out.push({ id });
    }
  }
  return out;
}

const projectKey = (cwd: string) => cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Scanne CLAUDE_HOME/projects (lecture seule), regroupe par cwd, utilise le cache s'il est fourni. */
export async function scanClaudeData(claudeHome: string, opts: ScanOptions = {}): Promise<{ projects: ProjectInfo[]; sessions: SessionSummary[]; dirCount: number }> {
  const root = join(claudeHome, 'projects');
  let dirs: string[] = [];
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { /* pas de projets */ }
  const cache: SessionCache = opts.cachePath ? await loadCache(opts.cachePath) : {};
  const next: SessionCache = {};
  const sessions: SessionSummary[] = [];
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = (await readdir(join(root, dir))).filter((f) => f.endsWith('.jsonl'));
    } catch { continue; }
    for (const f of files) {
      const file = join(root, dir, f);
      try {
        const st = await stat(file);
        const sessionId = f.slice(0, -'.jsonl'.length);
        let summary = cachedSummary(cache, file, st.size, st.mtimeMs);
        if (!summary) {
          summary = await summarizeTranscript(file, dir, sessionId, st.size, st.mtimeMs, opts.stats);
          summary.subagents = await readSubagents(join(root, dir, sessionId, 'subagents'));
        }
        next[file] = { size: st.size, mtimeMs: st.mtimeMs, summary };
        sessions.push({ ...summary });
      } catch { /* fichier disparu entre-temps : ignoré */ }
    }
  }
  if (opts.cachePath) await saveCache(opts.cachePath, next);
  const open = new Map((await readOpenSessions(claudeHome, opts.isAlive)).filter((o) => o.alive).map((o) => [o.sessionId, o]));
  for (const s of sessions) {
    const o = open.get(s.sessionId);
    if (o) s.live = { status: o.status };
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const byKey = new Map<string, ProjectInfo>();
  for (const s of sessions) {
    const key = s.cwd ? projectKey(s.cwd) : `dir:${s.claudeDir}`;
    let p = byKey.get(key);
    if (!p) byKey.set(key, (p = { cwd: s.cwd, claudeDirs: [], sessions: [] }));
    if (!p.claudeDirs.includes(s.claudeDir)) p.claudeDirs.push(s.claudeDir);
    p.sessions.push(s);
  }
  return { projects: [...byKey.values()], sessions, dirCount: dirs.length };
}
