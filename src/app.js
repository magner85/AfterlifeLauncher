(function () {
  /** Ширина/высота под центральный webview (логика embed как в C:\\Afterlife). */
  const BASE_WIDTH = 1120;
  /** Высота окна лаунчера: больше места под webview; нижняя полоса с копирайтом сохраняется. */
  const BASE_HEIGHT = 720;
  const BYPASS_EXTRA = 300;
  /** URL сайта во фрейме и для «Сайт» — не редактируется в UI, только в коде. */
  const LAUNCHER_FRAME_URL = 'https://afterlifedayz.ru';
  const DEFAULT_SERVER_CONNECT = '45.136.205.9:30120';
  const DEV_MODE_PIN = '2128506';
  const DEV_PIN_SESSION_KEY = 'afterlife_dev_auth_ok';
  /** Ссылка на Discord через VK away — единый канон для кнопок и дефолтов. */
  const DEFAULT_DISCORD_URL =
    'https://vk.com/away.php?to=https%3A%2F%2Fdiscord.gg%2FGK35WfYjtr&utf=1';
  /** Виджет багов — отдельный инвайт на канал репортов. */
  const BUG_REPORT_DISCORD_URL = 'https://discord.gg/ksHb8mTz';

  /** Стили и поведение гостевой страницы во фрейме (insertCSS + zoom) — как в рабочей сборке C:\\Afterlife. */
  const EMBED_GUEST_CSS = `
html { overflow-x: hidden !important; max-width: 100% !important; }
body { overflow-x: hidden !important; max-width: 100% !important; box-sizing: border-box !important; }
img, video, canvas, iframe, embed, object, svg { max-width: 100% !important; box-sizing: border-box !important; }
*{scrollbar-width:thin;scrollbar-color:rgba(70,76,88,0.95) rgba(0,0,0,0.32);}
*::-webkit-scrollbar{width:7px;height:0}
*::-webkit-scrollbar:horizontal{display:none}
*::-webkit-scrollbar-track{background:rgba(0,0,0,0.32);border-radius:999px;box-shadow:inset 0 0 0 1px rgba(70,76,88,0.65)}
*::-webkit-scrollbar-thumb{background:rgba(70,76,88,0.92);border-radius:3px;border:1px solid rgba(70,76,88,0.75)}
*::-webkit-scrollbar-thumb:hover{border-color:#c9a227;background:#c9a227;box-shadow:0 0 8px rgba(201,162,39,0.35)}
*::-webkit-scrollbar-corner{background:transparent}
  `.trim();

  const EMBED_GUEST_FIT_JS = `
(function(){
  function boxSize(el){
    if(!el)return null;
    try{
      var r=el.getBoundingClientRect();
      return {w:Math.ceil(Math.max(el.scrollWidth,r.width)),h:Math.ceil(Math.max(el.scrollHeight,r.height))};
    }catch(e){return null;}
  }
  function tryFit(){
    try{
      var h=document.documentElement;
      var b=document.body;
      h.style.zoom='';
      /* Режим #featured-news: блок уже растянут flex-цепочкой, zoom не нужен (и ломает шрифты) */
      if(document.querySelector('#featured-news.afterlife-embed-news-root'))return;
      var cw=h.clientWidth;
      var ch=h.clientHeight;
      if(cw<32||ch<32)return;
      var sw=Math.max(cw,h.scrollWidth,b?b.scrollWidth:cw);
      var sh=Math.max(ch,h.scrollHeight,b?b.scrollHeight:ch);
      var fe=document.getElementById('featured-news');
      var card=fe?fe.querySelector('.featured-news-card'):null;
      var bx=boxSize(card)||boxSize(fe);
      if(bx){sw=Math.max(sw,bx.w);sh=Math.max(sh,bx.h);}
      var zx=cw/(sw||cw);
      var zy=ch/(sh||ch);
      var z=Math.min(zx,zy,1);
      if(z>=0.998)return;
      if(z<0.12)z=0.12;
      h.style.zoom=String(z);
    }catch(e){}
  }
  window.__afterlifeEmbedFit=tryFit;
  if(!window.__afterlifeEmbedTuneListeners){
    window.__afterlifeEmbedTuneListeners=true;
    window.addEventListener('resize',tryFit);
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',function(){setTimeout(tryFit,0);},{once:true});
    }
  }
  tryFit();
  setTimeout(tryFit,120);
  setTimeout(tryFit,400);
  setTimeout(tryFit,1200);
  setTimeout(tryFit,2400);
  var __t=0;
  if(!window.__afterlifeEmbedFitBurst){
    window.__afterlifeEmbedFitBurst=1;
    __t=setInterval(function(){tryFit();},500);
    setTimeout(function(){clearInterval(__t);},10000);
  }
})();
true;
  `.trim();

  function embedHostnameFromUrl(urlStr) {
    try {
      return new URL(String(urlStr || '').trim()).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return '';
    }
  }

  function isVkEmbedHost(host) {
    return /^(m\.)?vk\.com$/i.test(host) || /^vk\.ru$/i.test(host);
  }

  /** Типовые порталы / WP / Elementor — верхняя шапка с «Войти» и меню (вне main). */
  const EMBED_GENERIC_HEADER_CSS = `
body > header,
body > #header,
body > [role="banner"],
.site-header,
#masthead,
.elementor-location-header,
.ast-primary-header-bar,
#wpadminbar,
[class*="site-header"],
[class*="top-header"],
[class*="TopBar"] {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  visibility: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
}
html { margin-top: 0 !important; }
body.admin-bar { padding-top: 0 !important; }
  `.trim();

  /** Доп. CSS: VK — вся верхняя полоса (поиск, вход, уведомления), не трогаем #page_body. */
  function embedChromeHideCss(host) {
    if (isVkEmbedHost(host)) {
      return `
#top_nav,
#page_header_cont,
#page_header,
#page_header_wrap,
#top_notifications_wrap,
#stl_side,
#stl_left,
#top_profile_btn,
#top_audio,
#top_search,
#ts_wrap,
#quick_login,
#fastchat,
#fastchats { display: none !important; height: 0 !important; min-height: 0 !important; max-height: 0 !important; overflow: hidden !important; visibility: hidden !important; pointer-events: none !important; margin: 0 !important; padding: 0 !important; border: none !important; }
#page_layout { padding-top: 0 !important; margin-top: 0 !important; }
#wrap_between,
#page_layout {
  display: flex !important;
  flex-direction: column !important;
  flex: 1 1 auto !important;
  min-height: 0 !important;
  height: 100% !important;
  max-height: 100% !important;
  box-sizing: border-box !important;
}
#page_body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  box-sizing: border-box !important;
}
      `.trim();
    }
    return EMBED_GENERIC_HEADER_CSS;
  }

  /** Скрытие шапки после SPA; VK и прочие сайты (портал в webview). */
  function embedChromeKillScript() {
    const vkSels = JSON.stringify([
      '#page_header_cont',
      '#page_header_wrap',
      '#top_nav',
      '#page_header',
      '#top_notifications_wrap',
      '#stl_side',
      '#stl_left',
      '#top_profile_btn',
      '#top_audio',
      '#top_search',
      '#ts_wrap',
      '#quick_login'
    ]);
    const portalSels = JSON.stringify([
      'header',
      '[role="banner"]',
      '.site-header',
      '#masthead',
      '.elementor-location-header',
      '#wpadminbar',
      '.ast-primary-header-bar'
    ]);
    return `(function(){
      var vkSels=${vkSels};
      var portalSels=${portalSels};
      function isVkHost(){
        return /^(m\\.)?vk\\.com$/i.test(location.hostname)||/^vk\\.ru$/i.test(location.hostname);
      }
      function vkHide(){
        vkSels.forEach(function(sel){
          try{
            document.querySelectorAll(sel).forEach(function(n){
              if(n.closest('#page_body'))return;
              n.style.setProperty('display','none','important');
              n.style.setProperty('height','0','important');
              n.style.setProperty('min-height','0','important');
              n.style.setProperty('overflow','hidden','important');
            });
          }catch(e){}
        });
        try{
          document.querySelectorAll('[class*="TopNav__"]').forEach(function(n){
            if(n.closest('#page_body'))return;
            var r=n.getBoundingClientRect();
            if(r.top<=8&&r.bottom<=220)n.style.setProperty('display','none','important');
          });
        }catch(e){}
      }
      function portalHide(){
        portalSels.forEach(function(sel){
          try{
            document.querySelectorAll(sel).forEach(function(n){
              if(n.closest('main')||n.closest('[role="main"]')||n.closest('#page_body')||n.closest('.entry-content')||n.closest('#content'))return;
              n.style.setProperty('display','none','important');
            });
          }catch(e){}
        });
      }
      function tick(){ if(isVkHost())vkHide(); else portalHide(); }
      tick();
      if(!window.__afterlifeEmbedChromeMO){
        window.__afterlifeEmbedChromeMO=1;
        var t;
        try{
          var mo=new MutationObserver(function(){clearTimeout(t);t=setTimeout(tick,130);});
          mo.observe(document.documentElement,{childList:true,subtree:true});
        }catch(e){}
      }
    })();void 0;`;
  }

  /** Во фрейме: только блок #featured-news; flex-цепочка body → ... → #featured-news (flex:1 1 auto). */
  const EMBED_FIRST_NEWS_CSS = `
html, body {
  overflow: hidden !important;
  height: 100% !important;
  max-height: 100% !important;
  margin: 0 !important;
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
* { scrollbar-width: none !important; -ms-overflow-style: none !important; }
*::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
#featured-news.afterlife-embed-news-root {
  position: relative;
  box-sizing: border-box !important;
  border-radius: 14px;
  border: 1px solid rgba(201, 162, 39, 0.32) !important;
  background: linear-gradient(165deg, rgba(26, 28, 34, 0.96) 0%, rgba(14, 15, 18, 0.99) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 10px 36px rgba(0, 0, 0, 0.45);
  overflow: hidden !important;
  max-height: 100% !important;
}
#featured-news.afterlife-embed-news-root .featured-news-card {
  overflow: hidden !important;
  max-height: 100% !important;
  box-sizing: border-box !important;
}
#featured-news.afterlife-embed-news-root .comments,
#featured-news.afterlife-embed-news-root #comments,
#featured-news.afterlife-embed-news-root .comments-section,
#featured-news.afterlife-embed-news-root .comment-section,
#featured-news.afterlife-embed-news-root .comments-block,
#featured-news.afterlife-embed-news-root .comments-widget,
#featured-news.afterlife-embed-news-root .comments-list,
#featured-news.afterlife-embed-news-root .comments-wrap,
#featured-news.afterlife-embed-news-root .news-comments,
#featured-news.afterlife-embed-news-root [class*="comment" i],
#featured-news.afterlife-embed-news-root [id*="comment" i],
#featured-news.afterlife-embed-news-root [data-comment],
#featured-news.afterlife-embed-news-root [data-comments] {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
}
  `.trim();

  function embedFirstNewsScript() {
    return `(function(){
    function pathToBody(node){
      var path=[];
      var x=node;
      while(x&&x!==document.body){
        path.unshift(x);
        x=x.parentNode;
      }
      return path;
    }
    function hideSiblingsOnPath(path){
      var b=document.body;
      var i,j,k,par,keep,ch;
      if(!path.length)return;
      for(i=0;i<b.children.length;i++){
        ch=b.children[i];
        if(ch!==path[0])ch.style.setProperty('display','none','important');
      }
      for(j=0;j<path.length-1;j++){
        par=path[j];
        keep=path[j+1];
        for(k=0;k<par.children.length;k++){
          ch=par.children[k];
          if(ch!==keep)ch.style.setProperty('display','none','important');
        }
      }
    }
    function apply(){
      var root=document.documentElement;
      var b=document.body;
      if(!b)return;
      var el=document.getElementById('featured-news');
      if(!el||!b.contains(el))return;
      var path=pathToBody(el);
      if(!path.length)return;
      hideSiblingsOnPath(path);
      root.style.setProperty('overflow','hidden','important');
      root.style.setProperty('height','100%','important');
      root.style.setProperty('max-height','100%','important');
      root.style.setProperty('margin','0','important');
      root.style.setProperty('padding','0','important');
      b.style.setProperty('overflow','hidden','important');
      b.style.setProperty('height','100%','important');
      b.style.setProperty('max-height','100%','important');
      b.style.setProperty('margin','0','important');
      b.style.setProperty('padding','0','important');
      b.style.setProperty('box-sizing','border-box','important');
      b.style.setProperty('display','flex','important');
      b.style.setProperty('flex-direction','column','important');
      var j,node;
      for(j=0;j<path.length-1;j++){
        node=path[j];
        node.style.setProperty('display','flex','important');
        node.style.setProperty('flex-direction','column','important');
        node.style.setProperty('flex','1 1 auto','important');
        node.style.setProperty('min-height','0','important');
        node.style.setProperty('width','100%','important');
        node.style.setProperty('max-width','100%','important');
        node.style.setProperty('box-sizing','border-box','important');
        node.style.setProperty('margin','0','important');
        node.style.setProperty('padding','0','important');
      }
      el.style.setProperty('box-sizing','border-box','important');
      el.style.setProperty('width','100%','important');
      el.style.setProperty('max-width','100%','important');
      el.style.setProperty('flex','1 1 auto','important');
      el.style.setProperty('min-height','0','important');
      el.style.setProperty('max-height','100%','important');
      el.style.setProperty('overflow','hidden','important');
      el.style.setProperty('margin','0','important');
      el.style.setProperty('padding','clamp(8px,2vmin,12px) clamp(10px,2.6vmin,18px) clamp(8px,2.4vmin,16px)','important');
      el.classList.add('afterlife-embed-news-root');
      var cards=el.querySelectorAll('.featured-news-card');
      var idx=1;
      var card=cards.length>idx?cards[idx]:cards[0]||null;
      var i,cn;
      for(i=0;i<cards.length;i++){
        cn=cards[i];
        if(!cn)continue;
        if(cn!==card)cn.style.setProperty('display','none','important');
        else cn.style.removeProperty('display');
      }
      if(card){
        card.style.setProperty('overflow','hidden','important');
        card.style.setProperty('max-height','100%','important');
        card.style.setProperty('box-sizing','border-box','important');
      }
      try{el.scrollTop=0;}catch(e){}
    }
    apply();
    if(!window.__afterlifeFirstNewsTimers){
      window.__afterlifeFirstNewsTimers=1;
      [60,240,700,1500,3000,6000].forEach(function(ms){setTimeout(apply,ms);});
    }
    if(!window.__afterlifeFirstNewsMO){
      window.__afterlifeFirstNewsMO=1;
      var t;
      try{
        var mo=new MutationObserver(function(){
          clearTimeout(t);
          t=setTimeout(apply,180);
        });
        mo.observe(document.documentElement,{childList:true,subtree:true});
      }catch(e){}
      try{
        window.addEventListener('resize',function(){clearTimeout(t);t=setTimeout(apply,120);});
      }catch(e){}
    }
  })();void 0;`;
  }

  const $ = (sel) => document.querySelector(sel);

  const appEl = $('#app');
  const bypassPanel = $('#bypassPanel');
  const btnBypass = $('#btnBypassToggle');
  const pingList = $('#pingList');
  const bypassLog = $('#bypassLog');
  const REPAIR_IDLE = 'Починить сеть';
  const REPAIR_BACK = 'Возврат';
  /** Клиент: после успешного ремонта кнопка «Возврат»; wasTunnel — отключать только нужное при откате UI. */
  let clientRepairActive = false;
  let clientRepairWasTunnel = false;
  let devBypassPowerOn = false;
  const webview = $('#siteWebview');
  const embedPanel = $('#embedPanel');
  let embedGuestCssKey = null;
  /** 'live' — сайт по embedUrl; 'placeholder' — локальная заглушка site.jpg во webview. */
  let embedViewMode = 'placeholder';
  const titlebarLogo = $('#titlebarLogo');
  if (titlebarLogo) {
    titlebarLogo.addEventListener('error', () => titlebarLogo.classList.add('titlebar-logo--missing'));
  }

  let config = null;
  let bypassOpen = false;
  let statusTimer = null;
  function isDevMode() {
    return appEl.dataset.dev === 'true';
  }

  function getFrameUrl() {
    return LAUNCHER_FRAME_URL;
  }

  function getConnectHost() {
    return (config && String(config.serverConnect || '').trim()) || DEFAULT_SERVER_CONNECT;
  }

  function isDevPinSessionOk() {
    try {
      return sessionStorage.getItem(DEV_PIN_SESSION_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setDevPinSessionOk() {
    try {
      sessionStorage.setItem(DEV_PIN_SESSION_KEY, '1');
    } catch (_) {}
  }

  function openDevPinGate() {
    const gate = $('#devPinGate');
    const inp = $('#devPinInput');
    const err = $('#devPinErr');
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
    if (inp) inp.value = '';
    if (gate) {
      gate.hidden = false;
      gate.setAttribute('aria-hidden', 'false');
    }
    appEl.dataset.devPinGate = 'open';
    requestAnimationFrame(() => {
      if (inp) inp.focus();
    });
  }

  function closeDevPinGate() {
    const gate = $('#devPinGate');
    if (gate) {
      gate.hidden = true;
      gate.setAttribute('aria-hidden', 'true');
    }
    delete appEl.dataset.devPinGate;
  }

  function setDevMode(on) {
    const next = !!on;
    appEl.dataset.dev = next ? 'true' : 'false';
    if (!next) {
      setBypassUi(false);
      window.launcher.setWindowSizeAnimated(BASE_WIDTH, BASE_HEIGHT, 280);
    }
    refreshElevationUi();
    refreshPingDomainPreview();
    if (next) void refreshBypassVlessSelect();
  }

  function tryDevModeShortcut() {
    if (isDevMode()) {
      closeDevPinGate();
      setDevMode(false);
      return;
    }
    if (!isDevPinSessionOk()) {
      openDevPinGate();
      return;
    }
    setDevMode(true);
  }

  function isTypingInLauncherField(target) {
    if (!target || target.nodeType !== 1) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.closest && target.closest('input, textarea, select')) return true;
    if (target.closest && target.closest('#devPinGate')) return true;
    return false;
  }

  function log(line, cls) {
    if (!bypassLog) return;
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = line + '\n';
    bypassLog.appendChild(span);
    bypassLog.scrollTop = bypassLog.scrollHeight;
  }

  function appendLogRaw(html) {
    if (!bypassLog) return;
    bypassLog.insertAdjacentHTML('beforeend', html);
    bypassLog.scrollTop = bypassLog.scrollHeight;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /** ===== Кастомная модалка (alert / confirm) в стиле лаунчера. ===== */
  const alModalBackdrop = $('#alModalBackdrop');
  const alModalEl = $('#alModal');
  const alModalIcon = $('#alModalIcon');
  const alModalTitle = $('#alModalTitle');
  const alModalBody = $('#alModalBody');
  const alModalList = $('#alModalList');
  const alModalActions = $('#alModalActions');
  let alModalResolver = null;
  let alModalEscBound = false;

  function closeAlModal(result) {
    if (!alModalBackdrop) return;
    alModalBackdrop.hidden = true;
    alModalBackdrop.setAttribute('aria-hidden', 'true');
    if (alModalActions) alModalActions.innerHTML = '';
    if (alModalList) { alModalList.innerHTML = ''; alModalList.hidden = true; }
    const resolver = alModalResolver;
    alModalResolver = null;
    if (resolver) resolver(result);
  }

  if (alModalBackdrop && !alModalBackdrop.__afterlifeBound) {
    alModalBackdrop.__afterlifeBound = true;
    alModalBackdrop.addEventListener('click', (e) => {
      if (e.target === alModalBackdrop) {
        /** Клик вне карточки — эквивалент отмены. */
        closeAlModal({ ok: false, value: 'backdrop' });
      }
    });
  }
  if (!alModalEscBound) {
    alModalEscBound = true;
    document.addEventListener('keydown', (e) => {
      if (!alModalBackdrop || alModalBackdrop.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAlModal({ ok: false, value: 'escape' });
      } else if (e.key === 'Enter') {
        /** Enter активирует primary-кнопку, если есть. */
        const primary = alModalActions && alModalActions.querySelector('.al-modal__btn--primary');
        if (primary) {
          e.preventDefault();
          primary.click();
        }
      }
    });
  }

  const AL_MODAL_ICONS = {
    info: 'i',
    warning: '!',
    error: '×',
    confirm: '?',
    discord: 'D'
  };

  function showAlModal(opts) {
    if (!alModalBackdrop || !alModalEl) {
      /** Graceful fallback: если разметки нет, ведём себя как alert/confirm. */
      if (opts && opts.type === 'confirm') return Promise.resolve({ ok: window.confirm(opts.message || ''), value: 'fallback' });
      window.alert((opts && (opts.title + '\n\n' + opts.message)) || '');
      return Promise.resolve({ ok: true, value: 'fallback' });
    }
    /** Закрываем предыдущее, если было открыто. */
    if (alModalResolver) {
      try { alModalResolver({ ok: false, value: 'superseded' }); } catch (_) {}
      alModalResolver = null;
    }
    const kind = String(opts.kind || opts.type || 'info');
    alModalEl.classList.remove('al-modal--info', 'al-modal--warning', 'al-modal--error');
    if (kind === 'error') alModalEl.classList.add('al-modal--error');
    else if (kind === 'warning' || kind === 'confirm') alModalEl.classList.add('al-modal--warning');
    else alModalEl.classList.add('al-modal--info');
    const iconKey = opts.icon || (kind === 'error' ? 'error' : kind === 'warning' ? 'warning' : kind === 'confirm' ? 'confirm' : 'info');
    if (alModalIcon) alModalIcon.textContent = AL_MODAL_ICONS[iconKey] || 'i';
    if (alModalTitle) alModalTitle.textContent = String(opts.title || 'Уведомление');
    if (alModalBody) alModalBody.textContent = String(opts.message || '');
    if (alModalList) {
      if (Array.isArray(opts.items) && opts.items.length) {
        alModalList.hidden = false;
        alModalList.innerHTML = opts.items.map((it) => `<li>${escapeHtml(String(it))}</li>`).join('');
      } else {
        alModalList.hidden = true;
        alModalList.innerHTML = '';
      }
    }
    if (alModalActions) {
      alModalActions.innerHTML = '';
      const buttons = Array.isArray(opts.buttons) && opts.buttons.length
        ? opts.buttons
        : [{ value: 'ok', label: 'OK', primary: true }];
      buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'al-modal__btn';
        if (b.primary) btn.classList.add('al-modal__btn--primary');
        if (b.danger) btn.classList.add('al-modal__btn--danger');
        btn.textContent = String(b.label || 'OK');
        btn.addEventListener('click', () =>
          closeAlModal({
            ok: b.cancel === true ? false : true,
            value: b.value ?? b.label,
            primary: !!b.primary
          })
        );
        alModalActions.appendChild(btn);
      });
    }
    alModalBackdrop.hidden = false;
    alModalBackdrop.setAttribute('aria-hidden', 'false');
    /** Автофокус на primary — чтобы Enter сразу работал по ожидаемой кнопке. */
    setTimeout(() => {
      const primary = alModalActions && (alModalActions.querySelector('.al-modal__btn--primary') || alModalActions.querySelector('.al-modal__btn'));
      if (primary) primary.focus();
    }, 20);
    return new Promise((res) => { alModalResolver = res; });
  }

  async function showAlAlert(message, opts) {
    await showAlModal({
      type: 'info',
      kind: (opts && opts.kind) || 'info',
      title: (opts && opts.title) || 'Уведомление',
      message: String(message || ''),
      items: opts && opts.items,
      buttons: [{ value: 'ok', label: (opts && opts.okLabel) || 'OK', primary: true }]
    });
  }

  async function showAlConfirm(message, opts) {
    const r = await showAlModal({
      type: 'confirm',
      kind: (opts && opts.kind) || 'confirm',
      title: (opts && opts.title) || 'Подтверждение',
      message: String(message || ''),
      items: opts && opts.items,
      buttons: [
        { value: 'cancel', label: (opts && opts.cancelLabel) || 'Отмена' },
        { value: 'ok', label: (opts && opts.okLabel) || 'Продолжить', primary: true, danger: !!(opts && opts.danger) }
      ]
    });
    return !!(r && r.ok && r.value === 'ok');
  }

  function getFivemExePath() {
    return (config && String(config.fivemExePath || '').trim()) || '';
  }

  async function ensureFivemPathInConfig() {
    let p = getFivemExePath();
    if (p && typeof window.launcher.isFivemExePathValid === 'function') {
      try {
        const v = await window.launcher.isFivemExePathValid(p);
        if (!v || !v.ok) {
          await savePartial({ fivemExePath: '' });
          p = '';
        }
      } catch (_) {
        await savePartial({ fivemExePath: '' });
        p = '';
      }
    }
    if (p) return p;
    try {
      const found = await window.launcher.findFiveMPath();
      if (found) {
        await savePartial({ fivemExePath: found });
        return String(found).trim();
      }
    } catch (_) {}
    return '';
  }

  async function refreshPlayDockButton() {
    await ensureFivemPathInConfig();
    const btn = $('#btnPlay');
    if (!btn) return;
    const has = !!getFivemExePath();
    btn.dataset.mode = has ? 'play' : 'download';
    btn.innerHTML = has
      ? '<span class="btn-play-icon"></span>ИГРАТЬ'
      : '<span class="btn-play-icon"></span>ЗАГРУЗИТЬ';
  }

  /**
   * Проверка релиза на GitHub и установка portable exe (без ручной загрузки в браузере).
   * @param {boolean} isManual — с кнопки; иначе тихое предложение при старте.
   * @param {object} [precomputed] — уже полученный результат checkSelfUpdate (без второго запроса).
   */
  async function runLauncherSelfUpdateCheck(isManual, precomputed) {
    if (typeof window.launcher.checkSelfUpdate !== 'function') {
      if (isManual) {
        void showAlAlert('Обновлений нет.', { title: 'Обновление', kind: 'info' });
      }
      return;
    }
    const btn = $('#btnCheckUpdates');
    let r = precomputed;
    if (!r) {
      if (isManual && btn) btn.classList.add('is-loading');
      try {
        r = await window.launcher.checkSelfUpdate();
      } catch (e) {
        r = { ok: false, error: String(e.message || e) };
      } finally {
        if (isManual && btn) setTimeout(() => btn.classList.remove('is-loading'), 380);
      }
    }
    if (!r || !r.ok) {
      if (isManual) {
        void showAlAlert('Обновлений нет.', { title: 'Обновление', kind: 'info' });
      }
      return;
    }
    if (r.devMode) {
      if (isManual) {
        void showAlAlert('Обновлений нет.', { title: 'Обновление', kind: 'info' });
      }
      return;
    }
    if (!r.needsUpdate) {
      if (isManual) {
        void showAlAlert('Обновлений нет.', { title: 'Обновление', kind: 'info' });
      }
      return;
    }
    const choice = await showAlModal({
      kind: 'info',
      title: 'Обновление',
      message: 'Доступно обновление лаунчера. Установить сейчас?',
      buttons: isManual
        ? [
            { value: 'cancel', label: 'Отмена', cancel: true },
            { value: 'install', label: 'Установить', primary: true }
          ]
        : [
            { value: 'later', label: 'Позже', cancel: true },
            { value: 'install', label: 'Установить', primary: true }
          ]
    });
    if (!choice || choice.value !== 'install') {
      if (!isManual && r.latestVersion) {
        try {
          sessionStorage.setItem('al_update_dismissed', String(r.latestVersion));
        } catch (_) {}
      }
      return;
    }
    if (typeof window.launcher.applySelfUpdate !== 'function') return;
    try {
      const ar = await window.launcher.applySelfUpdate(r.downloadUrl);
      if (!ar || !ar.ok) {
        void showAlAlert('Не удалось установить обновление.', { title: 'Обновление', kind: 'error' });
      }
    } catch (_) {
      void showAlAlert('Не удалось установить обновление.', { title: 'Обновление', kind: 'error' });
    }
  }

  function scheduleLauncherAutoUpdateCheck() {
    if (!config || config.updateAutoCheck === false) return;
    setTimeout(() => {
      void (async () => {
        let r;
        try {
          if (typeof window.launcher.checkSelfUpdate !== 'function') return;
          r = await window.launcher.checkSelfUpdate();
        } catch {
          return;
        }
        if (!r || !r.ok || !r.needsUpdate || r.devMode) return;
        try {
          if (sessionStorage.getItem('al_update_dismissed') === String(r.latestVersion)) return;
        } catch (_) {}
        await runLauncherSelfUpdateCheck(false, r);
      })();
    }, 4500);
  }

  async function loadConfig() {
    config = await window.launcher.getConfig();
    const chkEmbed = $('#chkEmbedActive');
    if (chkEmbed) chkEmbed.checked = !!config.embedActive;
    const chkRepairTunnel = $('#chkRepairTunnel');
    if (chkRepairTunnel) chkRepairTunnel.checked = !!config.repairUseTunneling;
    const selBv = $('#selectBypassVless');
    if (selBv && config && selBv.options.length) {
      const want = Math.max(0, parseInt(String(config.bypassVlessIndex ?? 0), 10) || 0);
      const max = selBv.options.length - 1;
      selBv.value = String(Math.min(want, max));
    }
    refreshPingDomainPreview();
    await syncEmbedPanelView();
    void refreshPlayDockButton();
  }

  async function clearEmbedGuestStyles() {
    if (!webview) return;
    try {
      if (embedGuestCssKey) {
        await webview.removeInsertedCSS(embedGuestCssKey);
      }
    } catch (_) {}
    embedGuestCssKey = null;
  }

  async function syncEmbedPanelView() {
    if (!webview || !embedPanel || !config) return;
    const active = !!config.embedActive;
    if (active) {
      embedViewMode = 'live';
      embedPanel.classList.remove('webview-wrap--placeholder');
      embedPanel.classList.add('webview-wrap--live');
      webview.removeAttribute('hidden');
      await clearEmbedGuestStyles();
      webview.src = getFrameUrl();
      nativeNewsLastHtml = '';
      nativeNewsLastListKey = '';
      if (nativeNewsList) { nativeNewsList.hidden = true; nativeNewsList.innerHTML = ''; }
      setNativeNewsError('Загрузка новостей…');
    } else {
      embedViewMode = 'placeholder';
      embedPanel.classList.add('webview-wrap--placeholder');
      embedPanel.classList.remove('webview-wrap--live');
      webview.removeAttribute('hidden');
      await clearEmbedGuestStyles();
      webview.src = 'about:blank';
      nativeNewsLastHtml = '';
      nativeNewsLastListKey = '';
      if (nativeNewsList) { nativeNewsList.hidden = true; nativeNewsList.innerHTML = ''; }
      setNativeNewsError('Раздел новостей отключён в настройках.');
      stopNativeNewsPoll();
      return;
    }
    startNativeNewsPoll();
  }

  async function savePartial(partial) {
    config = await window.launcher.setConfig(partial);
  }

  /** То же, что кнопка «Применить» у фрейма: сохранить URL/флаг и перезагрузить webview. */
  async function applyEmbedFromPanel() {
    const chk = $('#chkEmbedActive');
    const embedActive = chk ? !!chk.checked : !!(config && config.embedActive);
    await savePartial({ embedUrl: getFrameUrl(), embedActive });
    await syncEmbedPanelView();
  }

  /** Счётчик отмены: параллельные kick/stop/reload ломали гостя (пустой webview). */
  let embedKickToken = 0;

  /**
   * Один мягкий цикл: src + один reload после задержки (без stopLoading/loadURL).
   */
  function kickEmbedGuestLoad() {
    if (!webview || webview.hasAttribute('hidden') || embedViewMode !== 'live' || !config || !config.embedActive) return;
    const url = getFrameUrl();
    if (!url) return;
    embedKickToken += 1;
    const t = embedKickToken;
    requestAnimationFrame(() => {
      if (t !== embedKickToken) return;
      try {
        webview.src = url;
      } catch (_) {}
    });
    setTimeout(() => {
      if (t !== embedKickToken) return;
      try {
        if (typeof webview.reload === 'function') webview.reload();
      } catch (_) {}
    }, 420);
  }

  /** То же по смыслу, что kick для live: src + отложенный reload (заглушка file://). */
  function kickPlaceholderWebview() {
    if (!webview || webview.hasAttribute('hidden') || embedViewMode !== 'placeholder') return;
    embedKickToken += 1;
    const t = embedKickToken;
    requestAnimationFrame(() => {
      if (t !== embedKickToken) return;
      void (async () => {
        try {
          const ph =
            typeof window.launcher.getEmbedPlaceholderUrl === 'function'
              ? await window.launcher.getEmbedPlaceholderUrl()
              : '';
          if (ph) webview.src = ph;
        } catch (_) {}
      })();
    });
    setTimeout(() => {
      if (t !== embedKickToken) return;
      try {
        if (typeof webview.reload === 'function') webview.reload();
      } catch (_) {}
    }, 400);
  }

  let embedWatchdogTimer = null;
  let embedWatchdogDeadline = 0;
  let embedHealthyStreak = 0;

  function stopEmbedWatchdog() {
    if (embedWatchdogTimer) {
      clearInterval(embedWatchdogTimer);
      embedWatchdogTimer = null;
    }
    embedWatchdogDeadline = 0;
    embedHealthyStreak = 0;
  }

  function isWebviewShowingExpectedPage() {
    if (!webview) return true;
    try {
      const u = typeof webview.getURL === 'function' ? webview.getURL() : '';
      if (!u || u === 'about:blank') return false;
      if (embedViewMode === 'live') return /^https?:/i.test(u);
      return /^file:/i.test(u);
    } catch (_) {
      return false;
    }
  }

  function nudgeWebviewIfStuck() {
    if (!webview || webview.hasAttribute('hidden')) return;
    if (embedViewMode === 'live' && config && config.embedActive) {
      kickEmbedGuestLoad();
      return;
    }
    if (embedViewMode === 'placeholder') kickPlaceholderWebview();
  }

  function tickEmbedWatchdog() {
    if (!webview || webview.hasAttribute('hidden')) {
      stopEmbedWatchdog();
      return;
    }
    if (embedWatchdogDeadline && Date.now() > embedWatchdogDeadline) {
      stopEmbedWatchdog();
      return;
    }
    if (isWebviewShowingExpectedPage()) {
      embedHealthyStreak += 1;
      runEmbedGuestFitOnly();
      void runEmbedChromeKillOnly();
      void runEmbedFirstNewsOnly();
      if (embedHealthyStreak >= 3) stopEmbedWatchdog();
      return;
    }
    embedHealthyStreak = 0;
    nudgeWebviewIfStuck();
  }

  /** Пока страница «не завелась» — проверка каждые 2 с (после успеха несколько раз подряд стоп). */
  function startEmbedWatchdog(maxMs = 120000) {
    stopEmbedWatchdog();
    embedWatchdogDeadline = Date.now() + maxMs;
    embedHealthyStreak = 0;
    embedWatchdogTimer = setInterval(tickEmbedWatchdog, 2000);
    tickEmbedWatchdog();
  }

  /**
   * Первый assign к guest webview часто не даёт кадр до layout / window.load.
   * «Применить» + один мягкий kick (src + отложенный reload).
   */
  function scheduleEmbedReloadLikeApply() {
    const run = () => {
      void (async () => {
        await applyEmbedFromPanel();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (config && config.embedActive) kickEmbedGuestLoad();
            else kickPlaceholderWebview();
          });
        });
      })();
    };
    const afterLayout = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(run, 60);
        });
      });
    };
    if (document.readyState === 'complete') {
      afterLayout();
    } else {
      window.addEventListener('load', afterLayout, { once: true });
    }
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          if (document.readyState === 'complete') afterLayout();
        },
        { once: true }
      );
    }
  }

  /** Вытягиваем из webview: innerHTML блока #featured-news + массив элементов #news-list, + ставим helper для свапа. */
  const NATIVE_NEWS_EXTRACT_JS = `
(function(){
  function toAbs(u){ try{ return new URL(String(u||''), location.href).href; }catch(e){ return String(u||''); } }
  function stripAttrs(cl){
    try {
      cl.querySelectorAll('*').forEach(function(n){
        n.removeAttribute('class');
        n.removeAttribute('style');
        n.removeAttribute('id');
        for (var i=n.attributes.length-1;i>=0;i--){
          var nm=n.attributes[i].name;
          if (nm.indexOf('data-')===0 || nm.indexOf('aria-')===0) n.removeAttribute(nm);
        }
      });
    } catch(e){}
  }
  function absolutize(cl){
    try {
      cl.querySelectorAll('img').forEach(function(n){ var s=n.getAttribute('src'); if(s) n.setAttribute('src', toAbs(s)); n.removeAttribute('srcset'); n.removeAttribute('loading'); });
      cl.querySelectorAll('a').forEach(function(n){ var h=n.getAttribute('href'); if(h) n.setAttribute('href', toAbs(h)); n.setAttribute('target','_blank'); n.setAttribute('rel','noopener'); });
      cl.querySelectorAll('video source, video').forEach(function(n){ var s=n.getAttribute('src'); if(s) n.setAttribute('src', toAbs(s)); });
    } catch(e){}
  }
  function stripComments(cl){
    try {
      cl.querySelectorAll('script, style, noscript, iframe').forEach(function(n){ n.parentNode && n.parentNode.removeChild(n); });
    } catch(e){}
    try {
      cl.querySelectorAll('[class*="comment" i], [id*="comment" i], [data-comments]').forEach(function(n){ n.parentNode && n.parentNode.removeChild(n); });
    } catch(e){}
    /* Если виджет комментариев без classes с "comment" — находим короткий хедер типа "0 Комментарии" и удаляем его. */
    try {
      cl.querySelectorAll('*').forEach(function(n){
        if (!n || !n.parentNode) return;
        var txt = (n.textContent || '').trim();
        if (!txt) return;
        if (txt.length > 60) return;
        if (!/^[\\s\\d]*коммент/i.test(txt)) return;
        n.parentNode.removeChild(n);
      });
    } catch(e){}
  }
  function cleanClone(node){
    var cl = node.cloneNode(true);
    stripComments(cl);
    absolutize(cl);
    stripAttrs(cl);
    return cl;
  }
  function pickFeatured(){
    var el = document.getElementById('featured-news');
    if (el) return el;
    var alt = document.querySelector('main section .featured-news-card, main .featured-news-card, .featured-news-card');
    return alt || null;
  }
  function pickList(){
    var el = document.getElementById('news-list');
    if (el) return el;
    return document.querySelector('.news-grid-small, .news-grid, [id*="news-list" i]');
  }
  function textOf(n){ return n ? (n.textContent || '').replace(/\\s+/g,' ').trim() : ''; }
  function extractListItem(card){
    /* Ищем по ОРИГИНАЛУ (с классами), иначе селекторы типа .date, [class*="title"] пустые после очистки. */
    var dateNode = card.querySelector('time, .date, [class*="date" i], [class*="Date" i], small');
    var titleNode = card.querySelector('h1, h2, h3, h4, [class*="title" i], [class*="Title" i], [class*="heading" i]');
    var excerptNode = card.querySelector('p, [class*="excerpt" i], [class*="Excerpt" i], [class*="desc" i], [class*="Desc" i], [class*="summary" i]');
    var href = '';
    var linkNode = card.querySelector('a[href]');
    if (linkNode) { var h = linkNode.getAttribute('href'); if (h) href = toAbs(h); }
    if (!href) {
      var parentA = card.closest && card.closest('a[href]');
      if (parentA) { var hp = parentA.getAttribute('href'); if (hp) href = toAbs(hp); }
    }
    if (!href && card.tagName === 'A') {
      var ch = card.getAttribute('href'); if (ch) href = toAbs(ch);
    }
    if (!href) {
      /* Фолбэк: data-id / data-slug / data-href / data-url, чтобы ссылка не терялась на SPA. */
      var dv = card.getAttribute('data-href') || card.getAttribute('data-url');
      if (dv) href = toAbs(dv);
    }
    var date = textOf(dateNode);
    var title = textOf(titleNode);
    var excerpt = textOf(excerptNode);
    if (!title && !date && !excerpt) {
      var raw = textOf(card).slice(0, 240);
      if (!raw) return null;
      return { date: '', title: raw.slice(0, 60), excerpt: raw.slice(60), href: href };
    }
    return { date: date, title: title, excerpt: excerpt, href: href };
  }
  var featuredEl = pickFeatured();
  var listEl = pickList();
  var featured = '';
  if (featuredEl) featured = cleanClone(featuredEl).innerHTML;
  var items = [];
  if (listEl) {
    var kids = Array.prototype.slice.call(listEl.children);
    kids.slice(0, 3).forEach(function(card, idx){
      var it = extractListItem(card);
      if (it) { it.listIndex = idx; items.push(it); }
    });
  }
  return { featured: featured, items: items };
})()
`;

  const nativeNewsPanel = $('#nativeNewsPanel');
  const nativeNewsLoading = $('#nativeNewsLoading');
  const nativeNewsBody = $('#nativeNewsBody');
  const nativeNewsList = $('#nativeNewsList');
  let nativeNewsLastHtml = '';
  let nativeNewsLastListKey = '';
  let nativeNewsRetryTimer = null;
  /** Фоновое обновление новостей: опрос DOM + периодическая перезагрузка гостевой страницы (webview скрыт). */
  let nativeNewsPollTimer = null;
  let nativeNewsPollTicks = 0;
  const NATIVE_NEWS_POLL_MS = 60 * 1000;
  /** Полный reload webview каждые N циклов опроса — новые SSR-посты без смены DOM в SPA. */
  const NATIVE_NEWS_RELOAD_WEBVIEW_EVERY = 8;
  let nativeNewsPullInFlight = false;

  function setNativeNewsHtml(html) {
    if (!nativeNewsBody || !nativeNewsLoading) return;
    if (html && html !== nativeNewsLastHtml) {
      nativeNewsBody.innerHTML = html;
      nativeNewsBody.hidden = false;
      nativeNewsLoading.hidden = true;
      nativeNewsLastHtml = html;
    } else if (!nativeNewsLastHtml) {
      nativeNewsLoading.hidden = false;
      nativeNewsBody.hidden = true;
    }
  }

  function setNativeNewsError(msg) {
    if (!nativeNewsLoading || !nativeNewsBody) return;
    if (nativeNewsLastHtml) return;
    nativeNewsLoading.textContent = msg;
    nativeNewsLoading.hidden = false;
    nativeNewsBody.hidden = true;
    if (nativeNewsList) nativeNewsList.hidden = true;
  }

  function renderNativeNewsList(items) {
    if (!nativeNewsList) return;
    if (!Array.isArray(items) || !items.length) {
      nativeNewsList.hidden = true;
      nativeNewsList.innerHTML = '';
      nativeNewsLastListKey = '';
      return;
    }
    const key = items.map((it) => `${it.date}|${it.title}|${it.href}`).join('\u0001');
    if (key === nativeNewsLastListKey) return;
    nativeNewsLastListKey = key;
    const esc = (s) => escapeHtml(String(s || ''));
    const cards = items.map((it) => {
      const titleAttr = it.title ? ` data-news-title="${esc(it.title)}"` : '';
      const hrefAttr = it.href ? ` data-news-href="${esc(it.href)}"` : '';
      const listIdxAttr = Number.isFinite(it.listIndex) ? ` data-news-list-idx="${it.listIndex}"` : '';
      const dateHtml = it.date ? `<span class="native-news-list__card-date">${esc(it.date)}</span>` : '';
      const titleHtml = it.title ? `<h3 class="native-news-list__card-title">${esc(it.title)}</h3>` : '';
      const excerptHtml = it.excerpt ? `<p class="native-news-list__card-excerpt">${esc(it.excerpt)}</p>` : '';
      return `<button type="button" class="native-news-list__card" role="listitem"${titleAttr}${hrefAttr}${listIdxAttr}>${dateHtml}${titleHtml}${excerptHtml}</button>`;
    }).join('');
    nativeNewsList.innerHTML = cards;
    nativeNewsList.hidden = false;
  }

  function buildNativeNewsClickListScript(listIndex) {
    const idx = Number(listIndex);
    if (!Number.isFinite(idx) || idx < 0) return '(function(){return false;})()';
    return `(function(){
      var idx=${idx};
      function pickList(){
        var el=document.getElementById('news-list');
        if(el)return el;
        return document.querySelector('.news-grid-small, .news-grid, [id*="news-list" i]');
      }
      var listEl=pickList();
      if(!listEl)return false;
      var kids=Array.prototype.slice.call(listEl.children);
      var card=kids[idx];
      if(!card)return false;
      var a=card.querySelector('a[href]');
      if(a){a.click();return true;}
      var pa=card.closest&&card.closest('a[href]');
      if(pa){pa.click();return true;}
      try{card.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}
      catch(_){try{card.click();}catch(__){}}
      return true;
    })()`;
  }

  if (nativeNewsPanel && !nativeNewsPanel.__afterlifeBound) {
    nativeNewsPanel.__afterlifeBound = true;
    nativeNewsPanel.addEventListener('click', (e) => {
      /** Карточка внизу: клик в гостевом webview, затем подтягиваем разметку статьи в панель лаунчера. */
      const card = e.target && (e.target.closest ? e.target.closest('.native-news-list__card') : null);
      if (card) {
        e.preventDefault();
        const idxAttr = card.getAttribute('data-news-list-idx');
        const listIdx = idxAttr != null ? parseInt(idxAttr, 10) : NaN;
        if (webview && embedViewMode === 'live' && Number.isFinite(listIdx)) {
          void (async () => {
            try {
              await webview.executeJavaScript(buildNativeNewsClickListScript(listIdx));
            } catch (_) {}
            const pull = () => void pullNativeNewsFromWebview();
            setTimeout(pull, 120);
            setTimeout(pull, 380);
            setTimeout(pull, 900);
          })();
        }
        return;
      }
      /** Любые ссылки внутри основной статьи открываем в системном браузере, а не ломаем окно лаунчера. */
      const a = e.target && (e.target.closest ? e.target.closest('a[href]') : null);
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || /^javascript:/i.test(href)) return;
      e.preventDefault();
      try { window.launcher.openExternal(href); } catch (_) {}
    });
  }

  async function pullNativeNewsFromWebview() {
    if (!webview || embedViewMode !== 'live') return;
    if (nativeNewsPullInFlight) return;
    nativeNewsPullInFlight = true;
    try {
      const res = await webview.executeJavaScript(NATIVE_NEWS_EXTRACT_JS);
      if (!res || typeof res !== 'object') return;
      const featured = typeof res.featured === 'string' ? res.featured : '';
      if (featured && featured.trim().length > 12) {
        setNativeNewsHtml(featured);
      }
      const items = Array.isArray(res.items) ? res.items : [];
      if (items.length) {
        renderNativeNewsList(items);
      }
    } catch (_) {}
    finally {
      nativeNewsPullInFlight = false;
    }
  }

  function stopNativeNewsPoll() {
    if (nativeNewsPollTimer) {
      clearInterval(nativeNewsPollTimer);
      nativeNewsPollTimer = null;
    }
    nativeNewsPollTicks = 0;
  }

  function startNativeNewsPoll() {
    stopNativeNewsPoll();
    if (!webview || embedViewMode !== 'live' || !config || !config.embedActive) return;
    nativeNewsPollTicks = 0;
    nativeNewsPollTimer = setInterval(() => {
      if (!webview || embedViewMode !== 'live' || !config || !config.embedActive) {
        stopNativeNewsPoll();
        return;
      }
      nativeNewsPollTicks += 1;
      if (nativeNewsPollTicks % NATIVE_NEWS_RELOAD_WEBVIEW_EVERY === 0) {
        try {
          if (typeof webview.reload === 'function') webview.reload();
        } catch (_) {}
        return;
      }
      void pullNativeNewsFromWebview();
    }, NATIVE_NEWS_POLL_MS);
  }

  function stopNativeNewsRetries() {
    if (nativeNewsRetryTimer) {
      clearInterval(nativeNewsRetryTimer);
      nativeNewsRetryTimer = null;
    }
  }

  /** Пока нет и статьи, и списка — каждые 1500 мс тянем DOM и при необходимости перезагружаем webview. */
  function scheduleNativeNewsRetries() {
    stopNativeNewsRetries();
    let attempts = 0;
    nativeNewsRetryTimer = setInterval(() => {
      attempts += 1;
      void pullNativeNewsFromWebview();
      const flen = (nativeNewsLastHtml && nativeNewsLastHtml.trim().length) || 0;
      const hasFeatured = flen > 12;
      const hasList = !!nativeNewsLastListKey;
      if (hasFeatured && hasList) {
        stopNativeNewsRetries();
        return;
      }
      if ((hasFeatured && attempts >= 8) || (hasList && attempts >= 8)) {
        stopNativeNewsRetries();
        return;
      }
      if (attempts >= 2 && !hasFeatured && !hasList && config && config.embedActive) {
        kickEmbedGuestLoad();
      }
      if (attempts > 200) stopNativeNewsRetries();
    }, 1500);
  }

  async function applyEmbedGuestTuning() {
    if (!webview || embedViewMode !== 'live') return;
    nativeNewsLastHtml = '';
    nativeNewsLastListKey = '';
    if (nativeNewsBody) nativeNewsBody.innerHTML = '';
    if (nativeNewsList) {
      nativeNewsList.hidden = true;
      nativeNewsList.innerHTML = '';
    }
    setNativeNewsError('Загрузка новостей…');
    scheduleNativeNewsRetries();
  }

  function runEmbedGuestFitOnly() {}
  async function runEmbedChromeKillOnly() {}
  async function runEmbedFirstNewsOnly() {
    await pullNativeNewsFromWebview();
  }

  function setupEmbedGuestTuning() {
    if (!webview) return;
    webview.addEventListener('dom-ready', () => {
      applyEmbedGuestTuning();
    });
    webview.addEventListener('did-stop-loading', () => {
      pullNativeNewsFromWebview();
      scheduleNativeNewsRetries();
    });
    webview.addEventListener('did-navigate-in-page', () => {
      pullNativeNewsFromWebview();
      scheduleNativeNewsRetries();
    });
    webview.addEventListener('did-navigate', () => {
      void pullNativeNewsFromWebview();
      scheduleNativeNewsRetries();
    });
    webview.addEventListener('did-fail-load', (e) => {
      if (e && e.isMainFrame === false) return;
      setNativeNewsError('Не удалось загрузить новости. Проверьте сеть.');
      startEmbedWatchdog(180000);
    });
  }

  function setBypassUi(open) {
    if (!isDevMode()) {
      bypassOpen = false;
      appEl.dataset.bypass = 'closed';
      if (btnBypass) btnBypass.setAttribute('aria-expanded', 'false');
      if (bypassPanel) bypassPanel.setAttribute('aria-hidden', 'true');
      return;
    }
    bypassOpen = open;
    appEl.dataset.bypass = open ? 'open' : 'closed';
    if (btnBypass) btnBypass.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (bypassPanel) bypassPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
    const w = open ? BASE_WIDTH + BYPASS_EXTRA : BASE_WIDTH;
    const h = BASE_HEIGHT;
    window.launcher.setWindowSizeAnimated(w, h, 380);
  }

  let repairFeedbackOverride = null;
  /** Обнаружены VPN/DPI/Zapret и т.п. (system:detectBypassTools), не считая встроенный обход лаунчера. */
  let externalBypassDetected = false;
  let externalBypassSummary = '';

  async function refreshExternalBypassUi() {
    externalBypassDetected = false;
    externalBypassSummary = '';
    try {
      if (typeof window.launcher.detectBypassTools !== 'function') {
        renderRoutingLine();
        return;
      }
      const r = await window.launcher.detectBypassTools();
      if (r && r.found && Array.isArray(r.items) && r.items.length) {
        externalBypassDetected = true;
        externalBypassSummary = r.items.map((it) => String(it.label || '').trim()).filter(Boolean).join(', ');
      }
    } catch (_) {}
    renderRoutingLine();
  }

  /** Строка под новостями: прогресс FiveM или тип обхода / сообщение починки. */
  function renderRoutingLine() {
    const el = $('#routingStatusLine');
    if (!el) return;
    const prog = $('#fivemProgress');
    if (prog && !prog.hidden) return;
    if (repairFeedbackOverride) {
      el.textContent = repairFeedbackOverride.text;
      const st =
        repairFeedbackOverride.displayState ||
        (repairFeedbackOverride.isErr ? 'err' : 'ok');
      el.dataset.state = st;
      el.setAttribute('title', repairFeedbackOverride.tip || repairFeedbackOverride.text);
      return;
    }
    if (clientRepairActive) {
      el.textContent = clientRepairWasTunnel ? 'Обход: VPN (sing-box TUN)' : 'Обход: Zapret';
      el.dataset.state = 'ok';
      el.removeAttribute('title');
      return;
    }
    if (externalBypassDetected) {
      el.textContent = 'Сторонний обход';
      el.dataset.state = 'external';
      if (externalBypassSummary) el.setAttribute('title', externalBypassSummary);
      else el.removeAttribute('title');
      return;
    }
    el.textContent = 'Обход не используется';
    el.dataset.state = 'idle';
    el.removeAttribute('title');
  }

  function setFivemProgressVisible(visible, payload) {
    const prog = $('#fivemProgress');
    if (!prog) return;
    const fill = $('#fivemProgressFill');
    const label = $('#fivemProgressLabel');
    const hint = $('#fivemProgressHint');
    const bar = prog.querySelector('.fivem-progress__bar');
    prog.hidden = !visible;
    if (!visible) {
      prog.removeAttribute('data-indeterminate');
      if (fill) {
        fill.style.width = '0%';
        fill.style.marginLeft = '0';
      }
      if (bar) bar.setAttribute('aria-valuenow', '0');
      renderRoutingLine();
      return;
    }
    if (payload && payload.indeterminate) prog.setAttribute('data-indeterminate', 'true');
    else prog.removeAttribute('data-indeterminate');
    if (label && payload && payload.label != null) label.textContent = payload.label;
    if (hint && payload && payload.hint != null) hint.textContent = payload.hint;
    if (fill) {
      if (payload && payload.indeterminate) {
        fill.style.width = '';
        fill.style.marginLeft = '';
      } else if (payload && typeof payload.percent === 'number') {
        fill.style.marginLeft = '';
        fill.style.width = `${Math.max(0, Math.min(100, payload.percent))}%`;
      }
    }
    if (bar && payload && typeof payload.percent === 'number') {
      bar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, payload.percent))));
    }
    renderRoutingLine();
  }

  function applyFivemInstallProgressPayload(p) {
    if (!p) return;
    if (p.phase === 'done' || p.phase === 'error') {
      setFivemProgressVisible(false);
      return;
    }
    setFivemProgressVisible(true, p);
  }

  /**
   * Короткая строка статуса; tip — расширенная подсказка.
   * displayState: 'ok' | 'err' | 'warn' | 'idle' | 'busy' — иначе от isErr.
   */
  function setUserRepairFeedback(text, isErr, tip, displayState) {
    if (!text) {
      repairFeedbackOverride = null;
      renderRoutingLine();
      return;
    }
    repairFeedbackOverride = {
      text,
      isErr: !!isErr,
      tip: tip || '',
      displayState: displayState || null
    };
    renderRoutingLine();
  }

  function setRepairNetworkButtonUi(active, wasTunnel) {
    clientRepairActive = !!active;
    clientRepairWasTunnel = !!wasTunnel;
    const wRkn = $('#wRknMode');
    const chk = $('#chkRepairTunnel');
    if (wRkn) {
      wRkn.classList.toggle('is-active', !!active);
      wRkn.title = active ? REPAIR_BACK : 'Починить сеть (Zapret / TUN)';
    }
    if (chk) chk.disabled = !!active;
    renderRoutingLine();
  }

  async function revertClientRepair() {
    await window.launcher.stopSystemTunnel();
    await window.launcher.repairRevertZapret();
  }

  async function refreshElevationUi() {
    const banner = $('#adminBanner');
    if (!banner || !window.launcher.getSystemInfo) return;
    try {
      const info = await window.launcher.getSystemInfo();
      banner.hidden = !(info.platform === 'win32' && !info.isElevated);
    } catch {
      banner.hidden = true;
    }
  }

  function refreshPingDomainPreview() {
    const ul = $('#devPingDomainList');
    if (!ul || !config) return;
    const domains = (config.checkDomains && config.checkDomains.length ? config.checkDomains : ['cfx.re']) || [];
    ul.innerHTML = domains.map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  }

  async function refreshServerUi() {
    const refreshBtn = $('#btnRefreshServer');
    if (refreshBtn) refreshBtn.classList.add('is-loading');
    try {
      const host = getConnectHost();
    const nameEl = $('#serverName');
    const playersEl = $('#serverPlayers');
    const pingEl = $('#serverPing');
    const badgeEl = $('#serverBadge');
      const serverCard = $('#serverCard');

    if (!host) {
      badgeEl.dataset.state = 'unknown';
      badgeEl.textContent = 'Нет адреса';
      nameEl.textContent = '—';
      playersEl.textContent = '— / —';
      pingEl.textContent = '—';
        if (serverCard) {
          serverCard.title = 'В конфиге лаунчера не задан serverConnect';
        }
      return;
    }

    badgeEl.dataset.state = 'loading';
    badgeEl.textContent = 'Проверка…';

    const st = await window.launcher.getServerStatus(host);

    if (!st.ok) {
      badgeEl.dataset.state = 'offline';
      badgeEl.textContent = 'Offline';
      nameEl.textContent = '—';
      playersEl.textContent = '— / —';
      pingEl.textContent = '—';
        if (serverCard) {
          serverCard.title = st.error || 'Ошибка запроса';
        }
      return;
    }

    nameEl.textContent = st.hostname || 'Сервер';

    const c = st.clients != null ? st.clients : '—';
    const m = st.maxClients != null ? st.maxClients : '—';
    playersEl.textContent = `${c} / ${m}`;

    if (st.pingMs != null) {
      const pm = Number(st.pingMs);
      pingEl.textContent = pm <= 0 ? '<1 мс' : `${pm} мс`;
    } else {
      pingEl.textContent = '—';
    }

    if (st.reachable) {
      if (st.apiOnline && st.icmpOk) {
        badgeEl.dataset.state = 'ok';
        } else {
        badgeEl.dataset.state = 'warn';
        }
        badgeEl.textContent = 'Online';
      } else {
        badgeEl.dataset.state = 'offline';
        badgeEl.textContent = 'Offline';
      }

      if (serverCard) {
        serverCard.title = st.reachable
          ? ''
          : 'Сервер недоступен: проверьте IP:порт (30120), firewall и что FXServer запущен';
      }
    } finally {
      if (refreshBtn) refreshBtn.classList.remove('is-loading');
    }
  }

  /** Загрузка подписки и заполнение #selectBypassVless (режим разработчика). */
  async function refreshBypassVlessSelect() {
    const sel = $('#selectBypassVless');
    if (!sel || typeof window.launcher.subscriptionBypassVlessList !== 'function') return { ok: false };
    const r = await window.launcher.subscriptionBypassVlessList();
    if (!r.ok) {
      if (bypassLog && r.error) log(String(r.error), 'log-err');
      sel.innerHTML = '';
      const o = document.createElement('option');
      o.value = '0';
      o.textContent = r.error ? '— ошибка —' : '— нет данных —';
      sel.appendChild(o);
      return { ok: false };
    }
    const idxWant = Math.max(0, parseInt(String(config?.bypassVlessIndex ?? 0), 10) || 0);
    sel.innerHTML = '';
    r.items.forEach((it) => {
      const o = document.createElement('option');
      o.value = String(it.index);
      o.textContent = it.label;
      sel.appendChild(o);
    });
    if (sel.options.length) {
      const max = sel.options.length - 1;
      sel.value = String(Math.min(idxWant, max));
    }
    return { ok: true };
  }

  async function pingDomains() {
    if (!pingList) return { ok: 0, total: 0 };
    pingList.innerHTML = '';
    const domains = (config && config.checkDomains) || ['cfx.re'];
      const row = document.createElement('div');
    row.className = 'ping-row ping-row--summary';
    row.innerHTML = '<span>Проверка узлов (ICMP, затем TCP 443/80)</span><span class="ping-status">…</span>';
      pingList.appendChild(row);
      const statusEl = row.querySelector('.ping-status');

    const results = await Promise.all(domains.map((d) => window.launcher.ping(d)));
    const ok = results.filter((r) => r.ok && r.ms != null).length;
    const allOk = ok === domains.length;
    row.classList.add(allOk ? 'ok' : 'fail');
    statusEl.textContent = allOk ? 'доступны' : 'не все';
    statusEl.title = `${ok} из ${domains.length} узлов`;

    domains.forEach((d, i) => {
      const r = results[i];
      const line = document.createElement('div');
      const rowOk = r && r.ok && r.ms != null;
      line.className = `ping-row${rowOk ? ' ok' : ' fail'}`;
      line.innerHTML = `<span>${escapeHtml(d)}</span><span class="ping-status">${rowOk ? `${r.ms} ms` : '—'}</span>`;
      pingList.appendChild(line);
    });

    return { ok, total: domains.length };
  }

  /**
   * Модалка только при реальном конфликте (процессы/службы), не из‑за одного прокси в реестре.
   * @returns {'proceed'|'abort'}
   */
  async function resolveBypassConflictIfNeeded() {
    try {
      if (typeof window.launcher.detectBypassTools !== 'function') return 'proceed';
      const det = await window.launcher.detectBypassTools();
      if (!det || !det.conflict || !Array.isArray(det.items) || !det.items.length) return 'proceed';
      const conflictLines = det.items
        .filter((it) => it.kind === 'process' || it.kind === 'service')
        .map((it) => String(it.label || '').trim())
        .filter(Boolean);
      if (!conflictLines.length) return 'proceed';
      const choice = await showAlModal({
        kind: 'warning',
        title: 'Обнаружен внешний обход',
        message:
          'Запущены VPN, DPI-обход или связанные службы. Параллельно с нашим обходом возможны конфликты маршрутизации и DNS. Выберите действие.',
        items: conflictLines,
        buttons: [
          { value: 'dismiss', label: 'Ничего не делать', cancel: true },
          { value: 'replace', label: 'Закрыть чужие обходы и запустить наш', primary: true },
          { value: 'layer', label: 'Не закрывать чужие, запустить наш поверх', danger: true }
        ]
      });
      if (
        !choice ||
        choice.ok === false ||
        choice.value === 'dismiss' ||
        choice.value === 'backdrop' ||
        choice.value === 'escape' ||
        choice.value === 'superseded'
      ) {
        return 'abort';
      }
      if (choice.value === 'replace' && typeof window.launcher.killUserBypass === 'function') {
        await window.launcher.killUserBypass();
      }
      return 'proceed';
    } catch (_) {
      return 'proceed';
    }
  }

  /** Тот же сценарий, что раньше у «VPN (TUN) из подписки»: sing-box по подписке из конфига. */
  async function startTunnelFromSubscriptionWithFeedback() {
    const info = await window.launcher.getSystemInfo();
    if (info.platform === 'win32' && !info.isElevated) {
      await showAlAlert(
        'Для системного TUN нужны права администратора. Нажмите внизу «Перезапустить как администратор», затем снова виджет RKN.',
        { title: 'Требуются права администратора', kind: 'warning' }
      );
      return false;
    }
    const r = await window.launcher.startTunnelFromSubscription();
    if (!r.ok) {
      const err = r.error || 'Ошибка туннеля';
      const short = err.length > 76 ? `${err.slice(0, 74)}…` : err;
      setUserRepairFeedback(short, true, err);
      return false;
    }
    const pid = r.pid != null ? r.pid : '—';
    setUserRepairFeedback(
      `TUN вкл., PID ${pid}. Стоп: «Возврат» (виджет RKN).`,
      false,
      'Остановка sing-box: «Возврат» на виджете RKN или панель «ОБХОД».'
    );
    return true;
  }

  /** Zapret / TUN после подтверждения в модалке проверки сети. */
  async function runRknRepairAfterProbe(useTunnelOnly) {
    const resolution = await resolveBypassConflictIfNeeded();
    if (resolution === 'abort') {
      setUserRepairFeedback('Обход не запущен.', false, '', 'warn');
      return;
    }

    const info = await window.launcher.getSystemInfo();
    if (info.platform === 'win32' && !info.isElevated) {
      await showAlAlert(
        'Для установки Zapret и системного TUN нужны права администратора. Нажмите «Перезапустить как администратор», затем снова виджет RKN.',
        { title: 'Требуются права администратора', kind: 'warning' }
      );
      return;
    }

    if (useTunnelOnly) {
      const ok = await startTunnelFromSubscriptionWithFeedback();
      if (ok) setRepairNetworkButtonUi(true, true);
      return;
    }

    const r = await window.launcher.repairInstallZapret();
    if (!r.ok) {
      const err = r.error || 'Ошибка Zapret';
      const short = err.length > 76 ? `${err.slice(0, 74)}…` : err;
      setUserRepairFeedback(short, true, err);
      const tunOk = await startTunnelFromSubscriptionWithFeedback();
      if (tunOk) setRepairNetworkButtonUi(true, true);
      return;
    }

    setUserRepairFeedback('Zapret: ожидание и проверка сайта / Discord / cfx.re…', false, '', 'busy');
    await new Promise((res) => setTimeout(res, 2500));
    let afterOk = false;
    for (let i = 0; i < 3; i++) {
      const probe = await window.launcher.probeDiscordFiveM();
      if (probe && probe.allOk) {
        afterOk = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    if (afterOk) {
      setUserRepairFeedback(
        'Zapret: служба активна; сайт, Discord и cfx.re отвечают (TCP 443).',
        false,
        'General ALT9, автообновления и игровой фильтр включены.'
      );
      setRepairNetworkButtonUi(true, false);
      return;
    }

    const tunOk = await startTunnelFromSubscriptionWithFeedback();
    if (tunOk) {
      setRepairNetworkButtonUi(true, true);
      return;
    }
    setUserRepairFeedback(
      'Zapret установлен, но узлы всё ещё недоступны; TUN не удалось запустить.',
      true,
      'Проверьте подписку в launcher.config.json и sing-box.',
      'err'
    );
  }

  // Titlebar
  $('#btnMin').addEventListener('click', () => window.launcher.minimize());
  $('#btnMax').addEventListener('click', () => window.launcher.maximize());
  $('#btnClose').addEventListener('click', () => window.launcher.close());

  // Сайт · Discord · VK (левая колонка, блок «Ссылки»)
  $('#wSite').addEventListener('click', () => {
    const u = (config && config.projectUrl && String(config.projectUrl).trim()) || getFrameUrl();
    window.launcher.openExternal(u);
  });
  $('#wDiscord').addEventListener('click', () =>
    window.launcher.openExternal((config && config.discordUrl) || DEFAULT_DISCORD_URL)
  );
  $('#wVk').addEventListener('click', () => window.launcher.openExternal(config.vkUrl || 'https://vk.com'));
  $('#wBugReport')?.addEventListener('click', () => window.launcher.openExternal(BUG_REPORT_DISCORD_URL));
  window.addEventListener(
    'keydown',
    (e) => {
      const pinGate = $('#devPinGate');
      if (pinGate && !pinGate.hidden && e.key === 'Escape') {
        e.preventDefault();
        closeDevPinGate();
        return;
      }
      if (e.shiftKey && e.key === 'F12' && !isTypingInLauncherField(e.target)) {
        e.preventDefault();
        tryDevModeShortcut();
      }
    },
    true
  );

  if (btnBypass) {
  btnBypass.addEventListener('click', () => {
    setBypassUi(!bypassOpen);
    });
  }

  $('#btnRestartElevated').addEventListener('click', async () => {
    const go = await showAlConfirm(
      'Лаунчер закроется и откроется снова. Windows запросит разрешение на запуск от имени администратора. Продолжить?',
      { title: 'Перезапуск от администратора', kind: 'confirm', okLabel: 'Перезапустить' }
    );
    if (!go) return;
    const r = await window.launcher.restartElevated();
    if (r && !r.ok) {
      void showAlAlert(r.error || 'Не удалось запустить повышение прав', { title: 'Ошибка', kind: 'error' });
    }
  });

  $('#wRknMode')?.addEventListener('click', async () => {
    const btn = $('#wRknMode');
    const chkRepairTunnel = $('#chkRepairTunnel');
    const useTunnelOnly = !!(chkRepairTunnel && chkRepairTunnel.checked);
    if (btn) btn.disabled = true;
    if (bypassLog) bypassLog.textContent = '';
    try {
      if (clientRepairActive) {
        setUserRepairFeedback('', false);
        await revertClientRepair();
        if (devBypassPowerOn) {
          devBypassPowerOn = false;
        }
        setRepairNetworkButtonUi(false, false);
        setUserRepairFeedback('Обход выключен.', false, '', 'idle');
        return;
      }

      setUserRepairFeedback('', false);
      let pre = null;
      try {
        if (typeof window.launcher.probeDiscordFiveM === 'function') {
          pre = await window.launcher.probeDiscordFiveM();
        }
      } catch (_) {}

      let detailMsg;
      let allOk = false;
      if (!pre) {
        detailMsg = 'Проверка TCP не выполнена — нет ответа от лаунчера.';
      } else {
        const siteLine = pre.siteHost
          ? `${pre.siteHost} (443): ${pre.site443 ? 'OK' : 'нет соединения'}`
          : 'Сайт: в конфиге не задан (embedUrl / projectUrl)';
        detailMsg = [
          siteLine,
          `cfx.re (443): ${pre.cfx443 ? 'OK' : 'нет соединения'}`,
          `discord.com (443): ${pre.discord443 ? 'OK' : 'нет соединения'}`
        ].join('\n');
        allOk = !!pre.allOk;
      }

      if (allOk) {
        const okChoice = await showAlModal({
          kind: 'info',
          title: 'Проверка сети',
          message:
            'Все проверки TCP 443 прошли успешно. Отдельный обход не обязателен, но его можно включить вручную или закрыть лаунчер.\n\n' +
            detailMsg,
          buttons: [
            { value: 'close', label: 'Закрыть', cancel: true },
            { value: 'quit', label: 'Закрыть лаунчер', danger: true },
            { value: 'repair', label: 'Всё равно включить обход', primary: true }
          ]
        });
        if (okChoice && okChoice.value === 'repair') {
          await runRknRepairAfterProbe(useTunnelOnly);
          return;
        }
        if (okChoice && okChoice.value === 'quit') {
          const go = await showAlConfirm('Закрыть лаунчер полностью?', {
            title: 'Выход',
            kind: 'confirm',
            okLabel: 'Закрыть',
            danger: true
          });
          if (go) window.launcher.close();
        }
        return;
      }

      const choice = await showAlModal({
        kind: 'warning',
        title: 'Проверка сети',
        message:
          'Сайт или сервисы недоступны по TCP 443 (см. ниже). Можно попробовать обход Zapret / TUN.\n\n' +
          detailMsg,
        buttons: [
          { value: 'close', label: 'Закрыть', cancel: true },
          { value: 'repair', label: 'Починить сеть', primary: true }
        ]
      });

      if (!choice || !choice.ok || choice.value !== 'repair') {
        setUserRepairFeedback(
          'Проверка сети: не все узлы доступны. Повторите виджет для запуска обхода.',
          false,
          detailMsg,
          'warn'
        );
        return;
      }

      await runRknRepairAfterProbe(useTunnelOnly);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  const chkRepairTunnelEl = $('#chkRepairTunnel');
  if (chkRepairTunnelEl) {
    chkRepairTunnelEl.addEventListener('change', () => {
      void savePartial({ repairUseTunneling: !!chkRepairTunnelEl.checked });
    });
  }

  $('#btnPingAll').addEventListener('click', () => {
    if (bypassLog) bypassLog.textContent = '';
    void pingDomains();
  });

  $('#btnBypassVlessRefresh')?.addEventListener('click', async () => {
    if (bypassLog) bypassLog.textContent = '';
    const r = await refreshBypassVlessSelect();
    if (r.ok) log('Список узлов обновлён.', 'log-ok');
  });

  $('#selectBypassVless')?.addEventListener('change', async (e) => {
    const t = e.target;
    const v = parseInt(String(t.value), 10);
    if (!Number.isFinite(v) || v < 0) return;
    await savePartial({ bypassVlessIndex: v });
    log(`Узел обхода (sing-box): индекс ${v}.`, 'log-ok');
  });

  $('#btnRefreshServer').addEventListener('click', () => {
    refreshServerUi();
    nativeNewsLastHtml = '';
    nativeNewsLastListKey = '';
    if (nativeNewsBody) nativeNewsBody.innerHTML = '';
    if (nativeNewsList) {
      nativeNewsList.hidden = true;
      nativeNewsList.innerHTML = '';
    }
    setNativeNewsError('Загрузка новостей…');
    if (config && config.embedActive) kickEmbedGuestLoad();
    scheduleNativeNewsRetries();
  });


  /** Discord обязателен для входа на сервер — без него бот верификации не пропустит. Спрашиваем ДО запуска FiveM. */
  async function ensureDiscordRunningOrAsk() {
    try {
      if (typeof window.launcher.checkDiscord !== 'function') return true;
      const r = await window.launcher.checkDiscord();
      if (r && r.running) return true;
      const res = await showAlModal({
        kind: 'warning',
        icon: 'discord',
        title: 'Discord не запущен',
        message:
          'Discord нужен для входа на сервер — верификация и голосовой чат без него не работают.\n\n' +
          'Открыть Discord сейчас? После запуска Discord нажмите «ИГРАТЬ» ещё раз.',
        buttons: [
          { value: 'skip', label: 'Запустить без Discord' },
          { value: 'cancel', label: 'Отмена' },
          { value: 'open', label: 'Открыть Discord', primary: true }
        ]
      });
      if (res && res.value === 'open') {
        try {
          const or = await window.launcher.openDiscord();
          if (!or || !or.ok) {
            const inv = (config && config.discordUrl) || DEFAULT_DISCORD_URL;
            try { window.launcher.openExternal(inv); } catch (_) {}
          }
        } catch (_) {}
        return false;
      }
      if (res && res.value === 'skip') return true;
      return false;
    } catch (_) {
      return true;
    }
  }

  $('#btnPlay').addEventListener('click', async () => {
    const btn = $('#btnPlay');
    if (btn) btn.disabled = true;
    try {
      await ensureFivemPathInConfig();
      let fivemExePath = getFivemExePath();
      if (!fivemExePath) {
        if (typeof window.launcher.downloadInstallFiveM !== 'function') {
          void showAlAlert('Автоустановка FiveM недоступна в этой сборке.', { title: 'FiveM', kind: 'error' });
          return;
        }
        const inst = await window.launcher.downloadInstallFiveM();
        await loadConfig();
        await refreshPlayDockButton();
        if (!inst || !inst.ok) {
          void showAlAlert(
            (inst && inst.error) || 'Не удалось скачать или установить FiveM.',
            { title: 'FiveM', kind: 'error' }
          );
          return;
        }
        fivemExePath = getFivemExePath();
        if (!fivemExePath) {
          void showAlAlert('Путь к FiveM не записан в конфиг. Нажмите «Играть» ещё раз.', {
            title: 'FiveM',
            kind: 'warning'
          });
          return;
        }
      }
      const connectArg = getConnectHost();
      await savePartial({ fivemExePath, serverConnect: connectArg });
      if (!(await ensureDiscordRunningOrAsk())) return;
      const res = await window.launcher.launchFiveM({ fivemExePath, connectArg });
      if (!res.ok) {
        void showAlAlert(res.error || 'Ошибка запуска', { title: 'Не удалось запустить FiveM', kind: 'error' });
      } else {
        if (res.warn) void showAlAlert(res.warn, { title: 'Внимание', kind: 'warning' });
        try {
          window.launcher.minimize();
        } catch (_) {}
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#btnCheckUpdates')?.addEventListener('click', async () => {
    await runLauncherSelfUpdateCheck(true);
  });

  $('#btnReloadEmbed').addEventListener('click', () => {
    void (async () => {
      await applyEmbedFromPanel();
      if (config && config.embedActive) kickEmbedGuestLoad();
      else kickPlaceholderWebview();
      startEmbedWatchdog(120000);
    })();
  });

  const devPinSubmit = $('#devPinSubmit');
  const devPinCancel = $('#devPinCancel');
  const devPinInput = $('#devPinInput');
  if (devPinSubmit && devPinInput) {
    const submitPin = () => {
      const err = $('#devPinErr');
      const val = String(devPinInput.value || '').trim();
      if (val === DEV_MODE_PIN) {
        setDevPinSessionOk();
        closeDevPinGate();
        setDevMode(true);
        if (err) {
          err.hidden = true;
          err.textContent = '';
        }
      } else if (err) {
        err.hidden = false;
        err.textContent = 'Неверный код';
      }
    };
    devPinSubmit.addEventListener('click', () => submitPin());
    devPinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitPin();
      }
    });
  }
  if (devPinCancel) {
    devPinCancel.addEventListener('click', () => closeDevPinGate());
  }

  const chkEmbedActiveEl = $('#chkEmbedActive');
  if (chkEmbedActiveEl) {
    chkEmbedActiveEl.addEventListener('change', async () => {
      await savePartial({ embedUrl: getFrameUrl(), embedActive: !!chkEmbedActiveEl.checked });
      await syncEmbedPanelView();
      startEmbedWatchdog(120000);
      requestAnimationFrame(() => {
        if (config && config.embedActive) kickEmbedGuestLoad();
        else kickPlaceholderWebview();
      });
    });
  }

  setupEmbedGuestTuning();

  if (typeof window.launcher.onWindowShown === 'function') {
    window.launcher.onWindowShown(() => {
      startEmbedWatchdog(120000);
      requestAnimationFrame(() => {
        if (config && config.embedActive) kickEmbedGuestLoad();
        else kickPlaceholderWebview();
      });
    });
  }

  if (typeof window.launcher.onFivemInstallProgress === 'function') {
    window.launcher.onFivemInstallProgress((payload) => {
      applyFivemInstallProgressPayload(payload);
    });
  }
  if (typeof window.launcher.onLauncherSelfUpdateProgress === 'function') {
    window.launcher.onLauncherSelfUpdateProgress((payload) => {
      applyFivemInstallProgressPayload(payload);
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    startEmbedWatchdog(90000);
    runEmbedGuestFitOnly();
    if (config && config.embedActive && embedViewMode === 'live') void pullNativeNewsFromWebview();
  });

  window.addEventListener('focus', () => {
    refreshElevationUi();
    void refreshExternalBypassUi();
  });

  loadConfig().then(async () => {
    if (!isDevMode()) {
      appEl.dataset.bypass = 'closed';
    }
    setUserRepairFeedback('', false);
    await refreshExternalBypassUi();
    refreshServerUi();
    refreshElevationUi();
    statusTimer = setInterval(refreshServerUi, 30000);
    startEmbedWatchdog(180000);
    scheduleEmbedReloadLikeApply();
    /* webview: повторный fit и скрытие шапки после первой отрисовки */
    setTimeout(() => {
      runEmbedGuestFitOnly();
      void runEmbedChromeKillOnly();
      void runEmbedFirstNewsOnly();
    }, 450);
    scheduleLauncherAutoUpdateCheck();
  });
})();
