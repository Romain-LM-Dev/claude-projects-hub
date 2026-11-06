# projects-hub (« Projects Hub for Claude Code »)

Extension VS Code (publisher `romain-lm-dev`) et plugin Claude Code : mémoire de topics partagée entre les projets,
serveur MCP `hub`, hook SessionStart. Dépôt GitHub privé ; **aucune licence pour l'instant** (public plus tard,
après licence et première version stable). Windows 11, PowerShell 5.1, node 24, TypeScript.

## Commandes (depuis la racine, après T0)
| Commande | Rôle |
|---|---|
| `npm install` | dépendances (ADR 0001) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | esbuild : extension, hook, serveur MCP |
| `npm test` | `node --test "src/**/*.test.ts"` |
| `npm run test:ext` | tests de l'extension |
| `npm run probe` | sonde en lecture seule du vrai `CLAUDE_HOME` |
| `npm run package` | `.vsix` |

## Agents (.claude/agents)
La session principale tourne en `orchestrateur` (réglage `agent` de .claude/settings.json) : il délègue, contrôle et
rend un bilan, sans outil d'édition ni shell.

| Agent | Modèle | Possède | À lui pour |
|---|---|---|---|
| orchestrateur | session | rien | découper, déléguer, contrôler |
| architecte | opus | `docs/architecture.md`, `docs/decisions/` | contrats, ADR, arbitrages |
| dev-core | sonnet | `src/core/`, `test/fixtures/`, `scripts/probe.ts` | magasin, verrous, registre, identité, données Claude |
| dev-claude | sonnet | `src/hook/`, `src/mcp/`, `claude-plugin/`, `scripts/e2e-claude.ps1` | hook, serveur MCP, plugin, essais en session |
| dev-vscode | sonnet | `src/extension/`, `test/extension/`, `package.json`, `package-lock.json`, `tsconfig.json`, `esbuild.mjs`, `.gitignore`, `.vscodeignore` | extension, build, `.vsix` |
| qa-reviewer | sonnet | tests manquants | relecture contre les contrats, bout en bout |
| documentaliste | sonnet | `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `.claude/` | doc utilisateur, règles et agents |

## Règles
- Un fichier = un propriétaire ; parallèle seulement sur fichiers disjoints ; chacun écrit les tests de son code.
- Brief de délégation en cinq rubriques : objectif, contexte, périmètre, critère de fin, compte rendu.
- Compte rendu de 15 lignes au plus avec la sortie réelle des commandes ; jamais « terminé » sans elle.
- Fin de chantier : `qa-reviewer`, puis `documentaliste` si une commande ou un contrat a changé. Jamais `general-purpose`.
- Contrats dans `docs/architecture.md` ; toute dépendance hors ADR 0001 ou écart : retour à l'architecte.
- TypeScript effaçable seulement (`erasableSyntaxOnly`), imports relatifs en `.ts` ; fonctions de `src/core` avec
  racines (`CLAUDE_HOME`, `HUB_HOME`) en paramètre ; `.ps1` en UTF-8 avec BOM.
- Ne jamais écrire dans `~/.claude` hors architecture §7.5. La règle `mcp__plugin_projects-hub_hub` est ajoutée
  à `~/.claude/settings.json` par l'agent global config-claude après T6, jamais par l'équipe.
- Code et identifiants en anglais ; docs et interface en français.

## À lire en premier
`docs/reprise.md` (point de reprise), `docs/plan.md` (tâches, vagues), `docs/architecture.md`
(contrats), `docs/decisions/`.
