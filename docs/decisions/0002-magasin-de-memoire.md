# 0002 - Magasin de mémoire par topics

Statut : acceptée (2026-11-06)

## Contexte
Plusieurs sessions Claude (CLI et extension) peuvent écrire en même temps ; l'utilisateur veut lire et corriger la
mémoire dans VS Code ; des topics globaux servent à tous les projets ; la mémoire doit survivre au déplacement du
projet. Claude Code a déjà une auto-mémoire par chemin (`projects/<dir>/memory/`), chargée au démarrage.

## Options
1. Topics dans le projet (`<projet>/.claude/topics/`) : suivent le dossier, mais finissent dans git sans le
   vouloir, n'existent pas pour les topics globaux, et polluent chaque dépôt.
2. SQLite central : requêtes faciles, mais dépendance native (binaire par plateforme dans le `.vsix`), fichiers
   illisibles pour l'utilisateur, verrous à gérer quand même.
3. **Fichiers Markdown centraux** dans `HUB_HOME`, un fichier par topic, frontmatter minimal, identité de projet
   par marqueur et registre (ADR 0003).
4. Écrire dans l'auto-mémoire Claude : format interne, par chemin, aucun global, risque de casser ce que Claude
   charge lui-même.

## Décision
Option 3, contrat dans architecture §4 : `ref` `project:<slug>` / `global:<slug>`, frontmatter `title`, `summary`,
`tags`, dates = `mtime`, révision = SHA-256 tronqué, verrou fichier `wx` + écriture temporaire + `rename`,
contrôle optimiste par `baseRevision`, ajout daté sans conflit (`memory_append`), détection de secrets fermée.

Auto-mémoire Claude : cohabitation sans synchronisation. Elle est affichée en lecture seule sous chaque projet ;
la commande « Importer en topic » copie un souvenir vers un topic projet ou global (`importedFrom`) ; elle n'est
jamais injectée par le hook (Claude la charge déjà). Partage des rôles annoncé à Claude : topics = savoir par
sujet à partager (décisions, conventions, état d'un chantier, savoir commun à plusieurs projets) ; l'auto-mémoire
reste à Claude pour ses retours et préférences.

## Conséquences
- Aucune dépendance ; les topics s'ouvrent dans l'éditeur standard, l'utilisateur les modifie librement.
- Une édition manuelle qui casse le frontmatter rend le topic « invalide » (affiché, jamais réécrit).
- Recouvrement possible entre topics projet et auto-mémoire : accepté, réduit par la consigne d'injection ; à
  mesurer après usage réel.
- Mémoire locale au poste (synchronisation reportée).
