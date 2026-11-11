# Essai bout en bout dans de vraies sessions `claude -p` (2 appels) : injection de l'index, puis écriture d'un topic.
$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $root 'claude-plugin\projects-hub'
if (-not (Test-Path (Join-Path $plugin 'dist\hook.js'))) { throw "dist absent : lancer npm run build" }

# Hors %TEMP% (dossiers exclus) et stable, pour ne pas multiplier les transcripts orphelins.
$work = Join-Path $env:LOCALAPPDATA 'projects-hub-e2e'
New-Item -ItemType Directory -Force $work | Out-Null
$hub = Join-Path ([IO.Path]::GetTempPath()) ('hub-e2e-' + [guid]::NewGuid().ToString('N'))
$witness = 'temoin' + (Get-Random -Minimum 100000 -Maximum 999999)
$old = $env:CLAUDE_PROJECTS_HUB_HOME
$fail = $false
try {
  $env:CLAUDE_PROJECTS_HUB_HOME = $hub
  $gdir = Join-Path $hub 'global\topics'
  New-Item -ItemType Directory -Force $gdir | Out-Null
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $gdir 'e2e-temoin.md'), "---`ntitle: Essai e2e`nsummary: mot temoin $witness`ntags: []`n---`nCorps de l'essai.`n", $utf8)

  Push-Location $work
  # 1. Injection : Claude doit citer le mot témoin sans appeler d'outil.
  $out1 = & claude --plugin-dir $plugin -p "Quel est le mot temoin indique dans ta memoire partagee (projects-hub) ? Reponds par ce seul mot." --output-format stream-json --verbose --max-turns 2 | Out-String
  $prefix = ([regex]::Match($out1, 'mcp__[A-Za-z0-9_.-]+?__(?=memory_write)')).Value
  if ($prefix) { Write-Host "Prefixe reel des outils : $prefix" } else { Write-Host "Prefixe introuvable dans la sortie de la session 1" }
  $reply = ($out1 -split "`r?`n" | Where-Object { $_ -like '{*' } | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.type -eq 'result' } | Select-Object -Last 1).result
  if ($reply -match $witness) { Write-Host "OK 1/2 injection : mot temoin $witness cite dans la reponse" }
  elseif ($out1 -match $witness) { Write-Host "ECHEC 1/2 : injection OK (mot temoin dans le contexte) mais citation absente de la reponse : $reply"; $fail = $true }
  else { Write-Host "ECHEC 1/2 : mot temoin absent. SessionStart ne part peut-etre pas en -p. Procedure : claude --plugin-dir `"$plugin`" en session interactive, avec CLAUDE_PROJECTS_HUB_HOME=$hub, et demander le mot temoin."; $fail = $true }

  # 2. Ecriture : seul memory_write est autorise.
  if (-not $prefix) { $prefix = 'mcp__plugin_projects-hub_hub__' }
  $null = & claude --plugin-dir $plugin -p "Cree le topic project:essai (titre Essai, resume 'essai e2e', corps 'ok') avec memory_write." --allowedTools "${prefix}memory_write" --max-turns 4
  $found = Get-ChildItem -Path (Join-Path $hub 'projects') -Recurse -Filter 'essai.md' -ErrorAction SilentlyContinue
  $txt = if ($found) { [IO.File]::ReadAllText($found[0].FullName) } else { '' }
  if ($found -and $txt -match '(?ms)\A---\r?\n.*?^title: \S.*?^summary: \S.*?^---' ) { Write-Host "OK 2/2 ecriture : $($found[0].FullName) (frontmatter title et summary non vides)" }
  elseif ($found) { Write-Host "ECHEC 2/2 : essai.md au contenu non conforme :`n$txt"; $fail = $true }
  else { Write-Host "ECHEC 2/2 : essai.md absent sous $hub"; $fail = $true }
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  $env:CLAUDE_PROJECTS_HUB_HOME = $old
  if (Test-Path $hub) { Remove-Item -Recurse -Force $hub }
}
if ($fail) { exit 1 }
