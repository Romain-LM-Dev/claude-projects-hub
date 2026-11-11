import { homedir } from 'node:os';
import { join } from 'node:path';

export type ErrorCode =
  | 'invalid_ref' | 'invalid_input' | 'not_found' | 'exists' | 'conflict'
  | 'too_large' | 'secret_detected' | 'invalid_file' | 'io';

/** Error carrying an architecture §5 code; `currentRevision` is set for `conflict`. */
export class HubError extends Error {
  code: ErrorCode;
  currentRevision?: string;
  constructor(code: ErrorCode, message: string, currentRevision?: string) {
    super(message);
    this.name = 'HubError';
    this.code = code;
    this.currentRevision = currentRevision;
  }
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export type Scope = 'project' | 'global';
export interface Ref { scope: Scope; slug: string }

export function hubHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_PROJECTS_HUB_HOME || join(homedir(), '.claude-projects-hub');
}

export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.length <= 64 && SLUG_RE.test(slug) && !RESERVED_RE.test(slug);
}

export function parseRef(ref: unknown): Ref {
  const i = typeof ref === 'string' ? ref.indexOf(':') : -1;
  if (typeof ref !== 'string' || i < 0) throw new HubError('invalid_ref', 'ref attendue : project:<slug> ou global:<slug>');
  const scope = ref.slice(0, i);
  const slug = ref.slice(i + 1);
  if (scope !== 'project' && scope !== 'global') throw new HubError('invalid_ref', `portée inconnue : ${scope}`);
  if (!isValidSlug(slug)) throw new HubError('invalid_ref', `slug invalide : ${slug}`);
  return { scope, slug };
}

/** Directory of topics of a scope; `project` requires an already resolved project id. */
export function topicsDir(home: string, scope: Scope, projectId?: string): string {
  if (scope === 'global') return join(home, 'global', 'topics');
  if (!projectId || !/^[A-Za-z0-9-]+$/.test(projectId)) {
    throw new HubError('invalid_input', 'project: demande un identifiant de projet valide');
  }
  return join(home, 'projects', projectId, 'topics');
}

export function topicFile(home: string, ref: Ref, projectId?: string): string {
  return join(topicsDir(home, ref.scope, projectId), `${ref.slug}.md`);
}
