import { HubError, SLUG_RE, type ErrorCode } from './paths.ts';
import { l10n } from './l10n.ts';

export interface Frontmatter {
  title: string;
  summary: string;
  tags: string[];
  importedFrom?: string;
  /** Unknown keys, raw lines kept as-is on rewrite. */
  extra: string[];
}

const HEAD_RE = /^---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m;
const LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/;

/** Checks field constraints; `code` is invalid_file when reading, invalid_input when writing. */
export function validate(fm: Frontmatter, code: ErrorCode): void {
  const bad = (m: string): never => { throw new HubError(code, m); };
  if (fm.title.length < 1 || fm.title.length > 80 || /[\r\n]/.test(fm.title)) bad(l10n.t("title: 1 to 80 characters, one line"));
  if (fm.summary.length < 1 || fm.summary.length > 200 || /[\r\n]/.test(fm.summary)) bad(l10n.t("summary: 1 to 200 characters, one line"));
  if (fm.tags.length > 8) bad('tags : 8 maximum');
  if (fm.tags.some((t) => !SLUG_RE.test(t))) bad('tags : chacun au format slug');
  if (fm.importedFrom !== undefined && /[\r\n]/.test(fm.importedFrom)) bad('importedFrom : une ligne');
}

function quote(v: string): string {
  return /^[["']/.test(v) || v.includes(': ') || v !== v.trim()
    ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : v;
}

function unquote(v: string): string {
  if (!v.startsWith('"')) return v;
  if (!/^"(?:[^"\\]|\\["\\])*"$/.test(v)) throw new HubError('invalid_file', l10n.t("invalid quoted value: {0}", v));
  return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
}

export function parse(text: string): { fm: Frontmatter; body: string } {
  const m = HEAD_RE.exec(text);
  if (!m || m.index !== 0) throw new HubError('invalid_file', l10n.t("frontmatter missing or not closed"));
  const fm: Frontmatter = { title: '', summary: '', tags: [], extra: [] };
  const seen = new Set<string>();
  const lines = m[1].split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    const l = LINE_RE.exec(line);
    if (!l) throw new HubError('invalid_file', l10n.t("invalid frontmatter line: {0}", line));
    const [, key, raw = ''] = l;
    if (seen.has(key)) throw new HubError('invalid_file', l10n.t("duplicate key: {0}", key));
    seen.add(key);
    if (key === 'title') fm.title = unquote(raw);
    else if (key === 'summary') fm.summary = unquote(raw);
    else if (key === 'importedFrom') fm.importedFrom = unquote(raw);
    else if (key === 'tags') {
      const t = /^\[(.*)\]$/.exec(raw);
      if (!t) throw new HubError('invalid_file', l10n.t("tags: inline list [a, b] expected"));
      fm.tags = t[1].trim() === '' ? [] : t[1].split(',').map((s) => s.trim());
    } else fm.extra.push(line);
  }
  validate(fm, 'invalid_file');
  return { fm, body: text.slice(m[0].length) };
}

export function serialize(fm: Frontmatter, body: string): string {
  const lines = [`title: ${quote(fm.title)}`, `summary: ${quote(fm.summary)}`];
  if (fm.tags.length) lines.push(`tags: [${fm.tags.join(', ')}]`);
  if (fm.importedFrom !== undefined) lines.push(`importedFrom: ${quote(fm.importedFrom)}`);
  lines.push(...fm.extra);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
