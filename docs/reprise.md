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
- Dépôt GitHub rendu public le 2026-11-11 avec la licence source-available non commerciale de l'utilisateur
  (`LICENSE.md`, identique à celle de ses autres projets Claude). Historique réécrit avant publication (e-mail
  d'auteur remplacé par l'adresse noreply GitHub, pseudo d'un tiers retiré des exemples) : les identifiants de
  commits cités dans ce fichier et dans `docs/recette-t11.md` sont antérieurs à la réécriture et ne sont plus valides.
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

Contrats tranchés par l'architecte le 2026-11-11 (§14 Révisions, non commité). Correctif j4/j6 fait.
T4 fait (non commité) : `src/hook/{injection,main}.ts` + tests, `test/fixtures/hook-input.json` ; vérifié :
`node --test src/hook/*.test.ts` -> 12/12, code 0 ; hook bundlé sur la fixture -> JSON valide, 453 car. ; durée
mesurée par l'agent +31 à +71 ms au-delà de `node -e ""` (cible 150). Le hook retire le BOM que PowerShell 5.1
ajoute sur stdin.
T5 fait (non commité) : `src/mcp/{tools,main}.ts` + `tools.test.ts` ; vérifié : `node --test src/mcp/*.test.ts` ->
7/7, code 0 ; bundle `mcp.js` sur stdio -> `initialize` (protocole 2025-06-18) puis `tools/list` = 4 outils
(`memory_list`, `memory_read`, `memory_write`, `memory_append`).
T7 fait (non commité) : `src/extension/{extension,tree,sessionDocument,topicCommands,resume,diagnostics}.ts`,
`test/extension/{run,suite}.ts`, `package.json` (`contributes`, flag du point h), `esbuild.mjs` (entrée
`dist/test-suite.js`), `.vscode/launch.json` (ajouté par l'orchestrateur pour F5). Vérifié le 2026-11-11 par
l'orchestrateur : `npm test` -> 77/77, code 0, sans `MODULE_TYPELESS_PACKAGE_JSON` ; `npm run typecheck` -> 0 ;
`npm run build` -> 4 bundles ; `npm run test:ext` -> code 0 (VS Code 1.146.0), et code non nul avec une assertion
volontairement cassée (test négatif) ; plus grosse session réelle 142 Mo, page 1 en 22 ms (mesure de l'agent).
Reste de T7 : essai manuel F5 par l'utilisateur (`npm run build`, F5 « Extension », icône « Claude Hub »,
ouvrir la plus grosse session, « Claude Hub: Diagnostic », relever « document … page 1 : N ms »).

## Vague 5 (lancée le 2026-11-11, après les commits `ae1e6da` à `553ff2d` ; `injectionFor` extrait dans `src/hook/context.ts` pour l'aperçu)
| Tâche | Agent | Objet |
|---|---|---|
| T6 | dev-claude | plugin, `claude plugin validate`, `scripts/e2e-claude.ps1` (vraies sessions `claude -p`), préfixe réel des outils |
| T8 | dev-vscode | nœuds « À rattacher »/« Orphelins », Rattacher/Détacher/Copier l'auto-mémoire/Rafraîchir les empreintes, Aperçu de l'injection |

T6 fait (non commité) : `claude-plugin/` (marketplace `projects-hub-local`, plugin `projects-hub` : `plugin.json`,
`hooks/hooks.json`, `.mcp.json`), `scripts/e2e-claude.ps1`. Préfixe réel relevé : `mcp__plugin_projects-hub_hub__`
(= `TOOL_PREFIX`). Vérifié par l'orchestrateur : `claude plugin validate` plugin et marketplace -> « Validation
passed ». E2E (sortie de l'agent, 4 `claude -p` au total) : mot témoin cité dans la réponse finale, `essai.md` écrit
avec `title`/`summary` ; SessionStart part bien en `-p`.
Règle `mcp__plugin_projects-hub_hub` ajoutée à `~/.claude/settings.json` par config-claude le 2026-11-11 avec
l'accord de l'utilisateur (sauvegarde `settings.json.bak-20261111`) ; vérifié : JSON valide, règle présente 1 fois.
T8 fait (non commité) : `src/extension/{relocation,preview}.ts`, `tree.ts`, `extension.ts`, `package.json`,
`test/extension/`. Défaut trouvé (point o) : Annuler n'était pas durable ; corrigé.

## Vague 6 : T9 · dev-vscode
Partie code faite (`src/extension/install.ts`, commandes `installIntegration` / `removeIntegration`, champ
`repository`) ; vérifié par l'orchestrateur le 2026-11-11 : `npm test` 79/79, `test:ext` code 0 (installation testée
avec un exécuteur injecté, jamais le vrai `claude`), `npm run package` -> `claude-projects-hub-0.0.1.vsix` 162 074
octets, 11 fichiers (extension + plugin, ni `src/`, ni `test/`, ni `dist/test-suite.js`). Reste, avec l'accord de
l'utilisateur : installation réelle (`code --install-extension`, recharger, « Claude Hub: Installer l'intégration
Claude », `claude plugin list --json`), question « Quels topics de mémoire partagée vois-tu ? » dans une nouvelle
session, `claude --resume` d'une session orpheline rattachée ; message réel de `claude` pour « déjà installé » à
relever (supposé contenir « already »).
T10 fait et commité (`658b65e`) : README FR/EN, CHANGELOG 0.1.0 ; 18 commandes citées dans les deux README (contrôle
relancé par l'orchestrateur : 0 manquant). Écart connu : `package.json` 0.0.1, plugin 0.1.0.
Installation réelle, étape 1 faite le 2026-11-11 avec l'accord de l'utilisateur : `code --install-extension` ->
code 0, `romain-lm-dev.claude-projects-hub@0.0.1` listée (`.vsix` 160,7 Ko, 12 fichiers). Étape 2 (utilisateur) :
recharger la fenêtre, « Claude Hub: Installer l'intégration Claude » ; puis contrôle `claude plugin list --json`.
Étape 2 faite par l'utilisateur ; vérifié par l'orchestrateur : `projects-hub@projects-hub-local` 0.1.0, `enabled`,
`readFromFolder` = `~/.claude-projects-hub/marketplace/projects-hub`. Session réelle `claude -p` dans ce dépôt :
Claude cite le projet « claude-projects-hub » et 0 topic ; marqueur posé, ligne dans `.git/info/exclude`,
`git status` sans le marqueur, entrée au registre réel, `hook.log` vide. Reste : la même question dans le panneau
Claude de VS Code (utilisateur), `claude --resume` d'une session orpheline rattachée (T11).

## Vague 7 : T11 (2026-11-11)
qa-reviewer (sonnet) : commandes, tests du point p (`src/extension/relocation.test.ts`), scénario réel A/B/resume
(`docs/recette-t11.md`). Second relecteur (opus, lecture seule) : 9 défauts, aucun en traversée, injection ou secrets.
Corrigés (contrat §7.3, §7.4, §14 « T11 ») : Annuler d'un passage à plusieurs fusions (`undoMerge(hub, records[])`),
orphelin doublon, chemin complet des notes d'auto-mémoire, Détacher refusé hors racine, fusion défaite si un
déplacement échoue, verrou sur le topic cible, `info/exclude` seulement si `G/HEAD` existe, marqueur d'un parent
seulement dans un dépôt git, secrets de `importedFrom` ; extension : vue robuste à un registre illisible, id de
reprise = UUID, un seul Annuler ; verrou : EPERM/EACCES de Windows attendus comme EEXIST, délai toujours appliqué.
Preuves : nouveaux tests rouges sur `658b65e`, verts après ; `npm test` 97/97 deux fois ; typecheck, build,
`test:ext` code 0. `package.json` passe en 0.1.0 (la marketplace n'est recopiée qu'à un changement de version).
Limite acceptée : projet enregistré par le hook puis déplacé sans marqueur avant tout scan -> « Orphelins ».
Hub réel nettoyé avec l'accord de l'utilisateur : 2 entrées QA retirées du registre sous verrou (sauvegarde
`registry.json.before-qa-cleanup`), 3 dossiers `*projects-hub-qa*` mis à la corbeille.

## État final (2026-11-11)
v1 terminée (T0 à T11), fusionnée en avance rapide dans `main` et poussée (`fd7879a`, branche `feat/noyau` aussi).
Extension 0.1.0 installée ; marketplace `~/.claude-projects-hub/marketplace` recopiée depuis l'extension 0.1.0
installée (6 fichiers identiques, `hook.js` = build). Vérifié par une vraie session `claude -p` dans un dossier
neutre : hook injecté, `mcp__plugin_projects-hub_hub__memory_list` appelé sans demande de permission, réponse
correcte. Dans CE dépôt, la session démarre en agent `orchestrateur` (`.claude/settings.json`) dont la liste
d'outils n'inclut pas les outils MCP : Claude y voit l'index mais ne peut pas appeler `memory_*` (ajouter
`mcp__plugin_projects-hub_hub__memory_list`/`memory_read` à `.claude/agents/orchestrateur.md` si voulu :
documentaliste). « Secrets Supabase » signalés par config-claude : fausse alerte, aucun secret trouvé dans
`~/.claude/settings.json` (les chaînes `psql postgresql://user@hôte` n'ont pas de mot de passe).
Limite connue : un projet enregistré par le hook puis déplacé sans marqueur avant tout scan reste dans « Orphelins ».

Énoncé d'origine :
`.vsix` < 3 Mo (`.vscodeignore`, point n), commande « Installer l'intégration Claude » (copie vers
`HUB_HOME/marketplace`, `claude plugin marketplace add` puis `install`), installation réelle, question
« Quels topics de mémoire partagée vois-tu ? » dans une vraie session, `claude --resume` d'une session orpheline.
Puis T10 (documentaliste : README, CHANGELOG) et T11 (qa-reviewer).

Puis la suite du plan. Session lancée depuis le dossier parent : les agents du projet ne sont pas chargés ;
lancer la session dans `claude-projects-hub` (ou déléguer à `team-for-every-project:developpeur` avec les règles
de l'agent du projet dans le brief). Fin de chantier : qa-reviewer, puis documentaliste si une commande ou un contrat change.

## Points ouverts
| # | Sujet | Qui |
|---|---|---|
| a | Réglé (ADR 0005 l.32-35) : règle de permission posée par config-claude sur ce poste, par l'utilisateur ailleurs | - |
| b | Réglé (ADR 0001 l.47-50) : l'ADR fixe les paquets, pas les versions ; aucune API Node > 20 (contrôle qa-reviewer en T11) | - |
| c | À confirmer en exécution : préfixe réel des outils MCP (T6), forme exec du hook (T6), `claude --resume` depuis un autre dossier (T9), propagation de `info/exclude` dans un worktree (T3) | agents des tâches |
| d | Conséquence acceptée : deux clones vivants = deux projets distincts (rattachement manuel) | - |
| e | Réglé (§4.1 l.66-67, §5 l.110-122) : choix de T1 entérinés ; `excluded` produit par le MCP ; projet non enregistré -> `not_found` en lecture/ajout, `ensureProject` puis écriture pour `memory_write` | T5 applique |
| f | Réglé le 2026-11-11 : titre personnalisé = `{"type":"custom-title","customTitle":…,"sessionId":…}`, observé après `/rename` et lu par la sonde (`"custom":1`) | - |
| g | Réglé (§11 l.383-388) : ≤ 320 Kio lus par session, froid < 2 s, cache < 300 ms | - |
| h | Tranché (ADR 0001 l.46-57) : pas de `"type": "module"` ; `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` dans les scripts `test` et `probe` | dev-vscode, dans T7 (en cours) |
| i | Course possible si deux processus reprennent le même verrou périmé (> 10 s) : accepté, commentaire `shortcut` dans `lock.ts` | - |
| k, l, m | Réglés le 2026-11-11 (§5, §6.3, §14) : date locale dans les lignes d'index (test à 23 h 30 locale, passe aussi en `TZ=America/New_York`) ; `excluded` ajouté à `ErrorCode`, cast retiré de `tools.ts` ; `tags: [a, b]` inscrit au §5 ; `writeTopic` accepte `importedFrom`, passé par « Importer en topic » (test ajouté) ; `npm test` -> 78/78 | - |
| n | `dist/test-suite.js` est produit dans `dist/` : l'exclure du `.vsix` (`.vscodeignore`), comme `.vscode/`, `.vscode-test/`, `src/`, `test/` | dev-vscode, T9 |
| o | Réglé le 2026-11-11 (§7.4) : Annuler d'une fusion non durable (`.bak` pris avant la création de C, aucun refus inscrit → le scan suivant refusionnait). `.bak` = registre en mémoire juste avant la première fusion, `undoMerge` inscrit C dans `O.dismissed`. Le nouveau test échoue sur `553ff2d`, passe après ; `npm test` 79/79 ; `test:ext` code 0 (deux fois par l'agent, une fois par l'orchestrateur) | - |
| p | Chemins de T8 non testés, vérifiés par lecture seule : Rattacher depuis une proposition, QuickPick de `attachProject`, boîte modale de copie, Rafraîchir les empreintes, `undoMerge` en `conflict` ; `test:ext` jugé fragile par T8 (EPERM sur `rmSync` dans l'hôte) | qa-reviewer, T11 |
| j | Écarts de T3 au §7 : (1) « Ignorer l'orphelin » stocké en mettant l'id de l'orphelin dans son propre `dismissed` (aucun champ prévu) ; (2) marqueur trouvé dans un parent sans `.git` -> racine = dossier du marqueur (§7.3 dit « sinon dir ») ; (3) `ensureProject` ne retire pas un chemin disparu (le scan le fait) ; (4) un `.bak` par passage de `reconcile`, Annuler défait toutes les fusions du passage ; (5) `copyAutoMemory` ne lit que `claudeHome/settings.json` pour `autoMemoryDirectory`, casse `C-`/`c-` de la cible non gérée ; (6) empreintes calculées hors verrou : un projet créé pendant le scan attend le scan suivant. Tranché (§7.1 l.200-202, §7.3 l.224-226 et 240-242, §7.4 l.253-270, §7.5 l.297-300) : 1, 2, 3, 5 entérinés ; défauts réels à corriger : j4 (`MergeRecord.backupRevision`, `undoMerge` -> `conflict` si `.bak` réécrit) et j6 (`relocate.ts:126` lançait git sous le verrou du registre, jusqu'à 6 s par entrée, verrou repris au-delà de 10 s). Corrigés le 2026-11-11 (non commité) : précalcul hors verrou pour toute entrée à chemin vivant sans `git` ; les deux nouveaux tests échouent sur HEAD `9616834` et passent après correction ; `node --test src/core/*.test.ts` -> 58/58, code 0 | - |

## Risques
- Format JSONL interne de Claude, changeant : sonde `npm run probe`.
- Topics globaux injectés dans tous les projets : confidentialité.
- Test lecture seule via icacls fragile en CI.
- Budget de 150 ms du hook à mesurer.

## Reprendre
1. Ouvrir le dossier `claude-projects-hub` dans VS Code.
2. Lancer une nouvelle session Claude : elle démarre en `orchestrateur`.
3. Lui demander de lancer la vague 2 (T1 et T2) avec un brief en cinq rubriques.