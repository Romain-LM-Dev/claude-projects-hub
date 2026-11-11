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

/** `project` is a display name, or one of the two fixed states below. */
export const PROJECT_UNREGISTERED = 'non enregistré (le premier topic project: le crée)';
export const PROJECT_NONE = 'aucun (dossier temporaire ou personnel, topics global: seulement)';
export const projectLabel = (name: string) => `«${name}»`;

export function buildHeader(project: string): string {
  const t = (n: string) => `${TOOL_PREFIX}${n}`;
  return `## Mémoire partagée (projects-hub)\n` +
    `Topics partagés entre sessions. Projet : ${project}. Lire : ${t('memory_read')} {ref}. Créer ou remplacer : …memory_write ; ajouter : …memory_append ; lister : …memory_list. ` +
    `Écris un topic quand une décision, une convention ou l'état d'un chantier doit survivre à la session ; global = utile à tous les projets, sans secret ni donnée client.`;
}

/** Pure: header, then project lines, then global lines, as many as fit in `budget` (footer counted). */
export function buildInjection(header: string, projectTopics: TopicLine[], globalTopics: TopicLine[], budget: number): string {
  const all = [...projectTopics.map((t) => [0, t] as const), ...globalTopics.map((t) => [1, t] as const)];
  const render = (n: number) => {
    const parts = [header];
    for (const s of [0, 1] as const) {
      const lines = all.slice(0, n).filter(([k]) => k === s).map(([, t]) => formatTopicLine(t));
      if (lines.length) parts.push(s ? '### Global' : '### Projet', ...lines);
    }
    const rest = all.length - n;
    if (rest > 0) parts.push(`… ${rest} autres topics : memory_list`);
    return parts.join('\n');
  };
  let n = 0;
  while (n < all.length && render(n + 1).length <= budget) n++;
  return render(n);
}
