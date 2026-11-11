import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface GitFingerprint { rootCommits: string[]; remote?: string }

/** Architecture §7.2: strips `git+`, protocol, credentials, `.git` and trailing `/`; `git@host:path` -> `host/path`; lowercase. */
export function normalizeRemote(url: string): string {
  let u = url.trim().replace(/^git\+/, '');
  const scp = /^[^/@:\s]+@([^:/\s]+):(?!\/\/)(.+)$/.exec(u);
  if (scp) u = `${scp[1]}/${scp[2]}`;
  else u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^/@]*@/, '');
  return u.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', dir, ...args], { timeout: 3000, windowsHide: true });
  return stdout.trim();
}

/** `null` when `dir` is not a git work tree or git is missing. Never called by the hook. */
export async function gitFingerprint(dir: string): Promise<GitFingerprint | null> {
  try {
    if ((await git(dir, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return null;
  } catch { return null; }
  let rootCommits: string[] = [];
  try {
    rootCommits = (await git(dir, ['rev-list', '--max-parents=0', 'HEAD'])).split(/\r?\n/).filter(Boolean).sort();
  } catch { /* repository without commit */ }
  let remote: string | undefined;
  try { remote = normalizeRemote(await git(dir, ['config', '--get', 'remote.origin.url'])) || undefined; } catch { /* no origin */ }
  return remote ? { rootCommits, remote } : { rootCommits };
}
