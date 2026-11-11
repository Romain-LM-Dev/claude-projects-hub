# Recette T11 (2026-11-11, HEAD 658b65e + tests QA non commités)

## Commandes (codes de sortie réels)
| Commande | Code | Résultat |
|---|---|---|
| `npm run typecheck` | 0 | propre (avec les 2 nouveaux fichiers de test) |
| `npm test` (avant ajouts) | 0 | 79/79 |
| `npm test` (après ajouts) | 1 | 86 tests, 85 verts, 1 rouge volontaire (défaut 1) |
| `npm run test:ext` (avant et après) | 0 | hôte VS Code, sorties `Exit code: 0` |
| `npm run package` | 0 | `claude-projects-hub-0.0.1.vsix`, 12 fichiers, 160,7 Kio |
| `claude plugin validate .\claude-plugin\projects-hub` | 0 | « Validation passed » (avertissement : pas de licence, attendu) |
| `.\scripts\e2e-claude.ps1` | 0 | OK 1/2 injection (mot témoin cité), OK 2/2 écriture ; préfixe `mcp__plugin_projects-hub_hub__` |

## Tests ajoutés
- `src/extension/relocation.test.ts` (6, verts) : le module `vscode` est remplacé via `module.registerHooks` ; couvre Rattacher
  depuis une proposition, QuickPick d'`attachProject` (projet vivant, orphelin, annulation, projet sans id), boîte modale de
  copie d'auto-mémoire (fermée = rien, « Copier » = copie, cibles proposition et orphelin), Rafraîchir les empreintes,
  `undoMerge` en `conflict`. Raison du choix : `test:ext` n'a qu'une entrée (`dist/test-suite.js` = `suite.ts`, `esbuild.mjs`
  non modifiable) et `showQuickPick` n'est pas pilotable depuis l'hôte.
- `src/core/relocate.undo2.test.ts` (1, ROUGE) : deux fusions dans un même passage, annulées en ordre inverse comme le fait l'extension.

## Scénario réel (hub jetable, dépôts sous `%LOCALAPPDATA%\projects-hub-qa`, 4 sessions `claude -p` + 2 e2e = 6)
- A : marqueur posé (script `ensureProject`) + topic ; `git status --porcelain` vide ; dossier renommé ; session `claude -p` au
  nouveau chemin -> même id `ae4e2f85…`, `paths` = ancien + nouveau (l'ancien n'est retiré qu'au scan, §7.3), `git status` vide.
- B : session dans l'ancien dossier, marqueur supprimé, dossier déplacé, session au nouveau (crée C). Scan scripté
  (`scanClaudeData` réel, `reconcile` sur hub jetable) : AUCUNE fusion (défaut 2). Rejoué en intercalant un scan avant le
  déplacement : fusion certaine, marqueur de C réécrit avec l'id de O ; `undoMerge` -> 2e scan sans refusion.
- `claude --resume dcaad90d…` (session du dépôt B) lancé depuis le nouveau dossier : code 0, réponse « OK » ; la
  transcription continue dans l'ancien dossier `~/.claude/projects` (rien n'est copié dans le nouveau).
- Observé en passant : l'extension installée sur ce poste (VS Code ouvert) a rapproché les dossiers QA dans le VRAI hub
  (fusion de B faite automatiquement, marqueur de C réécrit 4 s après la session). Entrées `projects-hub-qa` restées
  dans `~/.claude-projects-hub/registry.json` et transcriptions dans `~/.claude/projects/*projects-hub-qa*` : à purger par l'utilisateur.

## Défauts
1. Bloquant (dev-core) `src/core/relocate.ts:undoMerge` : deux fusions d'un même passage partagent un `.bak` ; le 2e
   `undoMerge` relit le `.bak` d'origine et écrase le registre, perdant le refus (`dismissed`) du 1er. Preuve : test
   `relocate.undo2.test.ts` rouge (le scan suivant refusionne la paire A2). Correctif : lire le registre courant, ou
   restaurer toutes les entrées en un appel pour tout le passage.
2. À corriger (dev-core/architecte) `reconcile` : un projet connu seulement du hook (`git` absent) puis déplacé avant tout scan
   n'a jamais d'empreinte -> pas de fusion « certaine » (§7.4 le prévoit) ; de plus la boucle des dossiers morts
   (`relocate.ts` « for (const p of projects) … if (existsSync(p.cwd) …) ») crée un 2e orphelin doublon (`40ed81dd`) car l'entrée
   du hook n'a pas de `claudeDirs` ; elle devrait rattacher `p.claudeDirs` à l'entrée dont `paths` porte `p.cwd`.
   Preuve : registre du hub jetable (deux entrées `repoB` sans chemin vivant). Le scénario du plan (l.163-165) suppose un scan intermédiaire.
