# claude-projects-hub : architecture v1

Source unique des contrats (magasin, outils MCP, hook, identité, extraction des transcripts). Les ADR
(docs/decisions/) disent pourquoi ; ce document dit quoi. Toute modification d'un contrat passe par l'architecte.

## 1. Rôle

1. Lister et visualiser dans VS Code tous les projets Claude Code du poste et leurs sessions (CLI et extension
   officielle confondues), y compris les sessions en cours et les sous-agents.
2. Fournir une mémoire par topics : topics d'un projet (partagés entre ses sessions et les dossiers qui lui sont
   rattachés : copies portant son marqueur, clones ou worktrees rattachés à la main, §7.4) et topics globaux (partagés entre tous les projets), lus et écrits par Claude pendant les sessions, lisibles et
   modifiables par l'utilisateur comme de simples fichiers Markdown.
3. Garder cette mémoire attachée au bon projet quand son dossier est déplacé ou renommé, et rattacher les
   transcripts et l'auto-mémoire Claude devenus orphelins.

## 2. Composants

| Composant | Lancé par | Bundle | Rôle |
|---|---|---|---|
| Noyau `src/core/` | importé par les trois autres | (inclus) | magasin, registre, identité, lecture des données Claude ; Node pur, aucun `import 'vscode'` |
| Extension VS Code `src/extension/` | VS Code | `dist/extension.js` | vues, scan, relocalisation, installation de l'intégration |
| Hook SessionStart `src/hook/` | Claude Code (plugin) | `claude-plugin/projects-hub/dist/hook.js` | injecte l'index des topics (§6) |
| Serveur MCP stdio `src/mcp/` | Claude Code (plugin) | `claude-plugin/projects-hub/dist/mcp.js` | outils `memory_*` (§5) |

```
VS Code ── extension.js ──┐                      ┌── hook.js (SessionStart) ──┐
                          ├── src/core ── HUB_HOME (topics, registre)         ├── Claude Code (CLI ou extension)
                          │        └──── CLAUDE_HOME (lecture seule)          │
                          └── installe ──> HUB_HOME/marketplace ── plugin ────┴── mcp.js (stdio)
```

## 3. Emplacements

- `CLAUDE_HOME` = `$CLAUDE_CONFIG_DIR` sinon `~/.claude`. Lecture seule, sauf la copie d'auto-mémoire confirmée
  par l'utilisateur (§7.5) et la mise à la corbeille de sessions confirmée (ADR 0007, §10).
- `HUB_HOME` = `$CLAUDE_PROJECTS_HUB_HOME` sinon `~/.claude-projects-hub` (la variable sert aux tests).

```
HUB_HOME/
  registry.json              identités de projet (§7.1)
  registry.json.bak          copie prise avant chaque fusion (commande Annuler)
  global/topics/<slug>.md
  projects/<projectId>/topics/<slug>.md
  cache/sessions-v1.json     index des transcripts (§8.3), jetable
  marketplace/               copie du plugin, lue en place par Claude Code (§9)
  logs/hook.log, logs/mcp.log  1 Mo max chacun (au-delà : on garde la seconde moitié)
```

Marqueur dans le projet, posé dès la première session Claude dans un dossier non exclu (§7.3) :
`<racine du projet>/.claude/projects-hub.json`

```json
{ "id": "6f1c2e0a-3b7d-4c1e-9a52-0d4f8e7b1a23" }
```

Il est local au poste et jamais versionné : dans un dépôt git, la ligne `/.claude/projects-hub.json` est ajoutée au
fichier d'exclusion local du dépôt (`info/exclude`, §7.3), jamais à un `.gitignore` ni à un fichier suivi. Un clone
ne le porte donc pas et reçoit sa propre identité ; une copie du dossier (avec le marqueur) partage celle du projet.

## 4. Magasin de topics

### 4.1 Références et fichiers
- `ref` = `project:<slug>` ou `global:<slug>`.
- `slug` : `^[a-z0-9]+(-[a-z0-9]+)*$`, 64 caractères max ; refusés : `con prn aux nul com1-9 lpt1-9` (Windows).
- Fichier : `HUB_HOME/global/topics/<slug>.md` ou `HUB_HOME/projects/<projectId>/topics/<slug>.md`.
- `project:` se résout avec le projet de la session (§7.3). Le magasin reçoit l'id déjà résolu ; une ref `project:`
  sans id valide y lève `invalid_input` (erreur d'appel : le MCP traite avant « exclu » et « non enregistré », §5).

### 4.2 Format
```markdown
---
title: Ports Docker du projet
summary: PostgreSQL publié sur 5433 car 5432 est pris par l'instance locale
tags: [infra, docker]
---
Corps Markdown libre.
```
- Frontmatter : sous-ensemble strict de YAML, une clé par ligne. `title` (1-80 car.) et `summary` (1-200 car., une
  ligne) obligatoires ; `tags` facultatif, liste en ligne `[a, b]`, 8 tags max, chacun au format slug ;
  `importedFrom` facultatif (chemin du souvenir d'auto-mémoire importé). Valeur entre guillemets doubles si elle
  commence par `[`, `"`, `'` ou contient `: ` ; échappements `\"` et `\\` seulement.
- Clé inconnue : conservée telle quelle à la réécriture. Fichier illisible : affiché « invalide » dans la vue,
  ignoré par l'index, jamais réécrit par un outil (erreur `invalid_file`).
- Dates : `mtime` du fichier (aucune date dans le frontmatter, une seule source de vérité).
- `revision` = 12 premiers caractères hexadécimaux du SHA-256 des octets du fichier.
- Limites : corps 20 000 car. à l'écriture ; fichier 50 000 car. après un ajout ; texte ajouté 4 000 car.
- Encodage UTF-8 sans BOM, fins de ligne `\n`.

### 4.3 Écriture (sessions concurrentes)
1. Verrou : créer `<fichier>.lock` avec l'option `wx` (`{"pid":…, "at":"ISO"}`), nouvel essai toutes les 25 ms
   pendant 2 s ; verrou de plus de 10 s = périmé, supprimé puis repris ; libéré dans `finally`.
2. Sous verrou : relire, vérifier la révision attendue, écrire `<fichier>.<pid>.<aléa>.tmp`, puis `fs.rename` vers
   le fichier (remplacement atomique sur NTFS). `EPERM`/`EBUSY`/`EACCES` : 5 essais (50, 100, 200, 400, 800 ms).
3. Les lecteurs ne verrouillent pas (ils voient l'ancien ou le nouveau fichier, jamais un fichier partiel).
Même protocole pour `registry.json`.

### 4.4 Garde-fous de contenu (frontière de confiance : texte écrit par Claude)
Refus (`secret_detected`) si le texte contient : `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `sk-ant-[A-Za-z0-9_-]{20,}`,
`gh[pousr]_[A-Za-z0-9]{36,}`, `github_pat_[A-Za-z0-9_]{22,}`, `AKIA[0-9A-Z]{16}`, `xox[baprs]-[A-Za-z0-9-]{10,}`.
Liste fermée, testée ; elle ne prétend pas tout détecter (consigne dans la description des outils).

## 5. Outils MCP (serveur `hub`, plugin `projects-hub`)

Nom vu par Claude : `mcp__plugin_projects-hub_hub__<outil>` (préfixe confirmé en T6 sur une vraie session
`claude -p`, Claude Code 2.1.317 ; porté par une constante unique `TOOL_PREFIX`). Projet de la session : `$CLAUDE_PROJECT_DIR` (exporté par Claude Code aux serveurs
MCP de plugin), sinon `process.cwd()`. Résultats : contenu texte ; erreurs : `isError: true` et texte
`ERREUR <code> : <message>`. Codes : `invalid_ref`, `invalid_input`, `not_found`, `exists`, `conflict`,
`too_large`, `secret_detected`, `invalid_file`, `io`, `excluded` (ref `project:` depuis un dossier exclu, §7.3).

Résolution (révisé le 2026-11-11, point e) : le serveur appelle `resolveProject` avant toute ref `project:` (et
pour l'en-tête de `memory_list`). `excluded` n'est jamais levé par le noyau : le serveur le produit d'après
`resolveProject` (`status: 'excluded'`) ou `ensureProject` (`null`). Non enregistré : `memory_read` et
`memory_append` → `not_found` ; `memory_write` → `ensureProject(dir, { git: true })` puis écriture. Résolution en
échec (registre illisible `invalid_file`, verrou `io`) : code rendu pour une ref `project:` ; `memory_list` affiche
alors `Projet : non enregistré` et les seuls topics globaux ; les refs `global:` ne dépendent jamais de la résolution.

| Outil | Entrée | Sortie | Règles |
|---|---|---|---|
| `memory_list` | `scope?`: `project`\|`global`\|`all` (défaut `all`) ; `query?`: chaîne (sous-chaîne, sans casse, sur titre, résumé, tags) ; `tag?`: slug | 1re ligne `Projet : <nom> (<id>)` ou `Projet : non enregistré`, puis une ligne par topic au format de l'index (§6.3), 200 max, tri `mtime` décroissant | lecture seule ; projet exclu ou non enregistré : aucun topic projet, jamais d'erreur (`scope: project` compris) |
| `memory_read` | `ref` | `ref:`, `title:`, `summary:`, `tags: [a, b]`, `updated:` (ISO), `revision:`, ligne `---`, puis le corps brut | lecture seule |
| `memory_write` | `ref`, `title`, `summary`, `body`, `tags?`, `baseRevision?` | `ref:`, `revision:`, `created: true\|false` | absent + pas de `baseRevision` = création ; présent = `baseRevision` obligatoire (`exists` sinon) et égale à la révision courante (`conflict` + révision courante sinon) ; `baseRevision` sur un topic absent → `not_found`. Topic projet dans un projet non enregistré (hook en échec) : `ensureProject` d'abord (§7.3) ; dossier exclu : `excluded` |
| `memory_append` | `ref`, `text` | `ref:`, `revision:` | topic existant (`not_found` sinon) ; ajoute `\n\n### <AAAA-MM-JJTHH:MMZ, UTC>\n<text>` (ex. `### 2026-11-11T09:42Z`) sous verrou, sans conflit possible ; texte vide → `invalid_input` ; `too_large` au-delà de 50 000 car. |

Pas d'outil de suppression en v1 (l'utilisateur supprime depuis la vue, vers la corbeille).

Descriptions des outils (texte fourni à Claude, en français, à reprendre tel quel) :
- `memory_list` : « Liste les topics de mémoire partagée (projet courant et globaux). »
- `memory_read` : « Lit un topic complet et sa révision. À faire avant memory_write sur un topic existant. »
- `memory_write` : « Crée ou remplace un topic. Un topic = un sujet durable (décision, convention, état d'un
  chantier), résumé en une ligne utile seul. project: = ce projet ; global: = utile à tous les projets. Jamais de
  secret, de mot de passe ni de donnée client. Pour un topic existant, passer baseRevision lu par memory_read. »
- `memory_append` : « Ajoute une entrée datée à la fin d'un topic existant, sans risque de conflit entre sessions. »

## 6. Hook SessionStart

### 6.1 Déclaration (`claude-plugin/projects-hub/hooks/hooks.json`)
```json
{ "hooks": { "SessionStart": [ { "hooks": [
  { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/hook.js"], "timeout": 5 }
] } ] } }
```
Sans `matcher` : s'applique à `startup`, `resume`, `clear` et `compact` (réinjection après compactage).
Forme exec validée par `claude plugin validate` à l'étape T6.

### 6.2 Entrée et sortie
- Entrée : JSON sur stdin (`session_id`, `cwd`, `source`, …), lu avec 1 s de délai max. Dossier du projet =
  `$CLAUDE_PROJECT_DIR`, sinon `cwd`.
- Sortie (stdout, code 0) :
```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<texte §6.3>" } }
```
- Avant l'injection : `ensureProject(dossier, { git: false })` (§7.3). Son échec (lecture seule, verrou du registre
  non obtenu en 500 ms, disque plein…) est journalisé et n'empêche pas l'injection : projet résolu sans création,
  sinon « non enregistré » ; nouvel essai à la session suivante.
- Toute autre erreur : rien sur stdout, code 0 (ne jamais gêner la session), une ligne dans `logs/hook.log`.
- Aucun processus lancé (pas de git). Écritures : journal, et seulement s'ils manquent marqueur, ligne de
  `info/exclude` et entrée du registre. Cible : 150 ms, première session comprise, mesurée en T4.

### 6.3 Texte injecté et budget
Budget `HOOK_BUDGET = 4000` caractères (limite Claude Code : 10 000 ; au-delà seul un aperçu de 2 000 arrive).
```
## Mémoire partagée (projects-hub)
Topics partagés entre sessions. Projet : «G_mix-Generateur-Business_Games». Lire : mcp__plugin_projects-hub_hub__memory_read {ref}. Créer ou remplacer : …memory_write ; ajouter : …memory_append ; lister : …memory_list. Écris un topic quand une décision, une convention ou l'état d'un chantier doit survivre à la session ; global = utile à tous les projets, sans secret ni donnée client.
### Projet
- project:ports-docker — Ports Docker du projet : PostgreSQL publié sur 5433 car… [infra, docker] (2026-11-05)
### Global
- global:conventions-git — Conventions git : commits en français, impératif… (2026-10-30)
… 7 autres topics : memory_list
```
- En-tête toujours présent (≈ 450 car.), même sans topic, pour que Claude sache que les outils existent.
  Projet non enregistré (création en échec) : `Projet : non enregistré (le premier topic project: le crée)` ;
  dossier exclu : `Projet : aucun (dossier temporaire ou personnel, topics global: seulement)`.
- Ligne : `- <ref> — <title> : <summary> [<tags>] (<AAAA-MM-JJ de mtime, date locale>)`, coupée à 180 car. avec `…`.
- Ordre : topics du projet puis globaux, chacun par `mtime` décroissant ; on ajoute des lignes tant que
  en-tête + lignes + pied de page ≤ budget ; pied de page `… N autres topics : memory_list` si N > 0.
- Section vide omise. L'auto-mémoire Claude n'est jamais injectée (Claude la charge déjà).
- Fonction pure `buildInjection(header, projectTopics, globalTopics, budget)` partagée avec la commande
  « Aperçu de l'injection » de l'extension.

## 7. Identité de projet

### 7.1 Registre (`HUB_HOME/registry.json`)
```json
{
  "version": 1,
  "projects": {
    "6f1c2e0a-3b7d-4c1e-9a52-0d4f8e7b1a23": {
      "name": "G_mix-Generateur-Business_Games",
      "paths": ["c:\\_Documents-Romain\\Ecole-inge-EIGSI\\Projet IE\\G_mix-Generateur-Business_Games"],
      "formerPaths": [],
      "claudeDirs": ["c---Documents-Romain-Ecole-inge-EIGSI-Projet-IE-G-mix-Generateur-Business-Games"],
      "git": { "rootCommits": ["<sha40>"], "remote": "github.com/exemple/projet" },
      "dismissed": [],
      "createdAt": "2026-11-06T10:00:00Z"
    }
  }
}
```
- `id` : `crypto.randomUUID()`. `paths` : dossiers vivants (plusieurs = clones ou worktrees). `git` : `null` si
  pas de dépôt ou git absent ; clé absente = empreinte pas encore calculée (entrée créée par le hook). `dismissed` : ids de candidats refusés par l'utilisateur ; l'id du projet lui-même dans
  son propre `dismissed` = orphelin ignoré (« Ignorer l'orphelin » : ni candidats, ni nœud « Orphelins » ; reste
  rattachable par « Rattacher à un projet… » ; pas de commande pour lever l'ignorance en v1).
- Clé de comparaison d'un chemin : `path.resolve`, sans séparateur final, en minuscules sous Windows.

### 7.2 Empreinte git (extension et MCP seulement, jamais le hook)
- `rootCommits` : `git -C <dir> rev-list --max-parents=0 HEAD`, triés (vide si dépôt sans commit).
- `remote` : `git -C <dir> config --get remote.origin.url` normalisé : retirer `git+`, le protocole, les
  identifiants `user[:pass]@`, le suffixe `.git` et `/` final ; `git@hôte:chemin` → `hôte/chemin` ; minuscules.
- Délai 3 s par commande ; calculée à l'enregistrement par le MCP ou l'extension, au scan pour toute entrée à chemin
  vivant sans clé `git` (avant le rapprochement), et à la commande « Rafraîchir les empreintes ».

### 7.3 Résolution pendant une session (hook, MCP)
Dossier exclu (`isExcludedDir`, partagé avec le scan §7.4) : sous `os.tmpdir()` (dont le scratchpad de Claude
Code), égal à `os.homedir()`, racine d'un lecteur, ou sous `CLAUDE_HOME` ou `HUB_HOME`. Comparaison par clé (§7.1).
Un dossier exclu n'a jamais de marqueur ni d'entrée : seul le global est injecté et lu ; `project:` → `excluded`.

1. Chercher `.claude/projects-hub.json` dans le dossier puis ses parents ; arrêt après un dossier contenant `.git`
   (dossier ou fichier) ou à la racine du lecteur. Id valide trouvé → projet. Un marqueur d'un PARENT ne compte que
   si un dossier `.git` a été atteint au-dessus du dossier (on est dans un dépôt) ; hors dépôt, seul le marqueur du
   dossier lui-même compte (une session dans `~/Documents` ne capture pas ses sous-dossiers).
2. Sinon, projet du registre dont `paths` contient la clé du dossier → projet.
3. Sinon : non enregistré.

`ensureProject(dir, { git })`, fonction du noyau appelée par le hook à chaque session (`git: false`) et par le MCP
avant une écriture `project:` quand le projet n'est pas enregistré (`git: true`) ; ne fait rien si `dir` est exclu :
- Racine R = dossier où l'étape 1 a trouvé le marqueur ; sinon dernier dossier visité par l'étape 1 s'il contient
  `.git` et n'est pas exclu ; sinon `dir` (révisé le 2026-11-11 : un sous-dossier d'un projet marqué sans git
  n'entre pas dans `paths`).
- Sous le verrou de `registry.json` (§4.3 ; attente limitée à 500 ms pour le hook) : relire le registre ; id =
  marqueur trouvé, sinon projet dont `paths` contient R, sinon `crypto.randomUUID()` (`name` = nom de R, `git` absent
  pour le hook, calculé pour le MCP).
- Marqueur absent : écrit avec l'option `wx` (`EEXIST` → relire le marqueur et prendre son id). Impossible à écrire
  (`EACCES`, `EPERM`, `EROFS`…) : journalisé, on continue (le projet sera résolu par l'étape 2).
- Registre : entrée créée si l'id est inconnu (registre perdu → même id), R ajouté à `paths` et retiré des autres
  projets s'il manque ; écriture atomique.
- Si R contient `.git` : dossier git G = `R/.git` s'il est un dossier ; si c'est un fichier, chemin de sa ligne
  `gitdir:` (relatif à R), puis, si `G/commondir` existe, G = son contenu (relatif à G). Ajouter
  `/.claude/projects-hub.json` à `G/info/exclude` (créé avec `info/` au besoin) seulement si aucune ligne, sans
  espaces ni `\r`, ne lui est égale ; saut de ligne ajouté avant si le fichier ne finit pas par `\n`. Échec :
  journalisé, on continue.
- Rien d'autre n'est écrit dans le projet ; aucun `.gitignore` n'est créé ni modifié.
- `ensureProject` ne retire jamais un chemin disparu (seul le scan le déplace vers `formerPaths`, §7.4). Conséquence
  acceptée : avant le scan suivant, un nouveau dossier créé à l'ancien chemin d'un projet reçoit son identité
  (étape 2), comme une copie.

### 7.4 Rapprochement au scan (extension)
Pour chaque dossier projet vivant P (cwd des transcripts qui existe, hors dossier exclu §7.3) :
1. Marqueur d'id M (recherche de l'étape 1 du §7.3) : M inscrit → P ajouté à `M.paths` et retiré des autres
   projets ; M inconnu (registre perdu, dossier copié d'un autre poste) → entrée créée avec l'id M.
2. Sinon P déjà dans un `paths` → rien.
3. Sinon nouvelle entrée sans marqueur (le scan n'écrit jamais dans un projet ; le marqueur viendra à la
   prochaine session), empreinte calculée.
Puis empreinte calculée pour toute entrée à chemin vivant sans clé `git` (§7.2).
P est le cwd tel quel (pas la racine R du §7.3) : une session ouverte dans un sous-dossier d'un projet marqué ajoute
ce sous-dossier à `paths` (même id, sans effet sur la résolution). Aucun processus git sous le verrou du registre
(révisé le 2026-11-11) : les empreintes des cwd et des chemins vivants des entrées sans clé `git` sont calculées
avant la prise du verrou ; une entrée apparue entre-temps (hook) garde sa clé `git` absente jusqu'au scan suivant.
Chaque dossier `CLAUDE_HOME/projects/<dir>` est rattaché (`claudeDirs`) au projet de son cwd ; un dossier dont le
cwd n'existe plus et qu'aucun projet ne porte devient une entrée orpheline (`paths` vide, `git` null,
`formerPaths` = son cwd). Chemins disparus : déplacés de `paths` vers `formerPaths`. Projet sans chemin vivant =
orphelin.

Pour chaque orphelin O (non ignoré), candidats C = projets vivants, hors `O.dismissed` :
- **Certain** : `O.git` et `C.git` non nuls, `rootCommits` qui se recoupent, `remote` égaux (ou tous deux
  absents), C sans topic, et un seul C dans ce cas. → fusion automatique : copie de sauvegarde
  `registry.json.bak`, `O.paths += C.paths`, `O.claudeDirs += C.claudeDirs`, C supprimé, marqueur de C réécrit avec
  l'id de O s'il existe ; notification « Projet X rattaché à son nouveau dossier » avec bouton Annuler (restaure le
  `.bak` et le marqueur, puis inscrit C dans `O.dismissed` : le scan suivant ne refait pas la fusion, « Rattacher à
  un projet… » reste possible). Un seul `.bak` par passage, pris juste avant sa première fusion (registre en mémoire,
  entrées créées par ce passage comprises, pour que C garde son id après Annuler) : une seule notification par
  passage (noms des projets rattachés) ; Annuler défait toutes les fusions du passage (`undoMerge` sur chaque
  enregistrement, ordre inverse). `MergeRecord.backupRevision` = révision (§4.2) du `.bak` écrit ; `undoMerge` refuse
  (`conflict`) si le `.bak` a changé depuis (fusion ou rattachement plus récent). Les entrées créées entre la fusion et
  l'annulation sont perdues du registre et recréées par le marqueur à la session ou au scan suivants.
- **Probable** : `rootCommits` qui se recoupent sans le reste, ou même nom de dossier (sans casse). → proposé
  (nœud « À rattacher » et notification) : Rattacher / Ignorer ce candidat / Ignorer l'orphelin.
- Sinon : affiché dans « Orphelins » avec la commande manuelle « Rattacher à un projet… ».
Seuls les orphelins ont des candidats : deux clones ou worktrees vivants restent deux projets (aucun marqueur
partagé) tant que l'utilisateur ne les réunit pas par « Rattacher à un projet… », offerte aussi sur un projet
vivant (même fusion, marqueur réécrit).
Rattachement manuel quand les deux projets ont des topics : ceux de C sont déplacés chez O ; un slug déjà pris
reçoit le suffixe `-<4 premiers car. de l'id de C>` ; rien n'est écrasé.

Le marqueur rend le cas courant certain : tout projet ouvert dans une session depuis l'installation a un marqueur,
qui le suit dans son déplacement (aucun orphelin). L'empreinte git ne sert qu'aux dossiers sans marqueur : projets
connus seulement du scan, marqueur supprimé ou non inscriptible, dépôt recloné ailleurs. Cas typique : O sans
marqueur déplacé → la session au nouveau dossier crée C (marqueur, sans topic) → le scan calcule `C.git`, la
règle « certain » s'applique et réécrit le marqueur de C avec l'id de O.

Commande « Détacher ce dossier » : retire P du projet, lui crée une identité neuve, réécrit son marqueur s'il en a
un ; les topics restent au projet d'origine. Refusée (`invalid_input`, message « ce dossier n'est pas la racine
d'un projet ») si P n'a pas son propre marqueur et qu'un marqueur d'un parent le résout : le scan suivant le rendrait
au parent, et un marqueur posé dans un sous-dossier ne serait pas couvert par la ligne `info/exclude`.
Un dossier mort du scan dont le cwd figure déjà dans `paths` ou `formerPaths` d'une entrée (entrée créée par le
hook, sans `claudeDirs`) est rattaché à cette entrée (`claudeDirs`), jamais dupliqué en nouvel orphelin. Limite
acceptée : un projet enregistré par le hook puis déplacé sans marqueur avant tout scan n'a pas d'empreinte ; il
reste dans « Orphelins » (rattachement manuel).

### 7.5 Données Claude d'un orphelin rattaché
- Transcripts : non déplacés ; affichés sous le projet rattaché. Reprise dans un terminal ouvert au nouveau
  dossier (`claude --resume <id>` cherche hors du dossier projet courant depuis Claude Code 2.1.223 ; à vérifier
  en T9).
- Auto-mémoire : proposition « Copier l'auto-mémoire Claude vers le nouveau dossier » (confirmation obligatoire) :
  copie des `.md` absents de la cible, ajout à `MEMORY.md` des lignes d'index absentes ; jamais d'écrasement ni de
  suppression. Dossier cible = nom encodé du nouveau chemin (tout caractère non alphanumérique → `-`) ; refus si le
  nom dépasse 200 caractères (hash non reproductible) ou si `autoMemoryDirectory` est réglé : message « ouvrez
  d'abord une session Claude dans le nouveau dossier ». `autoMemoryDirectory` n'est lu que dans
  `CLAUDE_HOME/settings.json` (réglage utilisateur) ; un réglage local ou d'entreprise n'est pas vu, la copie va alors
  dans le dossier standard, inutilisée mais sans perte (limite acceptée le 2026-11-11). Casse du lecteur (`C-`/`c-`)
  non traitée : NTFS ne distingue pas la casse, un dossier Claude existant est donc réutilisé.

## 8. Lecture des données Claude

### 8.1 Sources
- `CLAUDE_HOME/projects/<dir>/<sessionId>.jsonl` : transcripts (format interne, lecture tolérante).
- `CLAUDE_HOME/projects/<dir>/<sessionId>/subagents/agent-<id>.meta.json` (`agentType`, `description`) et `.jsonl`.
- `CLAUDE_HOME/projects/<dir>/memory/` : auto-mémoire (`MEMORY.md` + souvenirs, frontmatter à plat ou sous
  `metadata`).
- `CLAUDE_HOME/sessions/<pid>.json` : sessions ouvertes (`pid`, `sessionId`, `cwd`, `status`, `updatedAt`,
  `entrypoint`, `name`) ; vivante si `process.kill(pid, 0)` réussit ou lève `EPERM`.
- `~/.claude.json` et `history.jsonl` : non lus en v1.

### 8.2 Résumé de session (`SessionSummary`)
`sessionId`, `claudeDir`, `file`, `sizeBytes`, `mtimeMs`, `cwd`, `gitBranch?`, `version?`, `entrypoint?`,
`startedAt?`, `endedAt?`, `title`, `titleSource` (`custom` | `ai` | `last-prompt` | `first-prompt` | `none`),
`costUsd?`, `subagents[]` (`id`, `agentType`, `description`), `live?` (`status`), `parseErrors`.
- Tête : blocs de 64 Kio jusqu'à obtenir `cwd` et `sessionId` (4 Mio max) : `cwd`, `gitBranch`, `version`,
  `entrypoint`, `startedAt` (1er `timestamp`), premier message `user` en texte qui ne commence pas par `<`
  (120 car.).
- Titre personnalisé (`/rename`) : ligne `{"type":"custom-title","customTitle":…,"sessionId":…}` (observée le
  2026-11-11, `npm run probe`).
- Queue : 256 Kio de fin (1re ligne partielle ignorée) : dernier `custom-title`/`ai-title`/`last-prompt`, dernier
  `cost-state.totalCostUSD`, dernier `timestamp` = `endedAt`. Titre : custom > ai > last-prompt > first-prompt.
- Jamais de lecture complète pour la liste. Ligne non JSON ou type inconnu : comptés, ignorés. Lignes `isSidechain`
  ignorées.
- Projet affiché = cwd de la session la plus récente ; deux dossiers Claude de même cwd (casse `C-`/`c-`) =
  un seul projet.

### 8.3 Cache
`cache/sessions-v1.json` : `{ "<chemin du .jsonl>": { "size", "mtimeMs", "summary" } }` ; entrée réutilisée si
taille et `mtimeMs` inchangés. Changement de format interne → nouveau nom de fichier (`-v2`).

### 8.4 Document de session (lecture complète, à la demande)
URI `claude-session:/<claudeDir>/<sessionId>.md?page=N` (`/subagents/<agentId>` pour un sous-agent), lecture en
flux `readline`, 200 entrées affichables par page, liens « page suivante ». Rendu Markdown : messages `user` et
`assistant` (texte), `tool_use` = nom + entrée résumée (300 car.), `tool_result` coupé à 1 500 car., blocs
`thinking` et `attachment` omis, tout texte de transcript placé dans des blocs de code clôturés (jamais interprété).

## 9. Installation de l'intégration Claude

Dépôt : `claude-plugin/.claude-plugin/marketplace.json` (marketplace `projects-hub-local`) et
`claude-plugin/projects-hub/` (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json`, `dist/`). Le nom de
plugin ne commence pas par `claude-` (réservé par Claude Code).

`.mcp.json` :
```json
{ "mcpServers": { "hub": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp.js"] } } }
```
Commande « Installer l'intégration Claude » (proposée une fois, relançable) :
1. Vérifier `node --version` ≥ 20 sur le PATH ; sinon arrêt avec message.
2. Copier `claude-plugin/` de l'extension vers `HUB_HOME/marketplace/` (remplacement complet).
3. `claude plugin marketplace add "<HUB_HOME>\marketplace" --json` puis
   `claude plugin install projects-hub@projects-hub-local --json` (déjà installé = succès).
4. `claude` introuvable : afficher les deux commandes `/plugin …` à taper dans Claude Code.
À chaque nouvelle version de l'extension : étape 2 seulement (marketplace locale lue en place, version non figée).
Désinstallation : commande « Retirer l'intégration » (`claude plugin uninstall projects-hub@projects-hub-local`).
Les appels d'outils MCP demandent une permission tant que la règle `mcp__plugin_projects-hub_hub` (préfixe réel
relevé en T6) n'est pas dans `permissions.allow` de `~/.claude/settings.json`. L'extension ne modifie jamais ce
fichier : sur ce poste, la règle est ajoutée après T6 par l'agent de configuration ; ailleurs, l'utilisateur
l'ajoute lui-même (README).

## 10. Vues VS Code

Conteneur « Claude Hub » dans la barre d'activité, deux vues :
- **Projets** : « Projet ouvert » (celui du dossier de travail) en tête, puis les projets par activité ; nœuds
  « À rattacher », « Orphelins », « Temporaires » (sessions des dossiers exclus §7.3 ; replié, masqué si `claudeProjectsHub.showTemporaryProjects` est
  faux). Projet → « Mémoire (n) » (topics), « Auto-mémoire Claude (n) » (lecture seule), « Sessions (n) » →
  sous-agents. Description d'une session : date · entrypoint · coût · « en cours » ; infobulle : chemin, branche,
  version.
- **Mémoire globale** : topics globaux.
Clic sur un topic : ouvre le fichier `.md` dans l'éditeur. Clic sur une session : document de session (§8.4).
Commandes : Rafraîchir, Nouveau topic, Supprimer le topic (corbeille), Supprimer la session… (corbeille, sélection
multiple, ou toutes les sessions d'un projet ou d'un orphelin ; ADR 0007), Importer en topic (souvenir d'auto-mémoire →
topic projet ou global), Reprendre dans Claude (`vscode://anthropic.claude-code/open?session=<id>`), Reprendre dans
un terminal (cwd = dossier vivant du projet, `claude --resume <id>`), Ouvrir le dossier, Rattacher à un projet…,
Détacher ce dossier, Copier l'auto-mémoire, Rafraîchir les empreintes, Aperçu de l'injection, Installer / Retirer
l'intégration, Diagnostic (canal de sortie : lignes illisibles, types inconnus, fin des journaux).
Rafraîchissement : observateurs de fichiers sur `HUB_HOME/**/*.md` et `CLAUDE_HOME/projects/**/*.jsonl`, regroupés
toutes les 2 s.

## 11. Budgets (mesurés par l'étape indiquée)
| Mesure | Cible | Étape |
|---|---|---|
| Scan à froid du poste | < 2 s ; octets lus / sessions ≤ 320 Kio (tête 64 Kio + queue 256 Kio ; une tête prolongée, 4 Mio max, est admise si la moyenne tient) | T2 (`npm run probe`) |
| Scan avec cache | < 300 ms | T2 |

Mesure du 2026-11-11 (`npm run probe`, poste de référence) : 13 projets, 72 sessions, 18,80 Mo lus (≈ 0,26 Mo par
session), froid 487 ms, cache 18 ms. L'ancienne cible « < 20 Mo lus » valait pour 38 sessions ; elle est remplacée
par la cible par session (point g).
| Hook SessionStart | < 150 ms (hors démarrage de Node) | T4 |
| Texte injecté | ≤ 4 000 caractères | T4 |
| Page de document de session (84 Mo) | < 2 s | T7 |
| `.vsix` | < 3 Mo | T9 |

## 12. Sécurité et confidentialité
- Rien ne quitte le poste ; aucun appel réseau.
- Les topics globaux sont injectés dans tous les projets : une information d'un client peut atteindre un autre
  projet. Garde-fous : consigne dans l'en-tête et les descriptions, détection de secrets (§4.4), topics visibles et
  modifiables dans VS Code.
- Le contenu des transcripts n'est jamais interprété comme du Markdown actif ni du HTML (blocs de code).
- Seules écritures hors `HUB_HOME` : le marqueur du projet et sa ligne dans `info/exclude` du dépôt (§7.3), la
  copie d'auto-mémoire confirmée (§7.5), et la mise à la corbeille de sessions confirmée (ADR 0007 : jamais de
  suppression définitive, jamais une session vivante, chemins confinés sous `CLAUDE_HOME`).

## 13. Reporté (hors v1)
Injection dans les sous-agents (SubagentStart) ; rappel par UserPromptSubmit ; outil de suppression pour Claude ;
recherche plein texte dans les transcripts ; tableau de bord en webview ; archivage des transcripts avant leur
purge par Claude Code (`cleanupPeriodDays`) ; déplacement des transcripts orphelins ; repli sur l'Agent SDK si le
format JSONL casse ; synchronisation de la mémoire entre postes ; Node fourni par VS Code (`ELECTRON_RUN_AS_NODE`)
quand Node manque ; règle de permission posée par l'extension ; CI GitHub Actions ; publication sur la Marketplace.

## 14. Révisions
| Date | Point | Sections | Décision |
|---|---|---|---|
| 2026-11-11 | e | §4.1, §5 | comportements de T1 entérinés (`invalid_input` sans id, `not_found` sur `baseRevision` d'un topic absent, date `AAAA-MM-JJTHH:MMZ`) ; résolution côté MCP précisée |
| 2026-11-11 | f | §8.2 | forme du titre personnalisé inscrite |
| 2026-11-11 | g | §11 | budget de lecture par session |
| 2026-11-11 | j1 | §7.1 | orphelin ignoré = son id dans son propre `dismissed` |
| 2026-11-11 | j2 | §7.3 | racine = dossier du marqueur trouvé |
| 2026-11-11 | j3 | §7.3, §7.4 | chemin disparu retiré par le scan seul ; P = cwd au scan |
| 2026-11-11 | j4 | §7.4 | un `.bak` par passage, Annuler par passage, refus si `.bak` réécrit (code à changer) |
| 2026-11-11 | j5 | §7.5 | limites de `copyAutoMemory` acceptées |
| 2026-11-11 | j6 | §7.4 | aucun git sous le verrou du registre (code à changer) |
| 2026-11-11 | a, b, h | ADR 0005, ADR 0001 | amendements datés |
| 2026-11-11 | 0.2 | §3, §10, §12, ADR 0007 | suppression de sessions : mise à la corbeille du transcript, du dossier de session, de `file-history/<id>` et `session-env/<id>`, sur confirmation, jamais pour une session vivante |
| 2026-11-11 | T11 | §7.3, §7.4 | revue finale : marqueur d'un parent seulement dans un dépôt git ; Détacher refusé hors racine ; dossier mort rattaché à l'entrée du hook (pas d'orphelin doublon) ; Annuler d'un passage à plusieurs fusions = un seul appel `undoMerge(hub, records[])` qui restaure le `.bak` une fois et inscrit tous les refus |
| 2026-11-11 | o | §7.4 | Annuler durable : `.bak` pris juste avant la première fusion (C garde son id), C inscrit dans `O.dismissed` (défaut trouvé en T8 : le scan suivant refusionnait) |
| 2026-11-11 | k, l, m | §5, §6.3 | date locale dans les lignes d'index ; `excluded` dans le type des codes ; format `tags: [a, b]` de `memory_read` ; `writeTopic` accepte `importedFrom` (import d'auto-mémoire) |
