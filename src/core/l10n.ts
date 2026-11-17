import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import fr from '../../l10n/bundle.l10n.fr.json' with { type: 'json' };
import { writeFileAtomic } from './lock.ts';

export type Lang = 'en' | 'fr';

let lang: Lang = 'en';

/** Any French tag (`fr`, `fr-FR`, as `vscode.env.language` gives it) → fr; everything else → en. */
export const toLang = (tag: unknown): Lang => (typeof tag === 'string' && tag.toLowerCase().startsWith('fr') ? 'fr' : 'en');

/** Process-wide: set once at start by the extension, the hook and the MCP server. */
export function setLanguage(l: Lang): void { lang = l; }

/**
 * Same contract as `vscode.l10n.t` (English literal as key, `{n}` placeholders) over the extension's French bundle,
 * so the core, the hook and the MCP server share one translation file with the extension.
 */
export const l10n = {
  t(message: string, ...args: Array<string | number | boolean>): string {
    const s = lang === 'fr' ? (fr as Record<string, string>)[message] ?? message : message;
    return s.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m));
  },
};

/** `HUB_HOME/settings.json`: the VS Code display language, written by the extension for the hook and the MCP server. */
export const settingsFile = (hubHome: string) => join(hubHome, 'settings.json');

/** Sync on purpose (hook start-up); missing or unreadable file → en. */
export function readLanguage(hubHome: string): Lang {
  try { return toLang((JSON.parse(readFileSync(settingsFile(hubHome), 'utf8')) as { language?: unknown }).language); } catch { return 'en'; }
}

/** Writes only on change, so each VS Code window opening does not rewrite the file. */
export async function writeLanguage(hubHome: string, l: Lang): Promise<void> {
  const text = JSON.stringify({ language: l }) + '\n';
  try { if (readFileSync(settingsFile(hubHome), 'utf8') === text) return; } catch { /* absent: write it */ }
  await mkdir(hubHome, { recursive: true });
  await writeFileAtomic(settingsFile(hubHome), text);
}
