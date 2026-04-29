/**
 * Собирает bundled-fivem/FiveM.zip из %LocalAppData%\\FiveM.
 *
 * По умолчанию ВКЛЮЧАЕТ кеши ресурсов сервера (data/server-cache*, data/cache, …)
 * и ИСКЛЮЧАЕТ FiveM.app/data/game-storage — это кеш Rockstar/GTA (гигабайты, не для раздачи,
 * не влезает в лимит GitHub 2 ГБ). У игроков должен быть свой GTA V.
 *
 * Полная копия (в т.ч. game-storage): node scripts/pack-fivem-zip.js --full
 *
 * npm run pack-fivem
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Префиксы путей относительно папки FiveM (как в архиве). */
const EXCLUDE_UNLESS_FULL = ['FiveM.app/data/game-storage'];

function excluded(relPosix, fullMode) {
  if (fullMode) return false;
  const r = relPosix.toLowerCase();
  for (const ex of EXCLUDE_UNLESS_FULL) {
    const e = ex.toLowerCase();
    if (r === e || r.startsWith(`${e}/`)) return true;
  }
  return false;
}

function copyFiltered(from, to, relPosix, fullMode) {
  if (excluded(relPosix, fullMode)) {
    console.log('[exclude]', relPosix || '(root)');
    return;
  }
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const r2 = relPosix ? `${relPosix}/${e.name}` : e.name;
      copyFiltered(path.join(from, e.name), path.join(to, e.name), r2, fullMode);
    }
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function main() {
  const fullMode = process.argv.includes('--full');
  if (process.platform !== 'win32') {
    console.error('pack-fivem: нужен Windows.');
    process.exit(1);
  }
  const base = process.env.LOCALAPPDATA;
  if (!base) {
    console.error('pack-fivem: нет LOCALAPPDATA.');
    process.exit(1);
  }
  const src = path.join(base, 'FiveM');
  const exe = path.join(src, 'FiveM.exe');
  if (!fs.existsSync(exe)) {
    console.error('pack-fivem: не найден', exe);
    process.exit(1);
  }
  const root = path.join(__dirname, '..');
  const outDir = path.join(root, 'bundled-fivem');
  const outZip = path.join(outDir, 'FiveM.zip');
  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

  const staging = path.join(os.tmpdir(), `afterlife-fivem-stage-${Date.now()}`);
  fs.mkdirSync(staging, { recursive: true });
  console.log(fullMode ? 'Режим: полный (+ game-storage)' : 'Режим: для раздачи (без game-storage, с кешами сервера)');
  console.log('Копирование в staging…');
  try {
    copyFiltered(src, staging, '', fullMode);
    const pat = path.join(staging, '*').replace(/'/g, "''");
    const outLit = outZip.replace(/'/g, "''");
    const cmd = `Compress-Archive -Path '${pat}' -DestinationPath '${outLit}' -CompressionLevel Optimal -Force`;
    console.log('Сжатие ZIP…');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      stdio: 'inherit'
    });
  } finally {
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch (_) {}
  }
  const st = fs.statSync(outZip);
  const mb = st.size / 1048576;
  console.log('');
  console.log('Готово:', outZip, `(${mb.toFixed(1)} MB)`);
  if (mb > 1900) {
    console.warn('Внимание: файл > ~1.9 GB — GitHub Release принимает максимум 2 GB на файл.');
  }
  console.log('Публикация: scripts\\publish-fivem-bundle.ps1 или вручную Release с тегом fivem-bundle');
  console.log('');
}

main();
