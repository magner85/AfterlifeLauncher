/**
 * Заливка на FTP: launcher-version.json, portable exe, FiveM.zip.
 * Учётные данные только в ftp-upload.env (файл в .gitignore).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('basic-ftp');

const root = path.join(__dirname, '..');

function loadEnv() {
  const p = path.join(root, 'ftp-upload.env');
  if (!fs.existsSync(p)) {
    console.error('');
    console.error('  Нет файла ftp-upload.env');
    console.error('  Скопируйте ftp-upload.env.example → ftp-upload.env и заполните FTP_HOST, FTP_USER, FTP_PASSWORD.');
    console.error('');
    process.exit(1);
  }
  const o = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return o;
}

function findPortableExe(version) {
  const rel = path.join(root, 'release');
  const exact = path.join(rel, `Afterlife Launcher-${version}-portable.exe`);
  if (fs.existsSync(exact)) return exact;
  if (!fs.existsSync(rel)) return null;
  const files = fs.readdirSync(rel).filter((f) => /portable\.exe$/i.test(f));
  if (!files.length) return null;
  let best = null;
  let mt = 0;
  for (const f of files) {
    const fp = path.join(rel, f);
    try {
      const s = fs.statSync(fp);
      if (s.mtimeMs >= mt) {
        mt = s.mtimeMs;
        best = fp;
      }
    } catch (_) {}
  }
  return best;
}

function findFivemZip(env) {
  if (env.FIVEM_ZIP_PATH && fs.existsSync(env.FIVEM_ZIP_PATH)) return env.FIVEM_ZIP_PATH;
  const bundled = path.join(root, 'bundled-fivem', 'FiveM.zip');
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

async function main() {
  const env = loadEnv();
  const host = env.FTP_HOST || '';
  const user = env.FTP_USER || '';
  const password = env.FTP_PASSWORD || '';
  const remoteDir = (env.FTP_REMOTE_DIR || 'launcher').replace(/\\/g, '/').replace(/^\/+/, '');
  const httpsBase = (env.HTTPS_PUBLIC_BASE || 'https://afterlifedayz.ru/launcher').replace(/\/$/, '');
  const port = parseInt(env.FTP_PORT || '21', 10) || 21;

  if (!host || !user || !password) {
    console.error('В ftp-upload.env укажите FTP_HOST, FTP_USER, FTP_PASSWORD.');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = String(pkg.version || '').trim();
  if (!version) {
    console.error('В package.json нет version.');
    process.exit(1);
  }

  const portableName = `Afterlife Launcher-${version}-portable.exe`;
  const portablePath = findPortableExe(version);
  if (!portablePath) {
    console.error(`Не найден portable exe. Сначала соберите: npm run dist`);
    console.error(`Ожидался файл в release/: «${portableName}»`);
    process.exit(1);
  }

  const fivemZip = findFivemZip(env);
  if (!fivemZip) {
    console.error('Не найден FiveM.zip.');
    console.error('Положите архив в bundled-fivem/FiveM.zip или укажите FIVEM_ZIP_PATH=... в ftp-upload.env');
    console.error('Сборка архива: npm run pack-fivem');
    process.exit(1);
  }

  const downloadUrl = `${httpsBase}/${encodeURIComponent(`Afterlife Launcher-${version}-portable.exe`).replace(/%2F/g, '/')}`;
  const manifest = {
    version,
    downloadUrl
  };
  const manifestPath = path.join(os.tmpdir(), `launcher-version-${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const secureRaw = String(env.FTP_SECURE || '').toLowerCase();
  let secure = false;
  if (secureRaw === '1' || secureRaw === 'true' || secureRaw === 'explicit') secure = true;
  if (secureRaw === 'implicit') secure = 'implicit';

  const client = new Client(120000);
  if (String(env.FTP_DEBUG || '') === '1') client.ftp.verbose = true;

  console.log(`FTP ${host}:${port} → ${remoteDir}`);
  try {
    await client.access({
      host,
      port,
      user,
      password,
      secure,
      secureOptions: env.FTP_TLS_REJECT_UNAUTHORIZED === '0' ? { rejectUnauthorized: false } : undefined
    });
    await client.ensureDir(remoteDir);
    await client.uploadFrom(manifestPath, 'launcher-version.json');
    await client.uploadFrom(portablePath, portableName);
    await client.uploadFrom(fivemZip, 'FiveM.zip');
  } catch (e) {
    console.error('Ошибка FTP:', e.message || e);
    process.exit(1);
  } finally {
    client.close();
    try {
      fs.unlinkSync(manifestPath);
    } catch (_) {}
  }

  console.log('');
  console.log('Готово. Проверьте в браузере (должно скачаться или открыться):');
  console.log(`  ${httpsBase}/launcher-version.json`);
  console.log(`  ${httpsBase}/FiveM.zip`);
  console.log(`  ${downloadUrl}`);
  console.log('');
  console.log('В launcher.config.json должны быть те же адреса:');
  console.log(`  "updateManifestUrl": "${httpsBase}/launcher-version.json"`);
  console.log(`  "fivemClientZipUrl": "${httpsBase}/FiveM.zip"`);
  console.log('');
}

main();
