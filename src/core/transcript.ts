import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type TitleSource = 'custom' | 'ai' | 'last-prompt' | 'first-prompt' | 'none';

export interface SubagentInfo {
  id: string;
  agentType?: string;
  description?: string;
}

export interface SessionSummary {
  sessionId: string;
  claudeDir: string;
  file: string;
  sizeBytes: number;
  mtimeMs: number;
  cwd: string;
  gitBranch?: string;
  version?: string;
  entrypoint?: string;
  startedAt?: string;
  endedAt?: string;
  title: string;
  titleSource: TitleSource;
  costUsd?: number;
  subagents: SubagentInfo[];
  live?: { status?: string };
  parseErrors: number;
}

/** Mesures facultatives pour la sonde : histogramme des types de ligne et octets lus. */
export interface ScanStats {
  types: Record<string, number>;
  bytesRead: number;
}

export const HEAD_BLOCK = 64 * 1024;
export const HEAD_MAX = 4 * 1024 * 1024;
export const TAIL_SIZE = 256 * 1024;
const TITLE_MAX = 120;

type Obj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const oneLine = (s: string, n = TITLE_MAX) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** Lignes complètes d'un tampon (avec leur décalage absolu) et nombre d'octets consommés. */
function completeLines(buf: Buffer, base: number): { lines: { text: string; offset: number }[]; used: number } {
  const lines: { text: string; offset: number }[] = [];
  let start = 0;
  for (let nl = buf.indexOf(10, start); nl !== -1; nl = buf.indexOf(10, start)) {
    lines.push({ text: buf.toString('utf8', start, nl), offset: base + start });
    start = nl + 1;
  }
  return { lines, used: start };
}

/** undefined = ligne vide, null = illisible (non JSON ou pas un objet). */
function parseLine(text: string, stats?: ScanStats): Obj | undefined | null {
  if (!text.trim()) return undefined;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
  if (stats) {
    const t = typeof (o as Obj).type === 'string' ? ((o as Obj).type as string) : '(sans type)';
    stats.types[t] = (stats.types[t] ?? 0) + 1;
  }
  return o as Obj;
}

function userText(o: Obj): string | undefined {
  if (o.type !== 'user' || o.isMeta) return undefined;
  const c = (o.message as Obj | undefined)?.content;
  const t =
    typeof c === 'string' ? c : Array.isArray(c) ? str((c.find((b) => (b as Obj)?.type === 'text') as Obj | undefined)?.text) : undefined;
  return t && !t.trimStart().startsWith('<') ? oneLine(t) : undefined;
}

/** Résumé d'un transcript : tête (jusqu'au cwd) + queue, jamais de lecture complète. */
export async function summarizeTranscript(
  file: string,
  claudeDir: string,
  sessionId: string,
  size: number,
  mtimeMs: number,
  stats?: ScanStats,
): Promise<SessionSummary> {
  const s: SessionSummary = {
    sessionId, claudeDir, file, sizeBytes: size, mtimeMs, cwd: '', title: '', titleSource: 'none', subagents: [], parseErrors: 0,
  };
  let firstPrompt: string | undefined;
  let custom: string | undefined, ai: string | undefined, last: string | undefined;
  const head = (o: Obj) => {
    s.cwd ||= str(o.cwd) ?? '';
    s.gitBranch ??= str(o.gitBranch);
    s.version ??= str(o.version);
    s.entrypoint ??= str(o.entrypoint);
    s.startedAt ??= str(o.timestamp);
    firstPrompt ??= userText(o);
  };
  const fh = await open(file, 'r');
  try {
    // Tête : blocs de 64 Kio jusqu'au cwd (4 Mio max)
    let pending: Buffer = Buffer.alloc(0);
    let pos = 0;
    let headEnd = 0;
    while (pos < size && pos < HEAD_MAX) {
      const chunk = Buffer.alloc(Math.min(HEAD_BLOCK, size - pos));
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
      if (!bytesRead) break;
      if (stats) stats.bytesRead += bytesRead;
      pos += bytesRead;
      pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
      const { lines, used } = completeLines(pending, headEnd);
      for (const { text } of lines) {
        const o = parseLine(text, stats);
        if (o === null) s.parseErrors++;
        else if (o && o.isSidechain !== true) head(o);
      }
      pending = pending.subarray(used);
      headEnd += used;
      if (s.cwd && (firstPrompt || pos >= HEAD_BLOCK)) break;
    }
    // Queue : 256 Kio de fin, première ligne partielle ignorée ; lignes déjà vues en tête non recomptées
    const tailStart = Math.max(0, size - TAIL_SIZE);
    const raw = Buffer.alloc(size - tailStart);
    const { bytesRead } = await fh.read(raw, 0, raw.length, tailStart);
    if (stats) stats.bytesRead += bytesRead;
    let buf = raw.subarray(0, bytesRead);
    let base = tailStart;
    if (tailStart > 0) {
      const nl = buf.indexOf(10);
      const skip = nl === -1 ? buf.length : nl + 1;
      buf = buf.subarray(skip);
      base += skip;
    }
    const { lines, used } = completeLines(buf, base);
    if (used < buf.length) lines.push({ text: buf.toString('utf8', used), offset: base + used }); // dernière ligne sans \n
    for (const { text, offset } of lines) {
      const fresh = offset >= headEnd;
      const o = parseLine(text, fresh ? stats : undefined);
      if (o === null) {
        if (fresh) s.parseErrors++;
        continue;
      }
      if (!o || o.isSidechain === true) continue;
      if (!s.cwd) head(o); // petit fichier dont la tête s'est arrêtée sans cwd
      switch (o.type) {
        case 'custom-title': custom = str(o.customTitle) ?? custom; break;
        case 'ai-title': ai = str(o.aiTitle) ?? ai; break;
        case 'last-prompt': last = str(o.lastPrompt) ?? last; break;
        case 'cost-state': if (typeof o.totalCostUSD === 'number') s.costUsd = o.totalCostUSD; break;
      }
      s.endedAt = str(o.timestamp) ?? s.endedAt;
    }
  } finally {
    await fh.close();
  }
  const pick: [string | undefined, TitleSource][] = [[custom, 'custom'], [ai, 'ai'], [last, 'last-prompt'], [firstPrompt, 'first-prompt']];
  for (const [t, src] of pick) {
    if (t) {
      s.title = oneLine(t);
      s.titleSource = src;
      break;
    }
  }
  return s;
}

// ---- Document de session (lecture complète, paginée, en flux) ----

export const PAGE_SIZE = 200;
const TOOL_INPUT_MAX = 300;
const TOOL_RESULT_MAX = 1500;

/** Bloc de code clôturé dont la clôture est plus longue que toute suite de backticks du texte. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}text\n${text}\n${f}`;
}
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [coupé]` : s);

function renderEntry(o: Obj): string | undefined {
  if (o.type !== 'user' && o.type !== 'assistant') return undefined;
  const c = (o.message as Obj | undefined)?.content;
  const blocks: unknown[] = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
  const parts: string[] = [];
  for (const b of blocks as Obj[]) {
    if (b?.type === 'text' && str(b.text)) parts.push(fence(b.text as string));
    else if (b?.type === 'tool_use') parts.push(fence(`${String(b.name)} ${cut(JSON.stringify(b.input ?? {}), TOOL_INPUT_MAX)}`));
    else if (b?.type === 'tool_result') {
      const r = b.content;
      const t = typeof r === 'string' ? r : Array.isArray(r) ? r.map((x) => str((x as Obj)?.text) ?? '').join('\n') : '';
      parts.push(fence(`[résultat] ${cut(t, TOOL_RESULT_MAX)}`));
    } // thinking, attachment et blocs inconnus : omis
  }
  return parts.length ? `### ${o.type}\n\n${parts.join('\n\n')}` : undefined;
}

export interface SessionPage {
  markdown: string;
  page: number;
  hasNext: boolean;
}

/** Page N (à partir de 1) du document Markdown d'un transcript, lu en flux. */
export async function renderSessionPage(file: string, page: number, pageSize = PAGE_SIZE): Promise<SessionPage> {
  const first = (page - 1) * pageSize;
  const out: string[] = [];
  let n = 0;
  let hasNext = false;
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      let o: unknown;
      try { o = JSON.parse(line); } catch { continue; }
      if (typeof o !== 'object' || o === null) continue;
      const md = renderEntry(o as Obj);
      if (!md) continue;
      if (n >= first + pageSize) { hasNext = true; break; }
      if (n >= first) out.push(md);
      n++;
    }
  } finally {
    rl.close();
  }
  if (hasNext) out.push(`[page suivante](?page=${page + 1})`);
  return { markdown: out.join('\n\n'), page, hasNext };
}
