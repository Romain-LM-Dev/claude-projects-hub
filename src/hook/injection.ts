import { l10n } from '../core/l10n.ts';

export const TOOL_PREFIX = 'mcp__plugin_projects-hub_hub__';
export const HOOK_BUDGET = 4000;
const MAX_LINE = 180;

export interface TopicLine { ref: string; title: string; summary: string; tags?: string[]; mtimeMs: number }

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const pad = (n: number) => String(n).padStart(2, '0');
/** AAAA-MM-JJ in local time (§6.3), the date the user sees elsewhere. */
const localDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** `- <ref> — <title> : <summary> [<tags>] (<AAAA-MM-JJ>)`, cut at 180 characters with `…`. */
export function formatTopicLine(t: TopicLine): string {
  const tags = t.tags?.length ? ` [${t.tags.map(flat).join(', ')}]` : '';
  const line = `- ${t.ref} — ${flat(t.title)} : ${flat(t.summary)}${tags} (${localDate(t.mtimeMs)})`;
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1) + '…' : line;
}

/** `project` is a display name, or one of the two fixed states below (functions: the language is set at start-up). */
export const projectUnregistered = () => l10n.t("not registered (the first project: topic creates it)");
export const projectNone = () => l10n.t("none (temporary or personal folder, global: topics only)");
export const projectLabel = (name: string) => l10n.t("“{0}”", name);

export function buildHeader(project: string): string {
  return l10n.t("## Shared memory (projects-hub)\nTopics shared between sessions. Project: {0}. Read: {1} {ref}. Create or replace: …memory_write; append: …memory_append; list: …memory_list. Write a topic when a decision, a convention or the state of a piece of work must outlive the session; global = useful to every project, no secrets or client data.",
    project, `${TOOL_PREFIX}memory_read`);
}

/** Pure: header, then project lines, then global lines, as many as fit in `budget` (footer counted). */
export function buildInjection(header: string, projectTopics: TopicLine[], globalTopics: TopicLine[], budget: number): string {
  const all = [...projectTopics.map((t) => [0, t] as const), ...globalTopics.map((t) => [1, t] as const)];
  const render = (n: number) => {
    const parts = [header];
    for (const s of [0, 1] as const) {
      const lines = all.slice(0, n).filter(([k]) => k === s).map(([, t]) => formatTopicLine(t));
      if (lines.length) parts.push(s ? '### Global' : l10n.t("### Project"), ...lines);
    }
    const rest = all.length - n;
    if (rest > 0) parts.push(l10n.t("… {0} more topics: memory_list", rest));
    return parts.join('\n');
  };
  let n = 0;
  while (n < all.length && render(n + 1).length <= budget) n++;
  return render(n);
}
