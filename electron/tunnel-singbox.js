/**
 * Генерация sing-box JSON: TUN (весь трафик системы) + vless из URI подписки.
 * Требуется sing-box ≥ 1.11 (правила route с action: sniff / hijack-dns / route).
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
  /** XTLS Vision / flow параметр — без него Reality-сервер молча закрывает TLS-handshake. */
  const flow = String(query.flow || '').trim();
  if (flow) ob.flow = flow;
  const tls = buildTlsFromQuery(query);
  if (tls.enabled) ob.tls = tls;
  const tr = buildTransportFromQuery(query);
  if (tr) ob.transport = tr;
  return ob;
}

/** Уникальное имя Wintun-адаптера и адресного пула: после падения старый адаптер остаётся, и повторный запуск с тем же IP падает с "object already exists". */
function randomTunIdentity() {
  const rng = Math.floor(Math.random() * 1e9);
  const ifSuffix = String(Math.floor(Math.random() * 9000) + 1000);
  const octet2 = 20 + (rng % 80);
  const hex = (rng & 0xffff).toString(16).padStart(4, '0');
  return {
    interfaceName: `AfterlifeTUN${ifSuffix}`,
    ipv4: `172.${octet2}.${(rng >> 8) & 0xff}.1/30`,
    ipv6: `fdfe:dcba:${hex}::1/126`
  };
}

/**
 * @param {string[]} vlessLines — только vless://
 * @param {number} defaultIndex — индекс сервера по умолчанию в селекторе
 * @param {{ checkDomains?: string[], interfaceName?: string, ipv4?: string, ipv6?: string }} [options]
 */
function buildSingBoxTunConfig(vlessLines, defaultIndex, options) {
  const opt = options || {};
  const checkDomains = Array.isArray(opt.checkDomains) ? opt.checkDomains.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const ident = {
    interfaceName: opt.interfaceName || randomTunIdentity().interfaceName,
    ipv4: opt.ipv4 || randomTunIdentity().ipv4,
    ipv6: opt.ipv6 || randomTunIdentity().ipv6
  };
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
  /** sing-box 1.12+ отвергает «пустой» direct, если на него ссылается detour DNS —
   *  udp_fragment:false — валидный параметр 1.14 и заодно избавляет от проблем с фрагментацией UDP. */
  outbounds.push({ type: 'direct', tag: 'direct', udp_fragment: false });

  const bootstrapHosts = [...new Set(parsedList.map((p) => p.host).filter((h) => h && !isIpLiteral(h)))];
  /**
   * bootstrap — резолв имени VLESS-сервера через 1.1.1.1 поверх direct (минуя провайдерский DNS),
   * иначе при DNS-подмене провайдером sing-box не найдёт сам VPN-сервер и туннель не поднимается.
   * local — системный DNS для частных имён (LAN / .local).
   * remote — 8.8.8.8 через поднятый proxy для всего остального трафика приложений.
   */
  const dnsServers = [
    { tag: 'bootstrap', type: 'udp', server: '1.1.1.1', server_port: 53, detour: 'direct' },
    { tag: 'local', type: 'local' },
    { tag: 'remote', type: 'udp', server: '8.8.8.8', server_port: 53, detour: 'proxy' }
  ];
  const dnsRules = [];
  if (bootstrapHosts.length) {
    dnsRules.push({ domain: bootstrapHosts, server: 'bootstrap' });
  }

  /**
   * sing-box 1.11+: legacy { protocol: "dns", outbound: "dns" } ломает hijack DNS в TUN —
   * система шлёт DNS мимо sing-box, браузер/Discord не резолвятся через прокси.
   */
  const routeRules = [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
    { ip_is_private: true, action: 'route', outbound: 'direct' }
  ];
  /** Хост VLESS-сервера — direct: предотвращаем петлю «proxy→сам же proxy». */
  if (bootstrapHosts.length) {
    routeRules.push({
      domain: bootstrapHosts,
      action: 'route',
      outbound: 'direct'
    });
  }
  /** IP-литералы VPN-серверов — тоже direct (на случай vless://uuid@ip:port). */
  const ipLiteralHosts = [...new Set(parsedList.map((p) => p.host).filter((h) => h && isIpLiteral(h)))];
  if (ipLiteralHosts.length) {
    routeRules.push({
      ip_cidr: ipLiteralHosts.map((ip) => (ip.includes(':') ? `${ip}/128` : `${ip}/32`)),
      action: 'route',
      outbound: 'direct'
    });
  }
  for (const d of checkDomains) {
    const host = String(d || '').trim().replace(/^\./, '');
    if (!host) continue;
    routeRules.push({
      domain: [host],
      domain_suffix: [`.${host}`],
      action: 'route',
      outbound: 'proxy'
    });
  }

  const dnsBlock = {
    servers: dnsServers,
    final: 'remote',
    strategy: 'prefer_ipv4'
  };
  if (dnsRules.length) dnsBlock.rules = dnsRules;

  return {
    log: { level: 'info', timestamp: true },
    dns: dnsBlock,
    inbounds: [
      {
        type: 'tun',
        tag: 'tun-in',
        interface_name: ident.interfaceName,
        address: [ident.ipv4, ident.ipv6],
        /** 1400 безопаснее 1500 для Wintun+TLS+Reality — реже фрагментируется handshake. */
        mtu: 1400,
        auto_route: true,
        /** strict_route на Windows часто рвёт маршрут до VLESS-сервера и блокирует весь трафик. */
        strict_route: false,
        stack: 'mixed',
        /** Весь публичный IPv4/IPv6 через TUN (Windows/macOS/Linux с auto_route). */
        route_address: ['0.0.0.0/1', '128.0.0.0/1', '::/1', '8000::/1'],
        /** Локальные сети и loopback не заворачиваем в TUN — иначе ломается LAN и маршрутизация. */
        route_exclude_address: [
          '192.168.0.0/16',
          '10.0.0.0/8',
          '172.16.0.0/12',
          '127.0.0.0/8',
          'fc00::/7',
          'fe80::/10'
        ]
      }
    ],
    outbounds,
    route: {
      rules: routeRules,
      final: 'proxy',
      auto_detect_interface: true,
      /** Внутренний резолвер sing-box (для outbounds/route) — bootstrap, чтобы VPN-сервер резолвился даже при DNS-подмене провайдера. */
      default_domain_resolver: 'bootstrap'
    }
  };
}

module.exports = {
  parseVlessUri,
  buildSingBoxTunConfig,
  isIpLiteral,
  randomTunIdentity
};
