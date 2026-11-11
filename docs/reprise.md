# Point de reprise (état au 2026-11-11)

## État
| Élément | État |
|---|---|
| Conception | faite : `docs/architecture.md`, ADR 0001 à 0006 (0003 révisé le 2026-11-06), `docs/plan.md` (T0 à T11) |
| Vague 1 : T0 socle | fait : `npm install`, `typecheck`, `build`, `test` -> code 0 ; `git init -b main` |
| Vague 1 : T0b équipe | fait : `CLAUDE.md`, `.claude/settings.json` (agent = orchestrateur), sept agents, frontmatter vérifié |
| Vague 2 : T1 magasin | fait, commit `4d3ad81` (branche `feat/noyau`) : `src/core/{paths,frontmatter,lock,store,secrets}.ts` + tests |
| Vague 2 : T2 données Claude | fait, commit `4d3ad81` : `src/core/{transcript,claudeData,sessionCache,automemory}.ts` + tests, `test/fixtures/claude-home/`, `scripts/probe.ts` |
| Vague 3 : T3 identité | fait (branche `feat/noyau`) : `src/core/{git,registry,identity,relocate}.ts` + tests, `test/fixtures/kit.ts` ; `claudeHome(env)` ajouté à `paths.ts` et utilisé par la sonde |
| Vérifié 2026-11-11 | `npm test` -> 56/56, 0 skip, code 0 ; `npm run typecheck` -> code 0 ; `npm run probe` -> 15 dossiers Claude, 13 projets, 72 sessions, 279 sous-agents, 0 ligne illisible, 18,80 Mo lus, froid 487 ms, cache 18 ms |
| Non lancés | `test:ext`, `package` : déclarés, `test/extension/run.ts` à créer par dev-vscode |
| Sorties du build | `dist/extension.js`, `claude-plugin/projects-hub/dist/hook.js`, `claude-plugin/projects-hub/dist/mcp.js` |

## Décisions de l'utilisateur
- Dépôt GitHub privé ; public après licence et première version stable (aucune licence pour l'instant).
- Marqueur `.claude/projects-hub.json` non versionné (`.git/info/exclude`), posé par le hook SessionStart dès la première session.
- Portée mémoire : projet + topics globaux.
- Publisher `romain-lm-dev`, displayName « Projects Hub for Claude Code ».
- Règle `mcp__plugin_projects-hub_hub` ajoutée à `~/.claude/settings.json` par l'agent global config-claude après T6 (préfixe vérifié), jamais par l'équipe.

## Prochaine vague (vague 4, voir « Ordre et parallélisme » de `docs/plan.md`)
| Tâche | Agent | Objet |
|---|---|---|
| T4 | dev-claude | hook SessionStart (`ensureProject(dir, {hubHome, git:false, lockTimeoutMs:500, log})`, puis `buildInjection`) |
| T5 | dev-claude (2e instance) | serveur MCP (`resolveProject`, store, `ensureProject(..., {git:true})` avant une écriture `project:`) |
| T7 | dev-vscode | vues, sessions, topics (`scanClaudeData`, `renderSessionPage`, store) |

Avant la vague 4 : l'architecte tranche les points e, g et j (ils touchent les contrats utilisés par T4, T5, T7).

Puis la suite du plan. Session lancée depuis le dossier parent : les agents du projet ne sont pas chargés ;
lancer la session dans `claude-projects-hub` (ou déléguer à `team-for-every-project:developpeur` avec les règles
de l'agent du projet dans le brief). Fin de chantier : qa-reviewer, puis documentaliste si une commande ou un contrat change.

## Points ouverts
| # | Sujet | Qui |
|---|---|---|
| a | ADR 0005 ligne 32 ne cite pas l'agent de configuration pour la règle de permission | architecte |
| b | typescript ^7.0.2 et @types/node ^26.6.6 non épinglés par l'ADR 0001 | architecte tranche |
| c | À confirmer en exécution : préfixe réel des outils MCP (T6), forme exec du hook (T6), `claude --resume` depuis un autre dossier (T9), propagation de `info/exclude` dans un worktree (T3) | agents des tâches |
| d | Conséquence acceptée : deux clones vivants = deux projets distincts (rattachement manuel) | - |
| e | Choix de T1 hors contrat : `project:` sans id de projet -> `invalid_input` ; `baseRevision` sur topic absent -> `not_found` ; date d'ajout `YYYY-MM-DDTHH:MMZ` | architecte valide |
| f | Réglé le 2026-11-11 : titre personnalisé = `{"type":"custom-title","customTitle":…,"sessionId":…}`, observé après `/rename` et lu par la sonde (`"custom":1`) | - |
| g | Budget « < 20 Mo lus » fixé pour 38 sessions ; à 72 sessions on lit 18,80 Mo : le reformuler par session (≈ 320 Kio max) | architecte |
| h | Avertissement Node `MODULE_TYPELESS_PACKAGE_JSON` à chaque test ; ne PAS ajouter `"type": "module"` sans passer les bundles CJS en `.cjs` (casserait `dist/extension.js`) | dev-vscode, architecte |
| i | Course possible si deux processus reprennent le même verrou périmé (> 10 s) : accepté, commentaire `shortcut` dans `lock.ts` | - |
| j | Écarts de T3 au §7 : (1) « Ignorer l'orphelin » stocké en mettant l'id de l'orphelin dans son propre `dismissed` (aucun champ prévu) ; (2) marqueur trouvé dans un parent sans `.git` -> racine = dossier du marqueur (§7.3 dit « sinon dir ») ; (3) `ensureProject` ne retire pas un chemin disparu (le scan le fait) ; (4) un `.bak` par passage de `reconcile`, Annuler défait toutes les fusions du passage ; (5) `copyAutoMemory` ne lit que `claudeHome/settings.json` pour `autoMemoryDirectory`, casse `C-`/`c-` de la cible non gérée ; (6) empreintes calculées hors verrou : un projet créé pendant le scan attend le scan suivant | architecte tranche |

## Risques
- Format JSONL interne de Claude, changeant : sonde `npm run probe`.
- Topics globaux injectés dans tous les projets : confidentialité.
- Test lecture seule via icacls fragile en CI.
- Budget de 150 ms du hook à mesurer.

## Reprendre
1. Ouvrir le dossier `claude-projects-hub` dans VS Code.
2. Lancer une nouvelle session Claude : elle démarre en `orchestrateur`.
3. Lui demander de lancer la vague 2 (T1 et T2) avec un brief en cinq rubriques.