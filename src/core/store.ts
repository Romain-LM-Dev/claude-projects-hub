import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { parse, serialize, validate, type Frontmatter } from './frontmatter.ts';
import { withLock, writeFileAtomic } from './lock.ts';
import { HubError, isValidSlug, parseRef, topicFile, topicsDir, type Scope } from './paths.ts';
import { assertNoSecret } from './secrets.ts';

export const MAX_BODY = 20_000;
export const MAX_FILE = 50_000;
export const MAX_APPEND = 4_000;

/** `projectId` is the already resolved project id (T3); required only for `project:` refs. */
export interface StoreCtx { hubHome: string; projectId?: string }

export interface Topic {
  ref: string;
  title: string;
  summary: string;
  tags: string[];
  importedFrom?: string;
  body: string;
  mtimeMs: number;
  revision: string;
}

export type TopicEntry =
  | { ref: string; valid: true; title: string; summary: string; tags: string[]; mtimeMs: number; revision: string }
  | { ref: string; valid: false; error: string; mtimeMs: number };

export interface WriteInput {
  title: string;
  summary: string;
  body: string;
  tags?: string[];
  baseRevision?: string;
  /** Path of the imported auto-memory note (§4.2); kept from the previous file when omitted. */
  importedFrom?: string;
}

export const revisionOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex').slice(0, 12);

const lf = (s: string) => s.replace(/\r\n?/g, '\n');

async function readBytes(file: string): Promise<Buffer | null> {
  try { return await readFile(file); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new HubError('io', `lecture impossible : ${(e as Error).message}`);
  }
}

function locate(ctx: StoreCtx, ref: string) {
  const r = parseRef(ref);
  return topicFile(ctx.hubHome, r, ctx.projectId);
}

export async function readTopic(ctx: StoreCtx, ref: string): Promise<Topic> {
  const file = locate(ctx, ref);
  const bytes = await readBytes(file);
  if (!bytes) throw new HubError('not_found', `topic introuvable : ${ref}`);
  const { fm, body } = parse(bytes.toString('utf8'));
  const { mtimeMs } = await stat(file);
  return { ref, title: fm.title, summary: fm.summary, tags: fm.tags, importedFrom: fm.importedFrom, body, mtimeMs, revision: revisionOf(bytes) };
}

/** Invalid files are returned with `valid: false` (shown by the view, ignored by the index). Sorted by mtime desc. */
export async function listTopics(ctx: StoreCtx, scope: Scope | 'all' = 'all'): Promise<TopicEntry[]> {
  const scopes: Scope[] = scope === 'all' ? (ctx.projectId ? ['project', 'global'] : ['global']) : [scope];
  const out: TopicEntry[] = [];
  for (const s of scopes) {
    const dir = topicsDir(ctx.hubHome, s, ctx.projectId);
    let names: string[];
    try { names = await readdir(dir); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new HubError('io', `lecture impossible : ${(e as Error).message}`);
    }
    for (const n of names) {
      const slug = n.endsWith('.md') ? n.slice(0, -3) : '';
      if (!isValidSlug(slug)) continue;
      const ref = `${s}:${slug}`;
      const file = `${dir}/${n}`;
      try {
        const bytes = await readBytes(file);
        if (!bytes) continue;
        const { mtimeMs } = await stat(file);
        try {
          const { fm } = parse(bytes.toString('utf8'));
          out.push({ ref, valid: true, title: fm.title, summary: fm.summary, tags: fm.tags, mtimeMs, revision: revisionOf(bytes) });
        } catch (e) {
          if (!(e instanceof HubError)) throw e;
          out.push({ ref, valid: false, error: e.message, mtimeMs });
        }
      } catch (e) {
        if (!(e instanceof HubError) && (e as NodeJS.ErrnoException).code === 'ENOENT') continue; // removed meanwhile
        throw e;
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Absent + no baseRevision = create. Present: baseRevision required (`exists` otherwise) and equal to the
 * current revision (`conflict` carrying the current one otherwise). Unknown frontmatter keys are kept.
 */
export async function writeTopic(ctx: StoreCtx, ref: string, input: WriteInput): Promise<{ ref: string; revision: string; created: boolean }> {
  const file = locate(ctx, ref);
  const fm: Frontmatter = { title: input.title, summary: input.summary, tags: input.tags ?? [], importedFrom: input.importedFrom, extra: [] };
  validate(fm, 'invalid_input');
  const body = lf(input.body);
  if (body.length > MAX_BODY) throw new HubError('too_large', `corps limité à ${MAX_BODY} caractères`);
  assertNoSecret([fm.title, fm.summary, fm.tags.join(' '), fm.importedFrom ?? '', body].join('\n'));

  return withLock(file, async () => {
    const old = await readBytes(file);
    if (!old) {
      if (input.baseRevision !== undefined) throw new HubError('not_found', `topic introuvable : ${ref}`);
    } else {
      const { fm: prev } = parse(old.toString('utf8'));
      const current = revisionOf(old);
      if (input.baseRevision === undefined) throw new HubError('exists', `le topic existe déjà (révision ${current}) : passer baseRevision`, current);
      if (input.baseRevision !== current) throw new HubError('conflict', `révision courante ${current}`, current);
      fm.extra = prev.extra;
      fm.importedFrom ??= prev.importedFrom;
    }
    const content = Buffer.from(serialize(fm, body), 'utf8');
    await writeFileAtomic(file, content);
    return { ref, revision: revisionOf(content), created: !old };
  });
}

/** Appends `\n\n### <UTC date to the minute>\n<text>` under lock; never conflicts. */
export async function appendTopic(ctx: StoreCtx, ref: string, text: string): Promise<{ ref: string; revision: string }> {
  const file = locate(ctx, ref);
  const t = lf(text);
  if (t.trim() === '') throw new HubError('invalid_input', 'texte vide');
  if (t.length > MAX_APPEND) throw new HubError('too_large', `texte limité à ${MAX_APPEND} caractères`);
  assertNoSecret(t);

  return withLock(file, async () => {
    const old = await readBytes(file);
    if (!old) throw new HubError('not_found', `topic introuvable : ${ref}`);
    const prev = old.toString('utf8');
    parse(prev); // invalid_file: never rewritten
    const next = `${prev}\n\n### ${new Date().toISOString().slice(0, 16)}Z\n${t}`;
    if (next.length > MAX_FILE) throw new HubError('too_large', `fichier limité à ${MAX_FILE} caractères`);
    const content = Buffer.from(next, 'utf8');
    await writeFileAtomic(file, content);
    return { ref, revision: revisionOf(content) };
  });
}
