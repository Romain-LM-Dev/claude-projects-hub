import { HubError } from './paths.ts';

// Closed list (architecture §4.4); does not claim to detect everything.
export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'github-pat', re: /github_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

/** Name of the first matching pattern, or null. */
export function findSecret(text: string): string | null {
  return SECRET_PATTERNS.find((p) => p.re.test(text))?.name ?? null;
}

export function assertNoSecret(text: string): void {
  const name = findSecret(text);
  if (name) throw new HubError('secret_detected', `secret probable détecté (${name}) : texte refusé`);
}
