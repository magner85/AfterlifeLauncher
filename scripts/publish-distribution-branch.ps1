# Публикация на GitHub ТОЛЬКО бинарников (без исходного кода).
# Orphan-коммит перезаписывает ветку — после push на странице репозитория будут только README, launcher-version.json, exe и (если указан) FiveM.zip.
#
# ПОРЯДОК ДЕЙСТВИЙ:
#  1) npm run dist  — собрать portable .exe
#  2) npm run pack-fivem  — получить bundled-fivem\FiveM.zip (иначе игроки не смогут скачать клиент с GitHub)
#  3) В package.json версия должна совпадать с -Version (её читает лаунчер для сравнения с launcher-version.json)
#  4) Запустить этот скрипт с -Force. При первой чистке: сначала на github.com → Settings → сменить Default branch на ту же, что -BranchName (например stable), ПОТОМ -DeleteOtherRemoteBranches
#  5) Убедиться, что git login (gh auth login или credential manager) работает для push
#
# Пример:
#   .\scripts\publish-distribution-branch.ps1 -PortableExe ".\release\Afterlife Launcher-0.25.0-portable.exe" -FivemZip ".\bundled-fivem\FiveM.zip" -Version "0.25.0" -DeleteOtherRemoteBranches -Force

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

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Команда git не найдена в PATH. Установите Git for Windows и откройте новый терминал."
}

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

if (-not $FivemZip -or -not (Test-RealFile $FivemZip)) {
  Write-Warning "Не указан рабочий -FivemZip. На GitHub не попадёт FiveM.zip — автоскачивание клиента в лаунчере даст 404, пока не запакуете архив (npm run pack-fivem) и не перезапустите скрипт с -FivemZip."
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

  $encExe = [uri]::EscapeDataString($portableName) -replace '\+','%20'
  $dlExe = "https://github.com/magner85/AfterlifeLauncher/raw/$BranchName/$encExe"
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
    $dlZip = "https://github.com/magner85/AfterlifeLauncher/raw/$BranchName/FiveM.zip"
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
    "*Ветка ``$BranchName`` — только сборки; исходники в этот репозиторий не публикуются.*"
  ) -join "`n"

  Set-Content -LiteralPath (Join-Path $cloneDir "README.md") -Value $readme -Encoding UTF8

  git add README.md launcher-version.json $portableName
  if ($FivemZip) { git add "FiveM.zip" }
  git commit -m "distribution: Afterlife Launcher $Version (portable only)"
  if ($LASTEXITCODE -ne 0) { throw "commit stable failed" }

  git branch -M $BranchName
  if ($Force -or $PSCmdlet.ShouldProcess($RemoteUrl, "git push --force $BranchName")) {
    git push origin $BranchName --force
    if ($LASTEXITCODE -ne 0) { throw "git push $BranchName failed" }
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
    Write-Host "Удаление удалённых веток, кроме $BranchName$(if ($AlsoPublishFivemBranch) { ' и fivem-bundle' })..."
    $heads = git ls-remote --heads origin
    foreach ($line in $heads) {
      if (-not $line) { continue }
      $ref = ($line -split '\s+')[1]
      if ($ref -notmatch 'refs/heads/(.+)$') { continue }
      $b = $Matches[1]
      if ($b -eq $BranchName) { continue }
      if ($b -eq 'fivem-bundle' -and $AlsoPublishFivemBranch) { continue }
      if ($Force -or $PSCmdlet.ShouldProcess($b, "git push --delete origin $b")) {
        git push origin --delete $b
      }
    }
  }

  Write-Host "Готово. Ветка $BranchName на GitHub: README.md, $($addedFiles -join ', ')."
  Write-Host "Проверьте в браузере: $RemoteUrl (ветка $BranchName). Версия в package.json лаунчера и поле version в launcher-version.json должны совпадать с $Version."
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
