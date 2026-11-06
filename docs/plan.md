# Plan d'exécution v1

Contrats : docs/architecture.md (source unique). Choix : docs/decisions/0001 à 0006. Toute dépendance hors ADR 0001
ou tout écart à un contrat : arrêt et retour à l'architecte.

## Agents du projet

| Agent | Modèle | Possède | À lui pour |
|---|---|---|---|
| architecte | opus | `docs/architecture.md`, `docs/decisions/` | contrats, ADR, arbitrages |
| dev-core | sonnet | `src/core/`, `test/fixtures/`, `scripts/probe.ts` | magasin, verrous, registre, identité, lecture des données Claude |
| dev-claude | sonnet | `src/hook/`, `src/mcp/`, `claude-plugin/`, `scripts/e2e-claude.ps1` | hook SessionStart, serveur MCP, plugin, essais dans une vraie session |
| dev-vscode | sonnet | `src/extension/`, `test/extension/`, `package.json`, `package-lock.json`, `tsconfig.json`, `esbuild.mjs`, `.gitignore`, `.vscodeignore` | extension, build, empaquetage `.vsix` |
| qa-reviewer | sonnet | tests manquants | relecture contre les contrats, vérifications de bout en bout |
| documentaliste | sonnet | `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `.claude/` | doc utilisateur, règles et agents du projet |

Règles : un fichier = un propriétaire ; les fonctions de `src/core` reçoivent leurs racines (`CLAUDE_HOME`,
`HUB_HOME`) en paramètre (tests sur dossiers temporaires, jamais sur le vrai `~/.claude` sauf la sonde, en
lecture seule) ; syntaxe TypeScript effaçable seulement (`erasableSyntaxOnly`), imports relatifs en `.ts` ; scripts
`.ps1` en UTF-8 avec BOM ; chaque agent écrit les tests de son code ; compte rendu avec la sortie réelle des
commandes du critère de fin.

## Tâches

### T0 - Socle du dépôt · dev-vscode
- Fichiers : `package.json`, `package-lock.json`, `tsconfig.json`, `esbuild.mjs`, `.gitignore`, `.vscodeignore`,
  `src/extension/extension.ts` (activation vide).
- Contenu : `git init` ; dépendances de l'ADR 0001, toutes installées ici ; `publisher: "romain-lm-dev"`,
  `displayName: "Projects Hub for Claude Code"` ;
  scripts `typecheck` (`tsc --noEmit`), `build` (esbuild, trois entrées : `src/extension/extension.ts` →
  `dist/extension.js`, `src/hook/main.ts` et `src/mcp/main.ts` → `claude-plugin/projects-hub/dist/`, entrée
  absente sautée avec un message), `test` (`node --test "src/**/*.test.ts"`), `test:ext`, `probe`, `package`
  (`vsce package --no-dependencies --skip-license`). `.gitignore` : `node_modules/`, `dist/`,
  `claude-plugin/projects-hub/dist/`, `.vscode-test/`, `*.vsix`.
- Fin : `npm install`, `npm run typecheck`, `npm run build` → code 0.

### T0b - Règles et agents du projet · documentaliste (parallèle à T0)
- Fichiers : `CLAUDE.md`, `.claude/agents/{architecte,dev-core,dev-claude,dev-vscode,qa-reviewer,documentaliste}.md`.
- Contenu : stack, commandes npm, tableau des agents ci-dessus, règles transverses (contrats dans
  architecture.md, pas de licence, Windows + PowerShell 5.1, ne jamais écrire dans `~/.claude` hors §7.5).
- Fin : les sept fichiers existent ; chaque agent liste exactement les chemins du tableau ci-dessus (relecture
  par l'architecte).

### T1 - Magasin de topics · dev-core
- Fichiers : `src/core/{paths,frontmatter,lock,store,secrets}.ts` et leurs `*.test.ts`.
- Contenu : architecture §3, §4 (refs, slugs, frontmatter strict, révision, verrou, écriture atomique, limites,
  secrets) ; API `listTopics`, `readTopic`, `writeTopic`, `appendTopic` utilisée telle quelle par T5 et T7.
- Tests exigés : aller-retour du frontmatter (guillemets, clé inconnue conservée, fichier invalide) ; refs et
  slugs (noms réservés Windows) ; `exists` et `conflict` ; deux processus fils × 50 `appendTopic` sur le même topic
  → 100 sections, aucune perte ; reprise d'un verrou périmé ; chaque motif de secret, cas positif et négatif.
- Fin : `npm test` et `npm run typecheck` → code 0.

### T2 - Lecture des données Claude · dev-core, 2e instance (parallèle à T1)
- Fichiers : `src/core/{claudeData,transcript,automemory,sessionCache}.ts` et tests, `test/fixtures/claude-home/`
  (synthétique, aucune donnée réelle), `scripts/probe.ts`.
- Contenu : architecture §8 (scan des dossiers, sessions ouvertes, sous-agents, tête et queue, cache, flux paginé
  pour le document de session, auto-mémoire aux deux variantes de frontmatter).
- Tests exigés : fixture avec première ligne > 64 Kio, ligne non JSON, type inconnu, deux dossiers `C-`/`c-` de même
  cwd, session sans titre, sous-agent, session ouverte avec pid mort.
- Fin : `npm test` → code 0 ; `npm run probe` sur le vrai `CLAUDE_HOME` (lecture seule) affiche 13 dossiers
  projet, 38 sessions, l'histogramme des types, les erreurs, les octets lus (< 20 Mo), scan à froid < 2 s et avec
  cache < 300 ms ; sortie collée au compte rendu (le type réel du titre personnalisé y est confirmé).

### T3 - Identité et relocalisation · dev-core (après T1 et T2)
- Fichiers : `src/core/{git,registry,identity,relocate}.ts` et tests.
- Contenu : architecture §7 (registre, empreinte git, `isExcludedDir`, résolution en session sans git,
  `ensureProject` avec marqueur `wx` et `info/exclude`, rapprochement au scan avec calcul des empreintes absentes,
  fusion avec `.bak` et annulation, propositions, `dismissed`, rattachement manuel d'un projet vivant,
  détachement, déplacement de topics avec suffixe, copie d'auto-mémoire §7.5).
- Tests exigés (dossiers temporaires, vrai git) : projet à marqueur déplacé → résolu par marqueur, hook compris ;
  dépôt sans marqueur déplacé → session au nouveau dossier (C créé sans `git`) → scan → fusion automatique, marqueur
  de C réécrit, puis annulation qui restaure tout ; deux clones candidats → proposition ; deux clones vivants →
  deux projets ; dossier sans git renommé à l'identique ailleurs → proposition ; candidat ignoré non reproposé ;
  détachement ; collision de slug ; copie d'auto-mémoire sans écrasement ; refus au-delà de 200 caractères ;
  `ensureProject` : dépôt neuf → marqueur, entrée, ligne `info/exclude`, `git status --porcelain` vide ; deuxième
  appel → rien de réécrit, ligne présente une seule fois (y compris fichier en CRLF ou sans `\n` final) ; worktree
  (`.git` fichier + `commondir`) → exclusion dans le dépôt principal ; sous-dossier d'un dépôt → marqueur à la
  racine du dépôt ; dossier sans git → marqueur seul ; dossiers exclus (`os.tmpdir()`, home, racine, `HUB_HOME`) →
  aucune écriture ; dossier en lecture seule → entrée créée, pas de marqueur, aucune exception ; registre perdu +
  marqueur → même id ; `ensureProject(..., { git: true })` (chemin du MCP, projet non enregistré) → identité,
  marqueur et empreinte.
- Fin : `npm test` → code 0.

### T4 - Hook SessionStart · dev-claude (après T3, parallèle à T5 et T7)
- Fichiers : `src/hook/{injection,main}.ts` et tests (`injection.ts` porte `TOOL_PREFIX` et `buildInjection`).
- Contenu : architecture §6 (dont l'appel à `ensureProject` de T3 avant l'injection).
- Tests exigés : aucun topic → en-tête seul ; 100 topics → longueur ≤ 4 000 et compte du pied de page exact ;
  ligne coupée à 180 ; stdin invalide → stdout vide et code 0 ; premier SessionStart dans un dépôt git neuf →
  marqueur créé, entrée au registre, ligne dans `.git/info/exclude`, injection avec le nom du projet ; second
  SessionStart → ligne toujours unique, marqueur inchangé ; `cwd` dans `os.tmpdir()` ou home → aucun marqueur ni
  entrée, en-tête « Projet : aucun » ; dossier en lecture seule (ACL refusant l'écriture, `icacls` dans le test) →
  JSON valide, code 0, ligne dans `logs/hook.log` ; verrou du registre tenu par un autre processus → injection
  « non enregistré » en moins de 1 s, code 0 ; durée du hook bundlé sur fixture, moins la durée de `node -e ""`,
  < 150 ms, en première session et en session suivante.
- Fin : `npm test` → code 0 ; `npm run build` puis
  `Get-Content test\fixtures\hook-input.json | node claude-plugin\projects-hub\dist\hook.js` → JSON valide,
  `additionalContext` ≤ 4 000 caractères (sortie collée).

### T5 - Serveur MCP · dev-claude, 2e instance (après T3, parallèle à T4 et T7)
- Fichiers : `src/mcp/{main,tools}.ts` et tests.
- Contenu : architecture §5, descriptions d'outils reprises mot pour mot.
- Tests exigés (client du SDK MCP relié au serveur) : chaque outil en cas nominal ; chaque code d'erreur ;
  résolution par `CLAUDE_PROJECT_DIR` puis `cwd` ; écriture concurrente de deux clients avec la même
  `baseRevision` → un succès, un `conflict`.
- Fin : `npm test` → code 0.

### T6 - Plugin et essais réels · dev-claude (après T4 et T5)
- Fichiers : `claude-plugin/.claude-plugin/marketplace.json`, `claude-plugin/projects-hub/{.claude-plugin/plugin.json,hooks/hooks.json,.mcp.json}`,
  `scripts/e2e-claude.ps1`.
- Contenu : architecture §6.1 et §9 ; le script fixe `CLAUDE_PROJECTS_HUB_HOME` vers un dossier jetable, y crée un
  topic global dont le résumé porte un mot témoin aléatoire, lance `claude --plugin-dir <plugin> -p` (1) pour
  faire citer le mot témoin (preuve d'injection), (2) avec `--allowedTools` limité à `memory_write` pour créer
  `project:essai` (preuve d'écriture), vérifie les fichiers, nettoie. Si `-p` ne déclenche pas SessionStart : le
  script le dit et donne la procédure en session interactive.
- Fin : `claude plugin validate .\claude-plugin\projects-hub` → « Validation passed » ;
  `.\scripts\e2e-claude.ps1` → deux contrôles OK (sortie collée) ; préfixe réel des outils relevé, `TOOL_PREFIX`
  corrigé s'il diffère, architecte prévenu ; l'orchestrateur confie alors à l'agent de configuration l'ajout de
  la règle `mcp__plugin_<préfixe réel>` à `~/.claude/settings.json` (hors dépôt, hors extension).

### T7 - Vues, sessions, topics · dev-vscode (après T3, parallèle à T4 et T5)
- Fichiers : `src/extension/{extension,tree,sessionDocument,topicCommands,resume,diagnostics}.ts`,
  `package.json` (`contributes` : conteneur, deux vues, commandes, réglage `claudeProjectsHub.showTemporaryProjects`),
  `test/extension/`.
- Contenu : architecture §8.4 et §10 sauf relocalisation, aperçu et installation.
- Fin : `npm run test:ext` → code 0 (hôte VS Code sur fixtures via `CLAUDE_CONFIG_DIR` et
  `CLAUDE_PROJECTS_HUB_HOME` : activation, projets de la fixture listés, page 1 d'un document de session contenant
  le premier prompt, création d'un topic) ; essai manuel F5 sur les vraies données : page 1 de la plus grosse
  session (84 Mo) < 2 s (temps du canal Diagnostic collé).

### T8 - Relocalisation dans l'interface et aperçu · dev-vscode (après T4 et T7)
- Fichiers : `src/extension/{relocation,preview}.ts`, `src/extension/extension.ts`, `package.json` (commandes),
  `test/extension/`.
- Contenu : nœuds « À rattacher » et « Orphelins », notification avec Annuler, Rattacher à un projet…, Détacher,
  Copier l'auto-mémoire, Rafraîchir les empreintes, Aperçu de l'injection (`buildInjection` de T4).
- Fin : `npm run test:ext` → code 0, avec une fixture de dépôt git déplacé (fusion notifiée, Annuler restaure) et
  l'aperçu identique à la sortie du hook sur la même fixture.

### T9 - Installation de l'intégration et `.vsix` · dev-vscode (après T6 et T8)
- Fichiers : `src/extension/install.ts`, `src/extension/extension.ts`, `package.json`, `.vscodeignore`.
- Contenu : architecture §9 ; reprise d'une session orpheline dans un terminal ouvert au nouveau dossier.
- Fin : `npm run package` → `.vsix` < 3 Mo contenant `dist/extension.js` et `claude-plugin/projects-hub/dist/*` ;
  `code --install-extension <vsix>` ; commande Installer → `claude plugin list --json` montre
  `projects-hub@projects-hub-local` activé ; nouvelle session dans l'extension Claude de VS Code : la question
  « Quels topics de mémoire partagée vois-tu ? » obtient l'index réel ; `claude --resume <id>` d'une session
  orpheline rattachée fonctionne depuis le nouveau dossier (résultat écrit tel quel, succès ou échec).

### T10 - Documentation utilisateur · documentaliste (après T9)
- Fichiers : `README.md`, `CHANGELOG.md` (0.1.0), `CLAUDE.md` si une commande a changé.
- Contenu : prérequis (Node ≥ 20 sur le PATH, Claude Code ≥ 2.1.223), installation, règle de permission
  `mcp__plugin_projects-hub_hub` (préfixe relevé en T6) : sur ce poste déjà ajoutée à `~/.claude/settings.json`
  par l'agent de configuration après T6, sur un autre poste à ajouter soi-même (`permissions.allow`, exemple
  JSON) ; l'extension ne touche pas ce fichier ; marqueur `.claude/projects-hub.json` : posé à la première session,
  local, exclu de git par `.git/info/exclude`, absent des dossiers temporaires et personnels ; clones et
  worktrees séparés sauf « Rattacher à un projet… » ; confidentialité des topics globaux, commandes, liste
  « Reporté » de l'architecture §13.
- Fin : chaque commande de `package.json` (`contributes.commands`) est citée dans le README (contrôle par
  `Select-String`, sortie collée).

### T11 - Revue finale · qa-reviewer (dernière)
- Relecture du code contre docs/architecture.md (contrats §4 à §9) et des tests manquants.
- Commandes : `npm run typecheck`, `npm test`, `npm run test:ext`, `npm run package`,
  `claude plugin validate .\claude-plugin\projects-hub`, `.\scripts\e2e-claude.ps1`.
- Scénario manuel de relocalisation hors `%TEMP%` (les dossiers temporaires sont exclus du registre) : dépôt git
  d'essai avec une session Claude et un topic (marqueur posé, `git status` vide), renommé, puis dépôt dont le
  marqueur a été supprimé, déplacé et rouvert dans une session ; résultats observés écrits.
- Fin : toutes les commandes → code 0, scénario consigné ; écarts listés pour leur propriétaire.

## Ordre et parallélisme

| Vague | Tâches (fichiers disjoints) |
|---|---|
| 1 | T0 ∥ T0b |
| 2 | T1 ∥ T2 |
| 3 | T3 |
| 4 | T4 ∥ T5 ∥ T7 |
| 5 | T6 ∥ T8 |
| 6 | T9 |
| 7 | T10 |
| 8 | T11 (qa-reviewer) |
