# 0006 - Interface VS Code : vues en arbre et documents Markdown, pas de webview en v1

Statut : acceptée (2026-11-06)

## Contexte
Priorités de l'utilisateur : qualité et efficacité, puis ergonomie. Il faut parcourir projets, sessions,
sous-agents et topics, lire une session et éditer un topic, reprendre une session (seule interface de l'extension
officielle : URI `vscode://anthropic.claude-code/open?session=<id>` ; en terminal `claude --resume <id>`).

## Options
1. Webview complète (tableau de bord, lecteur de session, éditeur de topic) : riche, mais code d'interface, CSP,
   échappement, messages entre processus, accessibilité à refaire.
2. **TreeView native + documents virtuels Markdown (`TextDocumentContentProvider`) pour les sessions + éditeur
   standard pour les topics.** Recherche (Ctrl+F), aperçu Markdown, thèmes, clavier et accessibilité fournis par
   VS Code.

## Décision
Option 2, détail dans architecture §8.4 et §10. Reprise : bouton « Reprendre dans Claude » (URI officielle) et
« Reprendre dans un terminal » (cwd = dossier vivant du projet).

## Conséquences
- Peu de code d'interface, aucune surface HTML ; le texte des transcripts est rendu en blocs de code.
- Pas de vue synthétique graphique (coûts, activité) en v1 : description et infobulle des nœuds seulement ;
  tableau de bord en webview reporté.
- Pages de 200 entrées : relire depuis le début pour la page N (raccourci accepté, ~84 Mo en flux < 2 s, à
  mesurer en T7).
