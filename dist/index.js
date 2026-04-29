/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 573:
/***/ ((module) => {

/**
 * Генерация sing-box JSON: TUN (весь трафик системы) + vless из URI подписки.
 * Поддержка: security=reality|tls|none, type=tcp|grpc|ws (частые поля из vless://).
 */

function isIpLiteral(host) {
  const h = String(host || '').trim();
  if (!h) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(':')) return true;
  return false;
}

function parseVlessUri(raw) {
  const u = String(raw || '').trim();
  if (!u.toLowerCase().startsWith('vless://')) return null;
  const noScheme = u.slice(8);
  const hashSep = noScheme.indexOf('#');
  const main = hashSep >= 0 ? noScheme.slice(0, hashSep) : noScheme;
  let name = '';
  if (hashSep >= 0) {
    try {
      name = decodeURIComponent(noScheme.slice(hashSep + 1));
    } catch {
      name = noScheme.slice(hashSep + 1);
    }
  }
  const qSep = main.indexOf('?');
  const hostPart = qSep >= 0 ? main.slice(0, qSep) : main;
  const queryStr = qSep >= 0 ? main.slice(qSep + 1) : '';
  const at = hostPart.indexOf('@');
  if (at < 0) return null;
  const uuid = hostPart.slice(0, at);
  const hp = hostPart.slice(at + 1);
  let host;
  let port;
  if (hp.startsWith('[')) {
    const close = hp.indexOf(']');
    if (close < 0) return null;
    host = hp.slice(1, close);
    const rest = hp.slice(close + 1);
    if (!rest.startsWith(':')) return null;
    port = parseInt(rest.slice(1), 10);
  } else {
    const lc = hp.lastIndexOf(':');
    if (lc < 0) return null;
    host = hp.slice(0, lc);
    port = parseInt(hp.slice(lc + 1), 10);
  }
  if (!uuid || !host || !Number.isFinite(port) || port <= 0) return null;
  const query = Object.fromEntries(new URLSearchParams(queryStr));
  return { uuid, host, port, query, name: name || host };
}

function buildTlsFromQuery(q) {
  const sec = String(q.security || 'none').toLowerCase();
  const sni = q.sni || q.host || '';
  const tls = { enabled: false };
  if (sec === 'none' || !sec) {
    return tls;
  }
  tls.enabled = true;
  if (sni) tls.server_name = sni;
  if (sec === 'reality') {
    tls.reality = { enabled: true };
    if (q.pbk) tls.reality.public_key = String(q.pbk);
    if (q.sid) tls.reality.short_id = String(q.sid);
  }
  const fp = String(q.fp || '').toLowerCase();
  if (fp && fp !== 'random') {
    tls.utls = { enabled: true, fingerprint: q.fp };
  } else if (sec === 'reality' || sec === 'tls') {
    tls.utls = { enabled: true, fingerprint: 'chrome' };
  }
  return tls;
}

function buildTransportFromQuery(q) {
  const t = String(q.type || 'tcp').toLowerCase();
  if (t === 'grpc') {
    const sn = q.serviceName || q.service_name || '';
    return { type: 'grpc', service_name: sn };
  }
  if (t === 'ws') {
    const out = { type: 'ws', path: q.path || '/' };
    const h = q.host || q.sni;
    if (h) out.headers = { Host: h };
    return out;
  }
  return undefined;
}

function vlessToOutbound(parsed, tag) {
  const { uuid, host, port, query } = parsed;
  const ob = {
    type: 'vless',
    tag,
    server: host,
    server_port: port,
    uuid,
    packet_encoding: 'xudp'
  };
  const tls = buildTlsFromQuery(query);
  if (tls.enabled) ob.tls = tls;
  const tr = buildTransportFromQuery(query);
  if (tr) ob.transport = tr;
  return ob;
}

/**
 * @param {string[]} vlessLines — только vless://
 * @param {number} defaultIndex — индекс сервера по умолчанию в селекторе
 * @param {{ checkDomains?: string[] }} [options] — явно гнать проверяемые домены через proxy (маршрут)
 */
function buildSingBoxTunConfig(vlessLines, defaultIndex, options) {
  const opt = options || {};
  const checkDomains = Array.isArray(opt.checkDomains) ? opt.checkDomains.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const parsedList = [];
  for (const line of vlessLines) {
    const p = parseVlessUri(line);
    if (p) parsedList.push(p);
  }
  if (!parsedList.length) {
    throw new Error('Нет валидных vless:// для sing-box');
  }
  const idx = Math.max(0, Math.min(defaultIndex, parsedList.length - 1));
  const srvTags = parsedList.map((_, i) => `srv${i}`);
  const outbounds = [];
  outbounds.push({
    type: 'selector',
    tag: 'proxy',
    outbounds: [...srvTags, 'direct'],
    default: srvTags[idx]
  });
  for (let i = 0; i < parsedList.length; i++) {
    outbounds.push(vlessToOutbound(parsedList[i], srvTags[i]));
  }
  outbounds.push({ type: 'direct', tag: 'direct' });
  outbounds.push({ type: 'dns', tag: 'dns-out' });

  /** Имена узлов VPN — через системный DNS (direct), остальные запросы — через туннель к 8.8.8.8. */
  const bootstrapHosts = [...new Set(parsedList.map((p) => p.host).filter((h) => h && !isIpLiteral(h)))];
  const dnsServers = [
    { tag: 'local', type: 'local' },
    {
      tag: 'remote',
      type: 'udp',
      server: '8.8.8.8',
      server_port: 53,
      detour: 'proxy'
    }
  ];
  const dnsRules = [];
  if (bootstrapHosts.length) {
    dnsRules.push({ domain: bootstrapHosts, server: 'local' });
  }

  const routeRules = [{ protocol: 'dns', outbound: 'dns-out' }];
  for (const d of checkDomains) {
    routeRules.push({ domain: [d], outbound: 'proxy' });
    routeRules.push({ domain_suffix: [d], outbound: 'proxy' });
  }

  const dnsBlock = {
    servers: dnsServers,
    final: 'remote',
    strategy: 'prefer_ipv4'
  };
  if (dnsRules.length) dnsBlock.rules = dnsRules;

  return {
    log: { level: 'warn', timestamp: true },
    dns: dnsBlock,
    inbounds: [
      {
        type: 'tun',
        tag: 'tun-in',
        interface_name: 'AfterlifeTUN',
        address: ['172.19.0.1/30'],
        mtu: 9000,
        auto_route: true,
        strict_route: true,
        stack: 'system',
        sniff: true
      }
    ],
    outbounds,
    route: {
      rules: routeRules,
      final: 'proxy',
      auto_detect_interface: true
    }
  };
}

module.exports = {
  parseVlessUri,
  buildSingBoxTunConfig,
  isIpLiteral
};


/***/ }),

/***/ 623:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);

const pathFile = __nccwpck_require__.ab + "path.txt";

function getElectronPath () {
  let executablePath;
  if (fs.existsSync(__nccwpck_require__.ab + "path.txt")) {
    executablePath = fs.readFileSync(pathFile, 'utf-8');
  }
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || 'electron');
  }
  if (executablePath) {
    return __nccwpck_require__.ab + "dist/" + executablePath;
  } else {
    throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again');
  }
}

module.exports = getElectronPath();


/***/ }),

/***/ 317:
/***/ ((module) => {

"use strict";
module.exports = require("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 611:
/***/ ((module) => {

"use strict";
module.exports = require("http");

/***/ }),

/***/ 692:
/***/ ((module) => {

"use strict";
module.exports = require("https");

/***/ }),

/***/ 278:
/***/ ((module) => {

"use strict";
module.exports = require("net");

/***/ }),

/***/ 928:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ }),

/***/ 16:
/***/ ((module) => {

"use strict";
module.exports = require("url");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const { app, BrowserWindow, ipcMain, shell, nativeImage } = __nccwpck_require__(623);
const path = __nccwpck_require__(928);
const { pathToFileURL } = __nccwpck_require__(16);
const { execFile, execFileSync, spawn } = __nccwpck_require__(317);
const fs = __nccwpck_require__(896);
const http = __nccwpck_require__(611);
const https = __nccwpck_require__(692);
const net = __nccwpck_require__(278);
const { buildSingBoxTunConfig, parseVlessUri } = __nccwpck_require__(573);

/** Конфиг рядом с проектом (dev) или с .exe (сборка), не в AppData */
function getConfigPath() {
  if (app.isPackaged) {
    return path.join(path.dirname(process.execPath), 'launcher.config.json');
  }
  return __nccwpck_require__.ab + "launcher.config.json";
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
  if (!Array.isArray(c.checkDomains)) c.checkDomains = ['cfx.re'];
  c.checkDomains = [...new Set(c.checkDomains.map((s) => String(s || '').trim()).filter(Boolean))];
  if (!c.checkDomains.length) c.checkDomains = ['cfx.re'];
  if (typeof c.serverConnect !== 'string') c.serverConnect = '';
  c.serverConnect = c.serverConnect.trim();
  if (!c.serverConnect) c.serverConnect = DEFAULT_SERVER_CONNECT;
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
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      merged = { ...defaults, ...data };
    }
  } catch (e) {
    console.error('launcher.config.json:', e.message);
  }
  return normalizeConfig(mergeSingBoxDiscovery(normalizeConfig(merged)));
}

const DEFAULT_EMBED_URL = 'https://vk.com/afterlife_dayz';
const DEFAULT_SERVER_CONNECT = '45.136.205.9:30120';

function getDefaultConfig() {
  return {
    fivemExePath: '',
    serverConnect: DEFAULT_SERVER_CONNECT,
    projectUrl: DEFAULT_EMBED_URL,
    vkUrl: DEFAULT_EMBED_URL,
    discordUrl: 'https://discord.gg',
    embedUrl: DEFAULT_EMBED_URL,
    /** true — грузить embedUrl во webview; false — заглушка assets/site.jpg (сайт в разработке). */
    embedActive: true,
    checkDomains: ['cfx.re', 'cloudflare.com', 'fivem.net'],
    vpnSubscriptionUrl: '',
    vpnAutoImportMaxUris: 12,
    tunnelSingBoxPath: ''
  };
}

/** Папка с launcher.exe (сборка) или корень проекта (dev) — сюда кладите sing-box.exe */
function getLauncherDir() {
  if (app.isPackaged) return path.dirname(process.execPath);
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

function resolveSingBoxExe(cfg) {
  const custom = String(cfg?.tunnelSingBoxPath || '').trim();
  if (custom) {
    const abs = path.isAbsolute(custom) ? custom : path.join(getLauncherDir(), custom);
    if (fs.existsSync(abs)) return abs;
    return null;
  }
  const dir = getLauncherDir();
  for (const n of SINGBOX_EXE_BASENAMES) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
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

/** Иконка окна и панели задач — тот же PNG, что и в шапке (src/assets/titlebar-logo.png). */
function getWindowIconNativeImage() {
  const iconPath = __nccwpck_require__.ab + "titlebar-logo.png";
  if (!fs.existsSync(__nccwpck_require__.ab + "titlebar-logo.png")) return undefined;
  try {
    const img = nativeImage.createFromPath(__nccwpck_require__.ab + "titlebar-logo.png");
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

function createWindow() {
  const winIcon = getWindowIconNativeImage();
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    icon: winIcon,
    webPreferences: {
      preload: __nccwpck_require__.ab + "preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  if (process.platform === 'darwin' && winIcon) {
    try {
      app.dock.setIcon(winIcon);
    } catch (_) {}
  }

  mainWindow.loadFile(__nccwpck_require__.ab + "index.html");
  mainWindow.once('ready-to-show', () => mainWindow.show());

  /** Каждый показ окна (в т.ч. после сворачивания) — поднять webview во фронте. */
  mainWindow.on('show', () => {
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
app.on('before-quit', () => killTunnelProcess());
app.on('window-all-closed', () => app.quit());

/** file:// URL страницы-заглушки с site.jpg (для webview, когда embedActive = false). */
function getEmbedPlaceholderPageUrl() {
  const htmlPath = __nccwpck_require__.ab + "embed-placeholder.html";
  if (fs.existsSync(__nccwpck_require__.ab + "embed-placeholder.html")) {
    return pathToFileURL(htmlPath).href;
  }
  const jpgPath = __nccwpck_require__.ab + "site.jpg";
  if (fs.existsSync(__nccwpck_require__.ab + "site.jpg")) {
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

/** sing-box TUN: vless + DNS через прокси + явные маршруты на checkDomains из конфига. */
async function executeSingBoxTunnelStart(cfgLoad, vlessOnly, defaultIndex) {
  killTunnelProcess();
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
  const configPath = path.join(app.getPath('userData'), 'afterlife-sing-box-tun.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(json, null, 2), 'utf8');
  const cwd = path.dirname(singBox);
  try {
    const child = spawn(singBox, ['run', '-c', configPath], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    tunnelProcess = child;
    child.on('error', () => {});
    child.on('exit', () => {
      if (tunnelProcess === child) tunnelProcess = null;
    });
    child.unref();
    return { ok: true, error: null, configPath, exePath: singBox, pid: child.pid };
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
        'Пустая ссылка на подписку. Откройте настройки (Shift+F12) и укажите HTTPS-ссылку на подписку с vless://.',
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
  return executeSingBoxTunnelStart(cfgLoad, prep.lines, 0);
});

ipcMain.handle('tunnel:stop', async () => {
  killTunnelProcess();
  return { ok: true };
});

ipcMain.handle('tunnel:status', async () => ({
  running: !!(tunnelProcess && !tunnelProcess.killed),
  pid: tunnelProcess && !tunnelProcess.killed ? tunnelProcess.pid : null
}));

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

ipcMain.handle('app:restartElevated', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Повышение прав доступно только в Windows' };
  }
  const exe = process.execPath;
  const cwd = getLauncherDir();
  try {
    const cmd = `Start-Process -LiteralPath ${JSON.stringify(exe)} -WorkingDirectory ${JSON.stringify(cwd)} -Verb RunAs`;
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', () => {});
    child.unref();
    setTimeout(() => {
      try {
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
  if (!mainWindow) return [1040, 760];
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

ipcMain.handle('fivem:launch', async (_e, opts) => {
  const { fivemExePath, connectArg } = opts;
  if (!fivemExePath || !fs.existsSync(fivemExePath)) {
    return { ok: false, error: 'Укажите путь к FiveM.exe в настройках.' };
  }
  const cwd = path.dirname(fivemExePath);
  const addr = normalizeConnectArg(connectArg);
  try {
    if (process.platform === 'win32') {
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

ipcMain.handle('fivem:findDefaultPath', async () => {
  const local = process.env.LOCALAPPDATA;
  if (!local) return '';
  const guess = path.join(local, 'FiveM', 'FiveM.exe');
  return fs.existsSync(guess) ? guess : '';
});

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
      const ms = Math.max(1, Math.round(Date.now() - t0));
      sock.destroy();
      resolve(ms);
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

  let pingMs = null;
  let icmpOk = false;
  if (pingTarget) {
    const pr = await icmpPingHost(pingTarget);
    icmpOk = pr.ok && pr.ms != null;
    pingMs = pr.ms;
  }

  const latencyHost = directHost || pingTarget;
  const latencyPort =
    directHost && directPort && directPort > 0
      ? directPort
      : endpointParsed && endpointParsed.port > 0
        ? endpointParsed.port
        : 30120;
  if (pingMs == null && latencyHost) {
    const tms = await tcpConnectLatencyMs(latencyHost, latencyPort, 4500);
    if (tms != null) pingMs = tms;
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


module.exports = __webpack_exports__;
/******/ })()
;