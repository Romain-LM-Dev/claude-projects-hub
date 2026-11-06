# Point de reprise (état au 2026-11-06)

## État
| Élément | État |
|---|---|
| Conception | faite : `docs/architecture.md`, ADR 0001 à 0006 (0003 révisé le 2026-11-06), `docs/plan.md` (T0 à T11) |
| Vague 1 : T0 socle | fait : `npm install`, `typecheck`, `build`, `test` -> code 0 ; `git init -b main` |
| Vague 1 : T0b équipe | fait : `CLAUDE.md`, `.claude/settings.json` (agent = orchestrateur), sept agents, frontmatter vérifié |
| Non lancés | `test:ext`, `probe`, `package` : déclarés, fichiers d'entrée `test/extension/run.ts` et `scripts/probe.ts` à créer par leurs propriétaires |
| Sorties du build | `dist/extension.js`, `claude-plugin/projects-hub/dist/hook.js`, `claude-plugin/projects-hub/dist/mcp.js` |

## Décisions de l'utilisateur
- Dépôt GitHub privé ; public après licence et première version stable (aucune licence pour l'instant).
- Marqueur `.claude/projects-hub.json` non versionné (`.git/info/exclude`), posé par le hook SessionStart dès la première session.
- Portée mémoire : projet + topics globaux.
- Publisher `romain-lm-dev`, displayName « Projects Hub for Claude Code ».
- Règle `mcp__plugin_projects-hub_hub` ajoutée à `~/.claude/settings.json` par l'agent global config-claude après T6 (préfixe vérifié), jamais par l'équipe.

## Prochaine vague (vague 2, voir « Ordre et parallélisme » de `docs/plan.md`)
| Tâche | Agent | Objet |
|---|---|---|
| T1 | dev-core | magasin |
| T2 | dev-core (2e instance) | lecture des données Claude |

Puis la suite du plan. Fin de chantier : qa-reviewer, puis documentaliste si une commande ou un contrat change.

## Points ouverts
| # | Sujet | Qui |
|---|---|---|
| a | ADR 0005 ligne 32 ne cite pas l'agent de configuration pour la règle de permission | architecte |
| b | typescript ^7.0.2 et @types/node ^26.6.6 non épinglés par l'ADR 0001 | architecte tranche |
| c | À confirmer en exécution : préfixe réel des outils MCP (T6), forme exec du hook (T6), `claude --resume` depuis un autre dossier (T9), propagation de `info/exclude` dans un worktree (T3) | agents des tâches |
| d | Conséquence acceptée : deux clones vivants = deux projets distincts (rattachement manuel) | - |

## Risques
- Format JSONL interne de Claude, changeant : sonde `npm run probe`.
- Topics globaux injectés dans tous les projets : confidentialité.
- Test lecture seule via icacls fragile en CI.
- Budget de 150 ms du hook à mesurer.

## Reprendre
1. Ouvrir le dossier `claude-projects-hub` dans VS Code.
2. Lancer une nouvelle session Claude : elle démarre en `orchestrateur`.
3. Lui demander de lancer la vague 2 (T1 et T2) avec un brief en cinq rubriques.