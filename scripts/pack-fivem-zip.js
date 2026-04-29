/**
 * Собирает bundled-fivem/FiveM.zip из %LocalAppData%\\FiveM (уже установленный клиент).
 * npm run pack-fivem
 * Потом выложите архив в GitHub: релиз с тегом fivem-bundle, вложение FiveM.zip
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function main() {
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
    console.error('Один раз установите FiveM с официального сайта, затем повторите npm run pack-fivem');
    process.exit(1);
  }
  const root = path.join(__dirname, '..');
  const outDir = path.join(root, 'bundled-fivem');
  const outZip = path.join(outDir, 'FiveM.zip');
  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

  const pat = path.join(src, '*').replace(/'/g, "''");
  const outLit = outZip.replace(/'/g, "''");
  const cmd = `Compress-Archive -Path '${pat}' -DestinationPath '${outLit}' -CompressionLevel Optimal -Force`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      stdio: 'inherit'
    });
  } catch {
    process.exit(1);
  }
  const st = fs.statSync(outZip);
  console.log('');
  console.log('Готово:', outZip, `(${(st.size / 1048576).toFixed(1)} MB)`);
  console.log('GitHub: Releases → New release → tag: fivem-bundle → прикрепите FiveM.zip');
  console.log('');
}

main();
