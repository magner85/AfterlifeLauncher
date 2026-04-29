# Upload bundled-fivem\FiveM.zip to GitHub Release (tag fivem-bundle).
# Requires: winget install GitHub.cli
# Run once: gh auth login
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$zip = Join-Path $root 'bundled-fivem\FiveM.zip'
if (-not (Test-Path -LiteralPath $zip)) {
    Write-Error "Missing $zip - run npm run pack-fivem first"
}
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    Write-Error "Install GitHub CLI: winget install GitHub.cli then gh auth login"
}
$repo = 'magner85/AfterlifeLauncher'
$tag = 'fivem-bundle'
$null = gh release view $tag --repo $repo 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Release $tag exists - uploading FiveM.zip"
    gh release upload $tag $zip --repo $repo --clobber
} else {
    Write-Host "Creating release $tag"
    gh release create $tag $zip --repo $repo --title 'FiveM bundle (launcher)' --notes 'Bundle for Afterlife Launcher auto-install. Server resource caches included. game-storage (GTA) excluded - players need GTA V.'
}
Write-Host 'Done.'
