# Publishes ONLY binaries to GitHub (orphan commit, force-push).
# Run: npm run dist; npm run pack-fivem; then this script with -Force.
# Before -DeleteOtherRemoteBranches: set Default branch on GitHub to -BranchName (e.g. stable).

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string] $PortableExe,

  [Parameter(Mandatory = $false)]
  [string] $FivemZip = "",

  [Parameter(Mandatory = $true)]
  [string] $Version,

  [string] $RemoteUrl = "https://github.com/magner85/AfterlifeLauncher.git",

  [string] $BranchName = "stable",

  [switch] $AlsoPublishFivemBranch,

  [switch] $DeleteOtherRemoteBranches,

  [switch] $Force
)

$ErrorActionPreference = "Stop"

$GitExe = $null
if (Get-Command git -ErrorAction SilentlyContinue) {
  $GitExe = (Get-Command git).Source
} else {
  foreach ($c in @(
      'C:\Program Files\Git\bin\git.exe',
      'C:\Program Files\Git\cmd\git.exe',
      'C:\Program Files (x86)\Git\bin\git.exe'
    )) {
    if (Test-Path -LiteralPath $c) {
      $GitExe = $c
      break
    }
  }
}
if (-not $GitExe) {
  throw "git not found. Install Git for Windows or add git to PATH."
}

$GitLfsExe = $null
if (Get-Command git-lfs -ErrorAction SilentlyContinue) {
  $GitLfsExe = (Get-Command git-lfs).Source
} else {
  foreach ($c in @(
      'C:\Program Files\Git\mingw64\bin\git-lfs.exe',
      'C:\Program Files\Git\usr\bin\git-lfs.exe',
      'C:\Program Files\Git LFS\git-lfs.exe'
    )) {
    if (Test-Path -LiteralPath $c) {
      $GitLfsExe = $c
      break
    }
  }
}
if (-not $GitLfsExe) {
  throw "Git LFS is required (FiveM.zip is >100MB). Install: https://git-lfs.com then run: git lfs install"
}

function Test-RealFile {
  param([string] $Path)
  if (-not $Path) { return $false }
  return (Test-Path -LiteralPath $Path -PathType Leaf)
}

if (-not (Test-RealFile $PortableExe)) {
  throw "Portable exe not found: $PortableExe"
}
if ($FivemZip -and -not (Test-RealFile $FivemZip)) {
  throw "FiveM zip not found: $FivemZip"
}

$portableName = Split-Path -Leaf $PortableExe
if ($portableName -notmatch '\.exe$') {
  throw "Expected .exe portable, got: $portableName"
}

if (-not $FivemZip -or -not (Test-RealFile $FivemZip)) {
  Write-Warning "No -FivemZip: FiveM.zip will not be on GitHub. Run: npm run pack-fivem"
}

$PortableExe = (Resolve-Path -LiteralPath $PortableExe).Path
if ($FivemZip) {
  $FivemZip = (Resolve-Path -LiteralPath $FivemZip).Path
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("al-dist-" + [Guid]::NewGuid().ToString("N"))
$cloneDir = Join-Path $tempRoot "repo"

try {
  New-Item -ItemType Directory -Path $cloneDir -Force | Out-Null
  Write-Host "Temp clone: $cloneDir"
  & $GitExe clone $RemoteUrl $cloneDir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed" }

  Push-Location $cloneDir

  & $GitExe config http.postBuffer 524288000

  & $GitExe checkout --orphan stable-dist
  if ($LASTEXITCODE -ne 0) { throw "orphan checkout failed" }
  & $GitExe rm -rf . 2>$null
  Remove-Item -LiteralPath * -Recurse -Force -ErrorAction SilentlyContinue

  & $GitLfsExe install --force
  if ($LASTEXITCODE -ne 0) { throw "git lfs install failed" }
  & $GitLfsExe track "*.zip"
  & $GitLfsExe track "*.exe"
  if (Test-Path -LiteralPath ".gitattributes") {
    & $GitExe add .gitattributes
  }

  Copy-Item -LiteralPath $PortableExe -Destination (Join-Path $cloneDir $portableName) -Force
  $addedFiles = @($portableName)

  $manifestPath = Join-Path $cloneDir "launcher-version.json"
  $manifestObj = [ordered]@{
    version = $Version
    file    = $portableName
  }
  $manifestObj | ConvertTo-Json -Compress | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  $addedFiles += "launcher-version.json"

  if ($FivemZip) {
    Copy-Item -LiteralPath $FivemZip -Destination (Join-Path $cloneDir "FiveM.zip") -Force
    $addedFiles += "FiveM.zip"
  }

  $encExe = [uri]::EscapeDataString($portableName) -replace '\+', '%20'
  $dlExe = "https://github.com/magner85/AfterlifeLauncher/raw/$BranchName/$encExe"
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add("# Afterlife Launcher (distribution branch)")
  [void]$lines.Add("")
  [void]$lines.Add("Binaries only. No application source code.")
  [void]$lines.Add("")
  [void]$lines.Add("## Portable build ($Version)")
  [void]$lines.Add("")
  [void]$lines.Add("- [$portableName]($dlExe) (Windows x64, no installer)")
  [void]$lines.Add("")

  if ($FivemZip) {
    $dlZip = "https://github.com/magner85/AfterlifeLauncher/raw/$BranchName/FiveM.zip"
    [void]$lines.Add("## FiveM client (ZIP)")
    [void]$lines.Add("")
    [void]$lines.Add("- [FiveM.zip]($dlZip) (first-time install via launcher)")
    [void]$lines.Add("")
  }

  [void]$lines.Add("---")
  [void]$lines.Add("")
  [void]$lines.Add("Branch ``$BranchName`` is updated by scripts/publish-distribution-branch.ps1 from your PC.")

  $readme = $lines -join "`n"
  Set-Content -LiteralPath (Join-Path $cloneDir "README.md") -Value $readme -Encoding UTF8

  & $GitExe add README.md launcher-version.json $portableName
  if ($FivemZip) { & $GitExe add "FiveM.zip" }
  & $GitExe commit -m "distribution: Afterlife Launcher $Version (portable only)"
  if ($LASTEXITCODE -ne 0) { throw "git commit failed" }

  & $GitExe branch -M $BranchName
  if ($Force -or $PSCmdlet.ShouldProcess($RemoteUrl, "git push --force $BranchName")) {
    & $GitExe push origin $BranchName --force
    if ($LASTEXITCODE -ne 0) { throw "git push $BranchName failed" }
  }

  if ($AlsoPublishFivemBranch -and $FivemZip) {
    & $GitExe checkout --orphan fivem-bundle-dist
    & $GitExe rm -rf . 2>$null
    Remove-Item -LiteralPath * -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $FivemZip -Destination (Join-Path $cloneDir "FiveM.zip") -Force
    $fm = @(
      '# FiveM.zip',
      '',
      '[FiveM.zip](https://github.com/magner85/AfterlifeLauncher/raw/fivem-bundle/FiveM.zip)'
    ) -join "`n"
    Set-Content -LiteralPath (Join-Path $cloneDir "README.md") -Value $fm -Encoding UTF8
    & $GitExe add README.md "FiveM.zip"
    & $GitExe commit -m "distribution: FiveM.zip bundle"
    & $GitExe branch -M fivem-bundle
    if ($Force -or $PSCmdlet.ShouldProcess($RemoteUrl, "git push --force fivem-bundle")) {
      & $GitExe push origin fivem-bundle --force
      if ($LASTEXITCODE -ne 0) { throw "git push fivem-bundle failed" }
    }
  }

  if ($DeleteOtherRemoteBranches) {
    Write-Host "Deleting remote branches except $BranchName ..."
    $heads = & $GitExe ls-remote --heads origin
    foreach ($line in $heads) {
      if (-not $line) { continue }
      $ref = ($line -split '\s+')[1]
      if ($ref -notmatch 'refs/heads/(.+)$') { continue }
      $b = $Matches[1]
      if ($b -eq $BranchName) { continue }
      if ($b -eq 'fivem-bundle' -and $AlsoPublishFivemBranch) { continue }
      if ($Force -or $PSCmdlet.ShouldProcess($b, "git push --delete origin $b")) {
        & $GitExe push origin --delete $b
      }
    }
  }

  Write-Host "Done. Branch $BranchName : $($addedFiles -join ', ')"
  Write-Host "Open: $RemoteUrl branch $BranchName. App version must match $Version."
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
