import { readFileSync } from 'node:fs';
import { setLanguage } from '../../src/core/l10n.ts';

const fr: Record<string, string> = JSON.parse(readFileSync(new URL('../../l10n/bundle.l10n.fr.json', import.meta.url), 'utf8'));

/** `vscode.l10n` stand-in that renders the French bundle: extension tests keep French assertions and fail on a missing key. */
export const l10nFr = {
  t(message: string, ...args: unknown[]): string {
    const s = fr[message];
    if (s === undefined) throw new Error(`missing French translation: ${JSON.stringify(message)}`);
    return s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)]));
  },
};
(globalThis as any).__l10nFr = l10nFr;
setLanguage('fr'); // core messages too, as with VS Code in French
