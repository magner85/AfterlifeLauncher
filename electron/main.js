const { app, BrowserWindow, ipcMain, shell, nativeImage, Tray, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const { buildSingBoxTunConfig, parseVlessUri, randomTunIdentity } = require('./tunnel-singbox.js');

/** Конфиг рядом с проектом (dev) или с .exe (сборка), не в AppData */
function getConfigPath() {
  if (app.isPackaged) {
    return path.join(path.dirname(process.execPath), 'launcher.config.json');
  }
  return path.join(__dirname, '..', 'launcher.config.json');
}

function normalizeConfig(merged) {
  const c = { ...merged };
  if (typeof c.vpnSubscriptionUrl !== 'string') c.vpnSubscriptionUrl = '';
  c.vpnSubscriptionUrl = c.vpnSubscriptionUrl.trim();
  const maxUris = parseInt(c.vpnAutoImportMaxUris, 10);
  c.vpnAutoImportMaxUris =
    Number.isFinite(maxUris) && maxUris > 0 ? Math.min(50, maxUris) : 12;
  if (typeof c.tunnelSingBoxPath !== 'string') c.tunnelSingBoxPath = '';
  c.tunnelSingBoxPath = c.tunnelSingBoxPath.trim();
  if (typeof c.embedUrl !== 'string') c.embedUrl = '';
  c.embedUrl = c.embedUrl.trim();
  c.embedActive = c.embedActive === true || c.embedActive === 'true' || c.embedActive === 1 || c.embedActive === '1';
  c.repairUseTunneling =
    c.repairUseTunneling === true ||
    c.repairUseTunneling === 'true' ||
    c.repairUseTunneling === 1 ||
    c.repairUseTunneling === '1';
  const bvi = parseInt(String(c.bypassVlessIndex), 10);
  c.bypassVlessIndex = Number.isFinite(bvi) && bvi >= 0 ? bvi : 0;
  if (!Array.isArray(c.checkDomains)) c.checkDomains = ['cfx.re'];
  c.checkDomains = [...new Set(c.checkDomains.map((s) => String(s || '').trim()).filter(Boolean))];
  if (!c.checkDomains.length) c.checkDomains = ['cfx.re'];
  if (typeof c.serverConnect !== 'string') c.serverConnect = '';
  c.serverConnect = c.serverConnect.trim();
  if (!c.serverConnect) c.serverConnect = DEFAULT_SERVER_CONNECT;
  if (typeof c.fivemExePath !== 'string') c.fivemExePath = '';
  c.fivemExePath = c.fivemExePath.trim();
  if (typeof c.fivemClientZipUrl !== 'string') c.fivemClientZipUrl = '';
  c.fivemClientZipUrl = c.fivemClientZipUrl.trim();
  delete c.bypassOrder;
  delete c.zapretPath;
  delete c.zaperPath;
  delete c.zapretBatPaths;
  delete c.goodbyedpiPath;
  delete c.vpnProfiles;
  delete c.activeVpnIndex;
  delete c.devVpnDiscovery;
  return c;
}

function loadConfig() {
  const configPath = getConfigPath();
  const defaults = getDefaultConfig();
  let merged = defaults;
  /** Первый запуск portable/installer: пользовательского launcher.config.json нет — засеять из bundled launcher.config.default.json. */
  if (app.isPackaged && !fs.existsSync(configPath)) {
    try {
      const seedPath = path.join(process.resourcesPath || '', 'launcher.config.default.json');
      if (fs.existsSync(seedPath)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.copyFileSync(seedPath, configPath);
      }
    } catch (_) {}
  }
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      merged = { ...defaults, ...data };
    }
  } catch (e) {
    console.error('launcher.config.json:', e.message);
  }
  let cfg = normalizeConfig(mergeSingBoxDiscovery(normalizeConfig(merged)));
  /** Пустой или битый путь в конфиге (чужой ПК в репозитории) — подставить стандартный FiveM.exe и сохранить. */
  const guessFivem = guessDefaultFiveMExePath();
  if ((!cfg.fivemExePath || !isFileSafe(cfg.fivemExePath)) && guessFivem) {
    cfg = { ...cfg, fivemExePath: guessFivem };
    saveConfig(cfg);
  }
  return cfg;
}

function guessDefaultFiveMExePath() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return '';
  const p = path.join(local, 'FiveM', 'FiveM.exe');
  return fs.existsSync(p) ? p : '';
}

const DEFAULT_EMBED_URL = 'https://vk.com/afterlife_dayz';
const DEFAULT_SERVER_CONNECT = '45.136.205.9:30120';
const DEFAULT_DISCORD_URL =
  'https://vk.com/away.php?to=https%3A%2F%2Fdiscord.gg%2FGK35WfYjtr&utf=1';

function getDefaultConfig() {
  return {
    fivemExePath: '',
    serverConnect: DEFAULT_SERVER_CONNECT,
    projectUrl: DEFAULT_EMBED_URL,
    vkUrl: DEFAULT_EMBED_URL,
    discordUrl: DEFAULT_DISCORD_URL,
    embedUrl: 'https://afterlifedayz.ru',
    /** true — грузить embedUrl во webview; false — заглушка assets/site.jpg (сайт в разработке). */
    embedActive: true,
    /** «Починить сеть» → sing-box по подписке; иначе — Zapret из папки ZAPRET. */
    repairUseTunneling: false,
    checkDomains: ['cfx.re', 'cloudflare.com', 'fivem.net'],
    vpnSubscriptionUrl: '',
    vpnAutoImportMaxUris: 12,
    tunnelSingBoxPath: '',
    /** Индекс узла vless:// после фильтрации и сортировки подписки (sing-box). */
    bypassVlessIndex: 0,
    /**
     * URL ZIP с содержимым %LocalAppData%\\FiveM. Пустая строка — качать с релиза лаунчера (fivem-bundle/FiveM.zip).
     * Локальный bundled-fivem/FiveM.zip всегда важнее URL.
     */
    fivemClientZipUrl: ''
  };
}

/** Папка с launcher.exe (сборка) или корень проекта (dev) — сюда кладите sing-box.exe */
function getLauncherDir() {
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.join(__dirname, '..');
}

/** В packaged-режиме sing-box.exe и ZAPRET лежат в resourcesPath (через extraResources). В dev — рядом с исходниками. */
function getBundledResourcesDir() {
  if (app.isPackaged) return process.resourcesPath;
  return path.join(__dirname, '..');
}

const SINGBOX_EXE_BASENAMES = ['sing-box.exe', 'sing-box-windows-amd64.exe', 'sing-box-windows-amd64v3.exe'];

const DISCOVERY_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'release',
  'dist',
  'out',
  'build',
  '.cursor',
  'electron'
]);

function relPathFromLauncherIfInside(absPath, root) {
  const abs = path.resolve(absPath);
  const r = path.resolve(root) + path.sep;
  if (abs.toLowerCase().startsWith(r.toLowerCase())) {
    return abs.slice(r.length);
  }
  return abs;
}

function isFileSafe(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

/** Если путь к sing-box не задан — ищем рядом с лаунчером (корень + подпапки 1 уровня). */
function mergeSingBoxDiscovery(c) {
  const next = { ...c };
  if (String(next.tunnelSingBoxPath || '').trim()) return next;
  const root = getLauncherDir();
  const dirs = [root];
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (DISCOVERY_SKIP_DIRS.has(ent.name)) continue;
      dirs.push(path.join(root, ent.name));
    }
  } catch (_) {}
  for (const dir of [...new Set(dirs)]) {
    for (const n of SINGBOX_EXE_BASENAMES) {
      const p = path.join(dir, n);
      if (isFileSafe(p)) {
        next.tunnelSingBoxPath = relPathFromLauncherIfInside(p, root);
        return next;
      }
    }
  }
  return next;
}

let tunnelProcess = null;
/** Лаунчер сам поставил службу zapret — при выходе снимаем. */
let launcherTouchedZapret = false;

function getZapretRoot() {
  /** В packaged-версии ZAPRET распакован в resources/ZAPRET; в dev — в корне репы. */
  const candidates = [
    path.join(getBundledResourcesDir(), 'ZAPRET'),
    path.join(getLauncherDir(), 'ZAPRET')
  ];
  for (const z of candidates) {
    try {
      if (fs.existsSync(path.join(z, 'service.bat')) && fs.existsSync(path.join(z, 'bin', 'winws.exe'))) return z;
    } catch (_) {}
  }
  return null;
}

function runCmdQuiet(cmd) {
  try {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 90000
    });
  } catch (_) {}
}

/** Как Remove Services в service.bat — без окон. */
function stopZapretServiceQuiet() {
  if (process.platform !== 'win32') return;
  runCmdQuiet('net stop zapret >nul 2>&1');
  runCmdQuiet('sc delete zapret >nul 2>&1');
  runCmdQuiet('taskkill /IM winws.exe /F >nul 2>&1');
  runCmdQuiet('net stop WinDivert >nul 2>&1');
  runCmdQuiet('sc delete WinDivert >nul 2>&1');
  runCmdQuiet('net stop WinDivert14 >nul 2>&1');
  runCmdQuiet('sc delete WinDivert14 >nul 2>&1');
  launcherTouchedZapret = false;
}

function killTunnelProcess() {
  if (!tunnelProcess) return;
  const pid = tunnelProcess.pid;
  try {
    if (process.platform === 'win32' && pid) {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try {
        tunnelProcess.kill('SIGTERM');
      } catch (_) {}
    }
  } catch (_) {}
  tunnelProcess = null;
}

/** Остановить всё, что поднял лаунчер (sing-box TUN + служба Zapret, если мы её ставили). */
function cleanupOurBypassSync(reason) {
  try {
    killTunnelProcess();
  } catch (_) {}
  try {
    if (launcherTouchedZapret) {
      stopZapretServiceQuiet();
    }
  } catch (_) {}
}

function resolveSingBoxExe(cfg) {
  const custom = String(cfg?.tunnelSingBoxPath || '').trim();
  if (custom) {
    /** Пользовательский путь — может быть absolute, относительно launcherDir, или относительно bundled resources. */
    if (path.isAbsolute(custom) && fs.existsSync(custom)) return custom;
    const candidatesRel = [
      path.join(getBundledResourcesDir(), custom),
      path.join(getLauncherDir(), custom)
    ];
    for (const p of candidatesRel) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  /** Auto: сперва bundled resources (packaged), потом папка лаунчера. */
  const dirs = [getBundledResourcesDir(), getLauncherDir()];
  for (const dir of [...new Set(dirs)]) {
    for (const n of SINGBOX_EXE_BASENAMES) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function saveConfig(cfg) {
  const configPath = getConfigPath();
  try {
    const clean = normalizeConfig(cfg);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(clean, null, 2), 'utf8');
  } catch (e) {
    console.error('save launcher.config.json:', e.message);
  }
}

let mainWindow = null;
let tray = null;
/** true только перед реальным выходом (пункт «Выход» в трее, перезапуск с повышением прав и т.п.). */
let isLauncherQuitting = false;

/**
 * Windows / Linux: крестик и системное закрытие — в трей; кнопка «свернуть» — обычная панель задач.
 * macOS: без перехвата close (стандарт Dock).
 */
const MINIMIZE_TO_TRAY = process.platform === 'win32' || process.platform === 'linux';

function getTrayIconImage() {
  const iconPath = path.join(__dirname, '..', 'src', 'assets', 'titlebar-logo.png');
  try {
    if (!fs.existsSync(iconPath)) return nativeImage.createEmpty();
    let img = nativeImage.createFromPath(iconPath);
    if (!img || img.isEmpty()) return nativeImage.createEmpty();
    const { width, height } = img.getSize();
    if (width > 32 || height > 32) {
      try {
        img = img.resize({ width: 16, height: 16 });
      } catch (_) {}
    }
    return img;
  } catch {
    return nativeImage.createEmpty();
  }
}

function destroyTray() {
  if (!tray) return;
  try {
    tray.destroy();
  } catch (_) {}
  tray = null;
}

function ensureTray() {
  if (!MINIMIZE_TO_TRAY || tray || !mainWindow) return;
  const img = getTrayIconImage();
  if (!img || img.isEmpty()) return;
  try {
    tray = new Tray(img);
  } catch (_) {
    tray = null;
    return;
  }
  tray.setToolTip('Afterlife Launcher');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Открыть лаунчер',
      click: () => showLauncherFromTray()
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isLauncherQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showLauncherFromTray());
}

function showLauncherFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (MINIMIZE_TO_TRAY) mainWindow.setSkipTaskbar(false);
  } catch (_) {}
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } catch (_) {}
}

/** Иконка окна и панели задач — тот же PNG, что и в шапке (src/assets/titlebar-logo.png). */
function getWindowIconNativeImage() {
  const iconPath = path.join(__dirname, '..', 'src', 'assets', 'titlebar-logo.png');
  if (!fs.existsSync(iconPath)) return undefined;
  try {
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

function createWindow() {
  const winIcon = getWindowIconNativeImage();
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 1120,
    maxWidth: 1500,
    minHeight: 720,
    maxHeight: 720,
    resizable: false,
    maximizable: false,
    minimizable: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    icon: winIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  if (process.platform === 'win32') {
    try {
      mainWindow.setMinimizable(true);
    } catch (_) {}
  }

  if (MINIMIZE_TO_TRAY) {
    ensureTray();
    mainWindow.on('close', (e) => {
      if (isLauncherQuitting || !mainWindow || mainWindow.isDestroyed()) return;
      if (!tray) return;
      e.preventDefault();
      try {
        mainWindow.setSkipTaskbar(true);
      } catch (_) {}
      try {
        mainWindow.hide();
      } catch (_) {}
    });
  }

  if (process.platform === 'darwin' && winIcon) {
    try {
      app.dock.setIcon(winIcon);
    } catch (_) {}
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    try {
      if (MINIMIZE_TO_TRAY) mainWindow.setSkipTaskbar(false);
    } catch (_) {}
    mainWindow.show();
  });

  /** Каждый показ окна (в т.ч. после сворачивания) — поднять webview во фронте. */
  mainWindow.on('show', () => {
    try {
      if (MINIMIZE_TO_TRAY && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setSkipTaskbar(false);
      }
    } catch (_) {}
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launcher:window-shown');
      }
    } catch (_) {}
  });

  if (process.env.DEBUG_LAUNCHER) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);
app.on('before-quit', () => {
  destroyTray();
  cleanupOurBypassSync('before-quit');
});
app.on('window-all-closed', () => app.quit());

process.on('uncaughtException', (err) => {
  console.error('[afterlife-launcher] uncaughtException', err);
  try {
    cleanupOurBypassSync('uncaughtException');
  } catch (_) {}
});
process.on('SIGTERM', () => {
  try {
    cleanupOurBypassSync('SIGTERM');
  } catch (_) {}
});
process.on('SIGINT', () => {
  try {
    cleanupOurBypassSync('SIGINT');
  } catch (_) {}
});

/** file:// URL страницы-заглушки с site.jpg (для webview, когда embedActive = false). */
function getEmbedPlaceholderPageUrl() {
  const htmlPath = path.join(__dirname, '..', 'src', 'assets', 'embed-placeholder.html');
  if (fs.existsSync(htmlPath)) {
    return pathToFileURL(htmlPath).href;
  }
  const jpgPath = path.join(__dirname, '..', 'src', 'assets', 'site.jpg');
  if (fs.existsSync(jpgPath)) {
    return pathToFileURL(jpgPath).href;
  }
  return '';
}

ipcMain.handle('assets:getEmbedPlaceholderUrl', () => getEmbedPlaceholderPageUrl());

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, partial) => {
  const cur = loadConfig();
  const next = normalizeConfig({ ...cur, ...partial });
  saveConfig(next);
  return next;
});

ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

async function fetchUrlText(url, timeoutMs = 25000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'AfterlifeLauncher/1.0 (subscription)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(id);
  }
}

/** Как getvpn.bat: тело ответа часто одна base64-строка → UTF-8 со списком vless:// … */
function decodeVpnSubscriptionBody(rawText) {
  const raw = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const pickShareLines = (txt) =>
    txt
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^(vless|vmess|trojan|ss|hysteria2):\/\//i.test(l));
  const tryB64 = (s) => {
    const clean = s.replace(/\s/g, '');
    if (clean.length < 8) return null;
    const pad = (4 - (clean.length % 4)) % 4;
    const padded = clean + '='.repeat(pad);
    try {
      const t = Buffer.from(padded, 'base64').toString('utf8');
      const decLines = pickShareLines(t);
      if (decLines.length) return decLines;
      const one = t.trim();
      if (/^(vless|vmess|trojan|ss|hysteria2):\/\//i.test(one)) return [one];
    } catch (_) {}
    return null;
  };
  const fromB64 = tryB64(raw);
  if (fromB64 && fromB64.length) return fromB64;
  return pickShareLines(raw);
}

ipcMain.handle('subscription:fetch', async (_e, url) => {
  const u = String(url || '').trim();
  if (!u) return { ok: false, error: 'Пустая ссылка на подписку', lines: [], savedPath: null };
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, error: 'Некорректный URL', lines: [], savedPath: null };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Разрешены только ссылки http:// или https://', lines: [], savedPath: null };
  }
  try {
    const body = await fetchUrlText(u, 28000);
    const lines = decodeVpnSubscriptionBody(body);
    if (!lines.length) {
      return {
        ok: false,
        error: 'В ответе не найдено строк vless/vmess/trojan/ss/hysteria2',
        lines: [],
        savedPath: null
      };
    }
    const dir = app.getPath('userData');
    const savedPath = path.join(dir, 'last-vpn-subscription.txt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(savedPath, lines.join('\n'), 'utf8');
    return { ok: true, lines, savedPath };
  } catch (e) {
    return { ok: false, error: String(e.message || e), lines: [], savedPath: null };
  }
});

/** Подстроки в имени узла или полной строке URI — узел не участвует в выборе. */
const VLESS_BLOCK_SUBSTRS = [
  'россия',
  'russia',
  'youtube',
  'ютуб',
  'белые списки',
  'белый список',
  'whitelist',
  'white list'
];

function vlessHaystackForBlock(line, parsed) {
  return `${parsed.name} ${line}`.toLowerCase();
}

/** RU как маркер страны/узла, без ложных срабатываний на «true», «grpc» и т.п. */
function haystackContainsRuMarker(hay) {
  return /(^|[^a-zа-яё0-9])ru([^a-zа-яё0-9]|$)/i.test(hay);
}

function isVlessNodeBlocked(line, parsed) {
  const hay = vlessHaystackForBlock(line, parsed);
  for (const w of VLESS_BLOCK_SUBSTRS) {
    if (hay.includes(w)) return true;
  }
  if (haystackContainsRuMarker(hay)) return true;
  return false;
}

/** Удаляем ВСЕ оставшиеся Wintun-адаптеры вида AfterlifeTUN* — после падения sing-box IP на них держится и блокирует новый запуск. */
function cleanupStaleAfterlifeTunAdapters() {
  if (process.platform !== 'win32') return;
  /** Список интерфейсов: netsh interface show interface — затем каждый AfterlifeTUN* снимаем. */
  const candidates = new Set();
  try {
    const out = execFileSync('netsh', ['interface', 'show', 'interface'], {
      windowsHide: true,
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString('binary');
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/(AfterlifeTUN\S*)/);
      if (m) candidates.add(m[1]);
    }
  } catch {}
  for (const ifName of candidates) {
    try {
      execFileSync('netsh', ['interface', 'set', 'interface', `name=${ifName}`, 'admin=disable'], {
        windowsHide: true,
        timeout: 4000,
        stdio: 'ignore'
      });
    } catch {}
    try {
      execFileSync('netsh', ['interface', 'ipv4', 'delete', 'address', ifName, 'all'], {
        windowsHide: true,
        timeout: 4000,
        stdio: 'ignore'
      });
    } catch {}
  }
}

/** sing-box TUN: vless + DNS через прокси + явные маршруты на checkDomains из конфига. */
async function executeSingBoxTunnelStart(cfgLoad, vlessOnly, defaultIndex) {
  killTunnelProcess();
  stopZapretServiceQuiet();
  cleanupStaleAfterlifeTunAdapters();
  const singBox = resolveSingBoxExe(cfgLoad);
  if (!singBox) {
    return {
      ok: false,
      error:
        'Не найден sing-box.exe. Положите sing-box.exe в папку с лаунчером или укажите tunnelSingBoxPath в launcher.config.json',
      configPath: null,
      exePath: null,
      pid: null
    };
  }
  if (!vlessOnly.length) {
    return { ok: false, error: 'Нет строк vless:// для системного туннеля', configPath: null, exePath: null, pid: null };
  }
  if (process.platform === 'win32' && !isWindowsElevated()) {
    return {
      ok: false,
      error:
        'Системный TUN (sing-box) на Windows требует права администратора. Нажмите «Перезапустить как администратор» внизу окна или запустите лаунчер вручную от имени администратора.',
      configPath: null,
      exePath: singBox,
      pid: null
    };
  }
  const checkDomains = Array.isArray(cfgLoad.checkDomains) ? cfgLoad.checkDomains : [];
  let json;
  try {
    json = buildSingBoxTunConfig(vlessOnly, defaultIndex, { checkDomains });
  } catch (e) {
    return { ok: false, error: String(e.message || e), configPath: null, exePath: null, pid: null };
  }
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'afterlife-sing-box-tun.json');
  const logPath = path.join(userDataDir, 'afterlife-sing-box-tun.log');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(json, null, 2), 'utf8');
  const cwd = path.dirname(singBox);
  /** Валидируем конфиг перед запуском — сразу увидим, если sing-box его не переварит (1.12+/1.14 изменения схемы). */
  try {
    const check = execFileSync(singBox, ['check', '-c', configPath], {
      cwd,
      windowsHide: true,
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    void check;
  } catch (e) {
    const stderr = String(e && e.stderr ? e.stderr : '').trim();
    const stdout = String(e && e.stdout ? e.stdout : '').trim();
    const msg = stderr || stdout || String(e.message || e);
    try { fs.writeFileSync(logPath, `[check] ${msg}\n`, 'utf8'); } catch {}
    return {
      ok: false,
      error: `sing-box отверг конфиг: ${msg.slice(0, 400)}`,
      configPath,
      exePath: singBox,
      pid: null
    };
  }
  try {
    /** Пишем stdout/stderr sing-box в лог, чтобы было куда смотреть при проблемах с сетью. */
    let logFd = -1;
    try { logFd = fs.openSync(logPath, 'w'); } catch { logFd = -1; }
    const child = spawn(singBox, ['run', '-c', configPath], {
      cwd,
      detached: true,
      stdio: ['ignore', logFd >= 0 ? logFd : 'ignore', logFd >= 0 ? logFd : 'ignore'],
      windowsHide: true
    });
    if (logFd >= 0) { try { fs.closeSync(logFd); } catch {} }
    tunnelProcess = child;
    let earlyExitCode = null;
    let earlyExitSignal = null;
    const onEarlyExit = (code, signal) => {
      earlyExitCode = code;
      earlyExitSignal = signal;
      if (tunnelProcess === child) tunnelProcess = null;
    };
    child.on('error', () => {});
    child.on('exit', onEarlyExit);
    child.unref();
    /** Ждём ~1.2 с: если sing-box упадёт на ранней стадии (TUN/маршруты), отдадим причину из лога. */
    await new Promise((res) => setTimeout(res, 1200));
    if (earlyExitCode !== null || earlyExitSignal !== null) {
      let tail = '';
      try {
        const buf = fs.readFileSync(logPath, 'utf8');
        tail = buf.split(/\r?\n/).filter(Boolean).slice(-10).join(' | ');
      } catch {}
      return {
        ok: false,
        error: `sing-box упал при старте (код ${earlyExitCode}). ${tail ? 'Лог: ' + tail.slice(0, 400) : 'Лог: ' + logPath}`,
        configPath,
        exePath: singBox,
        pid: null
      };
    }
    return { ok: true, error: null, configPath, exePath: singBox, pid: child.pid, logPath };
  } catch (e) {
    tunnelProcess = null;
    return { ok: false, error: String(e.message || e), configPath, exePath: singBox, pid: null };
  }
}

ipcMain.handle('tunnel:start', async (_e, payload) => {
  const uris = Array.isArray(payload?.uris) ? payload.uris.map((x) => String(x || '').trim()) : [];
  const defaultIndex = Math.max(0, parseInt(payload?.defaultIndex, 10) || 0);
  const cfgLoad = loadConfig();
  const vlessOnly = uris.filter((l) => l.toLowerCase().startsWith('vless://'));
  return executeSingBoxTunnelStart(cfgLoad, vlessOnly, defaultIndex);
});

ipcMain.handle('tunnel:startFromSubscription', async () => {
  const cfgLoad = loadConfig();
  const url = String(cfgLoad.vpnSubscriptionUrl || '').trim();
  if (!url) {
    return {
      ok: false,
      error:
        'Пустая ссылка на подписку. Укажите в расширенной панели лаунчера HTTPS-ссылку на подписку с vless://.',
      configPath: null,
      exePath: null,
      pid: null
    };
  }
  let lines;
  try {
    const body = await fetchUrlText(url, 28000);
    lines = decodeVpnSubscriptionBody(body);
  } catch (e) {
    return { ok: false, error: String(e.message || e), configPath: null, exePath: null, pid: null };
  }
  if (!lines.length) {
    return { ok: false, error: 'Пустой ответ подписки', configPath: null, exePath: null, pid: null };
  }
  const vlessOnly = lines.filter((l) => l.toLowerCase().startsWith('vless://'));
  if (!vlessOnly.length) {
    return { ok: false, error: 'В подписке нет строк vless://', configPath: null, exePath: null, pid: null };
  }
  const prep = await filterAndOrderSubscriptionVless(vlessOnly, cfgLoad.vpnAutoImportMaxUris);
  if (!prep.ok) {
    return { ok: false, error: prep.error, configPath: null, exePath: null, pid: null };
  }
  const n = prep.lines.length;
  const want = parseInt(String(cfgLoad.bypassVlessIndex), 10);
  const idx = Number.isFinite(want) ? Math.max(0, Math.min(n - 1, want)) : 0;
  return executeSingBoxTunnelStart(cfgLoad, prep.lines, idx);
});

ipcMain.handle('tunnel:stop', async () => {
  killTunnelProcess();
  return { ok: true };
});

ipcMain.handle('tunnel:status', async () => ({
  running: !!(tunnelProcess && !tunnelProcess.killed),
  pid: tunnelProcess && !tunnelProcess.killed ? tunnelProcess.pid : null
}));

ipcMain.handle('zapret:repairInstall', async () => {
  const root = getZapretRoot();
  if (!root) {
    return {
      ok: false,
      error: 'Не найдена папка ZAPRET с bin\\winws.exe и service.bat рядом с лаунчером.'
    };
  }
  if (process.platform === 'win32' && !isWindowsElevated()) {
    return {
      ok: false,
      error:
        'Установка службы Zapret на Windows требует права администратора. Нажмите «Перезапустить как администратор» внизу окна или запустите лаунчер от имени администратора.'
    };
  }
  const bat = path.join(root, 'afterlife-zapret-silent-install.bat');
  if (!fs.existsSync(bat)) {
    return { ok: false, error: `Не найден файл: ${bat}` };
  }
  killTunnelProcess();
  try {
    // Не подставлять полный путь с кириллицей в /c — cmd ломает кодировку. cwd = ZAPRET, в /c только ASCII-имя .bat.
    const batName = 'afterlife-zapret-silent-install.bat';
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `call ${batName}`], {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 180000
    });
    launcherTouchedZapret = true;
    return { ok: true, error: null };
  } catch (e) {
    const stderr = e.stderr != null ? String(e.stderr) : '';
    const stdout = e.stdout != null ? String(e.stdout) : '';
    const tail = stderr || stdout || String(e.message || e);
    return { ok: false, error: tail };
  }
});

ipcMain.handle('zapret:repairRevert', async () => {
  stopZapretServiceQuiet();
  return { ok: true };
});

ipcMain.handle('subscription:bypassVlessList', async () => {
  const cfgLoad = loadConfig();
  const url = String(cfgLoad.vpnSubscriptionUrl || '').trim();
  if (!url) {
    return { ok: false, items: [], error: 'Пустая ссылка на подписку (поле выше).' };
  }
  let lines;
  try {
    const body = await fetchUrlText(url, 28000);
    lines = decodeVpnSubscriptionBody(body);
  } catch (e) {
    return { ok: false, items: [], error: String(e.message || e) };
  }
  const vlessOnly = lines.filter((l) => l.toLowerCase().startsWith('vless://'));
  if (!vlessOnly.length) {
    return { ok: false, items: [], error: 'В ответе нет строк vless://' };
  }
  const prep = await filterAndOrderSubscriptionVless(vlessOnly, cfgLoad.vpnAutoImportMaxUris);
  if (!prep.ok) {
    return { ok: false, items: [], error: prep.error };
  }
  const items = prep.lines.map((line, index) => {
    const p = parseVlessUri(line);
    const core = p ? `${p.name || 'узел'} — ${p.host}:${p.port}` : `узел ${index + 1}`;
    return { index, label: `${index + 1}. ${core}` };
  });
  return { ok: true, items, error: null };
});

function isWindowsElevated() {
  if (process.platform !== 'win32') return true;
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const syncOpts = { stdio: 'pipe', windowsHide: true, timeout: 12000, encoding: 'utf8' };
  /** High Mandatory Level (S-1-16-12288) — процесс с повышенным IL; дочерние .exe наследуют и FiveM падает. */
  const whoami = path.join(systemRoot, 'System32', 'whoami.exe');
  if (fs.existsSync(whoami)) {
    try {
      const out = execFileSync(whoami, ['/groups'], syncOpts);
      const text = String(out || '');
      if (/S-1-16-12288\b/.test(text) || /High Mandatory Level/i.test(text)) return true;
    } catch (_) {
      /* medium / ошибка — не считаем elevated по whoami */
    }
  }
  const ps = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const psAdminCheck =
    'if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }';
  const psOpts = { stdio: 'ignore', windowsHide: true, timeout: 12000 };
  if (fs.existsSync(ps)) {
    try {
      execFileSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psAdminCheck], psOpts);
      return true;
    } catch (e) {
      const code = typeof e.status === 'number' ? e.status : null;
      if (code === 1) return false;
    }
  }
  return false;
}

ipcMain.handle('system:getInfo', async () => ({
  platform: process.platform,
  isElevated: isWindowsElevated()
}));

/** Набор известных процессов сторонних средств обхода (VPN/прокси/DPI) — нижний регистр, без .exe. */
const BYPASS_PROCESS_SIGNATURES = [
  { match: 'openvpn', label: 'OpenVPN' },
  { match: 'wireguard', label: 'WireGuard' },
  { match: 'amneziawg', label: 'AmneziaWG' },
  { match: 'amnezia', label: 'AmneziaVPN' },
  { match: 'tunnel.exe', label: 'WireGuard tunnel' },
  { match: 'wg-quick', label: 'WireGuard' },
  { match: 'v2ray', label: 'V2Ray' },
  { match: 'xray', label: 'Xray' },
  { match: 'nekoray', label: 'NekoRay' },
  { match: 'nekobox', label: 'NekoBox' },
  { match: 'hiddify', label: 'Hiddify' },
  { match: 'clash', label: 'Clash' },
  { match: 'mihomo', label: 'Mihomo / Clash' },
  { match: 'shadowsocks', label: 'Shadowsocks' },
  { match: 'tun2socks', label: 'tun2socks' },
  { match: 'zerotier', label: 'ZeroTier' },
  { match: 'tailscale', label: 'Tailscale' },
  { match: 'outline', label: 'Outline' },
  { match: 'psiphon', label: 'Psiphon' },
  { match: 'lantern', label: 'Lantern' },
  { match: 'v2rayn', label: 'v2rayN' },
  { match: 'v2raya', label: 'v2rayA' },
  { match: 'nordvpn', label: 'NordVPN' },
  { match: 'expressvpn', label: 'ExpressVPN' },
  { match: 'protonvpn', label: 'ProtonVPN' },
  { match: 'mullvad', label: 'Mullvad' },
  { match: 'windscribe', label: 'Windscribe' },
  { match: 'cyberghost', label: 'CyberGhost' },
  { match: 'hotspotshield', label: 'Hotspot Shield' },
  { match: 'tunnelbear', label: 'TunnelBear' },
  { match: 'privateinternetaccess', label: 'PIA' },
  { match: 'openconnect', label: 'OpenConnect' },
  { match: 'strongswan', label: 'strongSwan' },
  { match: 'softether', label: 'SoftEther' },
  { match: 'goodbyedpi', label: 'GoodbyeDPI' },
  { match: 'winws.exe', label: 'Zapret (winws)' },
  { match: 'zapret', label: 'Zapret' },
  { match: 'warp', label: 'Cloudflare WARP' },
  { match: 'spoof-dpi', label: 'SpoofDPI' },
  { match: 'spoofdpi', label: 'SpoofDPI' },
  { match: 'byedpi', label: 'ByeDPI' },
  { match: 'proxifier', label: 'Proxifier' },
  { match: 'dnscrypt', label: 'DNSCrypt' },
  { match: 'simplednscrypt', label: 'Simple DNSCrypt' },
  { match: 'pritunl', label: 'Pritunl' }
];

/** Строки tasklist /FO CSV: образ и PID (без ложных срабатываний по подстроке во всём выводе). */
function windowsTasklistExeRows() {
  const rows = [];
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString('latin1');
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('","');
      if (parts.length < 2) continue;
      const image = parts[0].replace(/^"/, '').replace(/""/g, '"').trim();
      const pidStr = parts[1].replace(/^"/, '').replace(/"$/, '').trim();
      const pid = parseInt(pidStr, 10);
      if (!/\.exe$/i.test(image) || !Number.isFinite(pid) || pid <= 0) continue;
      rows.push({ image, pid });
    }
  } catch {}
  return rows;
}

function bypassImageBaseMatch(baseLower, rawMatch) {
  const m = String(rawMatch || '')
    .toLowerCase()
    .replace(/\.exe$/i, '')
    .trim();
  if (!m || !baseLower) return false;
  /** WireGuard tunnel.exe — только имя tunnel, иначе ловим TunnelBear и т.п. */
  if (m === 'tunnel' || String(rawMatch).toLowerCase() === 'tunnel.exe') return baseLower === 'tunnel';
  if (baseLower === m) return true;
  if (baseLower.startsWith(`${m}-`) || baseLower.startsWith(`${m}_`)) return true;
  const norm = baseLower.replace(/\s+/g, '');
  const mn = m.replace(/\s+/g, '');
  if (mn.length <= 4) return norm === mn || norm.startsWith(`${mn}-`);
  return norm.startsWith(mn) || norm.includes(mn);
}

/**
 * Процессы обхода: только по имени образа из tasklist.
 * @param {Set<number>} excludePids — не трогать (наш sing-box).
 */
function detectBypassProcessesWindows(excludePids) {
  const ex = excludePids instanceof Set ? excludePids : new Set();
  const found = [];
  const seenPid = new Set();
  try {
    for (const row of windowsTasklistExeRows()) {
      if (ex.has(row.pid)) continue;
      const base = row.image.replace(/\.exe$/i, '').toLowerCase();
      for (const sig of BYPASS_PROCESS_SIGNATURES) {
        if (bypassImageBaseMatch(base, sig.match)) {
          if (!seenPid.has(row.pid)) {
            seenPid.add(row.pid);
            found.push({ label: sig.label, pid: row.pid, image: row.image });
          }
          break;
        }
      }
    }
  } catch {}
  return found;
}

/** Запущенные сторонние службы обхода — с реальным SERVICE_NAME для net stop. */
function detectBypassServicesWindows() {
  const services = [];
  const seen = new Set();
  try {
    const out = execFileSync('sc', ['query', 'state=', 'all'], {
      windowsHide: true,
      timeout: 6000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString('latin1');
    const sections = out.split(/\r?\n\r?\n/);
    for (const sec of sections) {
      const nameM = sec.match(/SERVICE_NAME:\s*([^\r\n]+)/i);
      const stateM = sec.match(/STATE\s*:\s*\d+\s+(\w+)/i);
      if (!nameM || !stateM) continue;
      const name = nameM[1].trim();
      const state = stateM[1].toLowerCase();
      if (state !== 'running') continue;
      const lower = name.toLowerCase();
      let label = '';
      if (/zapret/.test(lower)) label = 'Zapret (служба)';
      else if (/wireguardtunnel/.test(lower)) label = 'WireGuard (туннель)';
      else if (/zerotier/.test(lower)) label = 'ZeroTier';
      else if (/tailscale/.test(lower)) label = 'Tailscale';
      else if (/amnezia/.test(lower)) label = 'Amnezia';
      else if (/openvpnservice/.test(lower)) label = 'OpenVPN';
      else if (/nordvpn|expressvpn|protonvpn|mullvad|cyberghost|windscribe/.test(lower)) label = name;
      else continue;
      if (seen.has(name)) continue;
      seen.add(name);
      services.push({ serviceName: name, label });
    }
  } catch {}
  return services;
}

function stopWindowsServiceQuiet(serviceName) {
  if (!serviceName || process.platform !== 'win32') return;
  const sn = String(serviceName).trim();
  if (!sn) return;
  try {
    execFileSync('net', ['stop', sn], { windowsHide: true, timeout: 45000, stdio: 'ignore' });
  } catch (_) {}
}

function detectSystemProxyWindows() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyEnable'
    ], { windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] }).toString('latin1');
    const m = out.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i);
    if (!m) return null;
    const enabled = parseInt(m[1], 16) === 1;
    if (!enabled) return null;
    let server = '';
    try {
      const srvOut = execFileSync('reg', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        '/v', 'ProxyServer'
      ], { windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] }).toString('latin1');
      const sm = srvOut.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
      if (sm) server = sm[1].trim();
    } catch {}
    return { enabled: true, server };
  } catch {
    return null;
  }
}

function detectTunAdaptersWindows() {
  const labels = [];
  try {
    const out = execFileSync('netsh', ['interface', 'show', 'interface'], {
      windowsHide: true,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString('binary');
    for (const line of out.split(/\r?\n/)) {
      if (!/\bConnected\b|\b(Подключен|Подключено)\b/i.test(line)) continue;
      const parts = line.trim().split(/\s{2,}/);
      const name = parts[parts.length - 1] || '';
      if (!name) continue;
      const lower = name.toLowerCase();
      if (lower.startsWith('afterlifetun')) continue;
      if (/wintun|wireguard|tap-windows|openvpn|amnezia|zerotier|tailscale|wg-|tun[0-9]|utun/i.test(lower)) {
        labels.push(name);
      }
    }
  } catch {}
  return Array.from(new Set(labels));
}

function isDiscordRunningWindows() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 6000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString('latin1').toLowerCase();
    /** Покрываем основные клиенты: stable, canary, ptb, dev, Vesktop (OSS-клиент). */
    return /\b(discord(canary|ptb|development)?\.exe|vesktop\.exe)\b/.test(out);
  } catch {
    return false;
  }
}

ipcMain.handle('system:checkDiscord', async () => ({
  running: isDiscordRunningWindows()
}));

ipcMain.handle('system:openDiscord', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Доступно только в Windows' };
  }
  /** Канонический путь запуска Discord на Windows — через Update.exe, иначе по прямому ярлыку / протоколу. */
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Discord', 'Update.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'DiscordCanary', 'Update.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'DiscordPTB', 'Update.exe')
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const child = spawn(p, ['--processStart', 'Discord.exe'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.on('error', () => {});
      child.unref();
      return { ok: true, via: 'update', path: p };
    } catch {}
  }
  try {
    await shell.openExternal('discord://');
    return { ok: true, via: 'protocol' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

function getTunnelPidExcludeSet() {
  const ex = new Set();
  try {
    if (tunnelProcess && !tunnelProcess.killed && tunnelProcess.pid) ex.add(tunnelProcess.pid);
  } catch (_) {}
  return ex;
}

function tcpConnectProbe(host, port, timeoutMs) {
  const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 4500;
  return new Promise((resolve) => {
    let settled = false;
    let sock = null;
    let t = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        if (t) clearTimeout(t);
      } catch (_) {}
      try {
        if (sock) sock.destroy();
      } catch (_) {}
      resolve(ok);
    };
    sock = net.createConnection({ host, port: port || 443 }, () => finish(true));
    t = setTimeout(() => finish(false), ms);
    sock.on('error', () => finish(false));
  });
}

/** Сначала целевые узлы FiveM / Discord (TCP 443), без HTTP. */
ipcMain.handle('routing:probeDiscordFiveM', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, cfx443: false, discord443: false, allOk: false };
  }
  const [cfx443, discord443] = await Promise.all([
    tcpConnectProbe('cfx.re', 443, 5000),
    tcpConnectProbe('discord.com', 443, 5000)
  ]);
  const allOk = !!(cfx443 && discord443);
  return { ok: true, cfx443, discord443, allOk };
});

ipcMain.handle('bypass:killUserBypass', async () => {
  if (process.platform !== 'win32') {
    return { ok: true, killedPids: [], stoppedServices: [] };
  }
  const ex = getTunnelPidExcludeSet();
  const procs = detectBypassProcessesWindows(ex);
  const killedPids = [];
  for (const p of procs) {
    const pid = p && p.pid;
    if (!Number.isFinite(pid) || pid <= 0 || ex.has(pid)) continue;
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 15000,
        stdio: 'ignore'
      });
      killedPids.push(pid);
    } catch (_) {}
  }
  const svcList = detectBypassServicesWindows();
  const stoppedServices = [];
  for (const s of svcList) {
    const sn = s && s.serviceName;
    if (!sn) continue;
    /** Не трогаем zapret-службу, если её поднял лаунчер — её снимет revert. */
    if (/zapret/i.test(sn) && launcherTouchedZapret) continue;
    stopWindowsServiceQuiet(sn);
    stoppedServices.push(sn);
  }
  return { ok: true, killedPids, stoppedServices };
});

ipcMain.handle('system:detectBypassTools', async () => {
  if (process.platform !== 'win32') {
    return { found: false, conflict: false, items: [] };
  }
  const ex = getTunnelPidExcludeSet();
  const items = [];
  const proc = detectBypassProcessesWindows(ex);
  proc.forEach((p) =>
    items.push({
      kind: 'process',
      label: `${p.label} (${p.image}, PID ${p.pid})`,
      pid: p.pid
    })
  );
  const svc = detectBypassServicesWindows();
  svc.forEach((s) =>
    items.push({
      kind: 'service',
      label: s.label,
      serviceName: s.serviceName
    })
  );
  const proxy = detectSystemProxyWindows();
  if (proxy) {
    items.push({ kind: 'proxy', label: `Системный прокси: ${proxy.server || 'включён'}` });
  }
  const tun = detectTunAdaptersWindows();
  tun.forEach((t) => items.push({ kind: 'adapter', label: `Виртуальный адаптер: ${t}` }));
  const conflict =
    items.some((it) => it.kind === 'process') || items.some((it) => it.kind === 'service');
  return { found: items.length > 0, conflict, items };
});

ipcMain.handle('app:restartElevated', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Повышение прав доступно только в Windows' };
  }
  /** Для portable важно запускать исходный .exe, а не распакованный app-рантайм из Temp. */
  const portableExe = String(process.env.PORTABLE_EXECUTABLE_FILE || '').trim();
  const portableDir = String(process.env.PORTABLE_EXECUTABLE_DIR || '').trim();
  const exe = portableExe && fs.existsSync(portableExe) ? portableExe : process.execPath;
  const cwd = portableDir && fs.existsSync(portableDir) ? portableDir : path.dirname(exe);
  const psEsc = (s) => String(s).replace(/'/g, "''");
  const args = process.argv.slice(1).map((a) => `'${psEsc(a)}'`).join(', ');
  try {
    const cmd =
      args.length > 0
        ? `Start-Process -LiteralPath '${psEsc(exe)}' -WorkingDirectory '${psEsc(cwd)}' -Verb RunAs -ArgumentList @(${args})`
        : `Start-Process -LiteralPath '${psEsc(exe)}' -WorkingDirectory '${psEsc(cwd)}' -Verb RunAs`;
    const psPath = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    execFileSync(psPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 20000
    });
    setTimeout(() => {
      try {
        isLauncherQuitting = true;
        app.quit();
      } catch (_) {}
    }, 600);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

ipcMain.handle('window:getSize', () => {
  if (!mainWindow) return [1120, 720];
  return mainWindow.getSize();
});

ipcMain.handle('window:setSizeAnimated', (_e, endW, endH, durationMs = 380) => {
  if (!mainWindow) return;
  const [startW, startH] = mainWindow.getSize();
  const duration = Math.max(120, Number(durationMs) || 380);
  const t0 = Date.now();
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  return new Promise((resolve) => {
    const tick = () => {
      const elapsed = Date.now() - t0;
      const t = Math.min(1, elapsed / duration);
      const e = easeOutCubic(t);
      const w = Math.round(startW + (endW - startW) * e);
      const h = Math.round(startH + (endH - startH) * e);
      mainWindow.setSize(w, h, false);
      if (t < 1) setTimeout(tick, 16);
      else resolve(true);
    };
    tick();
  });
});

function normalizeConnectArg(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^\/+/, '');
  return s;
}

/** URI для запуска через `start` / оболочку (FiveM не принимает прямой старт из планировщика без shell). */
function fivemShellConnectUri(addr) {
  const a = String(addr || '').trim();
  if (!a) return '';
  if (/^fivem:/i.test(a)) return a;
  const norm = a.replace(/\\/g, '/').replace(/^\//, '');
  return `fivem://connect/${norm}`;
}

/**
 * Запуск URI или .exe через shell пользователя (explorer обычно не elevated) —
 * дочерний FiveM не наследует токен админа от Electron.
 */
function launchFiveMViaExplorer(fivemExePath, addr) {
  return new Promise((resolve, reject) => {
    const explorer = path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe');
    const uri = addr ? fivemShellConnectUri(addr) : '';
    const arg = uri || String(fivemExePath || '').trim();
    if (!arg) {
      reject(new Error('empty target'));
      return;
    }
    try {
      const ex = spawn(explorer, [arg], { detached: true, stdio: 'ignore', windowsHide: true });
      ex.on('error', (e) => reject(e));
      ex.unref();
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Запуск FiveM без elevated: задача планировщика с RunLevel Limited.
 * Команда — `cmd /c start "" "fivem://connect/…"` (как из проводника/браузера), не прямой вызов FiveM.exe.
 */
function launchFiveMWindowsDeelevatedViaScheduledTask(fivemExePath, cwd, addr) {
  const psSingle = (s) => String(s).replace(/'/g, "''");
  const cmdPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  const uri = addr ? fivemShellConnectUri(addr) : '';
  const cmdArg = uri
    ? `/c start "" "${uri.replace(/"/g, '')}"`
    : `/c start "" "${String(fivemExePath).replace(/"/g, '')}"`;
  const actionLine = `$act = New-ScheduledTaskAction -Execute '${psSingle(cmdPath)}' -Argument '${psSingle(cmdArg)}'`;
  const body = [
    '$ErrorActionPreference = "Stop"',
    `$tn = 'AfterlifeFiveM_' + ([guid]::NewGuid().ToString('n').Substring(0,22))`,
    actionLine,
    '$pr = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited',
    '$st = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew',
    'Register-ScheduledTask -TaskName $tn -Action $act -Principal $pr -Settings $st -Force | Out-Null',
    'Start-ScheduledTask -TaskName $tn',
    'Start-Sleep -Milliseconds 1500',
    'Unregister-ScheduledTask -TaskName $tn -Confirm:$false -ErrorAction SilentlyContinue'
  ].join('\r\n');
  const ps1Path = path.join(
    app.getPath('temp'),
    `afterlife-fivem-deelev-${process.pid}-${Date.now()}.ps1`
  );
  fs.writeFileSync(ps1Path, `\ufeff${body}`, 'utf8');
  const psPath = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  return new Promise((resolve, reject) => {
    execFile(
      psPath,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
      { windowsHide: true, timeout: 60000 },
      (err) => {
        try {
          fs.unlinkSync(ps1Path);
        } catch (_) {}
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * runas /trustlevel + `cmd /c start "" "fivem://…"` — оболочка и понижение IL.
 */
function launchFiveMWindowsDeelevated(fivemExePath, cwd, addr, trustLevel) {
  const runasExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'runas.exe');
  const cmdExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  const uri = addr ? fivemShellConnectUri(addr) : '';
  const inner = uri
    ? `"${cmdExe}" /c start "" "${uri.replace(/"/g, '')}"`
    : `"${cmdExe}" /c start "" "${fivemExePath}"`;
  const level = trustLevel || '0x20000';
  return new Promise((resolve, reject) => {
    execFile(runasExe, [`/trustlevel:${level}`, inner], { cwd, windowsHide: true }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Запасной путь: `cmd /c start "" …` без /B — /B ломает распознавание «из оболочки» для FiveM.
 */
function launchFiveMWindowsViaCmdStart(fivemExePath, cwd, addr) {
  const comspec = process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  const uri = addr ? fivemShellConnectUri(addr) : '';
  const startArgs = uri
    ? ['/c', 'start', '""', uri]
    : ['/c', 'start', '""', fivemExePath];
  const child = spawn(comspec, startArgs, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.on('error', () => {});
  child.unref();
}

/** Как ярлык из проводника: сначала explorer.exe + fivem:// или путь к .exe, иначе start. */
async function launchFiveMWindowsLikeShortcut(fivemExePath, cwd, addr) {
  try {
    await launchFiveMViaExplorer(fivemExePath, addr);
  } catch (_) {
    launchFiveMWindowsViaCmdStart(fivemExePath, cwd, addr);
  }
}

const FIVEM_BUNDLE_ZIP_NAME = 'FiveM.zip';
/** Публичный ZIP в релизе репозитория лаунчера (тег fivem-bundle, вложение FiveM.zip). Пустой fivemClientZipUrl в конфиге = этот URL. */
const FIVEM_BUNDLE_RELEASE_ZIP_URL =
  'https://github.com/magner85/AfterlifeLauncher/releases/download/fivem-bundle/FiveM.zip';

function sendFivemInstallProgress(payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fivem-install-progress', payload);
    }
  } catch (_) {}
}

/** Локальный архив клиента: portable рядом с .exe или extraResources (bundled-fivem). */
function findBundledFivemZipPath() {
  const cands = [
    path.join(getLauncherDir(), 'bundled-fivem', FIVEM_BUNDLE_ZIP_NAME),
    path.join(getBundledResourcesDir(), 'bundled-fivem', FIVEM_BUNDLE_ZIP_NAME)
  ];
  for (const p of cands) {
    if (isFileSafe(p)) return p;
  }
  return '';
}

function resolveFivemZipSource(cfg) {
  const local = findBundledFivemZipPath();
  if (local) return { kind: 'local', path: local };
  const urlStr = String(cfg.fivemClientZipUrl || '').trim();
  const candidate = urlStr || FIVEM_BUNDLE_RELEASE_ZIP_URL;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { kind: 'remote', url: u.href };
  } catch {
    return null;
  }
}

function downloadHttpOrHttpsToFileWithProgress(startUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    let redirectsLeft = 10;
    const cleanupFail = () => {
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch (_) {}
    };
    const tryGet = (u) => {
      let lib;
      try {
        const proto = new URL(u).protocol;
        lib = proto === 'http:' ? http : https;
      } catch (e) {
        cleanupFail();
        reject(e);
        return;
      }
      const req = lib.get(
        u,
        { headers: { 'User-Agent': 'AfterlifeLauncher/1.0 (Windows; FiveM bundle)' } },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (--redirectsLeft < 0) {
              cleanupFail();
              reject(new Error('Слишком много перенаправлений при загрузке архива FiveM.'));
              return;
            }
            try {
              tryGet(new URL(res.headers.location, u).href);
            } catch (e) {
              cleanupFail();
              reject(e);
            }
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            cleanupFail();
            const hint =
              res.statusCode === 404
                ? ' Нет файла на сервере: для разработчика — npm run pack-fivem и релиз GitHub с тегом fivem-bundle + FiveM.zip.'
                : '';
            reject(new Error(`Загрузка архива FiveM: HTTP ${res.statusCode}.${hint}`));
            return;
          }
          const file = fs.createWriteStream(destPath);
          const total = parseInt(String(res.headers['content-length'] || '0'), 10);
          let received = 0;
          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) onProgress(received, total);
          });
          res.pipe(file);
          file.on('finish', () => {
            file.close((cerr) => {
              if (cerr) {
                cleanupFail();
                reject(cerr);
              } else resolve({ received, total });
            });
          });
          res.on('error', (e) => {
            file.close();
            cleanupFail();
            reject(e);
          });
        }
      );
      req.on('error', (e) => {
        cleanupFail();
        reject(e);
      });
    };
    tryGet(startUrl);
  });
}

function expandZipWindows(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const zp = zipPath.replace(/'/g, "''");
    const dp = destDir.replace(/'/g, "''");
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${zp}' -DestinationPath '${dp}' -Force`
      ],
      { windowsHide: true, timeout: 900000, maxBuffer: 4 * 1024 * 1024 },
      (err, _so, se) => {
        if (err) {
          reject(err || new Error(se ? String(se).slice(0, 800) : 'Expand-Archive'));
        } else resolve();
      }
    );
  });
}

function findFivemExtractRoot(staging) {
  if (!staging || !fs.existsSync(staging)) return '';
  const direct = path.join(staging, 'FiveM.exe');
  if (fs.existsSync(direct)) return staging;
  const nested = path.join(staging, 'FiveM', 'FiveM.exe');
  if (fs.existsSync(nested)) return path.join(staging, 'FiveM');
  try {
    const entries = fs.readdirSync(staging, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const sub = path.join(staging, ent.name, 'FiveM.exe');
      if (fs.existsSync(sub)) return path.join(staging, ent.name);
    }
  } catch (_) {}
  return '';
}

async function unpackFivemZipToAppData(zipPath) {
  const staging = path.join(path.dirname(zipPath), `fivem-unpack-${process.pid}-${Date.now()}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    await expandZipWindows(zipPath, staging);
    const root = findFivemExtractRoot(staging);
    if (!root) {
      throw new Error(
        'В архиве нет FiveM.exe. Упакуйте содержимое %LocalAppData%\\FiveM: exe в корне ZIP или в папке FiveM/.'
      );
    }
    const la = process.env.LOCALAPPDATA;
    if (!la) throw new Error('LOCALAPPDATA не задан.');
    const dest = path.join(la, 'FiveM');
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(root, dest, { recursive: true, force: true });
    const exe = path.join(dest, 'FiveM.exe');
    if (!isFileSafe(exe)) throw new Error('После распаковки не найден FiveM.exe.');
    return exe;
  } finally {
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch (_) {}
  }
}

ipcMain.handle('fivem:downloadInstall', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Установка клиента FiveM из архива доступна только в Windows.' };
  }
  const existing = guessDefaultFiveMExePath();
  if (existing && isFileSafe(existing)) {
    try {
      const cfg = loadConfig();
      if (!cfg.fivemExePath || !isFileSafe(cfg.fivemExePath)) saveConfig({ ...cfg, fivemExePath: existing });
    } catch (_) {}
    return { ok: true, fivemExePath: existing, already: true };
  }
  const cfg = loadConfig();
  const source = resolveFivemZipSource(cfg);
  if (!source) {
    return {
      ok: false,
      error: 'Некорректный fivemClientZipUrl в launcher.config.json.'
    };
  }
  const workDir = path.join(app.getPath('temp'), 'afterlife-fivem-bundle');
  const zipOnDisk = path.join(workDir, FIVEM_BUNDLE_ZIP_NAME);
  try {
    fs.mkdirSync(workDir, { recursive: true });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  try {
    if (source.kind === 'local') {
      sendFivemInstallProgress({
        phase: 'download',
        percent: 100,
        indeterminate: false,
        label: 'Архив FiveM',
        hint: 'Из поставки лаунчера'
      });
      fs.copyFileSync(source.path, zipOnDisk);
    } else {
      sendFivemInstallProgress({
        phase: 'download',
        percent: 0,
        indeterminate: false,
        label: 'Загрузка архива FiveM…',
        hint: ''
      });
      await downloadHttpOrHttpsToFileWithProgress(source.url, zipOnDisk, (received, total) => {
        const pct = total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : 0;
        const hint =
          total > 0
            ? `${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} МБ`
            : `${(received / 1048576).toFixed(1)} МБ`;
        sendFivemInstallProgress({
          phase: 'download',
          percent: pct,
          indeterminate: false,
          label: 'Загрузка архива FiveM…',
          hint
        });
      });
    }
    sendFivemInstallProgress({
      phase: 'install',
      percent: 100,
      indeterminate: true,
      label: 'Распаковка FiveM…',
      hint: '%LOCALAPPDATA%\\FiveM — без окон установщика'
    });
    const installed = await unpackFivemZipToAppData(zipOnDisk);
    try {
      const next = loadConfig();
      saveConfig({ ...next, fivemExePath: installed });
    } catch (_) {}
    sendFivemInstallProgress({ phase: 'done', percent: 100, indeterminate: false, label: '', hint: '' });
    return { ok: true, fivemExePath: installed };
  } catch (e) {
    sendFivemInstallProgress({ phase: 'error', percent: 0, indeterminate: false, label: '', hint: '' });
    return { ok: false, error: String(e.message || e) };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (_) {}
  }
});

ipcMain.handle('fivem:launch', async (_e, opts) => {
  const { fivemExePath, connectArg } = opts;
  if (!fivemExePath || !fs.existsSync(fivemExePath)) {
    return { ok: false, error: 'Укажите путь к FiveM.exe в настройках.' };
  }
  const cwd = path.dirname(fivemExePath);
  const addr = normalizeConnectArg(connectArg);
  try {
    if (process.platform === 'win32') {
      /** Без прав админа: запускаем через shell (explorer/start), чтобы FiveM не видел прямой child-process запуск. */
      if (!isWindowsElevated()) {
        try {
          await launchFiveMWindowsLikeShortcut(fivemExePath, cwd, addr);
          return { ok: true };
        } catch {
          /** Аварийный fallback: если shell-старт недоступен, пробуем старый прямой запуск. */
          const args = addr ? ['+connect', addr] : [];
          await new Promise((resolve, reject) => {
            try {
              const child = spawn(fivemExePath, args, {
                cwd,
                detached: true,
                stdio: 'ignore',
                windowsHide: true
              });
              child.on('error', (err) => reject(err));
              child.unref();
              resolve();
            } catch (e) {
              reject(e);
            }
          });
          return { ok: true };
        }
      }
      if (isWindowsElevated()) {
        /** Сначала explorer (как двойной щелчок / протокол), затем задача Limited, затем runas — FiveM требует shell, не прямой child. */
        try {
          await launchFiveMViaExplorer(fivemExePath, addr);
        } catch {
          try {
            await launchFiveMWindowsDeelevatedViaScheduledTask(fivemExePath, cwd, addr);
          } catch {
            try {
              await launchFiveMWindowsDeelevated(fivemExePath, cwd, addr, '0x20000');
            } catch {
              try {
                await launchFiveMWindowsDeelevated(fivemExePath, cwd, addr, '0x10000');
              } catch {
                launchFiveMWindowsViaCmdStart(fivemExePath, cwd, addr);
                return {
                  ok: true,
                  warn:
                    'FiveM мог запуститься с правами администратора и закрыться с ошибкой. Закройте лаунчер и откройте его без «Запуск от имени администратора» (для sing-box/TUN используйте «Перезапустить как администратор» только когда нужен туннель).'
                };
              }
            }
          }
        }
        return { ok: true };
      }
      await launchFiveMWindowsLikeShortcut(fivemExePath, cwd, addr);
      return { ok: true };
    }
    const args = [];
    if (addr) {
      args.push('+connect', addr);
    }
    const child = spawn(fivemExePath, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('fivem:findDefaultPath', async () => guessDefaultFiveMExePath());

function pingStdoutToText(stdout, stderr) {
  const chunks = [];
  if (Buffer.isBuffer(stdout)) chunks.push(stdout);
  else if (typeof stdout === 'string' && stdout) chunks.push(Buffer.from(stdout, 'utf8'));
  if (Buffer.isBuffer(stderr)) chunks.push(stderr);
  else if (typeof stderr === 'string' && stderr) chunks.push(Buffer.from(stderr, 'utf8'));
  if (!chunks.length) return '';
  const buf = Buffer.concat(chunks);
  const tryEnc = (enc) => {
    try {
      return buf.toString(enc);
    } catch {
      return '';
    }
  };
  const utf8 = tryEnc('utf8');
  if (parsePingMs(utf8) != null) return utf8;
  for (const enc of ['cp866', 'windows-1251', 'latin1']) {
    const t = tryEnc(enc);
    if (t && parsePingMs(t) != null) return t;
  }
  return utf8;
}

/** Разбор вывода ping.exe (RU/EN Win), в т.ч. time<1ms и строка «Ответ от…». */
function parsePingMs(stdout) {
  const out = String(stdout || '');
  if (/time\s*<\s*1\s*ms/i.test(out) || /время\s*<\s*1\s*мс/i.test(out)) return 1;
  /** Ответ есть (TTL в строке), но время в нестандартном виде — считаем узел ответившим. */
  if (/TTL\s*=\s*\d+/i.test(out) && (/Ответ от\b/i.test(out) || /Reply from\b/i.test(out))) {
    const loose = /(?:time|время)\D{0,8}(\d+)\s*(?:ms|мс)/i.exec(out);
    if (loose) {
      const n = parseInt(loose[1], 10);
      if (Number.isFinite(n) && n >= 0 && n < 60000) return n;
    }
    return 1;
  }
  const patterns = [
    /bytes=\d+\s+time[=:](\d+)\s*ms/i,
    /число байт=\d+\s+время[=:](\d+)\s*мс/i,
    /\btime\s*[=:]\s*(\d+)\s*ms\b/i,
    /\bвремя\s*[=:]\s*(\d+)\s*мс\b/i,
    /(?:Среднее|Average)[^\d]*(\d+)\s*(?:мс|ms)\b/i,
    /(?:Minimum|Maximum|Минимальное|Максимальное)[^\d]*(\d+)\s*(?:мс|ms)\b/i,
    /[=<]\s*(\d+)\s*(?:ms|мс)\b/i,
    /\b(\d+)\s*ms\b/i,
    /\b(\d+)\s*мс\b/i
  ];
  for (const re of patterns) {
    const m = re.exec(out);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n < 60000) return n;
    }
  }
  return null;
}

/** Таймаут ожидания ответа ping.exe (-w), мс. Слишком короткий даёт ложные «недоступен» при ICMP-блоке/медленном DNS. */
const ICMP_PING_WAIT_MS = 3200;

function icmpPingHost(host) {
  const h = String(host || '').trim();
  if (!h) return Promise.resolve({ ok: false, ms: null, error: 'empty' });
  const isWin = process.platform === 'win32';
  const pingBin = isWin
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ping.exe')
    : 'ping';
  /** -4: IPv4 — при сломаном IPv6 ping к имени иначе может не получить ответ. */
  const args = isWin ? ['-n', '1', '-4', '-w', String(ICMP_PING_WAIT_MS), h] : ['-c', '1', h];
  const execOpts = {
    encoding: 'buffer',
    timeout: isWin ? ICMP_PING_WAIT_MS + 2800 : 5200
  };
  if (isWin) execOpts.windowsHide = true;
  return new Promise((resolve) => {
    execFile(pingBin, args, execOpts, (err, stdout, stderr) => {
      const text = pingStdoutToText(stdout, stderr);
      const ms = parsePingMs(text);
      if (ms != null) resolve({ ok: true, ms });
      else resolve({ ok: false, ms: null, error: err ? err.message : 'no reply' });
    });
  });
}

/**
 * Доступность хоста: сначала ICMP, при таймауте/блокировке ICMP — TCP к 443 и 80
 * (часто HTTPS жив, а echo-request режется провайдером или DPI).
 */
async function reachabilityPingHost(host) {
  const icmp = await icmpPingHost(host);
  if (icmp.ok && icmp.ms != null) return { ok: true, ms: icmp.ms };
  const h = String(host || '').trim();
  if (!h) return { ok: false, ms: null, error: 'empty' };
  const t443 = await tcpConnectLatencyMs(h, 443, 4500);
  if (t443 != null) return { ok: true, ms: t443 };
  const t80 = await tcpConnectLatencyMs(h, 80, 3500);
  if (t80 != null) return { ok: true, ms: t80 };
  return { ok: false, ms: null, error: icmp.error || 'unreachable' };
}

const VLESS_PING_CONCURRENCY = 6;
const VLESS_UNREACHABLE_MS = 9e8;

/**
 * Только распознанные vless://; измеряет задержку до server (ICMP / TCP 443/80), сортирует по возрастанию ms.
 */
async function orderVlessLinesByReachability(vlessLines) {
  const items = [];
  for (const line of vlessLines) {
    const p = parseVlessUri(line);
    if (p) items.push({ line, p });
  }
  if (!items.length) return [];
  for (let i = 0; i < items.length; i += VLESS_PING_CONCURRENCY) {
    const chunk = items.slice(i, i + VLESS_PING_CONCURRENCY);
    await Promise.all(
      chunk.map(async (it) => {
        const r = await reachabilityPingHost(it.p.host);
        it.ms = r.ok && r.ms != null ? r.ms : VLESS_UNREACHABLE_MS;
      })
    );
  }
  items.sort((a, b) => a.ms - b.ms);
  return items.map((it) => it.line);
}

/**
 * Фильтр по всей подписке, затем пинг не более vpnAutoImportMaxUris разрешённых узлов и сортировка по задержке;
 * остальные разрешённые URI дописываются без измерения (порядок как в подписке).
 * @returns {{ ok: true, lines: string[] } | { ok: false, lines: [], error: string }}
 */
async function filterAndOrderSubscriptionVless(vlessLines, maxUrisCfg) {
  const cap = Math.min(50, Math.max(1, parseInt(String(maxUrisCfg), 10) || 12));
  const allowed = [];
  for (const line of vlessLines) {
    const p = parseVlessUri(line);
    if (!p) continue;
    if (!isVlessNodeBlocked(line, p)) allowed.push(line);
  }
  if (!allowed.length) {
    return {
      ok: false,
      lines: [],
      error:
        'После фильтрации (RU, Россия, YouTube, белые списки) не осталось ни одного узла vless://. Проверьте подписку или названия серверов.'
    };
  }
  const toPing = allowed.slice(0, cap);
  const orderedHead = await orderVlessLinesByReachability(toPing);
  const tail = allowed.slice(cap);
  const lines = orderedHead.concat(tail);
  return { ok: true, lines, error: null };
}

ipcMain.handle('net:ping', async (_e, host) => reachabilityPingHost(host));

function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const lib = new URL(url).protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      { method: 'GET', timeout: timeoutMs },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

/** Базовый URL HTTP-инфо FXServer (Citizen); для IPv6 — скобки в URL. */
function fxServerHttpBase(host, port) {
  const h = String(host || '').trim();
  const p = Number(port) || 30120;
  if (net.isIPv6(h)) return `http://[${h}]:${p}`;
  return `http://${h}:${p}`;
}

/**
 * Параллельный опрос стандартных JSON эндпоинтов FXServer (любой успешный = сервер отвечает по HTTP).
 * Раньше хватало только dynamic.json — при его сбое ложно показывали «недоступен».
 */
async function probeFxServerJsonEndpoints(host, port) {
  const base = fxServerHttpBase(host, port);
  const endpoints = [
    { name: 'info', url: `${base}/info.json` },
    { name: 'dynamic', url: `${base}/dynamic.json` },
    { name: 'players', url: `${base}/players.json` }
  ];
  const settled = await Promise.allSettled(
    endpoints.map((e) => httpGetJson(e.url, 9000).then((data) => ({ name: e.name, data })))
  );

  let apiOnline = false;
  let clients = null;
  let maxClients = null;
  let hostname = null;
  let gametype = '';

  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { name, data } = s.value;
    if (!data || typeof data !== 'object') continue;
    apiOnline = true;

    if (name === 'info') {
      if (data.hostname) hostname = String(data.hostname);
      if (data.vars && data.vars.sv_projectName) hostname = String(data.vars.sv_projectName);
      if (data.vars && data.vars.sv_maxclients != null) maxClients = Number(data.vars.sv_maxclients);
      if (data.vars && data.vars.gametype) gametype = String(data.vars.gametype);
    } else if (name === 'dynamic') {
      if (typeof data.clients === 'number') clients = data.clients;
      if (data.sv_maxclients != null) maxClients = Number(data.sv_maxclients);
    } else if (name === 'players' && Array.isArray(data)) {
      clients = data.length;
    }
  }

  return { apiOnline, clients, maxClients, hostname, gametype };
}

/** TCP к порту сервера — часто проходит, когда ICMP и даже HTTP режутся, но клиент FiveM подключается. */
function tcpGamePortOpen(host, port, timeoutMs = 4500) {
  const h = String(host || '').trim();
  const p = Number(port);
  if (!h || !Number.isFinite(p) || p <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.connect({ host: h, port: p, family: 0 }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.on('error', () => resolve(false));
  });
}

/** Задержка TCP до порта (мс) — запасной «пинг», если ICMP не парсится / блокируется. */
function tcpConnectLatencyMs(host, port, timeoutMs = 4500) {
  const h = String(host || '').trim();
  const p = Number(port);
  if (!h || !Number.isFinite(p) || p <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = net.connect({ host: h, port: p, family: 0 }, () => {
      const ms = Math.round(Date.now() - t0);
      sock.destroy();
      resolve(Math.max(0, ms));
    });
    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => {
      sock.destroy();
      resolve(null);
    });
    sock.on('error', () => resolve(null));
  });
}

function extractCfxJoinId(raw) {
  const s = String(raw || '').trim();
  const m = /cfx\.re\/join\/([a-z0-9]+)/i.exec(s) || /\/join\/([a-z0-9]+)/i.exec(s);
  return m ? m[1] : null;
}

function parseDirectEndpoint(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^fivem:\/\//i, '')
    .replace(/^connect\s+/i, '');
  const first = cleaned.split(/[/\s?#]/)[0];
  if (!first) return null;

  if (first.startsWith('[')) {
    const close = first.indexOf(']');
    if (close === -1) return null;
    const host = first.slice(1, close);
    const rest = first.slice(close + 1);
    if (rest.startsWith(':')) {
      const port = parseInt(rest.slice(1), 10);
      return { host, port: Number.isFinite(port) && port > 0 ? port : 30120 };
    }
    return { host, port: 30120 };
  }

  if (first.includes(':')) {
    const idx = first.lastIndexOf(':');
    const hostPart = first.slice(0, idx);
    const portPart = first.slice(idx + 1);
    if (/^\d{1,5}$/.test(portPart)) {
      const port = parseInt(portPart, 10);
      if (!hostPart) return null;
      return { host: hostPart, port: Number.isFinite(port) && port > 0 ? port : 30120 };
    }
    if (net.isIPv6(first)) return { host: first, port: 30120 };
    return { host: first, port: 30120 };
  }

  return { host: first, port: 30120 };
}

ipcMain.handle('server:status', async (_e, connectHost) => {
  const raw = String(connectHost || '').trim();
  if (!raw) return { ok: false, error: 'Пустой адрес сервера' };

  let hostname = 'Сервер';
  let clients = null;
  let maxClients = null;
  let apiOnline = false;
  let pingTarget = null;
  let gametype = '';
  let directHost = null;
  let directPort = null;
  let tcpOk = false;
  /** Конечная точка из API (хост + порт) — для ICMP и TCP-латентности */
  let endpointParsed = null;

  const cfxId = extractCfxJoinId(raw);
  if (cfxId) {
    try {
      const j = await httpGetJson(
        `https://servers-frontend.fivem.net/api/servers/single/${cfxId}`,
        9000
      );
      const data = j.Data || j.data;
      if (data) {
        apiOnline = true;
        if (data.hostname) hostname = String(data.hostname);
        if (typeof data.clients === 'number') clients = data.clients;
        if (data.sv_maxclients != null) maxClients = Number(data.sv_maxclients);
        const ep = data.connectEndPoints && data.connectEndPoints[0];
        if (ep && typeof ep === 'string') {
          const parsedEp = parseDirectEndpoint(ep);
          if (parsedEp) {
            pingTarget = parsedEp.host;
            endpointParsed = parsedEp;
          }
        }
      }
    } catch (_) {
      /* пробуем прямой адрес ниже */
    }
  }

  if (!apiOnline) {
    const parsed = parseDirectEndpoint(raw);
    if (parsed) {
      const { host, port } = parsed;
      directHost = host;
      directPort = port;
      pingTarget = pingTarget || host;
      const probe = await probeFxServerJsonEndpoints(host, port);
      if (probe.apiOnline) {
        apiOnline = true;
        if (probe.hostname) hostname = String(probe.hostname);
        else hostname = host;
        if (probe.clients != null) clients = probe.clients;
        if (probe.maxClients != null) maxClients = probe.maxClients;
        if (probe.gametype) gametype = probe.gametype;
      }
    }
  }

  if (!pingTarget && !cfxId) {
    const p = parseDirectEndpoint(raw);
    if (p) pingTarget = p.host;
  }

  const latencyHost = directHost || pingTarget;
  const latencyPort =
    directHost && directPort && directPort > 0
      ? directPort
      : endpointParsed && endpointParsed.port > 0
        ? endpointParsed.port
        : 30120;

  /** Пинг для UI: сначала TCP к игровому порту (как при входе в FiveM), ICMP — запасной вариант. */
  let pingMs = null;
  let icmpOk = false;
  if (latencyHost && latencyPort > 0) {
    const tTcp = await tcpConnectLatencyMs(latencyHost, latencyPort, 4500);
    if (tTcp != null) pingMs = tTcp;
  }
  if (pingTarget) {
    const pr = await icmpPingHost(pingTarget);
    icmpOk = pr.ok && pr.ms != null;
    if (pingMs == null && pr.ms != null) pingMs = pr.ms;
  } else if (latencyHost && pingMs == null) {
    const pr = await icmpPingHost(latencyHost);
    icmpOk = pr.ok && pr.ms != null;
    if (pr.ms != null) pingMs = pr.ms;
  }

  if (!apiOnline && directHost && directPort) {
    tcpOk = await tcpGamePortOpen(directHost, directPort, 4500);
  }

  const reachable = apiOnline || icmpOk || tcpOk;

  const message = '';

  return {
    ok: true,
    reachable,
    apiOnline,
    tcpOk,
    icmpOk,
    pingMs,
    pingHost: pingTarget || null,
    hostname,
    clients,
    maxClients,
    gametype,
    message
  };
});

