import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MemoryNote {
  file: string;
  name?: string;
  description?: string;
  type?: string;
  body: string;
}
export interface AutoMemory {
  index?: string; // contenu de MEMORY.md
  notes: MemoryNote[];
}

/** Frontmatter `---` : clés à plat ou sous `metadata:` (indentées). Les clés à plat l'emportent. */
export function parseNote(file: string, text: string): MemoryNote {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { file, body: text };
  const flat: Record<string, string> = {};
  const nested: Record<string, string> = {};
  let inMeta = false;
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(\s*)([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const indented = kv[1]!.length > 0;
    let v = kv[3]!.trim();
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (!indented) {
      inMeta = kv[2] === 'metadata';
      if (!inMeta) flat[kv[2]!] = v;
    } else if (inMeta) nested[kv[2]!] = v;
  }
  const get = (k: string) => flat[k] ?? nested[k];
  return { file, name: get('name'), description: get('description'), type: get('type'), body: m[2]! };
}

/** Lit `<claudeDir>/memory/` ; dossier absent = mémoire vide. */
export async function readAutoMemory(memoryDir: string): Promise<AutoMemory> {
  let names: string[];
  try {
    names = await readdir(memoryDir);
  } catch {
    return { notes: [] };
  }
  const out: AutoMemory = { notes: [] };
  for (const n of names.filter((x) => x.endsWith('.md')).sort()) {
    const text = await readFile(join(memoryDir, n), 'utf8');
    if (n === 'MEMORY.md') out.index = text;
    else out.notes.push(parseNote(join(memoryDir, n), text));
  }
  return out;
}
