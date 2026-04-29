# Публикация на GitHub ТОЛЬКО бинарников (без исходного кода).
# Создаёт «чистую» историю ветки stable (и опционально fivem-bundle) через orphan commit.
#
# ВАЖНО:
# 1) На github.com в настройках репозитория смените Default branch на stable (если раньше был main).
# 2) Убедитесь, что portable .exe и при необходимости FiveM.zip уже собраны (см. npm run dist, npm run pack-fivem).
# 3) Файлы > ~100 МБ могут требовать Git LFS — при отказе push включите LFS для *.exe / *.zip.
#
# Пример:
#   .\scripts\publish-distribution-branch.ps1 -PortableExe "..\release\Afterlife Launcher-0.25.0-portable.exe" -FivemZip "..\bundled-fivem\FiveM.zip" -Version "0.25.0"

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string] $PortableExe,

  [Parameter(Mandatory = $false)]
  [string] $FivemZip = "",

  [Parameter(Mandatory = $true)]
  [string] $Version,

  [string] $RemoteUrl = "https://github.com/magner85/AfterlifeLauncher.git",

  [switch] $AlsoPublishFivemBranch,

  [switch] $DeleteOtherRemoteBranches,

  [switch] $Force
)

$ErrorActionPreference = "Stop"

function Test-RealFile {
  param([string] $Path)
  if (-not $Path) { return $false }
  return (Test-Path -LiteralPath $Path -PathType Leaf)
}

if (-not (Test-RealFile $PortableExe)) {
  throw "Не найден portable: $PortableExe"
}
if ($FivemZip -and -not (Test-RealFile $FivemZip)) {
  throw "Не найден архив FiveM: $FivemZip"
}

$portableName = Split-Path -Leaf $PortableExe
if ($portableName -notmatch '\.exe$') {
  throw "Ожидается .exe portable, получено: $portableName"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("al-dist-" + [Guid]::NewGuid().ToString("N"))
$cloneDir = Join-Path $tempRoot "repo"

try {
  New-Item -ItemType Directory -Path $cloneDir -Force | Out-Null
  Write-Host "Клон (временно): $cloneDir"
  git clone $RemoteUrl $cloneDir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed" }

  Push-Location $cloneDir

  # --- stable: только exe (+ опционально FiveM.zip) + короткий README ---
  git checkout --orphan stable-dist
  if ($LASTEXITCODE -ne 0) { throw "orphan checkout failed" }
  git rm -rf . 2>$null
  Remove-Item -LiteralPath * -Recurse -Force -ErrorAction SilentlyContinue

  Copy-Item -LiteralPath $PortableExe -Destination (Join-Path $cloneDir $portableName) -Force
  $addedFiles = @($portableName)

  if ($FivemZip) {
    Copy-Item -LiteralPath $FivemZip -Destination (Join-Path $cloneDir "FiveM.zip") -Force
    $addedFiles += "FiveM.zip"
  }

  $dlExe = "https://github.com/magner85/AfterlifeLauncher/raw/stable/$portableName"
  $readme = @(
    '# Afterlife Launcher — сборки',
    '',
    'В этом репозитории **только готовые файлы** для игроков и автообновления лаунчера (исходного кода здесь нет).',
    '',
    "## Скачать portable ($Version)",
    '',
    "- **[$portableName]($dlExe)** — запуск без установки (Windows x64).",
    ''
  ) -join "`n"

  if ($FivemZip) {
    $dlZip = 'https://github.com/magner85/AfterlifeLauncher/raw/stable/FiveM.zip'
    $readme += @(
      '## Клиент FiveM (архив)',
      '',
      "- **[FiveM.zip]($dlZip)** — для первичной установки клиента из лаунчера.",
      ''
    ) -join "`n"
  }

  $readme += @(
    '---',
    '',
    '*Ветка `stable` обновляется скриптом `publish-distribution-branch.ps1` локально; исходники на GitHub не публикуются.*'
  ) -join "`n"

  Set-Content -LiteralPath (Join-Path $cloneDir "README.md") -Value $readme -Encoding UTF8

  git add README.md $portableName
  if ($FivemZip) { git add "FiveM.zip" }
  git commit -m "distribution: Afterlife Launcher $Version (portable only)"
  if ($LASTEXITCODE -ne 0) { throw "commit stable failed" }

  git branch -M stable
  if ($Force -or $PSCmdlet.ShouldProcess($RemoteUrl, "git push --force stable")) {
    git push origin stable --force
    if ($LASTEXITCODE -ne 0) { throw "git push stable failed" }
  }

  # --- опционально: отдельная ветка только с FiveM.zip ---
  if ($AlsoPublishFivemBranch -and $FivemZip) {
    git checkout --orphan fivem-bundle-dist
    git rm -rf . 2>$null
    Remove-Item -LiteralPath * -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $FivemZip -Destination (Join-Path $cloneDir "FiveM.zip") -Force
    $readmeFm = @(
      '# FiveM.zip (bundle)',
      '',
      'Прямая ссылка: [FiveM.zip](https://github.com/magner85/AfterlifeLauncher/raw/fivem-bundle/FiveM.zip)'
    ) -join "`n"
    Set-Content -LiteralPath (Join-Path $cloneDir "README.md") -Value $readmeFm -Encoding UTF8
    git add README.md "FiveM.zip"
    git commit -m "distribution: FiveM.zip bundle"
    git branch -M fivem-bundle
    if ($Force -or $PSCmdlet.ShouldProcess($RemoteUrl, "git push --force fivem-bundle")) {
      git push origin fivem-bundle --force
      if ($LASTEXITCODE -ne 0) { throw "git push fivem-bundle failed" }
    }
  }

  if ($DeleteOtherRemoteBranches) {
    Write-Host "Удаление удалённых веток, кроме stable$(if ($AlsoPublishFivemBranch) { ' и fivem-bundle' })..."
    $heads = git ls-remote --heads origin
    foreach ($line in $heads) {
      if (-not $line) { continue }
      $ref = ($line -split '\s+')[1]
      if ($ref -notmatch 'refs/heads/(.+)$') { continue }
      $b = $Matches[1]
      if ($b -eq 'stable') { continue }
      if ($b -eq 'fivem-bundle' -and $AlsoPublishFivemBranch) { continue }
      if ($Force -or $PSCmdlet.ShouldProcess($b, "git push --delete origin $b")) {
        git push origin --delete $b
      }
    }
  }

  Write-Host "Готово. Ветка stable на GitHub содержит только: README.md, $($addedFiles -join ', ')."
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
