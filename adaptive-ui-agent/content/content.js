/**
 * EqualiUI Content Script
 * Dynamic In-Page Code Injector, DOM Context Analyzer & Auto-Adaptation Engine
 * Specialized Accessibility Features: TTS Screen Reader, Live Captions, Plain Language & RLHF Recommendation Toast
 * 100% Reversible & Safe
 */

(function () {
  'use strict';

  // 이미 살아 있는 인스턴스가 있으면 중복 실행하지 않는다.
  // 단, 확장 프로그램이 새로고침되어 이전 인스턴스가 죽은(orphan) 경우에는 새 인스턴스가 이어받는다.
  if (window.__EQUALI_UI_INJECTED__) {
    const probe = { alive: false };
    document.dispatchEvent(new CustomEvent('equali-ping', { detail: probe }));
    if (probe.alive) return;
    document.querySelectorAll('equali-ui-host, #equali-root-container, #equali-reading-ruler, .equali-toast, .equali-recommendation-toast, .equali-visual-editor-panel').forEach(el => el.remove());
  }
  window.__EQUALI_UI_INJECTED__ = true;
  document.addEventListener('equali-ping', (e) => {
    try {
      if (chrome.runtime && chrome.runtime.id && e.detail) e.detail.alive = true;
    } catch (err) {}
  });

  const state = {
    isAdapted: false,
    currentInjectedCss: '',
    currentInjectedDom: [],
    rulerActive: false,
    autoApplied: false,
    goalTitle: '',
    lastClickedSelector: null,
    sessionConversationHistory: [],
    modifiedOriginals: [], // isModify 로 바꾼 요소의 원본 값 (복구용)
    pendingReview: null,   // { proposal, audit, instruction, altDepth, prevAltKind } 사용자 검토 대기 중인 제안
    lastApplied: null,     // { goalTitle, instruction, at, altDepth, ... } 방금 승인·적용한 제안 (적용 후 피드백용)
    timers: {},
    previewActive: false
  };

  // 장식용 이모지는 떼고 보여준다 (간결한 표기 + 스크린리더가 이모지 이름을 읽지 않도록)
  const plainLabel = (str) => String(str == null ? '' : str).replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '');

  const escapeHtml = (str) => String(str == null ? '' : str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));

  // Global Interaction & Click Tracker for Contextual Grounding
  document.addEventListener('click', (e) => {
    if (ui.isOwn(e.target)) return;
    try {
      if (typeof EqualiVisualEditor !== 'undefined' && EqualiVisualEditor.getUniqueSelector) {
        state.lastClickedSelector = EqualiVisualEditor.getUniqueSelector(e.target);
      }
    } catch(err) {}
  }, true);

  /* ==========================================================================
     0. Trusted Types Policy (Bypass strict CSP on sites like Google)
     ========================================================================== */
  let ttPolicy = null;
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    try {
      ttPolicy = window.trustedTypes.createPolicy('equali-ui-policy', {
        createHTML: (string) => string,
        createScript: (string) => string
      });
    } catch (e) {
      console.warn('[EqualiUI] TrustedTypes policy creation failed:', e);
    }
  }

  function getTrustedHtml(htmlString) {
    return ttPolicy ? ttPolicy.createHTML(htmlString) : htmlString;
  }

  function getTrustedScript(scriptString) {
    return (ttPolicy && ttPolicy.createScript) ? ttPolicy.createScript(scriptString) : scriptString;
  }

  /* ==========================================================================
     0.5. Isolated UI Layer (closed Shadow DOM)
     검토 카드·승인 버튼·제안 배너 등 "안전 장치의 UI"는 이 안에서만 그려진다.
       - 방문한 사이트의 CSS, 그리고 AI 가 생성한 CSS 는 Shadow DOM 경계를 넘지 못한다
         (예: AI 의 `button { display:none }` 이 승인/거절 버튼을 숨길 수 없다).
       - closed 모드라 페이지 스크립트가 검토 카드 내부를 읽거나 대신 클릭할 수 없다.
       - 호스트 요소 자체를 숨기려는 규칙은 inline !important 로 막고, 제거되면 다시 붙인다.
     ========================================================================== */
  const ui = {
    host: null,
    root: null,
    layer: null,

    ensure() {
      if (this.layer) {
        if (!this.host.isConnected) document.documentElement.appendChild(this.host);
        return this.layer;
      }
      this.host = document.createElement('equali-ui-host');
      // 하네스(test/*.html)에서만 내부를 들여다볼 수 있게 한다. 실제 확장에서는 content script 가
      // 격리된 world 에서 돌기 때문에 페이지가 이 값을 심어도 보이지 않는다 → 항상 closed.
      const mode = window.__EQUALI_TEST_OPEN_SHADOW__ === true ? 'open' : 'closed';
      this.root = this.host.attachShadow({ mode });
      this.guardHost();

      const css = `:host { all: initial; }
#equali-ui-layer {
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", Roboto, sans-serif;
  font-size: 14px; line-height: 1.5; color: #0F172A; text-align: left; direction: ltr;
  letter-spacing: normal; word-spacing: normal; text-transform: none; font-style: normal; font-weight: 400;
  text-shadow: none; white-space: normal; cursor: auto; visibility: visible;
}
#equali-ui-layer > * { pointer-events: auto; }
#equali-ui-layer *, #equali-ui-layer *::before, #equali-ui-layer *::after { box-sizing: border-box; }
` + (self.EQUALI_UI_CSS || '');
      let adopted = false;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        this.root.adoptedStyleSheets = [sheet];
        adopted = true;
      } catch (e) {}
      if (!adopted) {
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        this.root.appendChild(styleEl);
      }

      this.layer = document.createElement('div');
      this.layer.id = 'equali-ui-layer';
      this.root.appendChild(this.layer);
      this.applyViewPrefs();
      try {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && (changes.newtabPrefs || changes.traitInsights || changes.persona || changes.customPersona)) this.applyViewPrefs();
          if (area === 'local' && (changes.persona || changes.customPersona || changes.personaChangedAt)) applyPersona({ announce: true });
        });
        if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyViewPrefs());
      } catch (e) {}

      // Shadow DOM 밖에서는 입력 중인 요소가 호스트로 보이기 때문에, 사이트의 단축키(예: 영상 사이트의 k, f)가
      // 우리 입력창에 글을 쓰는 동안 발동할 수 있다 → 글자 입력 이벤트는 밖으로 내보내지 않는다.
      const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      for (const type of ['keydown', 'keypress', 'keyup']) {
        this.layer.addEventListener(type, (e) => {
          if (type === 'keydown' && e.key === 'Escape' && modalBackdrop && modalBackdrop.classList.contains('equali-visible')) {
            e.stopPropagation();
            closeReviewModal();
            return;
          }
          if (isTyping(e.target) && !e.altKey) e.stopPropagation();
        });
      }

      document.documentElement.appendChild(this.host);
      // 사이트가 DOM 을 통째로 갈아끼우며 호스트를 지워도 UI(특히 복구 수단)가 사라지지 않게 한다
      new MutationObserver(() => {
        if (!this.host.isConnected) document.documentElement.appendChild(this.host);
        this.guardHost();
      }).observe(document.documentElement, { childList: true });
      const hostObserver = new MutationObserver(() => {
        this.guardHost();
        hostObserver.takeRecords(); // 방금 우리가 고친 변경은 다시 처리하지 않는다 (무한 루프 방지)
      });
      hostObserver.observe(this.host, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      return this.layer;
    },

    // 새 탭 "보기 설정"(글자 크기 · 화면 색 · 간격)과 특성 메모를 검토 카드·배너에도 그대로 적용한다
    async applyViewPrefs() {
      let prefs = { size: 'normal', theme: 'auto', spacing: false };
      try {
        if (typeof EqualiViewPrefs !== 'undefined' && chrome.storage && chrome.storage.local.get) {
          const data = await chrome.storage.local.get(['newtabPrefs', 'traitInsights', 'persona', 'customPersona']);
          if (typeof EqualiPersona !== 'undefined' && EqualiPersona.setCustom) EqualiPersona.setCustom(data && data.customPersona);
          const traits = typeof EqualiPersona !== 'undefined' ? EqualiPersona.withPersonaTraits(data && data.persona, (data && data.traitInsights) || []) : ((data && data.traitInsights) || []);
          prefs = EqualiViewPrefs.resolvePrefs(data && data.newtabPrefs, traits).prefs;
        }
      } catch (e) {}
      if (!this.layer) return;
      const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.layer.dataset.theme = prefs.theme !== 'auto' ? prefs.theme : (dark ? 'dark' : 'light');
      this.layer.dataset.size = prefs.size;
      this.layer.dataset.spacing = prefs.spacing ? 'on' : 'off';
      this.layer.dataset.speak = prefs.speak ? 'on' : 'off';
    },

    // 페이지/AI 의 CSS 가 호스트를 숨기거나 눌리지 않게 만들지 못하도록 inline !important 로 고정
    guardHost() {
      const want = {
        display: 'block', visibility: 'visible', opacity: '1', position: 'fixed', top: '0px', left: '0px',
        width: '0px', height: '0px', margin: '0px', padding: '0px', 'border-width': '0px', overflow: 'visible',
        'z-index': '2147483647', 'pointer-events': 'none', transform: 'none', filter: 'none',
        'clip-path': 'none', clip: 'auto', contain: 'none', 'content-visibility': 'visible', zoom: '1'
      };
      const st = this.host.style;
      for (const [k, v] of Object.entries(want)) {
        if (st.getPropertyValue(k) !== v || st.getPropertyPriority(k) !== 'important') st.setProperty(k, v, 'important');
      }
      if (this.host.hidden) this.host.hidden = false;
    },

    append(el) { this.ensure().appendChild(el); return el; },
    // 화면 구석에 떠 있는 부품(맨 위로, 글자 크기 조절)을 쌓는 자리
    floatingParts() {
      let box = this.byId('equali-floating-parts');
      if (!box) {
        box = document.createElement('div');
        box.id = 'equali-floating-parts';
        box.style.cssText = 'position:fixed; left:20px; bottom:20px; display:flex; flex-direction:column; gap:8px; align-items:flex-start; z-index:2147483600;';
        this.append(box);
      }
      return box;
    },
    byId(id) { return this.root ? this.root.getElementById(id) : null; },
    q(sel) { return this.root ? this.root.querySelector(sel) : null; },
    // 이벤트 대상이 우리 UI 인가? (Shadow DOM 밖의 리스너에는 대상이 호스트로 보인다)
    isOwn(node) {
      if (!node || !this.host) return false;
      return node === this.host || (node.getRootNode && node.getRootNode() === this.root);
    }
  };

  /* ==========================================================================
     1. Dynamic Code Injection & Reversion Engine
     ========================================================================== */

  /**
   * AI 가 만든 HTML 을 실제 DOM 으로 파싱한 뒤 허용 목록 기반으로 정화한다.
   * (Service Worker 의 정규식 검사에 이은 2차 방어선)
   */
  const FORBIDDEN_TAGS = new Set(['SCRIPT', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'FORM', 'LINK', 'META', 'BASE', 'STYLE', 'APPLET', 'PORTAL', 'TEMPLATE']);
  const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background']);

  function sanitizeHtmlToElement(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = getTrustedHtml(String(html || ''));
    const rootEl = tpl.content.firstElementChild;
    if (!rootEl) return null;

    const all = [rootEl, ...rootEl.querySelectorAll('*')];
    for (const node of all) {
      if (FORBIDDEN_TAGS.has(node.tagName)) {
        if (node === rootEl) return null;
        node.remove();
        continue;
      }
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
          node.removeAttribute(attr.name);
        } else if (URL_ATTRS.has(name) && !/^(https:\/\/|data:image\/|#|\/(?!\/))/i.test(value)) {
          node.removeAttribute(attr.name);
        } else if (name === 'style' && /expression\s*\(|javascript:|url\(\s*['"]?(?!https:|data:image\/)/i.test(value)) {
          node.removeAttribute(attr.name);
        }
      }
      if (node.tagName === 'A') node.setAttribute('rel', 'noopener noreferrer');
    }
    rootEl.classList.add('equali-injected-element');
    if (!rootEl.id) {
      // 같은 HTML 은 항상 같은 id → 재적용 시 중복 삽입 방지
      let h = 0;
      const src = String(html);
      for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
      rootEl.id = 'equali-inj-' + (h >>> 0).toString(36);
    }
    return rootEl;
  }

  /* ---------------- 정해진 동작 실행기 (shared/actions.js) ----------------
     페이지에 코드를 넣지 않고 확장이 직접 수행하므로, 인라인 스크립트를 막는 사이트에서도 동작한다.
     "원래대로"(equali-revert) 때 리스너까지 함께 제거된다. */
  let elementActionAbort = new AbortController();
  document.addEventListener('equali-revert', () => { elementActionAbort.abort(); elementActionAbort = new AbortController(); });

  function performElementAction(el, action) {
    const pick = (sel) => { if (!sel) return null; try { const t = document.querySelector(sel); return t && !ui.isOwn(t) ? t : null; } catch (e) { return null; } };
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    switch (action.type) {
      case 'scroll_top': window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); break;
      case 'navigate': {
        // 주소는 만들 때와 저장본을 읽을 때 모두 검증된 http(s) 주소다. 그래도 떠나기 직전에 한 번 더 확인한다.
        const url = EqualiActions.cleanUrl(action.url);
        if (!url) { showToast('이동할 주소가 올바르지 않습니다.'); break; }
        showToast(`${EqualiActions.destinationText(url)} (으)로 이동합니다.`);
        setTimeout(() => { if (action.newTab) window.open(url, '_blank', 'noopener'); else window.location.assign(url); }, 350);
        break;
      }
      case 'scroll_to': { const t = pick(action.target); if (t) t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); else showToast('이동할 곳을 찾지 못했습니다.'); break; }
      case 'toggle': { const t = pick(action.target); if (!t) { showToast('보이거나 숨길 요소를 찾지 못했습니다.'); break; } const hidden = t.dataset.equaliToggled === '1'; t.style.display = hidden ? (t.dataset.equaliDisplay || '') : 'none'; if (!hidden) t.dataset.equaliDisplay = t.style.display === 'none' ? '' : t.style.display; t.dataset.equaliToggled = hidden ? '0' : '1'; break; }
      case 'message': showToast(action.text); break;
      case 'speak': {
        if (!('speechSynthesis' in window)) { showToast('이 브라우저는 읽어 주기를 지원하지 않습니다.'); break; }
        const t = action.target ? pick(action.target) : null;
        const text = action.text || ((t || el).innerText || '').trim().replace(/\s+/g, ' ').slice(0, 600);
        if (!text) break;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance(text));
        break;
      }
      case 'highlight': { const t = pick(action.target); if (!t) { showToast('강조할 요소를 찾지 못했습니다.'); break; } const prev = t.style.outline, prevOff = t.style.outlineOffset; t.style.outline = '4px solid #F5581F'; t.style.outlineOffset = '3px'; t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }); setTimeout(() => { t.style.outline = prev; t.style.outlineOffset = prevOff; }, (action.seconds || 3) * 1000); break; }
      case 'text_size': { const t = (action.target ? pick(action.target) : null) || el; const base = parseFloat(t.dataset.equaliBaseFont || getComputedStyle(t).fontSize) || 16; t.dataset.equaliBaseFont = String(base); const step = (parseFloat(t.dataset.equaliFontStep || '0') || 0) + action.percent; const clamped = Math.max(-30, Math.min(120, step)); t.dataset.equaliFontStep = String(clamped); t.style.setProperty('font-size', `${Math.round(base * (1 + clamped / 100))}px`, 'important'); break; }
      case 'focus': { const t = pick(action.target); if (t) { t.focus({ preventScroll: false }); t.scrollIntoView({ block: 'center' }); } else showToast('이동할 입력 칸을 찾지 못했습니다.'); break; }
      case 'sound': { try { const Ctx = window.AudioContext || window.webkitAudioContext; const ctx = new Ctx(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.frequency.value = action.tone === 'ding' ? 1175 : 660; gain.gain.setValueAtTime(0.15, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4); osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.42); setTimeout(() => ctx.close().catch(() => {}), 700); } catch (e) {} break; }
      case 'confetti': {
        if (reduced) { showToast('축하합니다!'); break; }
        const r = el.getBoundingClientRect();
        const layer = document.createElement('div');
        layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147482000;overflow:hidden;';
        const colors = ['#F5581F', '#FFD54A', '#2A6FDB', '#178A5B', '#7C56D9'];
        for (let i = 0; i < 36; i++) {
          const p = document.createElement('span');
          const dx = (Math.random() - 0.5) * 360, dy = -120 - Math.random() * 220;
          p.style.cssText = `position:absolute;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;width:9px;height:14px;background:${colors[i % colors.length]};border-radius:2px;`;
          layer.appendChild(p);
          p.animate([{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: 0.6 }, { transform: `translate(${dx * 1.2}px,${dy + 420}px) rotate(${Math.random() * 900}deg)`, opacity: 0 }], { duration: 1500 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        }
        document.documentElement.appendChild(layer);
        setTimeout(() => layer.remove(), 2200);
        break;
      }
      case 'shake': { if (!reduced && el.animate) el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 380 }); break; }
      case 'counter': { const n = (parseInt(el.dataset.equaliCount || '0', 10) || 0) + 1; el.dataset.equaliCount = String(n); showToast(`${n}번 눌렀습니다.`); break; }
    }
  }

  function bindElementAction(targetEl, spec) {
    if (!targetEl || !spec || typeof EqualiActions === 'undefined') return false;
    const eventName = { click: 'click', hover: 'mouseenter', focus: 'focus' }[spec.trigger] || 'click';
    targetEl.addEventListener(eventName, (e) => {
      if (spec.replace && eventName === 'click') { e.preventDefault(); e.stopPropagation(); }
      for (const action of spec.actions) { try { performElementAction(targetEl, action); } catch (err) { console.warn('[EqualiUI] element action error:', action.type, err); } }
    }, { signal: elementActionAbort.signal, capture: spec.replace === true });
    targetEl.setAttribute('data-equali-action', spec.actions.map(a => a.type).join(' '));
    // 어디로 데려가는 버튼인지 누르기 전에 알 수 있어야 한다 → 말풍선과 읽어 주기용 설명에 목적지를 드러낸다
    const nav = spec.actions.find(a => a.type === 'navigate');
    if (nav) {
      const where = `Re:Cognition: 누르면 ${EqualiActions.destinationText(nav.url)} (으)로 이동합니다`;
      if (targetEl.dataset.equaliPrevTitle === undefined) targetEl.dataset.equaliPrevTitle = targetEl.getAttribute('title') || '';
      targetEl.setAttribute('title', where);
      elementActionAbort.signal.addEventListener('abort', () => { const prev = targetEl.dataset.equaliPrevTitle; if (prev) targetEl.setAttribute('title', prev); else targetEl.removeAttribute('title'); delete targetEl.dataset.equaliPrevTitle; }, { once: true });
    }
    return true;
  }

  function executeElementActionScript(targetEl, jsCode, selector) {
    if (!targetEl || !jsCode) return false;
    // 정해진 동작(shared/actions.js)이면 코드를 주입하지 않고 직접 수행한다
    if (typeof EqualiActions !== 'undefined') {
      const spec = EqualiActions.decode(jsCode);
      if (spec) return bindElementAction(targetEl, spec);
      if (String(jsCode).trim().startsWith(EqualiActions.PREFIX)) return false; // 형식은 맞는데 검증을 통과하지 못한 동작
    }

    // 실행 직전 최종 안전 검사 (저장소·메시지 경로가 오염되었더라도 위험 구문은 실행하지 않는다)
    if (typeof EqualiSafety !== 'undefined') {
      const audit = EqualiSafety.auditProposal({ generatedJs: { [selector || 'el']: jsCode } }, null);
      if (Object.keys(audit.sanitized.generatedJs).length === 0) {
        console.warn('[EqualiUI] 안전 검사에서 차단된 스크립트는 실행하지 않습니다.', audit.findings);
        return false;
      }
    }

    let cleanCode = jsCode.trim();
    if (cleanCode.startsWith('```javascript')) {
      cleanCode = cleanCode.split('```javascript')[1].split('```')[0].trim();
    } else if (cleanCode.startsWith('```js')) {
      cleanCode = cleanCode.split('```js')[1].split('```')[0].trim();
    } else if (cleanCode.startsWith('```')) {
      cleanCode = cleanCode.split('```')[1].split('```')[0].trim();
    }

    // Pre-sanitize to prevent 'Identifier el has already been declared'
    let sanitized = cleanCode
      .replace(/\b(const|let|var)\s+el\s*=\s*document\.querySelector\([^)]+\);?/g, '')
      .replace(/\b(const|let|var)\s+el\s*=/g, 'let _temp_el =');

    // If code does not contain an event listener, automatically wrap in click listener!
    if (!sanitized.includes('addEventListener') && !sanitized.includes('.onclick')) {
      sanitized = `
        el.addEventListener('click', (e) => {
          if (e && e.preventDefault) e.preventDefault();
          ${sanitized}
        });
      `;
    }

    // Tag the target element with a unique action ID so the script finds it reliably
    const actionId = 'eq-act-' + Math.random().toString(36).substr(2, 9);
    targetEl.setAttribute('data-equali-action-id', actionId);

    // 스크립트가 등록하는 모든 리스너에 AbortSignal 을 물려, "원래대로" 시 동작까지 함께 제거되도록 한다.
    const fullCode = `
      (function() {
        if (!window.__equaliAbort) {
          window.__equaliAbort = new AbortController();
          document.addEventListener('equali-revert', function () {
            window.__equaliAbort.abort();
            window.__equaliAbort = new AbortController();
          });
        }
        var __signal = window.__equaliAbort.signal;
        var __origAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, fn, opts) {
          var o = (typeof opts === 'object' && opts) ? Object.assign({}, opts) : { capture: !!opts };
          if (!o.signal) o.signal = __signal;
          return __origAdd.call(this, type, fn, o);
        };
        try {
          const el = document.querySelector('[data-equali-action-id="${actionId}"]');
          if (el) {
            ${sanitized}
          }
        } catch(err) {
          console.error('[EqualiUI Action Script Runtime Error]:', err);
        } finally {
          EventTarget.prototype.addEventListener = __origAdd;
        }
      })();
    `;

    try {
      // 인라인 스크립트를 막는 사이트에서는 아래 주입이 조용히 버려진다 → 위반 이벤트를 잡아 실패로 알린다
      let blocked = false;
      const onViolation = (e) => { if (/script-src/.test(e.violatedDirective || e.effectiveDirective || '') && (e.blockedURI === 'inline' || !e.blockedURI)) blocked = true; };
      document.addEventListener('securitypolicyviolation', onViolation);
      const scriptEl = document.createElement('script');
      scriptEl.type = 'text/javascript';
      scriptEl.className = 'equali-injected-script';
      try {
        scriptEl.text = getTrustedScript(fullCode);
      } catch(e) {
        scriptEl.textContent = fullCode;
      }
      (document.head || document.documentElement || document.body).appendChild(scriptEl);
      document.removeEventListener('securitypolicyviolation', onViolation); // 위반 이벤트는 appendChild 와 같은 작업 안에서 동기적으로 온다
      setTimeout(() => {
        try { scriptEl.remove(); } catch(e) {}
      }, 50);
      if (blocked) console.warn('[EqualiUI] 이 사이트의 보안 정책(CSP)이 스크립트 주입을 막아 동작을 연결하지 못했습니다:', selector);
      return !blocked;
    } catch (err) {
      console.error('[EqualiUI Action Script Injection Error]:', err);
      return false;
    }
  }

  function injectDynamicCss(cssText, title = '사용자 맞춤 UI 코드', domElements = [], jsBlocks = {}, components = []) {
    // 어떤 경로로 들어온 패치든 적용 직전에 한 번 더 정화한다
    if (typeof EqualiSafety !== 'undefined') {
      const audit = EqualiSafety.auditProposal(
        { generatedCss: cssText, generatedDom: domElements, generatedJs: jsBlocks, components },
        { domain: window.location.hostname, url: window.location.href, hasPasswordField: pageHasPasswordField(), hasPaymentField: pageHasPaymentField() }
      );
      cssText = audit.sanitized.generatedCss;
      domElements = audit.sanitized.generatedDom;
      jsBlocks = audit.sanitized.generatedJs;
      components = audit.sanitized.components;
    } else {
      components = []; // 검증기를 쓸 수 없으면 부품은 그리지 않는다
    }
    clearPreview();

    if (cssText) {
      let styleEl = document.getElementById('equali-dynamic-patch');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'equali-dynamic-patch';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = cssText;
      state.currentInjectedCss = cssText;
    }

    if (domElements && domElements.length > 0) {
      state.currentInjectedDom = domElements;

      const applyDomElements = (pendingList, attempt = 1) => {
        const stillPending = [];

        pendingList.forEach(item => {
          try {
            const parent = document.querySelector(item.parentSelector);
            if (parent) {
              if (ui.isOwn(parent)) return;
              if (item.isModify) {
                state.modifiedOriginals.push({
                  el: parent,
                  textContent: item.textContent !== undefined ? parent.textContent : undefined,
                  src: item.src !== undefined && parent.tagName === 'IMG' ? parent.src : undefined
                });
                if (item.textContent !== undefined) parent.textContent = item.textContent;
                if (item.src !== undefined && parent.tagName === 'IMG') parent.src = item.src;
              } else if (item.html) {
                const el = sanitizeHtmlToElement(item.html);
                if (el && !document.getElementById(el.id)) {
                  parent.appendChild(el);
                }
              }
            } else {
              stillPending.push(item);
            }
          } catch (e) {
            console.error('[EqualiUI] DOM injection error for selector:', item.parentSelector, e);
          }
        });

        if (stillPending.length > 0 && attempt <= 5) {
          setTimeout(() => applyDomElements(stillPending, attempt + 1), attempt * 300);
        }
      };

      applyDomElements(domElements, 1);
    }

    if (jsBlocks && Object.keys(jsBlocks).length > 0) {
      const applyJsBlocks = (attempt = 1) => {
        let allFound = true;
        for (const [selector, jsCode] of Object.entries(jsBlocks)) {
          try {
            const el = document.querySelector(selector);
            if (el) {
              if (!el.__equali_bound_js__) {
                el.__equali_bound_js__ = true;
                executeElementActionScript(el, jsCode, selector);
              }
            } else {
              allFound = false;
            }
          } catch (e) {
            console.error('[EqualiUI] Failed to bind JS logic for selector:', selector, e);
          }
        }
        if (!allFound && attempt <= 5) {
          setTimeout(() => applyJsBlocks(attempt + 1), attempt * 300);
        }
      };
      applyJsBlocks(1);
    }

    if (components && components.length > 0 && typeof EqualiParts !== 'undefined') {
      components.forEach(c => EqualiSignals.usedFeatures.add(c.type));
      const renderParts = (list, attempt = 1) => {
        const pending = EqualiParts.render(list, {
          catalog: EqualiSafety.COMPONENT_CATALOG,
          floatingLayer: ui.floatingParts(),
          theme: ui.layer ? ui.layer.dataset.theme : 'light',
          size: ui.layer ? ui.layer.dataset.size : 'normal',
          shadowMode: window.__EQUALI_TEST_OPEN_SHADOW__ === true ? 'open' : 'closed'
        });
        if (pending.length > 0 && attempt <= 5) setTimeout(() => renderParts(pending, attempt + 1), attempt * 300);
      };
      renderParts(components);
    }

    state.isAdapted = true;
    state.goalTitle = title;

    updateBadgeStatus(true, title);
    console.log('[EqualiUI] Injected dynamic custom patch for this page.');
  }

  function revertAllChanges(options = {}) {
    clearPreview();
    const styleEl = document.getElementById('equali-dynamic-patch');
    if (styleEl) {
      styleEl.remove();
    }

    // 추가했던 요소 제거 + 바꿨던 문구/이미지 원복 + 연결했던 동작 스크립트 해제
    document.querySelectorAll('.equali-injected-element').forEach(el => el.remove());
    const floatingParts = ui.byId('equali-floating-parts');
    if (floatingParts) floatingParts.textContent = '';
    state.modifiedOriginals.reverse().forEach(o => {
      try {
        if (o.textContent !== undefined) o.el.textContent = o.textContent;
        if (o.src !== undefined) o.el.src = o.src;
      } catch (e) {}
    });
    state.modifiedOriginals = [];
    state.currentInjectedDom = null;
    document.dispatchEvent(new CustomEvent('equali-revert'));
    document.querySelectorAll('[data-equali-action-id]').forEach(el => {
      el.removeAttribute('data-equali-action-id');
      el.__equali_bound_js__ = false;
    });

    // Stop and clear all specialized accessibility modules
    EqualiTTSPlayer.stop();
    EqualiLiveCaptionsBar.stop();
    EqualiPlainLanguageHelper.stop();

    // Reset ruler
    state.rulerActive = false;
    const ruler = ui.byId('equali-reading-ruler');
    if (ruler) ruler.style.display = 'none';

    // Remove any theme/font utility classes applied to body
    document.body.classList.remove(
      'equali-theme-dark-contrast',
      'equali-theme-warm-sepia',
      'equali-theme-yellow-contrast',
      'equali-font-dyslexic',
      'equali-font-enlarged',
      'equali-font-extra-large'
    );

    state.isAdapted = false;
    state.currentInjectedCss = '';
    state.goalTitle = '';
    state.sessionConversationHistory = [];

    updateBadgeStatus(false);

    // 승인했던 제안을 되돌렸다면 가장 강한 불만족 신호 → 학습하고, 다른 형태의 대안을 먼저 제안한다
    if (state.lastApplied) {
      const a = state.lastApplied;
      const signal = a.rageRevert ? 'rage_after_apply' : a.viaCheckin ? 'checkin_negative' : (Date.now() - a.at < QUICK_REVERT_MS ? 'quick_revert' : 'revert');
      reportDissatisfaction(signal);
    }

    // 긴급 복구: 새로고침해도 문제의 패치가 다시 적용되지 않도록 자동 반영을 끈다
    if (options.emergency) {
      try {
        chrome.runtime.sendMessage({ type: 'DISABLE_SITE_PATCH', domain: window.location.hostname || 'local-page' });
      } catch (e) {}
    }
  }

  /* --- 미리보기: CSS 만 임시로 입혀 보고, 승인 전에는 언제든 사라진다 --- */
  function applyPreview(cssText) {
    clearPreview();
    const applied = document.getElementById('equali-dynamic-patch');
    if (applied) applied.disabled = true;
    const el = document.createElement('style');
    el.id = 'equali-preview-patch';
    el.textContent = cssText || '';
    document.head.appendChild(el);
    state.previewActive = true;
  }

  // 검토 중인 제안을 "적용된 모습 그대로" 보여 준다: 모양(CSS)과 도움 부품까지. 동작 스크립트는 승인 전에는 절대 실행하지 않는다.
  // 아무것도 저장되지 않으며, 다른 후보로 넘기거나 거절하면 흔적 없이 사라진다.
  function applyLivePreview(proposal) {
    applyPreview(proposal.generatedCss);
    const components = proposal.components || [];
    if (!components.length || typeof EqualiParts === 'undefined' || typeof EqualiSafety === 'undefined') return;
    const floating = ui.floatingParts();
    const hostsNow = () => new Set([...document.querySelectorAll('equali-part'), ...(floating ? floating.querySelectorAll('equali-part') : [])]);
    const before = hostsNow();
    try {
      EqualiParts.render(components, {
        catalog: EqualiSafety.COMPONENT_CATALOG, floatingLayer: floating,
        theme: ui.layer ? ui.layer.dataset.theme : 'light', size: ui.layer ? ui.layer.dataset.size : 'normal',
        shadowMode: window.__EQUALI_TEST_OPEN_SHADOW__ === true ? 'open' : 'closed'
      });
    } catch (e) { console.warn('[EqualiUI] preview parts error:', e); }
    state.previewParts = [...hostsNow()].filter(h => !before.has(h));
  }

  function clearPreview() {
    for (const host of state.previewParts || []) { try { host.remove(); } catch (e) {} }
    state.previewParts = [];
    const el = document.getElementById('equali-preview-patch');
    if (el) el.remove();
    const applied = document.getElementById('equali-dynamic-patch');
    if (applied) applied.disabled = false;
    state.previewActive = false;
  }

  function pageHasPasswordField() {
    return Boolean(document.querySelector('input[type="password"]'));
  }

  function pageHasPaymentField() {
    return Boolean(document.querySelector('input[autocomplete^="cc-"], input[name*="card" i][name*="num" i], input[id*="cardnumber" i], input[name*="cvc" i], input[name*="cvv" i]'));
  }

  /* ==========================================================================
     2. Deep HTML / DOM Snapshot Scanner (Supplies Rich HTML Signals to GPT-5.6-luna)
     ========================================================================== */

  function buildCompactHtmlSkeleton(node, depth = 0, maxDepth = 12, charLimit = 40000) {
    if (!node || depth > maxDepth) return '';

    const ignoreTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'IFRAME', 'LINK', 'META', 'BR', 'HR']);
    if (ignoreTags.has(node.tagName)) return '';

    let tag = node.tagName.toLowerCase();
    let idAttr = node.id ? ` id="${node.id}"` : '';
    let classAttr = node.className && typeof node.className === 'string'
      ? ` class="${node.className.trim().split(/\s+/).slice(0, 6).join(' ')}"`
      : '';

    let indent = '  '.repeat(depth);
    let openTag = `${indent}<${tag}${idAttr}${classAttr}>`;

    // Leaf or simple text node check
    if (node.children.length === 0) {
      let txt = (node.innerText || '').trim().replace(/\s+/g, ' ');
      if (txt.length > 80) txt = txt.slice(0, 77) + '...';
      return `${openTag}${txt ? ` ${txt} ` : ''}</${tag}>\n`;
    }

    let childrenHtml = '';
    for (const child of node.children) {
      if (childrenHtml.length > charLimit) break;
      childrenHtml += buildCompactHtmlSkeleton(child, depth + 1, maxDepth, charLimit);
    }

    return `${openTag}\n${childrenHtml}${indent}</${tag}>\n`;
  }

  function detectSemanticLandmarks() {
    const findBestMatch = (selectors) => {
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el && (el.offsetHeight > 0 || el.offsetWidth > 0 || el.getClientRects().length > 0)) {
            const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : '';
            const id = el.id ? `#${el.id}` : '';
            return {
              selector: `${sel}${id && !sel.includes('#') ? id : ''}${cls && !sel.includes('.') ? cls : ''}`,
              tag: el.tagName.toLowerCase(),
              snippet: (el.innerText || '').trim().slice(0, 150)
            };
          }
        } catch (e) {}
      }
      return null;
    };

    return {
      mainArticle: findBestMatch(['article', 'main', '[role="main"]', '.article-body', '.post-content', '.entry-content', '.news_view', '#articleBody', '#content', '.content']),
      primaryNav: findBestMatch(['nav', 'header nav', '[role="navigation"]', '.gnb', '.navbar', '.header-menu', '#gnb', '#nav', 'header']),
      commentSection: findBestMatch(['#comments', '.comments', '.comment-box', '.reply-list', '[id*="comment"]', '[class*="comment"]', '.discussion']),
      sidebar: findBestMatch(['aside', '.sidebar', '#sidebar', '.aside', '.right-area', '[role="complementary"]', '.sub-content']),
      mediaPlayer: findBestMatch(['video', 'iframe[src*="youtube"]', 'iframe[src*="vimeo"]', '.video-stream', '.player', '.video-container']),
      adBanners: findBestMatch(['[class*="ad-"]', '[id*="ad_"]', '[class*="banner"]', 'iframe[src*="doubleclick"]', '.google-anno', '.adsbygoogle'])
    };
  }

  function getViewportContext() {
    const vh = window.innerHeight || (document.documentElement ? document.documentElement.clientHeight : 800);
    const vw = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 1200);
    const scrollTop = window.scrollY || window.pageYOffset || 0;
    const scrollHeight = (document.documentElement ? document.documentElement.scrollHeight : 0) || (document.body ? document.body.scrollHeight : 0) || 1;

    // Visible headings within current viewport
    let visibleHeadings = [];
    try {
      visibleHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.top < vh && rect.bottom > 0 && rect.width > 0 && rect.height > 0;
        })
        .map(el => el.innerText.trim())
        .filter(Boolean)
        .slice(0, 5);
    } catch (e) {}

    // User selected text (critical for contextual pronouns like "이거", "여기")
    let userSelectedText = '';
    try {
      const sel = window.getSelection();
      if (sel) {
        userSelectedText = sel.toString().trim().slice(0, 300);
      }
    } catch (e) {}

    // Active element
    let activeElementSelector = null;
    try {
      if (document.activeElement && document.activeElement !== document.body && !ui.isOwn(document.activeElement)) {
        const el = document.activeElement;
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : '';
        activeElementSelector = `${tag}${id}${cls}`;
      }
    } catch (e) {}

    return {
      scrollTop: scrollTop,
      viewportHeight: vh,
      viewportWidth: vw,
      pageScrollPercent: scrollHeight > vh ? Math.round((scrollTop / (scrollHeight - vh)) * 100) : 0,
      userSelectedText: userSelectedText || null,
      lastClickedSelector: state.lastClickedSelector || null,
      activeElementSelector: activeElementSelector,
      visibleHeadings: visibleHeadings
    };
  }

  function detectPageType() {
    try {
      const url = (window.location.href || '').toLowerCase();
      const ogTypeMeta = document.querySelector('meta[property="og:type"]');
      const ogType = (ogTypeMeta && ogTypeMeta.content) ? ogTypeMeta.content.toLowerCase() : '';

      if (ogType.includes('article') || document.querySelector('article, .article-body, #articleBody, .news_view')) {
        return 'article';
      }
      if (url.includes('youtube.com') || url.includes('twitch.tv') || document.querySelector('video, .video-stream')) {
        return 'video_streaming';
      }
      if (document.querySelector('.price, [class*="product"], [id*="product"], .shopping-cart, .buy-btn')) {
        return 'ecommerce_shopping';
      }
      if (url.includes('github.com') || url.includes('docs.') || document.querySelector('.documentation, .doc-content, pre code')) {
        return 'documentation_tech';
      }
      if (document.querySelector('.feed, .timeline, [role="feed"], .post-item')) {
        return 'social_feed';
      }
    } catch (e) {}
    return 'general_webpage';
  }

  function getElementUniqueSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';

    // 1. Unique ID check
    if (el.id && typeof el.id === 'string' && el.id.trim()) {
      try {
        const escaped = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(el.id) : el.id.replace(/([:.#/[\]])/g, '\\$1');
        if (document.querySelectorAll('#' + escaped).length === 1) {
          return '#' + escaped;
        }
      } catch (e) {}
    }

    // 2. Climb up DOM hierarchy using nth-child, anchoring to unique IDs
    const path = [];
    let current = el;

    while (current && current !== document.body && current !== document.documentElement) {
      if (current !== el && current.id && typeof current.id === 'string' && current.id.trim()) {
        try {
          const escaped = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(current.id) : current.id.replace(/([:.#/[\]])/g, '\\$1');
          if (document.querySelectorAll('#' + escaped).length === 1) {
            path.unshift('#' + escaped);
            break;
          }
        } catch (e) {}
      }

      const parent = current.parentElement;
      if (!parent) {
        path.unshift(current.tagName.toLowerCase());
        break;
      }

      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length === 1) {
        path.unshift(tag);
      } else {
        const idx = Array.prototype.indexOf.call(parent.children, current) + 1;
        path.unshift(`${tag}:nth-child(${idx})`);
      }
      current = parent;
    }

    return path.join(' > ');
  }

  function extractInteractiveElementsMap() {
    const vh = window.innerHeight || 800;
    const results = [];
    try {
      const candidates = document.querySelectorAll('button, a, input, [role="button"], textarea, select, [tabindex="0"]');

      for (const el of candidates) {
        if (results.length >= 30) break;
        if (ui.isOwn(el)) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.bottom > -50 && rect.top < vh + 150) {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

          let label = (el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
          if (label.length > 50) label = label.slice(0, 47) + '...';

          const sel = getElementUniqueSelector(el);
          results.push({
            selector: sel,
            tag: el.tagName.toLowerCase(),
            type: el.type || el.getAttribute('role') || el.tagName.toLowerCase(),
            text: label || '(no text)',
            rect: {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          });
        }
      }
    } catch(e) {}
    return results;
  }

  function extractLocalFocusSubtree(targetEl = null) {
    let el = targetEl;
    if (!el && state.lastClickedSelector) {
      try { el = document.querySelector(state.lastClickedSelector); } catch (e) {}
    }
    if (!el && document.activeElement && document.activeElement !== document.body && !ui.isOwn(document.activeElement)) {
      el = document.activeElement;
    }
    if (!el) return null;

    try {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const parent = el.parentElement;
      const parentStyle = parent ? window.getComputedStyle(parent) : null;

      const siblings = parent ? Array.from(parent.children)
        .filter(child => child !== el)
        .slice(0, 5)
        .map(child => ({
          tag: child.tagName.toLowerCase(),
          text: (child.innerText || child.value || '').trim().replace(/\s+/g, ' ').slice(0, 40)
        })) : [];

      let snippet = (el.innerText || el.value || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ');
      if (snippet.length > 80) snippet = snippet.slice(0, 77) + '...';

      return {
        selector: getElementUniqueSelector(el),
        tag: el.tagName.toLowerCase(),
        text: snippet,
        outerHtml: el.outerHTML ? el.outerHTML.slice(0, 400) : '',
        rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
        computedStyles: {
          backgroundColor: style.backgroundColor,
          color: style.color,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily ? style.fontFamily.split(',')[0].trim() : '',
          display: style.display,
          position: style.position
        },
        parent: parent ? {
          tag: parent.tagName.toLowerCase(),
          id: parent.id || null,
          className: (parent.className && typeof parent.className === 'string') ? parent.className.split(/\s+/).slice(0, 3).join(' ') : null,
          display: parentStyle ? parentStyle.display : null
        } : null,
        siblings: siblings
      };
    } catch (e) {
      return null;
    }
  }

  function extractPrimaryColorPalette() {
    try {
      const bodyStyle = window.getComputedStyle(document.body);
      const headerEl = document.querySelector('header, nav, .header, .gnb, [role="navigation"]');
      const headerStyle = headerEl ? window.getComputedStyle(headerEl) : null;
      const btnEl = document.querySelector('button, [role="button"], input[type="submit"], .btn, .button');
      const btnStyle = btnEl ? window.getComputedStyle(btnEl) : null;

      return {
        bodyBg: bodyStyle.backgroundColor || 'rgb(255, 255, 255)',
        textColor: bodyStyle.color || 'rgb(0, 0, 0)',
        fontFamily: bodyStyle.fontFamily ? bodyStyle.fontFamily.split(',')[0].trim() : 'sans-serif',
        headerBg: headerStyle ? headerStyle.backgroundColor : null,
        primaryButtonBg: btnStyle ? btnStyle.backgroundColor : null,
        primaryButtonColor: btnStyle ? btnStyle.color : null
      };
    } catch(e) {
      return { bodyBg: '#ffffff', textColor: '#000000', fontFamily: 'sans-serif' };
    }
  }

  function extractRichPageDomSnapshot() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => h.innerText.trim())
      .filter(Boolean)
      .slice(0, 6);

    // Identify concrete main layout containers
    const keyContainers = [];
    const containerSelectors = [
      'header', 'nav', 'main', 'article', 'section', 'aside', 'footer',
      '#root', '#app', '#main', '#content', '.main', '.content', '.container',
      '.wrapper', '.wrap', '.article-body', '.article_body', '.post-content',
      '.board', '.feed', '.card', '.sidebar'
    ];

    containerSelectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) {
        const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : '';
        const id = el.id ? `#${el.id}` : '';
        keyContainers.push(`${sel}${id && !sel.includes('#') ? id : ''}${cls && !sel.includes('.') ? cls : ''}`);
      }
    });

    const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
    const primaryPalette = extractPrimaryColorPalette();

    // Compact HTML Skeleton of the active page (body scope)
    let htmlSkeleton = '';
    try {
      htmlSkeleton = buildCompactHtmlSkeleton(document.body, 0, 8, 30000);
    } catch (e) {
      htmlSkeleton = '<body><!-- DOM Skeleton unavailable --></body>';
    }

    const hasDistractions = document.querySelectorAll('iframe, [class*="banner"], [class*="ad-"], aside').length > 1;
    const hasVideo = Boolean(document.querySelector('video, iframe[src*="youtube"], iframe[src*="vimeo"]'));
    const totalTextLength = (document.body.innerText || '').trim().length;

    return {
      title: document.title,
      url: window.location.href,
      domain: window.location.hostname,
      pageType: detectPageType(),
      metaDescription: metaDesc,
      headings: headings,
      keyContainers: keyContainers.slice(0, 10),
      semanticLandmarks: detectSemanticLandmarks(),
      interactiveMap: extractInteractiveElementsMap(),
      viewportContext: getViewportContext(),
      localFocusSubtree: extractLocalFocusSubtree(),
      primaryColors: primaryPalette,
      computedStyles: {
        backgroundColor: primaryPalette.bodyBg,
        color: primaryPalette.textColor,
        fontFamily: primaryPalette.fontFamily,
        fontSize: window.getComputedStyle(document.body).fontSize || '16px'
      },
      htmlSkeleton: htmlSkeleton,
      existingInjectedCss: state.currentInjectedCss || null,
      existingInjectedDom: state.currentInjectedDom || [],
      hasDistractions: hasDistractions,
      hasVideo: hasVideo,
      totalTextLength: totalTextLength,
      hasPasswordField: pageHasPasswordField(),
      hasPaymentField: pageHasPaymentField()
    };
  }

  /* ==========================================================================
     2.5. Live-Page Proposal Validator & Accessibility Signal Collector
     ========================================================================== */

  function parseRgb(str) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(str || '');
    if (!m) return null;
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4] && m[4].endsWith('%')) a /= 100;
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }

  function luminance({ r, g, b }) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function contrastRatio(c1, c2) {
    const l1 = luminance(c1), l2 = luminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // 요소의 실제 배경색 (투명이면 조상으로 올라감). 배경 이미지를 만나면 판단 불가 → null
  function effectiveBackground(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const st = window.getComputedStyle(cur);
      if (st.backgroundImage && st.backgroundImage !== 'none') return null;
      const bg = parseRgb(st.backgroundColor);
      if (bg && bg.a > 0.9) return bg;
      if (bg && bg.a > 0.05) return null; // 반투명 합성은 계산하지 않음
      cur = cur.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function isUsable(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const st = window.getComputedStyle(cur);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false;
      if (cur === el && st.pointerEvents === 'none') return false;
      cur = cur.parentElement;
    }
    return true;
  }

  const ESSENTIAL_CONTROL_SEL = 'input:not([type="hidden"]), select, textarea, button, [role="button"], [type="submit"], form a, main a, article a, [role="main"] a';
  const NON_ESSENTIAL_REGION_SEL = 'aside, footer, [role="complementary"], [class*="sidebar" i], [class*="banner" i], [class*="advert" i], [class*="ad-" i], [id^="ad" i], .adsbygoogle, #equali-root-container, .equali-injected-element';

  // ②의 최적 선택이 쓰는 측정값: "이 후보를 입히면 실제로 무엇이 얼마나 나아지는가"
  function measurePage() {
    const m = {};
    try {
      const textEl = EqualiSignals.mainTextElement();
      if (textEl) {
        const st = window.getComputedStyle(textEl);
        m.fontPx = Math.round((parseFloat(st.fontSize) || 16) * 10) / 10;
        const lh = parseFloat(st.lineHeight);
        m.lineHeightRatio = Math.round(((isNaN(lh) ? m.fontPx * 1.2 : lh) / m.fontPx) * 100) / 100;
        const fg = parseRgb(st.color);
        const bg = effectiveBackground(textEl);
        if (fg && bg) m.contrast = Math.round(contrastRatio(fg, bg) * 10) / 10;
        m.lineLengthCh = Math.round(textEl.getBoundingClientRect().width / (m.fontPx * 0.55));
      }
      m.visibleDistractions = Array.from(document.querySelectorAll('iframe, [class*="banner" i], [class*="ad-" i], .adsbygoogle, aside, [class*="sidebar" i]'))
        .slice(0, 60).filter(el => !ui.isOwn(el) && isUsable(el)).length;
      const controls = Array.from(document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, [role="button"]'))
        .filter(el => !ui.isOwn(el)).slice(0, 80).filter(isUsable);
      m.smallTargets = controls.filter(el => { const r = el.getBoundingClientRect(); return r.height < 24 || r.width < 24; }).length;
      // "또렷함": 브라우저 기본 밑줄·기본 버튼 테두리는 세지 않는다 (굵은 밑줄 2px 이상, 바깥선 또는 2px 이상 테두리만)
      m.underlinedLinks = controls.filter(el => {
        if (el.tagName !== 'A') return false;
        const st = window.getComputedStyle(el);
        return /underline/.test(st.textDecorationLine) && parseFloat(st.textDecorationThickness) >= 2;
      }).length;
      m.outlinedButtons = controls.filter(el => {
        if (el.tagName === 'A') return false;
        const st = window.getComputedStyle(el);
        return (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2) || (st.borderTopStyle === 'solid' && parseFloat(st.borderTopWidth) >= 2); // 브라우저 기본 버튼 테두리(outset)는 제외
      }).length;
      // 무엇이든 바뀌었는지 보기 위한 표본 지문
      m.fingerprint = Array.from(document.querySelectorAll('p, h1, h2, a, button, li, aside, nav')).slice(0, 40).map(el => {
        const st = window.getComputedStyle(el);
        return [st.color, st.backgroundColor, st.fontSize, st.display, st.lineHeight, st.letterSpacing, st.fontFamily.slice(0, 12), st.textDecorationLine, st.textDecorationThickness, st.outlineStyle, st.outlineWidth, st.borderTopWidth, st.fontWeight].join('|');
      }).join(';');
    } catch (e) {}
    return m;
  }

  /**
   * 제안된 CSS 를 "그려지기 전에" 잠깐 입혀 실제 페이지에서 측정하고 즉시 걷어낸다 (동기 실행 → 화면 깜빡임 없음).
   * 죽은 선택자, 대비 저하, 사라진 버튼/입력창, 본문 소실, 가로 넘침을 보고한다.
   */
  function validateProposalOnPage(proposal) {
    const report = { totalSelectors: 0, deadSelectors: [], contrastFailures: [], hiddenInteractive: [], hiddenMainContent: false, horizontalOverflow: false, missingPartSelectors: [] };
    if (proposal && proposal.components && typeof EqualiParts !== 'undefined') {
      report.missingPartSelectors = EqualiParts.missingSelectors(proposal.components).slice(0, 8);
    }
    const css = (proposal && proposal.generatedCss) || '';
    if (!css.trim()) return report;

    const applied = document.getElementById('equali-dynamic-patch');
    const preview = document.getElementById('equali-preview-patch');
    const appliedWasDisabled = applied ? applied.disabled : false;
    if (applied) applied.disabled = true;
    if (preview) preview.disabled = true;

    const temp = document.createElement('style');
    try {
      // --- 기준선 (원본 페이지)
      const controls = Array.from(document.querySelectorAll(ESSENTIAL_CONTROL_SEL))
        .filter(el => !el.closest(NON_ESSENTIAL_REGION_SEL)).slice(0, 80)
        .filter(isUsable);
      const landmark = detectSemanticLandmarks().mainArticle;
      let mainEl = null;
      try { mainEl = landmark ? document.querySelector(landmark.selector) : null; } catch (e) {}
      const mainWasVisible = mainEl ? isUsable(mainEl) : false;
      const textEls = Array.from(document.querySelectorAll('p, li, h1, h2, h3, a, button, label, td, span'))
        .filter(el => !el.closest('#equali-root-container') && el.childElementCount === 0 && (el.textContent || '').trim().length >= 2) // 한국어 버튼 이름은 짧다 ("로그인", "검색")
        .slice(0, 400).filter(isUsable).slice(0, 60);
      const before = textEls.map(el => {
        const st = window.getComputedStyle(el);
        return { color: st.color, bg: JSON.stringify(effectiveBackground(el)) };
      });
      const overflowBefore = document.documentElement.scrollWidth > window.innerWidth + 20;
      const measuredBefore = measurePage();
      // 상자(테두리·바깥선)가 새로 생기는 요소를 찾기 위한 기준선. 크기가 0 인 링크도 포함한다 (막대로 드러나는 사고 방지)
      const boxSample = Array.from(document.querySelectorAll('a[href], button, [role="button"], input:not([type="hidden"]), summary'))
        .filter(el => !ui.isOwn(el)).slice(0, 160);
      const hasBox = (el) => {
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const border = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(st[`border${side}Width`]) > 0 && st[`border${side}Style`] !== 'none' && !/rgba\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(st[`border${side}Color`]));
        const outline = st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0;
        return border || outline;
      };
      const boxedBefore = new Set(boxSample.filter(hasBox));
      // 조작 요소의 글자 대비는 본문 표본과 따로 잰다 (버튼에 배경만 칠해 글자가 안 보이게 되는 사고 방지)
      const controlText = boxSample.filter(el => (el.innerText || el.value || '').trim().length >= 1).slice(0, 80);
      const controlBefore = controlText.map(el => ({ color: window.getComputedStyle(el).color, bg: JSON.stringify(effectiveBackground(el)) }));
      const rectsBefore = boxSample.slice(0, 60).map(el => el.getBoundingClientRect().top);

      // --- 임시 적용
      temp.textContent = css;
      document.head.appendChild(temp);

      const walk = (rules) => {
        for (const rule of Array.from(rules || [])) {
          if (rule.selectorText) {
            report.totalSelectors++;
            let hits = 0;
            try { hits = document.querySelectorAll(rule.selectorText.replace(/::?(before|after|placeholder|selection|first-line|first-letter|marker)/g, '')).length; } catch (e) {}
            if (hits === 0 && !/:(hover|focus|active|focus-visible|focus-within|visited)/.test(rule.selectorText)) {
              report.deadSelectors.push(rule.selectorText.slice(0, 100));
            }
          } else if (rule.cssRules) {
            walk(rule.cssRules);
          }
        }
      };
      try { walk(temp.sheet.cssRules); } catch (e) {}

      textEls.forEach((el, i) => {
        if (report.contrastFailures.length >= 5 || !isUsable(el)) return;
        const st = window.getComputedStyle(el);
        const bgObj = effectiveBackground(el);
        if (st.color === before[i].color && JSON.stringify(bgObj) === before[i].bg) return; // 제안이 바꾼 곳만 평가
        const fg = parseRgb(st.color);
        if (!fg || !bgObj) return;
        const ratio = contrastRatio(fg, bgObj);
        const large = parseFloat(st.fontSize) >= 24;
        if (ratio < (large ? 3 : 4.5)) {
          report.contrastFailures.push({
            selector: getElementUniqueSelector(el).slice(0, 100),
            ratio: Math.round(ratio * 10) / 10,
            color: st.color,
            background: `rgb(${bgObj.r}, ${bgObj.g}, ${bgObj.b})`
          });
        }
      });

      controlText.forEach((el, i) => {
        if (report.contrastFailures.length >= 5 || !isUsable(el)) return;
        const st = window.getComputedStyle(el);
        const bgObj = effectiveBackground(el);
        if (st.color === controlBefore[i].color && JSON.stringify(bgObj) === controlBefore[i].bg) return;
        const fg = parseRgb(st.color);
        if (!fg || !bgObj) return;
        const ratio = contrastRatio(fg, bgObj);
        const selector = getElementUniqueSelector(el).slice(0, 100);
        if (report.contrastFailures.some(c => c.selector === selector)) return; // 본문 표본에서 이미 잡힌 요소
        if (ratio < (parseFloat(st.fontSize) >= 24 ? 3 : 4.5)) {
          report.contrastFailures.push({ selector, ratio: Math.round(ratio * 10) / 10, color: st.color, background: `rgb(${bgObj.r}, ${bgObj.g}, ${bgObj.b})` });
        }
      });

      for (const el of controls) {
        if (report.hiddenInteractive.length >= 5) break;
        if (!isUsable(el)) {
          const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName.toLowerCase()).trim().replace(/\s+/g, ' ').slice(0, 30);
          report.hiddenInteractive.push({ selector: getElementUniqueSelector(el).slice(0, 100), label });
        }
      }
      if (mainEl && mainWasVisible && !isUsable(mainEl)) report.hiddenMainContent = true;
      if (!overflowBefore && document.documentElement.scrollWidth > window.innerWidth + 20) report.horizontalOverflow = true;
      const measuredAfter = measurePage();
      // 새로 상자가 생긴 요소 중: 여러 줄로 쪼개지거나 블록을 감싼 inline 요소(조각난 상자), 크기가 거의 없는 요소(막대)
      const artifacts = { sampled: boxSample.length, boxed: 0, fragmentedBoxes: 0, strayBoxes: 0, clippedBoxes: 0, overlappingBoxes: 0, examples: [] };
      const drawn = []; // 새로 그려진 상자의 실제 바깥 테두리 영역
      const outerRect = (el, st) => {
        const r = el.getBoundingClientRect();
        const grow = st.outlineStyle !== 'none' ? Math.max(0, parseFloat(st.outlineOffset) || 0) + (parseFloat(st.outlineWidth) || 0) : 0;
        return { left: r.left - grow, top: r.top - grow, right: r.right + grow, bottom: r.bottom + grow };
      };
      // 조상 중 넘치는 부분을 잘라내는 요소가 상자의 일부를 가리면, 위아래가 잘려 세로 막대만 남는다 (탭 줄·도구 막대에서 흔하다)
      const clippedBy = (el, box) => {
        for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
          const ps = window.getComputedStyle(p);
          if (!/(hidden|clip|auto|scroll)/.test(ps.overflowX + ps.overflowY)) continue;
          const pr = p.getBoundingClientRect();
          if (pr.width < 1 || pr.height < 1) continue;
          if (box.left < pr.left - 0.5 || box.right > pr.right + 0.5 || box.top < pr.top - 0.5 || box.bottom > pr.bottom + 0.5) return true;
        }
        return false;
      };
      for (const el of boxSample) {
        if (boxedBefore.has(el) || !hasBox(el)) continue;
        artifacts.boxed++;
        const rect = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        const stray = rect.width < 6 || rect.height < 6;
        const fragmented = !stray && st.display.startsWith('inline') && st.display !== 'inline-block' && st.display !== 'inline-flex'
          && (el.getClientRects().length > 1 || Boolean(el.querySelector('h1, h2, h3, h4, div, p, img, svg, cite')));
        if (stray) artifacts.strayBoxes++;
        if (fragmented) artifacts.fragmentedBoxes++;
        let clipped = false;
        if (!stray && !fragmented) {
          const box = outerRect(el, st);
          clipped = clippedBy(el, box);
          if (clipped) artifacts.clippedBoxes++;
          else drawn.push({ el, box });
        }
        if ((stray || fragmented || clipped) && artifacts.examples.length < 4) artifacts.examples.push(getElementUniqueSelector(el).slice(0, 80));
      }
      // 나란히 붙은 아이콘 버튼마다 상자를 두르면 선이 서로 겹쳐 지저분해진다 → 묶음(예: 검색 양식) 하나에 두르는 편이 낫다
      const overlapping = new Set();
      for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
          const a = drawn[i], b = drawn[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) { overlapping.add(b.el.contains(a.el) ? a.el : b.el); continue; }
          if (a.box.left < b.box.right && b.box.left < a.box.right && a.box.top < b.box.bottom && b.box.top < a.box.bottom) { overlapping.add(a.el); overlapping.add(b.el); }
        }
      }
      artifacts.overlappingBoxes = overlapping.size;
      for (const el of overlapping) { if (artifacts.examples.length < 4) artifacts.examples.push(getElementUniqueSelector(el).slice(0, 80)); }
      // 글자 크기·간격을 바꾸지 않았는데 요소들이 밀렸다면 테두리·여백이 레이아웃을 민 것이다
      artifacts.shifted = boxSample.slice(0, 60).filter((el, i) => Math.abs(el.getBoundingClientRect().top - rectsBefore[i]) > 3).length;
      report.visualArtifacts = artifacts;
      const changedAny = measuredBefore.fingerprint !== measuredAfter.fingerprint || measuredBefore.visibleDistractions !== measuredAfter.visibleDistractions;
      delete measuredBefore.fingerprint;
      delete measuredAfter.fingerprint;
      report.metrics = { before: measuredBefore, after: measuredAfter, changedAny };
    } catch (e) {
      console.warn('[EqualiUI] Proposal validation error:', e);
    } finally {
      temp.remove();
      if (applied) applied.disabled = appliedWasDisabled;
      if (preview) preview.disabled = false;
    }
    report.deadSelectors = report.deadSelectors.slice(0, 12);
    return report;
  }

  /**
   * 접근성 신호 수집기 — 모두 기기 안에서만 계산되며, 추천 점수 계산과 (사용자가 켠 경우) AI 제안에만 쓰인다.
   */
  const EqualiSignals = {
    behavior: { zoomEvents: 0, rereadScrolls: 0, rageClicks: 0 },
    // 입력 패턴: 글자 내용은 절대 보지 않고 횟수·속도만 센다
    input: { clicks: 0, missClicks: 0, keyNav: 0, shortcutUses: 0, typedChars: 0, backspaces: 0, typingMs: 0, scrollPx: 0, scrollMs: 0, firstActionSec: null },
    targets: new Map(),   // 이 방문에서 누른 버튼·링크의 짧은 이름 → 횟수 (반복 작업 감지용)
    usedFeatures: new Set(),
    startedAt: Date.now(),
    _lastKeyAt: 0, _lastScrollAt: 0, _sent: false,
    onBehavior: null,
    _lastY: 0, _downRun: 0, _upRun: 0, _clicks: [],

    init() {
      const firstAction = () => { if (this.input.firstActionSec === null) this.input.firstActionSec = Math.round((Date.now() - this.startedAt) / 100) / 10; };
      window.addEventListener('keydown', (e) => {
        if (ui.isOwn(e.target)) return;
        firstAction();
        const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
        if (typing && e.target.type !== 'password') {
          const now = Date.now();
          if (e.key === 'Backspace') this.input.backspaces++;
          else if (e.key.length === 1) this.input.typedChars++;
          if (this._lastKeyAt && now - this._lastKeyAt < 2000) this.input.typingMs += now - this._lastKeyAt;
          this._lastKeyAt = now;
        } else if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') {
          this.input.keyNav++;
        } else if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.length === 1) {
          this.input.shortcutUses++;
        }
      }, true);
      document.addEventListener('click', (e) => {
        if (ui.isOwn(e.target) || !e.isTrusted) return;
        firstAction();
        this.input.clicks++;
        const control = e.target.closest && e.target.closest('button, a[href], [role="button"], input[type="submit"], input[type="button"], summary, label');
        if (!control) { this.input.missClicks++; return; }
        if (control.closest('form') && control.closest('form').querySelector('input[type="password"]')) return; // 로그인 양식은 기록하지 않는다
        const label = (control.innerText || control.value || control.getAttribute('aria-label') || control.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        if (!label || /\d{4,}/.test(label)) return; // 이름 없는 것, 번호가 섞인 것은 남기지 않는다
        const cur = this.targets.get(label) || { count: 0, selector: getElementUniqueSelector(control) };
        cur.count++;
        this.targets.set(label, cur);
      }, true);
      const send = () => this.flush();
      window.addEventListener('pagehide', send);
      document.addEventListener('visibilitychange', () => { if (document.hidden) send(); });

      window.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) this.bump('zoomEvents'); }, { passive: true });
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) this.bump('zoomEvents');
      });
      this._lastY = window.scrollY;
      window.addEventListener('scroll', () => {
        const y = window.scrollY;
        const d = y - this._lastY;
        this._lastY = y;
        const nowS = Date.now();
        if (this._lastScrollAt && nowS - this._lastScrollAt < 500) { this.input.scrollPx += Math.abs(d); this.input.scrollMs += nowS - this._lastScrollAt; }
        this._lastScrollAt = nowS;
        if (d > 0) {
          this._downRun += d;
          this._upRun = 0;
        } else if (d < 0) {
          this._upRun -= d;
          // 충분히 읽어 내려간 뒤 의미 있게 되돌아간 경우만 "되읽기"로 본다
          if (this._downRun > 400 && this._upRun > 150) {
            this._downRun = 0;
            this._upRun = 0;
            this.bump('rereadScrolls');
          }
        }
      }, { passive: true });
      document.addEventListener('click', (e) => {
        if (ui.isOwn(e.target)) return;
        const now = Date.now();
        this._clicks = this._clicks.filter(c => now - c.t < 800);
        this._clicks.push({ t: now, x: e.clientX, y: e.clientY });
        const near = this._clicks.filter(c => Math.abs(c.x - e.clientX) < 30 && Math.abs(c.y - e.clientY) < 30);
        if (near.length >= 3) {
          this._clicks = [];
          this.bump('rageClicks');
        }
      }, true);
    },

    environment() {
      const mq = (q) => Boolean(window.matchMedia && window.matchMedia(q).matches);
      return {
        prefersDark: mq('(prefers-color-scheme: dark)'),
        prefersReducedMotion: mq('(prefers-reduced-motion: reduce)'),
        prefersContrast: mq('(prefers-contrast: more)'),
        forcedColors: mq('(forced-colors: active)'),
        coarsePointer: mq('(pointer: coarse)'),
        pageZoom: Math.round((window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : 1) * 100) / 100,
        viewportWidth: window.innerWidth,
        language: navigator.language || ''
      };
    },

    // 방문이 끝날 때(탭을 떠날 때) 한 번, 이번 방문의 관측을 프로필로 보낸다 (구조도 ① 데이터 수집)
    flush() {
      const dwellSec = Math.round((Date.now() - this.startedAt) / 1000);
      if (this._sent && dwellSec - this._sent < 30) return;
      this._sent = dwellSec;
      const i = this.input;
      try {
        chrome.runtime.sendMessage({
          type: 'SESSION_OBSERVATION',
          observation: {
            domain: window.location.hostname,
            pageType: detectPageType(),
            dwellSec,
            sensitive: pageHasPasswordField() || pageHasPaymentField(),
            adapted: state.isAdapted ? { goalTitle: state.goalTitle } :
              (rebuild.isOpen() ? { goalTitle: rebuild.currentGoal() } : null),
            environment: this.environment(),
            signals: this.collect(),
            input: {
              clicks: i.clicks, missClicks: i.missClicks, keyNav: i.keyNav, shortcutUses: i.shortcutUses,
              typedChars: i.typedChars, backspaces: i.backspaces, typingSec: Math.round(i.typingMs / 1000),
              firstActionSec: i.firstActionSec,
              scrollPxPerSec: i.scrollMs > 2000 ? Math.round(i.scrollPx / (i.scrollMs / 1000)) : undefined
            },
            targets: Array.from(this.targets.entries()).map(([label, t]) => ({ label, selector: t.selector, count: t.count })),
            usedFeatures: Array.from(this.usedFeatures)
          }
        });
      } catch (e) {}
    },

    bump(key) {
      this.behavior[key]++;
      if (this.onBehavior) this.onBehavior(key);
    },

    mainTextElement() {
      const landmark = detectSemanticLandmarks().mainArticle;
      let scope = document.body;
      try { if (landmark) scope = document.querySelector(landmark.selector) || document.body; } catch (e) {}
      const ps = Array.from(scope.querySelectorAll('p, li, dd, td')).filter(el => (el.innerText || '').trim().length > 40);
      return ps.find(isUsable) || null;
    },

    collect() {
      const s = { ...this.behavior };
      try {
        const bodyText = (document.body.innerText || '').trim();
        s.textLength = bodyText.length;
        const sentences = bodyText.slice(0, 4000).split(/[.!?。\n]+/).map(x => x.trim()).filter(x => x.length > 8);
        s.avgSentenceLength = sentences.length ? Math.round(sentences.reduce((a, x) => a + x.length, 0) / sentences.length) : 0;

        const textEl = this.mainTextElement();
        if (textEl) {
          const st = window.getComputedStyle(textEl);
          s.fontPx = parseFloat(st.fontSize) || 16;
          const fg = parseRgb(st.color);
          const bg = effectiveBackground(textEl);
          if (fg && bg) s.contrastRatio = Math.round(contrastRatio(fg, bg) * 10) / 10;
          s.lineLengthCh = Math.round(textEl.getBoundingClientRect().width / (s.fontPx * 0.55));
        }

        const video = document.querySelector('video');
        s.hasVideo = Boolean(video || document.querySelector('iframe[src*="youtube"], iframe[src*="vimeo"]'));
        if (video) {
          const tracks = Array.from(video.textTracks || []);
          const ytBtn = document.querySelector('.ytp-subtitles-button');
          s.videoHasCaptions = tracks.some(t => t.mode === 'showing') || (ytBtn ? ytBtn.getAttribute('aria-pressed') === 'true' : false);
        }
        s.distractionCount = document.querySelectorAll('iframe, [class*="banner" i], [class*="ad-" i], .adsbygoogle, aside').length;
      } catch (e) {}
      return s;
    }
  };

  /* ==========================================================================
     3. Specialized Accessibility Feature Modules
     ========================================================================== */

  /**
   * 3.1 EqualiTTSPlayer
   * Visual + Audio Screen Reader for Visually Impaired & Low-Vision Users
   * Reads paragraphs sequentially with yellow highlight guide & floating controls
   * Shortcut: Alt + S
   */
  const EqualiTTSPlayer = {
    active: false,
    speaking: false,
    paused: false,
    currentIndex: 0,
    paragraphs: [],
    utterance: null,
    rate: 1.0,
    barEl: null,

    init() {
      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 's' || e.key === 'S' || e.key === 'ㄴ')) {
          e.preventDefault();
          this.toggle();
        }
      });
    },

    scanReadableElements() {
      const candidates = Array.from(document.querySelectorAll(
        'article p, main p, .post-content p, .article-body p, .content p, h1, h2, h3, p'
      ));
      return candidates.filter(el => {
        const text = (el.innerText || '').trim();
        const style = window.getComputedStyle(el);
        return (
          text.length > 12 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          !el.closest('#equali-root-container') &&
          !el.closest('.equali-plain-summary-card') &&
          !el.closest('.equali-recommendation-toast')
        );
      });
    },

    start() {
      if (!('speechSynthesis' in window)) {
        showToast('이 브라우저는 음성 합성(TTS) 기능을 지원하지 않습니다.');
        return;
      }

      this.paragraphs = this.scanReadableElements();
      if (this.paragraphs.length === 0) {
        showToast('읽을 본문 텍스트를 찾지 못했습니다.');
        return;
      }

      this.active = true;
      this.currentIndex = 0;
      this.renderBar();
      this.speakCurrent();

      EqualiSignals.usedFeatures.add('tts_reader');

      chrome.runtime.sendMessage({
        type: 'RECORD_FEATURE_USAGE',
        featureId: 'tts_reader'
      });
      showToast('🎙️ 본문 읽어주기(TTS)를 시작합니다. (단축키: Alt + S)');
    },

    renderBar() {
      if (this.barEl) this.barEl.remove();
      this.barEl = document.createElement('div');
      this.barEl.className = 'equali-tts-player-bar';
      this.barEl.setAttribute('role', 'toolbar');
      this.barEl.setAttribute('aria-label', '본문 읽어주기');
      this.barEl.innerHTML = getTrustedHtml(`
        <span class="equali-tts-label">읽어주기</span>
        <span id="equali-tts-progress" class="equali-tts-progress">문단 1/${Math.max(1, this.paragraphs.length)}</span>
        <button id="equali-tts-prev" aria-label="이전 문단">◀</button>
        <button id="equali-tts-playpause" class="equali-tts-main" aria-label="재생 또는 일시정지">⏸</button>
        <button id="equali-tts-next" aria-label="다음 문단">▶</button>
        <button id="equali-tts-speed" class="equali-tts-speed-btn" aria-label="읽는 속도">${this.rate.toFixed(1)}x</button>
        <button id="equali-tts-stop" aria-label="읽어주기 끝내기">×</button>
      `);
      ui.append(this.barEl);

      this.barEl.querySelector('#equali-tts-playpause').addEventListener('click', () => this.togglePlayPause());
      this.barEl.querySelector('#equali-tts-prev').addEventListener('click', () => this.prev());
      this.barEl.querySelector('#equali-tts-next').addEventListener('click', () => this.next());
      this.barEl.querySelector('#equali-tts-stop').addEventListener('click', () => this.stop());
      this.barEl.querySelector('#equali-tts-speed').addEventListener('click', () => this.cycleSpeed());
    },

    speakCurrent() {
      window.speechSynthesis.cancel();
      if (!this.active || this.paragraphs.length === 0) return;

      document.querySelectorAll('.equali-tts-reading-highlight').forEach(el => el.classList.remove('equali-tts-reading-highlight'));

      if (this.currentIndex >= this.paragraphs.length) {
        this.stop();
        showToast('✅ 본문 전체 낭독이 완료되었습니다.');
        return;
      }

      const targetEl = this.paragraphs[this.currentIndex];
      targetEl.classList.add('equali-tts-reading-highlight');
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const progressEl = ui.byId('equali-tts-progress');
      if (progressEl) progressEl.textContent = `문단 ${this.currentIndex + 1}/${this.paragraphs.length}`;

      const textToRead = targetEl.innerText.trim();
      this.utterance = utterance(textToRead);
      this.utterance.rate = this.rate;
      this.utterance.lang = document.documentElement.lang || navigator.language || 'ko-KR';

      this.utterance.onend = () => {
        targetEl.classList.remove('equali-tts-reading-highlight');
        if (this.active && !this.paused) {
          this.currentIndex++;
          this.speakCurrent();
        }
      };

      this.utterance.onerror = (e) => {
        console.warn('[EqualiUI TTS] Notice:', e);
        targetEl.classList.remove('equali-tts-reading-highlight');
      };

      this.speaking = true;
      this.paused = false;
      window.speechSynthesis.speak(this.utterance);

      const playBtn = this.barEl ? this.barEl.querySelector('#equali-tts-playpause') : null;
      if (playBtn) playBtn.textContent = '⏸';
    },

    togglePlayPause() {
      if (!this.active) return;
      const playBtn = this.barEl ? this.barEl.querySelector('#equali-tts-playpause') : null;
      if (this.paused) {
        this.paused = false;
        window.speechSynthesis.resume();
        if (playBtn) playBtn.textContent = '⏸';
      } else {
        this.paused = true;
        window.speechSynthesis.pause();
        if (playBtn) playBtn.textContent = '▶';
      }
    },

    prev() {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        this.speakCurrent();
      }
    },

    next() {
      if (this.currentIndex < this.paragraphs.length - 1) {
        this.currentIndex++;
        this.speakCurrent();
      }
    },

    cycleSpeed() {
      const speeds = [1.0, 1.25, 1.5, 2.0, 0.8];
      const idx = speeds.indexOf(this.rate);
      this.rate = speeds[(idx + 1) % speeds.length];
      const speedBtn = this.barEl ? this.barEl.querySelector('#equali-tts-speed') : null;
      if (speedBtn) speedBtn.textContent = `${this.rate.toFixed(1)}x`;
      if (this.speaking && !this.paused) {
        this.speakCurrent();
      }
    },

    stop() {
      this.active = false;
      this.speaking = false;
      this.paused = false;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      document.querySelectorAll('.equali-tts-reading-highlight').forEach(el => el.classList.remove('equali-tts-reading-highlight'));
      if (this.barEl) {
        this.barEl.remove();
        this.barEl = null;
      }
    },

    toggle() {
      if (this.active) {
        this.stop();
        showToast('🎙️ 본문 읽어주기를 종료했습니다.');
      } else {
        this.start();
      }
    }
  };

  /**
   * 3.2 EqualiLiveCaptionsBar
   * Real-time High-Contrast AI Subtitles Overlay for Hearing-Impaired Users
   * Positions over active video elements or screen bottom
   * Shortcut: Alt + C
   */
  const EqualiLiveCaptionsBar = {
    active: false,
    overlayEl: null,
    videoEl: null,
    youtubeCaptionObserver: null,

    init() {
      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'ㅊ')) {
          e.preventDefault();
          this.toggle();
        }
      });
    },

    start({ automatic = false } = {}) {
      this.active = true;
      this.render();
      this.monitorVideos();
      if (!automatic) {
        EqualiSignals.usedFeatures.add('live_captions');
        chrome.runtime.sendMessage({ type: 'RECORD_FEATURE_USAGE', featureId: 'live_captions' });
        showToast('💬 AI 실시간 자막 바를 활성화했습니다. (단축키: Alt + C)');
      }
    },

    render() {
      if (this.overlayEl) this.overlayEl.remove();
      this.overlayEl = document.createElement('div');
      this.overlayEl.className = 'equali-captions-overlay';
      this.overlayEl.setAttribute('role', 'status');
      this.overlayEl.setAttribute('aria-live', 'polite');
      this.overlayEl.innerHTML = getTrustedHtml(`
        <div class="equali-captions-label"><span id="equali-caption-sound" class="equali-caption-sound" hidden></span>자막 (Alt+C 로 끄기)</div>
        <div id="equali-caption-text" class="equali-captions-text">자막 정보를 확인하고 있습니다...</div>
      `);
      ui.append(this.overlayEl);
    },

    monitorVideos() {
      const video = document.querySelector('video');
      this.needsTranscription = false;
      if (!video) {
        this.needsTranscription = true;
        this.updateCaption('이 페이지에서 자막이 있는 영상을 찾지 못했습니다. Re:Cognition 팝업이나 사이드 패널의 "소리를 글자로 바꾸기"로 이 탭의 소리를 자막으로 볼 수 있습니다.');
        return;
      }
      this.videoEl = video;

      // YouTube renders its captions in the player DOM instead of exposing a
      // TextTrack. Mirror only real, visible caption segments into our panel.
      if (location.hostname.endsWith('youtube.com')) {
        this.youtubeCaptionObserver?.disconnect();
        const attachPlayer = () => {
          const player = document.querySelector('.html5-video-player');
          if (!player) return;
          this.youtubeCaptionObserver?.disconnect();
          const readYoutubeCaption = () => {
            const segments = Array.from(player.querySelectorAll('.ytp-caption-segment'));
            const caption = segments.map(node => node.textContent?.trim()).filter(Boolean).join(' ');
            if (caption) this.updateCaption(caption);
          };
          this.youtubeCaptionObserver = new MutationObserver(readYoutubeCaption);
          this.youtubeCaptionObserver.observe(player, { childList: true, characterData: true, subtree: true });
          readYoutubeCaption();
        };
        if (document.querySelector('.html5-video-player')) attachPlayer();
        else {
          this.youtubeCaptionObserver = new MutationObserver(attachPlayer);
          this.youtubeCaptionObserver.observe(document.body, { childList: true, subtree: true });
        }
      }

      const bindTracks = () => {
        const tracks = Array.from(video.textTracks || []).filter(t => t.kind === 'subtitles' || t.kind === 'captions');
        if (tracks.length === 0) return false;
        const lang = (document.documentElement.lang || navigator.language || 'ko').slice(0, 2);
        const track = tracks.find(t => (t.language || '').startsWith(lang)) || tracks[0];
        if (track.mode === 'disabled') track.mode = 'hidden';
        track.oncuechange = () => {
          const cues = Array.from(track.activeCues || []);
          this.updateCaption(cues.map(c => (c.text || '').replace(/<[^>]+>/g, '')).join(' ') || ' ');
        };
        this.updateCaption(`자막 트랙(${track.label || track.language || '기본'})을 크게 표시합니다. 영상을 재생하세요.`);
        return true;
      };

      if (!bindTracks()) {
        // 없는 자막을 있는 것처럼 보여주지 않는다: 사이트 자체 자막을 켜도록 안내
        const ytBtn = document.querySelector('.ytp-subtitles-button');
        if (ytBtn) {
          if (ytBtn.getAttribute('aria-pressed') !== 'true') ytBtn.click();
          this.updateCaption('YouTube 자막을 확인하고 있습니다. 제공되는 자막이 없으면 "소리를 글자로 바꾸기"를 이용해 주세요.');
        } else {
          this.needsTranscription = true;
          this.updateCaption('이 영상에는 자막이 없습니다. Re:Cognition 팝업이나 사이드 패널의 "소리를 글자로 바꾸기"를 누르면 AI가 소리를 자막으로 바꿔 드립니다.');
        }
        if (video.textTracks && video.textTracks.addEventListener) {
          video.textTracks.addEventListener('addtrack', () => bindTracks(), { once: true });
        }
      }
    },

    updateCaption(text) {
      const textEl = ui.byId('equali-caption-text');
      if (textEl && text) {
        textEl.textContent = text;
      }
      if (text) rebuild.onCaptionText(text);
    },

    // 소리 → 글자 변환 결과 (서비스 워커 → CAPTION_EVENT)
    onCaptionEvent(ev) {
      rebuild.onCaptionEvent(ev);
      if (!this.active) { this.active = true; this.render(); }
      if (ev.kind === 'text') this.updateCaption(ev.text);
      else if (ev.kind === 'state') { this.transcribing = true; this.updateCaption('소리를 듣고 있습니다. 말소리가 나오면 글자로 보여드립니다.'); }
      else if (ev.kind === 'error') this.updateCaption(`소리를 글자로 바꾸지 못했습니다: ${ev.error}`);
      else if (ev.kind === 'sound') {
        const dot = ui.byId('equali-caption-sound');
        if (dot) { dot.hidden = false; dot.dataset.active = String(Boolean(ev.active)); dot.textContent = ev.active ? '소리 나는 중 · ' : '조용함 · '; }
      }
    },

    stop() {
      this.active = false;
      this.youtubeCaptionObserver?.disconnect();
      this.youtubeCaptionObserver = null;
      if (this.transcribing) {
        this.transcribing = false;
        try { chrome.runtime.sendMessage({ type: 'STOP_TRANSCRIPTION' }); } catch (e) {}
      }
      if (this.overlayEl) {
        this.overlayEl.remove();
        this.overlayEl = null;
      }
    },

    toggle() {
      if (this.active) {
        this.stop();
        showToast('💬 실시간 자막 바를 종료했습니다.');
      } else {
        this.start();
      }
    }
  };

  /**
   * 3.3 EqualiPlainLanguageHelper
   * Modern AI-powered single-paragraph summary with glassmorphism card
   */
  const EqualiPlainLanguageHelper = {
    active: false,
    cardEl: null,

    start() {
      this.active = true;
      this.renderLoadingCard();
      this.fetchAISummary();
      EqualiSignals.usedFeatures.add('plain_summary');
      chrome.runtime.sendMessage({
        type: 'RECORD_FEATURE_USAGE',
        featureId: 'plain_summary'
      });
    },

    renderLoadingCard() {
      if (this.cardEl) this.cardEl.remove();

      this.cardEl = document.createElement('div');
      this.cardEl.className = 'equali-summary-card-modern';
      this.cardEl.setAttribute('role', 'region');
      this.cardEl.setAttribute('aria-label', '쉬운 요약');
      this.cardEl.innerHTML = getTrustedHtml(`
        <div class="equali-summary-header-modern">
          <span>쉬운 요약</span>
          <button id="equali-summary-close" class="eq-ghost" aria-label="요약 닫기">×</button>
        </div>
        <div class="equali-summary-body-modern" id="equali-summary-body" aria-live="polite">
          <div class="equali-summary-loading">
            <div class="equali-summary-spinner" aria-hidden="true"></div>
            <span>페이지를 읽고 있습니다...</span>
          </div>
        </div>
      `);

      ui.append(this.cardEl);
      this.cardEl.querySelector('#equali-summary-close').addEventListener('click', () => this.stop());
    },

    async fetchAISummary() {
      const paragraphs = Array.from(document.querySelectorAll('article p, main p, .content p, p'))
        .map(p => p.innerText.trim())
        .filter(t => t.length > 20);
      const text = paragraphs.slice(0, 20).join('\n');

      if (text.length < 50) {
        this.updateCard('이 페이지에는 요약할 만한 본문 텍스트가 충분하지 않습니다.');
        return;
      }

      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'GENERATE_SUMMARY',
            text: text,
            pageTitle: document.title
          }, resolve);
        });

        if (res && res.success && res.summary) {
          this.updateCard(res.summary, res.source);
        } else {
          this.updateCard('요약을 생성하지 못했습니다.');
        }
      } catch (e) {
        this.updateCard('요약 생성 중 오류가 발생했습니다.');
      }
    },

    updateCard(summaryText, source) {
      const body = ui.byId('equali-summary-body');
      if (!body) return;

      const sourceLabel = source === 'ai' ? 'AI 생성 · 원문과 다를 수 있어요' : '본문에서 추출';
      body.innerHTML = getTrustedHtml(`
        <p class="equali-summary-text">${escapeHtml(summaryText)}</p>
        <div class="equali-summary-meta">
          <span>${sourceLabel}</span>
          <button id="equali-summary-tts" class="eq-btn">듣기</button>
        </div>
      `);

      const ttsBtn = body.querySelector('#equali-summary-tts');
      if (ttsBtn) {
        ttsBtn.addEventListener('click', () => {
          const utt = utterance(summaryText);
          utt.lang = 'ko-KR';
          window.speechSynthesis.speak(utt);
        });
      }
    },

    stop() {
      this.active = false;
      if (this.cardEl) {
        this.cardEl.remove();
        this.cardEl = null;
      }
    },

    toggle() {
      if (this.active) {
        this.stop();
        showToast('✨ AI 요약 카드를 닫았습니다.');
      } else {
        this.start();
      }
    }
  };

  /**
   * 3.4 EqualiRecommendationBanner — 자발적 맥락 인터페이스 제안
   *  - 측정된 페이지/행동 신호에 근거가 있을 때만 제안하고, "왜 제안하는지"를 항상 함께 보여준다.
   *  - 적용 / 닫기 / 무시 / 다시 추천 안 함 결과를 페이지 유형별로 학습한다 (REC_OUTCOME).
   *  - 어려움 신호가 뚜렷하면 AI 가 이 페이지 전용 맞춤 제안을 만든다. 적용은 항상 검토 단계를 거친다.
   */
  const EqualiRecommendationBanner = {
    toastEl: null,
    shownCount: 0,
    aiTried: false,
    _timer: null,
    _recheck: null,

    activeFeatures() {
      const list = [];
      if (EqualiTTSPlayer.active) list.push('tts_reader');
      if (EqualiLiveCaptionsBar.active) list.push('live_captions');
      if (EqualiPlainLanguageHelper.active) list.push('plain_summary');
      if (state.rulerActive) list.push('dyslexic_ruler');
      if (document.body.classList.contains('equali-theme-dark-contrast')) list.push('high_contrast');
      if (document.body.classList.contains('equali-font-extra-large')) list.push('large_font');
      return list;
    },

    context() {
      return { domain: window.location.hostname, pageType: detectPageType() };
    },

    report(featureId, outcome) {
      try {
        chrome.runtime.sendMessage({ type: 'REC_OUTCOME', featureId, outcome, ...this.context() });
      } catch (e) {}
    },

    async check(trigger = 'load') {
      if (this.toastEl || state.pendingReview || this.shownCount >= 2 || rebuild.isOpen()) return;
      if (trigger === 'load' && this.shownCount >= 1) return;
      try {
        const signals = EqualiSignals.collect();
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'GET_FEATURE_RECOMMENDATIONS',
            signals,
            pageContext: this.context(),
            activeFeatures: this.activeFeatures()
          }, resolve);
        });

        if (res && res.success && res.recommendations && res.recommendations.length > 0) {
          this.showFeature(res.recommendations[0]);
        } else if (trigger === 'behavior' && !this.aiTried) {
          this.aiTried = true;
          const ai = await new Promise(resolve => {
            chrome.runtime.sendMessage({
              type: 'SUGGEST_CONTEXTUAL_UI',
              signals,
              pageSummary: { ...this.context(), title: document.title, headings: Array.from(document.querySelectorAll('h1, h2')).map(h => h.innerText.trim()).filter(Boolean).slice(0, 5) }
            }, resolve);
          });
          if (ai && ai.suggestions && ai.suggestions.length > 0 && !this.toastEl) this.showAiSuggestion(ai.suggestions[0]);
        }
      } catch (e) {
        // Ignored if runtime not ready
      }
    },

    // 행동 신호(확대, 되읽기, 연타)가 생기면 잠시 뒤 다시 판단한다
    onBehavior() {
      clearTimeout(this._recheck);
      this._recheck = setTimeout(() => this.check('behavior'), 1500);
    },

    buildShell(title, desc, reasons, opts = {}) {
      clearTimeout(this._timer);
      if (this.toastEl) this.toastEl.remove();
      const el = document.createElement('div');
      el.className = 'equali-recommendation-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.innerHTML = getTrustedHtml(`
        <div class="equali-rec-title">
          <span>${escapeHtml(plainLabel(title))}</span>
          <button class="equali-rec-close" aria-label="제안 닫기">×</button>
        </div>
        <div class="equali-rec-desc">${escapeHtml(desc)}</div>
        ${reasons.length ? `<ul class="equali-rec-reasons">${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        <div class="equali-rec-actions"></div>
        <button class="equali-rec-snooze">오늘은 제안하지 않기</button>
      `);
      el.querySelector('.equali-rec-snooze').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'SNOOZE_RECOMMENDATIONS', hours: 24 });
        this.shownCount = 99;
        showToast('오늘은 더 이상 제안하지 않을게요.');
        this.dismiss();
      });
      if (opts.snooze === false) el.querySelector('.equali-rec-snooze').remove();
      speakIfAudioFirst(`${plainLabel(title)}. ${desc || ''} ${(reasons || []).join(', ')}`);
      ui.append(el);
      this.toastEl = el;
      if (opts.count !== false) this.shownCount++;
      return el;
    },

    armAutoDismiss(onIgnored) {
      const arm = () => {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => {
          if (this.toastEl) {
            onIgnored();
            this.dismiss();
          }
        }, 25000);
      };
      arm();
      // 읽고 있는 동안에는 사라지지 않게 한다
      this.toastEl.addEventListener('mouseenter', () => clearTimeout(this._timer));
      this.toastEl.addEventListener('focusin', () => clearTimeout(this._timer));
      this.toastEl.addEventListener('mouseleave', arm);
    },

    showFeature(feature) {
      const el = this.buildShell(feature.title, feature.desc, feature.reasons || []);
      const actions = el.querySelector('.equali-rec-actions');
      actions.innerHTML = getTrustedHtml(`
        <button class="btn-rec-apply">지금 적용</button>
        <div class="equali-rlhf-group">
          <button class="btn-rlhf-subtle" data-act="dislike">별로예요</button>
          <button class="btn-rlhf-subtle exclude" data-act="exclude">다시 추천 안 함</button>
        </div>
      `);
      this.report(feature.id, 'shown');

      actions.querySelector('.btn-rec-apply').addEventListener('click', () => {
        this.triggerFeature(feature.id);
        this.report(feature.id, 'accepted');
        this.dismiss();
      });
      actions.querySelector('[data-act="dislike"]').addEventListener('click', () => {
        this.report(feature.id, 'disliked');
        showToast(`'${plainLabel(feature.title)}' 추천을 줄일게요.`);
        this.dismiss();
      });
      actions.querySelector('[data-act="exclude"]').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'DISLIKE_AND_EXCLUDE_FEATURE', featureId: feature.id });
        showToast(`'${plainLabel(feature.title)}' 기능은 다시 추천하지 않습니다.`);
        this.dismiss();
      });
      el.querySelector('.equali-rec-close').addEventListener('click', () => {
        this.report(feature.id, 'dismissed');
        this.dismiss();
      });
      this.armAutoDismiss(() => this.report(feature.id, 'ignored'));
    },

    showAiSuggestion(sug) {
      const el = this.buildShell(`맞춤 제안: ${sug.title}`, 'AI가 이 페이지에 맞춰 만든 제안입니다. 적용 전에 내용을 직접 확인하고 승인하실 수 있어요.', sug.reason ? [sug.reason] : []);
      const actions = el.querySelector('.equali-rec-actions');
      actions.innerHTML = getTrustedHtml(`
        <button class="btn-rec-apply">제안 살펴보기</button>
        <button class="btn-rlhf-subtle" data-act="no">괜찮아요</button>
      `);
      actions.querySelector('.btn-rec-apply').addEventListener('click', () => {
        this.dismiss();
        requestProposalAndReview(sug.instruction);
      });
      actions.querySelector('[data-act="no"]').addEventListener('click', () => this.dismiss());
      el.querySelector('.equali-rec-close').addEventListener('click', () => this.dismiss());
      this.armAutoDismiss(() => {});
    },

    triggerFeature(featureId) {
      EqualiSignals.usedFeatures.add(featureId);
      if (featureId === 'tts_reader') {
        EqualiTTSPlayer.start();
      } else if (featureId === 'live_captions') {
        EqualiLiveCaptionsBar.start();
      } else if (featureId === 'plain_summary') {
        EqualiPlainLanguageHelper.start();
      } else if (featureId === 'dyslexic_ruler') {
        state.rulerActive = true;
        if (readingRuler) readingRuler.style.display = 'block';
        document.body.classList.add('equali-font-dyslexic');
        showToast('📖 난독증 보조 시선 룰러 활성화');
      } else if (featureId === 'high_contrast') {
        document.body.classList.add('equali-theme-dark-contrast');
        showToast('🌙 고대비 다크모드 적용');
      } else if (featureId === 'large_font') {
        document.body.classList.add('equali-font-extra-large');
        showToast('🔤 큰 글자 모드 적용');
      } else if (featureId === 'rain_ambient') {
        requestProposalAndReview('비 내리는 감성 배경 적용해줘');
      }
      if (['dyslexic_ruler', 'high_contrast', 'large_font'].includes(featureId)) {
        chrome.runtime.sendMessage({ type: 'RECORD_FEATURE_USAGE', featureId });
        state.isAdapted = true;
        updateBadgeStatus(true, '접근성 기능 적용중');
      }
    },

    dismiss() {
      clearTimeout(this._timer);
      const el = this.toastEl;
      this.toastEl = null;
      if (el) {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.25s ease';
        setTimeout(() => el.remove(), 250);
      }
    }
  };

  /**
   * 3.5 EqualiVisualEditor (Figma-style In-Page Editor)
   */
  const EqualiVisualEditor = {
    active: false,
    hoverEl: null,
    selectedEl: null,
    panelEl: null,
    generatedRules: {},
    generatedDom: [],
    generatedJs: {},

    start() {
      if (this.active) return;
      this.active = true;
      document.body.classList.add('equali-visual-editor-active');

      if (state.currentInjectedDom && state.currentInjectedDom.length > 0) {
        this.generatedDom = [...state.currentInjectedDom];
      }

      this.bindEvents();
      this.renderPanel();
      showToast('🎨 웹 페이지 커스텀 모드 활성화 (Figma 스타일)');
    },

    stop() {
      if (!this.active) return;
      this.active = false;
      document.body.classList.remove('equali-visual-editor-active');
      this.unbindEvents();
      if (this._dragEl && this._currentDragHandler) {
        this._dragEl.removeEventListener('mousedown', this._currentDragHandler);
        this._dragEl.style.cursor = '';
      }
      if (this.panelEl) {
        this.panelEl.remove();
        this.panelEl = null;
      }
      this.clearHighlights();
      this.selectedEl = null;
    },

    toggle() {
      if (this.active) this.stop();
      else this.start();
    },

    bindEvents() {
      this._onMouseOver = this.onMouseOver.bind(this);
      this._onMouseOut = this.onMouseOut.bind(this);
      this._onClick = this.onClick.bind(this);

      document.addEventListener('mouseover', this._onMouseOver, true);
      document.addEventListener('mouseout', this._onMouseOut, true);
      document.addEventListener('click', this._onClick, true);
    },

    unbindEvents() {
      document.removeEventListener('mouseover', this._onMouseOver, true);
      document.removeEventListener('mouseout', this._onMouseOut, true);
      document.removeEventListener('click', this._onClick, true);
    },

    isIgnoredElement(el) {
      if (!el || el === document.body || el === document.documentElement) return true;
      if (ui.isOwn(el)) return true;
      if (el.tagName === 'IFRAME' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return true;
      return false;
    },

    onMouseOver(e) {
      if (this.isIgnoredElement(e.target)) return;
      if (this.hoverEl && this.hoverEl !== this.selectedEl) {
        this.hoverEl.classList.remove('equali-editor-hover');
      }
      this.hoverEl = e.target;
      if (this.hoverEl !== this.selectedEl) {
        this.hoverEl.classList.add('equali-editor-hover');
      }
    },

    onMouseOut(e) {
      if (this.hoverEl && this.hoverEl !== this.selectedEl) {
        this.hoverEl.classList.remove('equali-editor-hover');
      }
      this.hoverEl = null;
    },

    onClick(e) {
      if (this.isIgnoredElement(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      this.clearHighlights();
      this.selectedEl = e.target;
      this.selectedEl.classList.add('equali-editor-selected');
      
      this.updatePanelForSelected();
    },

    clearHighlights() {
      if (this.selectedEl) this.selectedEl.classList.remove('equali-editor-selected');
      if (this.hoverEl) this.hoverEl.classList.remove('equali-editor-hover');
    },

    getUniqueSelector(el) {
      return getElementUniqueSelector(el);
    },

    renderPanel() {
      if (this.panelEl) return;
      this.panelEl = document.createElement('div');
      this.panelEl.className = 'equali-visual-editor-panel';
      this.panelEl.setAttribute('role', 'region');
      this.panelEl.setAttribute('aria-label', '캔버스 에디터');
      this.panelEl.innerHTML = getTrustedHtml(`
        <div class="equali-ve-header">
          <span>캔버스 에디터</span>
          <button id="equali-ve-close" aria-label="캔버스 에디터 닫기">×</button>
        </div>
        <div class="equali-ve-body">
          <div class="equali-ve-empty" id="equali-ve-empty">바꿀 요소를 페이지에서 눌러 선택하세요.</div>
          <div class="equali-ve-controls" id="equali-ve-controls" style="display:none;">
            <div class="equali-ve-sel" id="equali-ve-sel-info">선택: ---</div>

            <div class="equali-ve-section">모양</div>
            <div class="equali-ve-row"><label for="equali-ve-bg">배경색</label><input type="color" id="equali-ve-bg" /></div>
            <div class="equali-ve-row"><label for="equali-ve-color">글자색</label><input type="color" id="equali-ve-color" /></div>
            <div class="equali-ve-row">
              <label for="equali-ve-fontsize">글자 크기</label>
              <input type="range" id="equali-ve-fontsize" min="8" max="48" value="16" />
              <span class="equali-ve-val" id="equali-ve-fontsize-val">16px</span>
            </div>
            <div class="equali-ve-row">
              <label for="equali-ve-bgimg">배경 이미지 주소</label>
              <button id="equali-ve-bgimg-search-btn" class="equali-ve-mini">이미지 검색</button>
            </div>
            <input type="text" id="equali-ve-bgimg" class="equali-ve-field" placeholder="https://..." />

            <div class="equali-ve-section">배치</div>
            <div class="equali-ve-row">
              <label for="equali-ve-padding">안쪽 여백</label>
              <input type="range" id="equali-ve-padding" min="0" max="60" value="0" />
              <span class="equali-ve-val" id="equali-ve-padding-val">0px</span>
            </div>
            <div class="equali-ve-row">
              <label for="equali-ve-radius">모서리 둥글기</label>
              <input type="range" id="equali-ve-radius" min="0" max="50" value="0" />
              <span class="equali-ve-val" id="equali-ve-radius-val">0px</span>
            </div>
            <div class="equali-ve-row"><label for="equali-ve-hide">숨기기</label><input type="checkbox" id="equali-ve-hide" /></div>

            <div class="equali-ve-section">조작</div>
            <div class="equali-ve-btns">
              <button id="equali-ve-drag-mode">끌어서 이동</button>
              <button id="equali-ve-duplicate">복제</button>
              <button id="equali-ve-delete" class="equali-ve-danger">숨기기</button>
            </div>

            <div id="equali-ve-text-editor" style="display:none;">
              <div class="equali-ve-section">글 내용</div>
              <textarea id="equali-ve-text-input" class="equali-ve-field" rows="2" aria-label="글 내용 수정"></textarea>
            </div>

            <div id="equali-ve-img-editor" style="display:none;">
              <div class="equali-ve-row">
                <label for="equali-ve-img-input">이미지 주소</label>
                <button id="equali-ve-img-search-btn" class="equali-ve-mini">이미지 검색</button>
              </div>
              <input type="text" id="equali-ve-img-input" class="equali-ve-field" />
            </div>

            <div id="equali-ve-logic-editor">
              <div class="equali-ve-section">동작 추가 (정해진 동작에서 골라 연결합니다)</div>
              <input type="text" id="equali-ve-logic-prompt" class="equali-ve-field" aria-label="추가할 동작 설명" placeholder="이 요소를 누르면... (예: 맨 위로 이동, 학사일정 페이지로 이동, https://... 로 이동)" />
              <div class="equali-ve-btns"><button id="equali-ve-logic-btn">동작 만들기</button></div>
              <div id="equali-ve-logic-status" class="equali-ve-status" style="display:none;" role="status"></div>
            </div>

            <div class="equali-ve-section">요소 추가</div>
            <div class="equali-ve-btns">
              <button id="equali-ve-add-text">글상자</button>
              <button id="equali-ve-add-btn">버튼</button>
              <button id="equali-ve-add-img">이미지</button>
            </div>
          </div>
        </div>
        <div class="equali-ve-footer">
          <button id="equali-ve-save" class="equali-btn-primary">디자인 저장</button>
        </div>
      `);
      ui.append(this.panelEl);

      this.panelEl.querySelector('#equali-ve-close').addEventListener('click', () => this.stop());
      
      const bgInput = this.panelEl.querySelector('#equali-ve-bg');
      const colorInput = this.panelEl.querySelector('#equali-ve-color');
      const fontsizeInput = this.panelEl.querySelector('#equali-ve-fontsize');
      const fontsizeVal = this.panelEl.querySelector('#equali-ve-fontsize-val');
      const bgImgInput = this.panelEl.querySelector('#equali-ve-bgimg');
      const paddingInput = this.panelEl.querySelector('#equali-ve-padding');
      const paddingVal = this.panelEl.querySelector('#equali-ve-padding-val');
      const radiusInput = this.panelEl.querySelector('#equali-ve-radius');
      const radiusVal = this.panelEl.querySelector('#equali-ve-radius-val');
      const hideInput = this.panelEl.querySelector('#equali-ve-hide');

      const applyChange = () => {
        if (!this.selectedEl) return;
        const selector = this.getUniqueSelector(this.selectedEl);
        if (!this.generatedRules[selector]) this.generatedRules[selector] = {};
        
        if (bgInput.value && bgInput.value !== '#000000') {
          this.selectedEl.style.backgroundColor = bgInput.value;
          this.generatedRules[selector].backgroundColor = bgInput.value;
        }
        if (colorInput.value && colorInput.value !== '#000000') {
          this.selectedEl.style.color = colorInput.value;
          this.generatedRules[selector].color = colorInput.value;
        }
        const fs = fontsizeInput.value + 'px';
        fontsizeVal.textContent = fs;
        this.selectedEl.style.fontSize = fs;
        this.generatedRules[selector].fontSize = fs;

        const pd = paddingInput.value + 'px';
        paddingVal.textContent = pd;
        this.selectedEl.style.padding = pd;
        this.generatedRules[selector].padding = pd;

        const rd = radiusInput.value + 'px';
        radiusVal.textContent = rd;
        this.selectedEl.style.borderRadius = rd;
        this.generatedRules[selector].borderRadius = rd;

        if (hideInput.checked) {
          this.selectedEl.style.display = 'none';
          this.generatedRules[selector].display = 'none';
        } else if (this.selectedEl.style.display === 'none') {
          this.selectedEl.style.display = '';
          delete this.generatedRules[selector].display;
        }
      };

      bgInput.addEventListener('input', applyChange);
      colorInput.addEventListener('input', applyChange);
      fontsizeInput.addEventListener('input', applyChange);
      paddingInput.addEventListener('input', applyChange);
      radiusInput.addEventListener('input', applyChange);
      hideInput.addEventListener('change', applyChange);

      bgImgInput.addEventListener('change', () => {
        if (!this.selectedEl) return;
        const url = bgImgInput.value.trim();
        if (url) {
          this.selectedEl.style.backgroundImage = `url("${url}")`;
          this.selectedEl.style.backgroundSize = 'cover';
          this.selectedEl.style.backgroundPosition = 'center';
          const selector = this.getUniqueSelector(this.selectedEl);
          if (!this.generatedRules[selector]) this.generatedRules[selector] = {};
          this.generatedRules[selector].backgroundImage = `url("${url}")`;
          this.generatedRules[selector].backgroundSize = 'cover';
          this.generatedRules[selector].backgroundPosition = 'center';
        }
      });

      const bgImgSearchBtn = this.panelEl.querySelector('#equali-ve-bgimg-search-btn');
      if (bgImgSearchBtn) {
        bgImgSearchBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.openImageSearchModal(bgImgInput, (pickedUrl) => {
            if (!this.selectedEl) return;
            this.selectedEl.style.backgroundImage = `url("${pickedUrl}")`;
            this.selectedEl.style.backgroundSize = 'cover';
            this.selectedEl.style.backgroundPosition = 'center';
            const selector = this.getUniqueSelector(this.selectedEl);
            if (!this.generatedRules[selector]) this.generatedRules[selector] = {};
            this.generatedRules[selector].backgroundImage = `url("${pickedUrl}")`;
            this.generatedRules[selector].backgroundSize = 'cover';
            this.generatedRules[selector].backgroundPosition = 'center';
            showToast('배경 이미지가 적용되었습니다! ✨');
          });
        });
      }

      const txtInput = this.panelEl.querySelector('#equali-ve-text-input');
      const imgInput = this.panelEl.querySelector('#equali-ve-img-input');

      const imgSearchBtn = this.panelEl.querySelector('#equali-ve-img-search-btn');
      if (imgSearchBtn) {
        imgSearchBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.openImageSearchModal(imgInput, (pickedUrl) => {
            if (!this.selectedEl) return;
            if (this.selectedEl.tagName === 'IMG') {
              this.selectedEl.src = pickedUrl;
              const selector = this.getUniqueSelector(this.selectedEl);
              this.generatedDom.push({ parentSelector: selector, src: pickedUrl, isModify: true });
            } else {
              this.selectedEl.style.backgroundImage = `url("${pickedUrl}")`;
              this.selectedEl.style.backgroundSize = 'cover';
              const selector = this.getUniqueSelector(this.selectedEl);
              if (!this.generatedRules[selector]) this.generatedRules[selector] = {};
              this.generatedRules[selector].backgroundImage = `url("${pickedUrl}")`;
            }
            showToast('이미지가 변경되었습니다! ✨');
          });
        });
      }
      const logicPrompt = this.panelEl.querySelector('#equali-ve-logic-prompt');
      const logicBtn = this.panelEl.querySelector('#equali-ve-logic-btn');
      const logicStatus = this.panelEl.querySelector('#equali-ve-logic-status');

      txtInput.addEventListener('change', () => {
        if (!this.selectedEl) return;
        this.selectedEl.textContent = txtInput.value;
        const selector = this.getUniqueSelector(this.selectedEl);
        // Track DOM changes (replace entire element html roughly)
        this.generatedDom.push({ parentSelector: selector, textContent: txtInput.value, isModify: true });
      });

      imgInput.addEventListener('change', () => {
        if (!this.selectedEl || this.selectedEl.tagName !== 'IMG') return;
        this.selectedEl.src = imgInput.value;
        const selector = this.getUniqueSelector(this.selectedEl);
        this.generatedDom.push({ parentSelector: selector, src: imgInput.value, isModify: true });
      });

      logicPrompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); logicBtn.click(); } });
      logicBtn.addEventListener('click', () => {
        if (!this.selectedEl) {
          showToast('요소를 먼저 선택하세요.');
          return;
        }
        const instruction = logicPrompt.value.trim();
        if (!instruction) return;
        
        logicBtn.disabled = true;
        logicStatus.style.display = 'block';
        logicStatus.textContent = '동작을 만들고 있습니다...';

        const selector = this.getUniqueSelector(this.selectedEl);
        const localContext = extractLocalFocusSubtree(this.selectedEl);
        const primaryPalette = extractPrimaryColorPalette();
        
        const target = this.selectedEl;
        const finish = (text, toast) => { logicBtn.disabled = false; logicStatus.textContent = text; if (toast) showToast(toast); setTimeout(() => { logicStatus.style.display = 'none'; }, 9000); };
        // "○○ 페이지로 이동"을 말로 지정할 수 있도록 지금 페이지의 링크를 함께 보낸다 (AI 는 이 목록의 주소나 사용자가 적은 주소만 쓸 수 있다)
        const pageLinks = [];
        const seenHref = new Set();
        for (const a of document.querySelectorAll('a[href]')) {
          if (pageLinks.length >= 60) break;
          if (ui.isOwn(a) || !/^https?:/i.test(a.href) || seenHref.has(a.href)) continue;
          const text = (a.innerText || a.textContent || a.getAttribute('aria-label') || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 40);
          if (!text) continue;
          seenHref.add(a.href);
          pageLinks.push({ text, href: a.href });
        }
        chrome.runtime.sendMessage({
          type: 'GENERATE_ELEMENT_ACTION',
          instruction, selector, tag: target.tagName,
          localContext, pageTitle: document.title, pageUrl: location.href, pageLinks
        }, (res) => {
          if (chrome.runtime.lastError || !res) return finish('확장 프로그램과 연결하지 못했습니다. 확장과 이 페이지를 새로고침한 뒤 다시 시도해 주세요.');
          if (/Unknown message/i.test(res.error || '')) return finish('확장 프로그램이 예전 상태입니다. 확장 프로그램 관리 화면에서 새로고침(↻)한 뒤 이 페이지도 새로고침해 주세요.');
          if (!res.success) return finish(res.error || '동작을 만들지 못했습니다.', res.unsupported ? '이 요청은 정해진 동작으로 만들 수 없습니다.' : '동작을 만들지 못했습니다.');
          // 같은 요소에 다시 만들면 앞의 동작을 갈아 끼운다 (겹쳐 쌓이지 않게)
          if (target.__equaliActionAbort) target.__equaliActionAbort.abort();
          const own = new AbortController();
          elementActionAbort.signal.addEventListener('abort', () => own.abort(), { once: true });
          target.__equaliActionAbort = own;
          const saved = elementActionAbort; elementActionAbort = own;
          const ok = bindElementAction(target, res.spec);
          elementActionAbort = saved;
          if (!ok) return finish('동작을 연결하지 못했습니다.');
          this.generatedJs[selector] = res.code;
          target.__equali_bound_js__ = true;
          logicPrompt.value = '';
          finish(`연결했습니다: ${res.description}${(res.notes || []).length ? ' · ' + res.notes.join(' ') : ''}`, '동작을 연결했습니다. 지금 바로 눌러서 확인해 보세요. "디자인 저장"을 누르면 다음에도 유지됩니다.');
        });
      });

      // Drag Move
      this.panelEl.querySelector('#equali-ve-drag-mode').addEventListener('click', () => {
        if (!this.selectedEl) {
          showToast('이동할 요소를 먼저 클릭하여 선택하세요.');
          return;
        }
        this.selectedEl.style.position = 'relative';
        this.selectedEl.style.cursor = 'move';
        showToast('드래그 이동 모드: 선택 요소를 원하는 위치로 드래그하세요.');
        
        let startX, startY, origX, origY;
        const onDown = (e) => {
          if (!this.selectedEl || !this.selectedEl.contains(e.target)) return;
          e.preventDefault();
          startX = e.clientX; 
          startY = e.clientY;
          origX = parseInt(this.selectedEl.style.left || 0, 10);
          origY = parseInt(this.selectedEl.style.top || 0, 10);

          const onMove = (e2) => {
            const newLeft = (origX + e2.clientX - startX) + 'px';
            const newTop = (origY + e2.clientY - startY) + 'px';
            this.selectedEl.style.left = newLeft;
            this.selectedEl.style.top = newTop;
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const selector = this.getUniqueSelector(this.selectedEl);
            if (!this.generatedRules[selector]) this.generatedRules[selector] = {};
            this.generatedRules[selector].position = 'relative';
            this.generatedRules[selector].left = this.selectedEl.style.left;
            this.generatedRules[selector].top = this.selectedEl.style.top;
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        };

        if (this._dragEl && this._currentDragHandler) {
          this._dragEl.removeEventListener('mousedown', this._currentDragHandler);
        }
        this._dragEl = this.selectedEl;
        this._currentDragHandler = onDown;
        this.selectedEl.addEventListener('mousedown', onDown);
      });

      // Duplicate
      this.panelEl.querySelector('#equali-ve-duplicate').addEventListener('click', () => {
        if (!this.selectedEl) return;
        const clone = this.selectedEl.cloneNode(true);
        clone.id = '';
        clone.style.opacity = '0.8';
        this.selectedEl.parentNode.insertBefore(clone, this.selectedEl.nextSibling);
        showToast('요소가 복제되었습니다.');
      });

      // Delete (hide)
      this.panelEl.querySelector('#equali-ve-delete').addEventListener('click', () => {
        if (!this.selectedEl) return;
        this.selectedEl.style.display = 'none';
        const selector = this.getUniqueSelector(this.selectedEl);
        if (!this.generatedRules[selector]) this.generatedRules[selector] = {};
        this.generatedRules[selector].display = 'none';
        this.clearHighlights();
        this.selectedEl = null;
        showToast('요소가 삭제(숨김)되었습니다.');
      });

      const generateId = () => 'equali-inj-' + Math.random().toString(36).substring(2, 9);

      this.panelEl.querySelector('#equali-ve-add-text').addEventListener('click', () => {
        if (!this.selectedEl) return;
        const id = generateId();
        const html = `<div id="${id}" class="equali-injected-element" style="padding:10px; margin:10px 0; border:1px dashed #94A3B8; background:rgba(255,255,255,0.8); color:#0F172A;" contenteditable="true">이곳에 텍스트를 입력하세요.</div>`;
        this.selectedEl.insertAdjacentHTML('beforeend', getTrustedHtml(html));
        this.generatedDom.push({ parentSelector: this.getUniqueSelector(this.selectedEl), html });
        showToast('텍스트 상자 추가됨');
      });

      this.panelEl.querySelector('#equali-ve-add-btn').addEventListener('click', () => {
        if (!this.selectedEl) return;
        const id = generateId();
        const html = `<button id="${id}" class="equali-injected-element" style="padding:8px 16px; margin:10px 0; background:#3B82F6; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">새 버튼</button>`;
        this.selectedEl.insertAdjacentHTML('beforeend', getTrustedHtml(html));
        this.generatedDom.push({ parentSelector: this.getUniqueSelector(this.selectedEl), html });
        showToast('버튼 추가됨');
      });

      this.panelEl.querySelector('#equali-ve-add-img').addEventListener('click', () => {
        if (!this.selectedEl) return;
        const id = generateId();
        const html = `<img id="${id}" class="equali-injected-element" src="https://via.placeholder.com/150" style="margin:10px 0; max-width:100%; border-radius:8px;" alt="추가된 이미지" />`;
        this.selectedEl.insertAdjacentHTML('beforeend', getTrustedHtml(html));
        this.generatedDom.push({ parentSelector: this.getUniqueSelector(this.selectedEl), html });
        showToast('이미지 추가됨');
      });

      this.panelEl.querySelector('#equali-ve-save').addEventListener('click', () => {
        this.saveDesign();
      });
    },

    updatePanelForSelected() {
      if (!this.panelEl || !this.selectedEl) return;
      this.panelEl.querySelector('#equali-ve-empty').style.display = 'none';
      this.panelEl.querySelector('#equali-ve-controls').style.display = 'block';
      
      const style = window.getComputedStyle(this.selectedEl);
      const tag = this.selectedEl.tagName.toLowerCase();
      const id = this.selectedEl.id ? `#${this.selectedEl.id}` : '';
      const cls = this.selectedEl.className && typeof this.selectedEl.className === 'string'
        ? '.' + this.selectedEl.className.trim().split(/\s+/).filter(c => !c.startsWith('equali-')).slice(0, 2).join('.')
        : '';
      this.panelEl.querySelector('#equali-ve-sel-info').textContent = `선택: <${tag}${id}${cls}>`;
      
      const rgbToHex = (rgb) => {
        if (!rgb || !rgb.includes('rgb')) return '#000000';
        try {
          let a = rgb.split("(")[1].split(")")[0].split(",");
          let b = a.map(x => {
            x = parseInt(x).toString(16);
            return (x.length==1) ? "0"+x : x;
          });
          return "#" + b.slice(0,3).join("");
        } catch(e) { return '#000000'; }
      };
      
      try {
        this.panelEl.querySelector('#equali-ve-bg').value = rgbToHex(style.backgroundColor);
        this.panelEl.querySelector('#equali-ve-color').value = rgbToHex(style.color);
      } catch(e) {}
      
      const fontSize = parseInt(style.fontSize) || 16;
      this.panelEl.querySelector('#equali-ve-fontsize').value = fontSize;
      this.panelEl.querySelector('#equali-ve-fontsize-val').textContent = fontSize + 'px';

      const padding = parseInt(style.paddingTop) || 0;
      this.panelEl.querySelector('#equali-ve-padding').value = padding;
      this.panelEl.querySelector('#equali-ve-padding-val').textContent = padding + 'px';

      const radius = parseInt(style.borderTopLeftRadius) || 0;
      this.panelEl.querySelector('#equali-ve-radius').value = radius;
      this.panelEl.querySelector('#equali-ve-radius-val').textContent = radius + 'px';

      this.panelEl.querySelector('#equali-ve-hide').checked = (style.display === 'none');
      this.panelEl.querySelector('#equali-ve-bgimg').value = '';

      // Reset specific editors
      const txtDiv = this.panelEl.querySelector('#equali-ve-text-editor');
      const imgDiv = this.panelEl.querySelector('#equali-ve-img-editor');
      const logicPrompt = this.panelEl.querySelector('#equali-ve-logic-prompt');
      txtDiv.style.display = 'none';
      imgDiv.style.display = 'none';
      logicPrompt.value = '';

      if (tag === 'img') {
        imgDiv.style.display = 'block';
        this.panelEl.querySelector('#equali-ve-img-input').value = this.selectedEl.src || '';
      } else {
        // Only allow text editing if it has no child elements (just text nodes)
        if (this.selectedEl.childElementCount === 0 && this.selectedEl.textContent.trim().length > 0) {
          txtDiv.style.display = 'block';
          this.panelEl.querySelector('#equali-ve-text-input').value = this.selectedEl.textContent.trim();
        }
      }
    },

    openImageSearchModal(targetInput, onSelect) {
      let modal = ui.byId('equali-ve-img-modal');
      if (modal) modal.remove();

      modal = document.createElement('div');
      modal.id = 'equali-ve-img-modal';
      modal.className = 'equali-ve-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-label', '이미지 검색');
      modal.innerHTML = getTrustedHtml(`
        <div class="equali-ve-modal-head">
          <span>이미지 검색</span>
          <button id="equali-ve-modal-close" class="eq-ghost" aria-label="이미지 검색 닫기">×</button>
        </div>
        <div class="equali-direct-row">
          <input type="text" id="equali-ve-modal-kw" aria-label="이미지 검색어" placeholder="검색어 (예: 밤하늘, 숲)" />
          <button id="equali-ve-modal-search" class="eq-btn">검색</button>
        </div>
        <div class="equali-rv-chips" style="margin-top:0.6em;">
          <button class="equali-ve-preset-chip" data-kw="rain">비</button>
          <button class="equali-ve-preset-chip" data-kw="night">밤하늘</button>
          <button class="equali-ve-preset-chip" data-kw="nature">숲</button>
          <button class="equali-ve-preset-chip" data-kw="ocean">바다</button>
          <button class="equali-ve-preset-chip" data-kw="cafe">카페</button>
        </div>
        <div id="equali-ve-modal-results" class="equali-ve-modal-grid">
          <div class="equali-ve-note">키워드를 입력하고 검색하세요.</div>
        </div>
      `);
      ui.append(modal);

      modal.querySelector('#equali-ve-modal-close').addEventListener('click', () => {
        modal.remove();
      });

      const resultsBox = modal.querySelector('#equali-ve-modal-results');
      const kwInput = modal.querySelector('#equali-ve-modal-kw');
      const searchBtn = modal.querySelector('#equali-ve-modal-search');

      const doSearch = (query) => {
        if (!query) return;
        resultsBox.innerHTML = getTrustedHtml('<div class="equali-ve-note" role="status">검색 중...</div>');
        chrome.runtime.sendMessage({ type: 'SEARCH_IMAGES', query }, (res) => {
          const items = res?.results || [];
          if (items.length === 0) {
            resultsBox.innerHTML = getTrustedHtml('<div class="equali-ve-note" role="status">검색 결과가 없습니다.</div>');
            return;
          }
          resultsBox.innerHTML = getTrustedHtml(items.map(img => `
            <button class="equali-ve-res-item" data-url="${escapeHtml(img.url)}" aria-label="${escapeHtml(img.title)} 선택">
              <img src="${escapeHtml(img.previewUrl || img.url)}" alt="" />
              <span>${escapeHtml(img.title)}</span>
            </button>
          `).join(''));

          resultsBox.querySelectorAll('.equali-ve-res-item').forEach(it => {
            it.addEventListener('click', () => {
              const pickedUrl = it.dataset.url;
              if (targetInput) targetInput.value = pickedUrl;
              if (onSelect) onSelect(pickedUrl);
              modal.remove();
            });
          });
        });
      };

      searchBtn.onclick = () => doSearch(kwInput.value.trim());
      kwInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSearch(kwInput.value.trim());
        }
      };

      modal.querySelectorAll('.equali-ve-preset-chip').forEach(chip => {
        chip.onclick = () => {
          kwInput.value = chip.dataset.kw;
          doSearch(chip.dataset.kw);
        };
      });

      kwInput.focus();
    },

    consolidateDomElements() {
      const elements = [];
      const injectedNodes = document.querySelectorAll('.equali-injected-element');

      injectedNodes.forEach(node => {
        if (node.tagName === 'EQUALI-PART' || node.tagName === 'STYLE') return; // 부품은 components 로 따로 저장된다
        const id = node.id;
        const parent = node.parentElement;
        if (!parent || ui.isOwn(parent)) return;

        const parentSelector = this.getUniqueSelector(parent);
        const clone = node.cloneNode(true);
        clone.classList.remove('equali-editor-selected', 'equali-editor-hover');
        if (node.style.cssText) {
          clone.style.cssText = node.style.cssText;
        }

        elements.push({
          id: id,
          parentSelector: parentSelector,
          html: clone.outerHTML
        });
      });

      // Preserve existing element content modifications
      this.generatedDom.forEach(item => {
        if (item.isModify) {
          elements.push(item);
        }
      });

      return elements;
    },

    saveDesign() {
      const finalDom = this.consolidateDomElements();
      const hasRules = Object.keys(this.generatedRules).length > 0;
      const hasDom = finalDom.length > 0;
      const hasJs = Object.keys(this.generatedJs).length > 0;

      if (!hasRules && !hasDom && !hasJs) {
        showToast('저장할 변경사항이나 추가된 요소가 없습니다.');
        return;
      }
      
      let cssText = '';
      if (hasRules) {
        cssText = '/* EqualiUI Visual Custom Design */\n';
        for (const [selector, rules] of Object.entries(this.generatedRules)) {
          cssText += `${selector} {\n`;
          for (const [prop, val] of Object.entries(rules)) {
            const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
            cssText += `  ${cssProp}: ${val} !important;\n`;
          }
          cssText += `}\n`;
        }
      }
      
      const domain = window.location.hostname || 'local-page';

      chrome.runtime.sendMessage({
        type: 'SAVE_VISUAL_DESIGN',
        domain: domain,
        css: cssText,
        domElements: finalDom,
        js: this.generatedJs,
        title: '사용자 시각적 맞춤 디자인 및 로직'
      }, () => {
        showToast('✅ 시각적 디자인 및 요소가 저장되어 새로고침 후에도 유지됩니다.');
        injectDynamicCss(cssText, '시각적 에디터 맞춤 디자인', finalDom, this.generatedJs);
        this.stop();
      });
    }
  };

  /* ==========================================================================
     4. In-Page HITL Interface (Floating Badge & Prompt Modal)
     ========================================================================== */

  let rootContainer = null;
  let floatingBadge = null;
  let modalBackdrop = null;
  let inpageRecognition = null;
  let readingRuler = null;

  function initHITLInterface() {
    if (ui.byId('equali-root-container')) return;

    rootContainer = document.createElement('div');
    rootContainer.id = 'equali-root-container';

    // Reading Ruler
    readingRuler = document.createElement('div');
    readingRuler.id = 'equali-reading-ruler';
    ui.append(readingRuler);

    // Floating Badge
    floatingBadge = document.createElement('div');
    floatingBadge.className = 'equali-floating-badge';
    floatingBadge.innerHTML = getTrustedHtml(`
      <span class="equali-badge-icon" aria-hidden="true"></span>
      <span class="equali-badge-text">Re:Cognition</span>
      <span class="equali-badge-pill" id="equali-badge-status">· 대기 중</span>
    `);
    floatingBadge.setAttribute('role', 'button');
    floatingBadge.tabIndex = 0;
    floatingBadge.setAttribute('aria-label', 'Re:Cognition 맞춤 요청 열기');
    floatingBadge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleReviewModal(); }
    });
    floatingBadge.title = 'Re:Cognition 에이전트 맞춤 요청 열기';
    floatingBadge.addEventListener('click', toggleReviewModal);

    // In-Page Direct Prompt Modal
    modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'equali-modal-backdrop';
    modalBackdrop.innerHTML = getTrustedHtml(`
      <div class="equali-review-card" role="dialog" aria-modal="true" aria-label="Re:Cognition 맞춤 요청 및 검토">
        <div class="equali-modal-header">
          <div class="equali-header-title">
            <span>Re:Cognition</span>
            <span class="equali-safety-tag">승인 전에는 아무것도 바뀌지 않습니다</span>
          </div>
          <button class="equali-close-btn" id="equali-modal-close" aria-label="닫기">×</button>
        </div>

        <div class="equali-modal-body">
          <!-- Human-in-the-Loop Review Panel -->
          <div id="equali-review-panel" aria-live="polite"></div>

          <section class="equali-persona" aria-labelledby="equali-persona-title">
            <div class="equali-direct-label" id="equali-persona-title">누구를 위한 화면인가요?</div>
            <div class="equali-direct-sub" id="equali-persona-desc">고르신 방식에 따라 Re:Cognition이 페이지를 다루는 방법 전체가 달라집니다.</div>
            <div class="equali-persona-list" id="equali-persona-list" role="group" aria-label="페르소나 고르기"></div>
            <div class="equali-quick-row">
              <button id="equali-rebuild-open" class="equali-btn-primary">이 페이지를 새 화면으로 다시 구성</button>
            </div>
          </section>

          <div class="equali-direct-input-box">
            <div class="equali-direct-header">
              <div class="equali-direct-label">무엇을 바꿔 드릴까요?</div>
              <div class="equali-direct-sub">변경안은 안전 검사 후 보여드리고, 승인하신 뒤에만 적용합니다.</div>
            </div>
            <div class="equali-direct-row">
              <input type="text" id="equali-inpage-input" aria-label="에이전트에게 요청하기" placeholder="예: 본문 글씨 크게, 사이드바 숨겨줘" />
              <button type="button" id="equali-inpage-voice-btn" aria-label="음성으로 요청 입력" aria-pressed="false">말로 입력</button>
              <button id="equali-inpage-send-btn">요청</button>
            </div>
            <p id="equali-inpage-voice-status" class="equali-direct-sub" role="status" aria-live="polite" hidden></p>
            <div class="equali-inpage-chips" role="group" aria-label="추천 요청">
              <button class="equali-in-chip" data-cmd="본문 글씨를 130%로 크게 키워줘">글자 크게</button>
              <button class="equali-in-chip" data-cmd="눈부심 방지 고대비 다크모드로 바꿔줘">눈이 편한 어두운 화면</button>
              <button class="equali-in-chip" data-cmd="어지러운 광고와 사이드바 가려줘">광고·사이드바 정리</button>
              <button class="equali-in-chip" data-cmd="이 페이지를 쉬운 말로 설명하는 안내 카드와 어려운 낱말 풀이를 추가해줘">이 페이지 쉽게 설명</button>
            </div>
          </div>

          <div class="equali-quick-row" role="group" aria-label="바로 켜기">
            <button id="equali-quick-describe" class="equali-in-chip">화면 설명 듣기</button>
            <button id="equali-quick-tts" class="equali-in-chip">읽어주기</button>
            <button id="equali-quick-caps" class="equali-in-chip">자막 크게</button>
            <button id="equali-quick-plain" class="equali-in-chip">쉬운 요약</button>
            <button id="equali-quick-figma" class="equali-in-chip" hidden>캔버스 에디터</button>
          </div>

          <div class="equali-summary-box">
            <div class="equali-summary-title" id="equali-patch-title">현재 페이지 상태</div>
            <div class="equali-summary-desc" id="equali-patch-desc">아직 적용된 변경이 없습니다.</div>
          </div>

          <div id="equali-code-preview" style="display: none;">
            <div class="equali-code-label">적용된 CSS</div>
            <pre></pre>
          </div>
        </div>

        <div class="equali-modal-footer">
          <button class="equali-btn-revert" id="equali-btn-revert-all" title="단축키: Alt + Z">원래대로 복구</button>
          <button class="equali-btn-primary" id="equali-btn-close-modal">닫기</button>
        </div>
      </div>
    `);

    rootContainer.appendChild(floatingBadge);
    rootContainer.appendChild(modalBackdrop);
    ui.append(rootContainer);

    // 커서가 실제 EqualiUI 조작 요소 위에 있을 때만 그 기능을 읽는다.
    let hoveredControl = null;
    ui.layer.addEventListener('pointerover', (e) => {
      if (ui.layer.dataset.speak !== 'on' || EqualiTTSPlayer.active || e.target.closest('.equali-rb')) return;
      const target = e.target.closest('button, [role="button"], input:not([type="password"]), textarea, select');
      if (!target || target === hoveredControl || target.disabled || target.dataset.noSpeak !== undefined) return;
      hoveredControl = target;
      const label = (target.getAttribute('aria-label') || target.title || target.textContent || target.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 100);
      if (label && 'speechSynthesis' in window) { window.speechSynthesis.cancel(); speakIfAudioFirst(label); }
    });
    ui.layer.addEventListener('pointerout', (e) => {
      if (!hoveredControl || !hoveredControl.contains(e.target) || (e.relatedTarget && hoveredControl.contains(e.relatedTarget))) return;
      hoveredControl = null;
    });

    // Submodule event inits
    EqualiTTSPlayer.init();
    EqualiLiveCaptionsBar.init();

    // Event Bindings
    modalBackdrop.querySelector('#equali-modal-close').addEventListener('click', closeReviewModal);
    modalBackdrop.querySelector('#equali-btn-close-modal').addEventListener('click', closeReviewModal);
    modalBackdrop.querySelector('#equali-btn-revert-all').addEventListener('click', () => {
      revertAllChanges({ emergency: true });
      showToast('모든 동적 맞춤 코드가 제거되고 원본 상태로 복원되었습니다.');
      closeReviewModal();
    });

    modalBackdrop.querySelector('#equali-rebuild-open').addEventListener('click', () => {
      closeReviewModal();
      rebuild.open(state.persona || EqualiPersona.get('none'), { manual: true });
    });

    modalBackdrop.querySelector('#equali-quick-describe').addEventListener('click', () => {
      closeReviewModal();
      describePageAloud();
    });

    modalBackdrop.querySelector('#equali-quick-tts').addEventListener('click', () => {
      closeReviewModal();
      EqualiTTSPlayer.toggle();
    });

    modalBackdrop.querySelector('#equali-quick-caps').addEventListener('click', () => {
      closeReviewModal();
      EqualiLiveCaptionsBar.toggle();
    });

    modalBackdrop.querySelector('#equali-quick-plain').addEventListener('click', () => {
      closeReviewModal();
      EqualiPlainLanguageHelper.toggle();
    });

    const figmaChip = modalBackdrop.querySelector('#equali-quick-figma');
    figmaChip.addEventListener('click', () => {
      closeReviewModal();
      EqualiVisualEditor.toggle();
    });
    // 설정에서 켠 경우에만 보인다 (기본은 숨김)
    const syncCanvasChip = () => chrome.storage.local.get('canvasEditorEnabled').then(data => { figmaChip.hidden = !data.canvasEditorEnabled; }).catch(() => {});
    syncCanvasChip();
    try { chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.canvasEditorEnabled) syncCanvasChip(); }); } catch (e) {}

    const inpageInput = modalBackdrop.querySelector('#equali-inpage-input');
    const inpageVoiceBtn = modalBackdrop.querySelector('#equali-inpage-voice-btn');
    const inpageVoiceStatus = modalBackdrop.querySelector('#equali-inpage-voice-status');
    const inpageSendBtn = modalBackdrop.querySelector('#equali-inpage-send-btn');
    const inpageChips = modalBackdrop.querySelectorAll('.equali-in-chip[data-cmd]');

    function showApiKeyInlinePrompt() {
      const summaryBox = modalBackdrop.querySelector('.equali-summary-box');
      if (!summaryBox) return;
      summaryBox.innerHTML = getTrustedHtml(`
        <div class="equali-summary-title">API 키가 없습니다</div>
        <div class="equali-summary-desc">확장 폴더의 .env 에 AI_API_KEY 를 넣고 node scripts/load-env.js 를 실행한 뒤, 확장을 새로고침해 주세요.</div>
      `);
    }

    async function handleInpageRequest(text) {
      if (!text || !text.trim()) return;
      if (inpageRecognition) { inpageRecognition.abort(); inpageRecognition = null; }
      inpageSendBtn.textContent = '...';
      inpageSendBtn.disabled = true;
      try {
        const res = await requestProposalAndReview(text);
        if (res && res.needsApiKey) showApiKeyInlinePrompt();
      } finally {
        inpageSendBtn.textContent = '요청';
        inpageSendBtn.disabled = false;
        inpageInput.value = '';
      }
    }

    inpageSendBtn.addEventListener('click', () => handleInpageRequest(inpageInput.value));
    inpageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleInpageRequest(inpageInput.value);
    });

    inpageVoiceBtn.addEventListener('click', () => {
      if (inpageRecognition) { inpageRecognition.stop(); return; }
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { inpageVoiceStatus.hidden = false; inpageVoiceStatus.textContent = '이 브라우저는 음성 입력을 지원하지 않습니다.'; return; }
      const rec = new Recognition();
      const prefix = inpageInput.value.trim();
      inpageRecognition = rec;
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.continuous = false;
      inpageVoiceBtn.setAttribute('aria-pressed', 'true');
      inpageVoiceBtn.textContent = '듣기 중지';
      inpageVoiceStatus.hidden = false;
      inpageVoiceStatus.textContent = '듣는 중입니다. 내용을 확인한 뒤 요청 버튼을 누르세요.';
      rec.onresult = (ev) => {
        const spoken = Array.from(ev.results).map(result => result[0].transcript).join(' ').trim();
        inpageInput.value = [prefix, spoken].filter(Boolean).join(' ');
      };
      rec.onerror = (ev) => { inpageVoiceStatus.textContent = ev.error === 'not-allowed' ? '마이크 사용이 허용되지 않았습니다.' : '음성을 알아듣지 못했습니다. 다시 시도해 주세요.'; };
      rec.onend = () => { if (inpageRecognition === rec) { inpageRecognition = null; inpageVoiceBtn.setAttribute('aria-pressed', 'false'); inpageVoiceBtn.textContent = '말로 입력'; } };
      try { rec.start(); } catch (e) { rec.onend(); inpageVoiceStatus.textContent = '음성 입력을 시작하지 못했습니다.'; }
    });

    inpageChips.forEach(chip => {
      chip.addEventListener('click', () => handleInpageRequest(chip.dataset.cmd));
    });

    // Mouse tracker for Reading Ruler
    window.addEventListener('mousemove', (e) => {
      if (state.rulerActive && readingRuler) {
        readingRuler.style.top = `${e.clientY}px`;
      }
    });

    // 화면 구조 듣기 (Alt + D)
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'd' || e.key === 'D' || e.key === 'ㅇ')) {
        e.preventDefault();
        describePageAloud();
      }
    });

    // Global Emergency Revert Shortcut (Alt + Z)
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'ㅋ')) {
        e.preventDefault();
        rebuild.close(true);
        revertAllChanges({ emergency: true });
        closeReviewModal();
        showToast('긴급 복구 단축키(Alt+Z): 원래 화면으로 복원했고, 이 사이트의 자동 적용을 껐습니다.');
      }
    });
  }

  /* --------------------------------------------------------------------------
     Human-in-the-Loop: 요청 → 제안 생성 → 검토 카드 → 승인/거절
     -------------------------------------------------------------------------- */

  async function requestProposalAndReview(text, chain = {}) {
    const instruction = (text || '').trim();
    if (!instruction) return null;
    initHITLInterface();
    showToast('에이전트가 변경안을 만들고 안전 검사를 하고 있습니다...');
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'DIRECT_INSTRUCTION',
          instruction,
          pageData: extractRichPageDomSnapshot(),
          conversationHistory: state.sessionConversationHistory || [],
          altDepth: chain.altDepth || 0,
          prevAltKind: chain.prevAltKind || null,
          cssOnly: Boolean(chain.cssOnly)
        }, resolve);
      });

      if (res && res.success && res.proposal) {
        if (res.proposal.isRevert) {
          revertAllChanges();
          showToast('↩ 원래 웹페이지 상태로 복원 완료');
        } else {
          showProposalReview(res.proposal, res.audit, { autoApprovable: res.autoApprovable, instruction, candidates: res.candidates || [], ...chain });
        }
      } else if (!(res && res.needsApiKey)) {
        showToast(`⚠️ ${res?.error || '요청 처리에 실패했습니다.'}`);
      }
      return res;
    } catch (err) {
      showToast('오류 발생: ' + err.message);
      return null;
    }
  }

  const RISK_LABELS = {
    low: { text: '위험 낮음 · 모양만 바뀝니다', cls: 'low' },
    medium: { text: '확인 필요', cls: 'medium' },
    high: { text: '주의 · 기능이 달라질 수 있습니다', cls: 'high' }
  };
  const SEVERITY_ICONS = { block: '차단됨', high: '주의', medium: '확인', info: '' };
  const REJECT_REASONS = ['원한 것과 달라요', '변화가 너무 커요', '기능이 바뀌거나 위험해 보여요', '보기 불편해요'];

  const METRIC_ROWS = [
    ['fontPx', '본문 글자 크기', (v) => `${Math.round(v)}px`],
    ['contrast', '글자·배경 대비', (v) => `${v}:1`],
    ['lineHeightRatio', '줄 간격', (v) => `${v}배`],
    ['visibleDistractions', '광고·사이드바 등', (v) => `${v}개`],
    ['smallTargets', '누르기 어려운 작은 버튼', (v) => `${v}개`],
    ['underlinedLinks', '밑줄로 구분되는 링크', (v) => `${v}개`],
    ['outlinedButtons', '테두리로 구분되는 버튼', (v) => `${v}개`]
  ];

  // 구조도 ②: 여러 후보 중 왜 이 안을 골랐는지, 입히면 실제로 무엇이 얼마나 바뀌는지를 숫자로 보여준다
  function selectionHtml(current, candidates) {
    if (!current) return '';
    let html = '';
    const m = current.metrics;
    if (m && m.before && m.after) {
      const rows = METRIC_ROWS.filter(([k]) => m.before[k] !== undefined && m.after[k] !== undefined && m.before[k] !== m.after[k])
        .map(([k, label, fmt]) => `<li><strong>${label}</strong><span>${fmt(m.before[k])} → ${fmt(m.after[k])}</span></li>`);
      if (rows.length) html += `<div class="equali-rv-findings-title">이 페이지에서 측정한 변화</div><ul class="equali-rv-findings equali-rv-metrics">${rows.join('')}</ul>`;
    }
    if (candidates.length > 1 && current.score) {
      const rank = candidates.findIndex(c => c.proposal.id === current.proposal.id) + 1;
      const reasons = (current.score.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
      const problems = rank > 1 ? (current.score.problems || []).map(r => `<li>${escapeHtml(r)}</li>`).join('') : '';
      html += `
        <div class="equali-rv-select">
          <div class="equali-rv-findings-title">후보 ${candidates.length}개 중 ${rank === 1 ? '가장 알맞다고 판단한 안' : `${rank}번째 안`} · ${escapeHtml(current.strategyText || '')} (${Math.round(current.score.total)}점)</div>
          ${reasons || problems ? `<ul class="equali-rv-changes">${reasons}${problems}</ul>` : ''}
        </div>`;
    }
    return html;
  }

  function describeChanges(proposal) {
    const parts = [];
    const ruleCount = (proposal.generatedCss.match(/\{/g) || []).length;
    if (ruleCount) parts.push(`모양(CSS) 규칙 ${ruleCount}개`);
    const added = proposal.generatedDom.filter(d => !d.isModify).length;
    const modified = proposal.generatedDom.length - added;
    if (added) parts.push(`새 요소 ${added}개 추가`);
    if (modified) parts.push(`기존 문구/이미지 ${modified}곳 변경`);
    const jsCount = Object.keys(proposal.generatedJs).length;
    if (jsCount) parts.push(`동작 스크립트 ${jsCount}개 (선택)`);
    for (const c of proposal.components || []) {
      const def = (typeof EqualiSafety !== 'undefined' && EqualiSafety.COMPONENT_CATALOG[c.type]) || { name: c.type };
      const title = c.props && (c.props.title || c.props.label);
      parts.push(`부품 추가: ${def.name}${title ? ` — "${title}"` : ''}`);
    }
    return parts;
  }

  function showProposalReview(proposal, audit, options = {}) {
    initHITLInterface();
    const panel = ui.byId('equali-review-panel');
    if (!panel) return;
    audit = audit || { riskLevel: 'medium', findings: [] };
    const candidates = options.candidates || [];
    const current = candidates.find(c => c.proposal.id === proposal.id) || null;
    state.pendingReview = { proposal, audit, candidates, instruction: options.instruction || '', altDepth: options.altDepth || 0, prevAltKind: options.prevAltKind || null };
    clearTimeout(state.timers.abandon);

    // 사용자가 "저위험 자동 적용"을 켠 경우: 즉시 적용하되 항상 실행 취소를 제공한다
    if (options.autoApprovable) {
      resolveReview('approve', { silent: true }).then(() => {
        showToast(`적용했습니다: ${proposal.goalTitle}`, { label: '실행 취소', onClick: () => revertAllChanges({ emergency: true }) });
      });
      return;
    }

    const risk = RISK_LABELS[audit.riskLevel] || RISK_LABELS.medium;
    const jsCount = Object.keys(proposal.generatedJs).length;
    const findings = (audit.findings || []).filter(f => f.severity !== 'info');
    const needsAck = audit.riskLevel === 'high';

    // 후보 버튼: 누르면 그 후보가 바로 페이지에 입혀진다. 마지막 선택(승인 · 이번만 · 거절)은 사용자가 한다.
    const candidateButtons = candidates.length > 1 ? `
        <div class="equali-rv-candidates" role="group" aria-label="후보 고르기 (누르면 바로 페이지에 보여 줍니다)">
          ${candidates.map((c, i) => `<button class="equali-rv-cand" data-candidate="${i}" aria-pressed="${c.proposal.id === proposal.id}">
            <span>${i + 1}. ${escapeHtml(({ minimal: '조금만', balanced: '고르게', structural: '도움 더하기' })[c.proposal.strategy] || `${i + 1}번째 안`)}</span>${c.score ? `<small>${Math.round(c.score.total)}점</small>` : ''}
          </button>`).join('')}
        </div>` : '';
    const detailsHtml = `
          <ul class="equali-rv-changes">${describeChanges(proposal).map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
          ${selectionHtml(current, candidates)}
          ${(audit.notes || []).map(n => `<div class="equali-rv-note">${escapeHtml(n)}</div>`).join('')}
          ${audit.repaired ? '<div class="equali-rv-note">실제 페이지에서 측정한 문제를 에이전트가 한 차례 스스로 수정했습니다.</div>' : ''}
          ${findings.length ? `
          <div class="equali-rv-findings-title">안전 검사 결과</div>
          <ul class="equali-rv-findings">${findings.map(f => `<li class="equali-rv-f-${f.severity}"><strong>${SEVERITY_ICONS[f.severity] || ''}</strong><span>${escapeHtml(f.message)}</span></li>`).join('')}</ul>` : '<div class="equali-rv-note">안전 검사에서 발견된 문제가 없습니다.</div>'}
          ${jsCount ? `
          <label class="equali-rv-check"><input type="checkbox" id="equali-rv-js" /> 동작 스크립트 ${jsCount}개도 허용합니다 (기본: 허용 안 함 · 미리보기에서는 실행하지 않습니다)</label>` : ''}
          <details class="equali-rv-code"><summary>코드 보기 ›</summary><pre id="equali-rv-pre"></pre></details>`;

    panel.innerHTML = getTrustedHtml(audit.isEmpty ? `
      <div class="equali-rv-card equali-rv-${risk.cls}">
        <div class="equali-rv-head"><span class="equali-rv-title">적용 전 검토</span><span class="equali-rv-risk equali-rv-risk-${risk.cls}">${risk.text}</span></div>
        <div class="equali-rv-goal">${escapeHtml(proposal.goalTitle)}</div>
        <div class="equali-rv-empty">안전 검사를 통과한 변경 내용이 없어 적용할 것이 없습니다. 요청을 바꿔 다시 시도해 주세요.</div>
        <pre id="equali-rv-pre" hidden></pre>
        <div class="equali-rv-actions"><button class="equali-rv-btn" data-act="close">닫기</button></div>
      </div>` : `
      <div class="equali-rv-card equali-rv-${risk.cls}">
        <div class="equali-rv-head">
          <span class="equali-rv-live" role="status">지금 페이지에 입혀서 보여 드리는 중입니다 · 아직 저장되지 않았습니다</span>
          <span class="equali-rv-risk equali-rv-risk-${risk.cls}">${risk.text}</span>
        </div>
        <div class="equali-rv-goal">${escapeHtml(proposal.goalTitle)}</div>
        <div class="equali-rv-summary">${escapeHtml(proposal.summary || proposal.reasoning || '')}</div>
        ${candidateButtons}
        ${needsAck ? '<label class="equali-rv-check equali-rv-ack"><input type="checkbox" id="equali-rv-ack" /> 아래 "자세히"의 주의 사항을 확인했습니다</label>' : ''}
        <div class="equali-rv-actions">
          <button class="equali-rv-btn equali-rv-approve" data-act="approve" style="flex-basis:100%">이 안으로 승인 · 이 사이트에 항상 적용</button>
          <button class="equali-rv-btn" data-act="once">이번만 적용</button>
          <button class="equali-rv-btn" data-act="compare" aria-pressed="false">원래 화면과 비교</button>
          <button class="equali-rv-btn equali-rv-reject" data-act="reject">거절</button>
        </div>
        <div class="equali-rv-reject-box" hidden>
          <div class="equali-rv-findings-title">거절 이유를 알려주시면 다음부터 같은 제안을 피합니다</div>
          <div class="equali-rv-chips">${REJECT_REASONS.map(r => `<button class="equali-rv-chip" data-reason="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')}</div>
          <div class="equali-direct-row"><input type="text" id="equali-rv-reason" aria-label="거절 이유 직접 입력" placeholder="직접 입력 (선택)" /><button class="equali-rv-btn" data-act="reject-send">보내기</button></div>
        </div>
        <details class="equali-rv-more" ${needsAck ? 'open' : ''}>
          <summary>자세히 (바뀌는 내용 · 안전 검사 · 코드) · <button class="equali-rv-btn" data-act="speak" style="margin-left:0.6em;min-height:36px;">설명 듣기</button></summary>
          <div class="equali-rv-more-body">${detailsHtml}</div>
        </details>
      </div>
    `);

    // 승인 전이지만 "적용된 모습 그대로" 바로 보여 준다 (저장하지 않으며, 다른 후보로 넘기거나 거절하면 사라진다)
    if (!audit.isEmpty) {
      applyLivePreview(proposal);
      modalBackdrop.classList.add('equali-previewing');
    } else {
      clearPreview();
      modalBackdrop.classList.remove('equali-previewing');
    }

    panel.querySelector('#equali-rv-pre').textContent = [
      proposal.generatedCss && `/* CSS */\n${proposal.generatedCss}`,
      proposal.generatedDom.length && `/* 추가·변경 요소 */\n${JSON.stringify(proposal.generatedDom, null, 2)}`,
      (proposal.components || []).length && `/* 부품 (종류·글자·위치만 AI 가 정하고, 모양과 동작은 Re:Cognition 이 그립니다) */\n${JSON.stringify(proposal.components, null, 2)}`,
      jsCount && `/* 동작 스크립트 */\n${Object.entries(proposal.generatedJs).map(([k, v]) => `// ${k}\n${v}`).join('\n\n')}`
    ].filter(Boolean).join('\n\n');

    const approveBtns = panel.querySelectorAll('[data-act="approve"], [data-act="once"]');
    const ack = panel.querySelector('#equali-rv-ack');
    if (ack) {
      approveBtns.forEach(b => (b.disabled = true));
      ack.addEventListener('change', () => approveBtns.forEach(b => (b.disabled = !ack.checked)));
    }

    // 패널은 재사용되므로 이전 검토의 리스너를 끊고 새로 건다
    if (state.reviewAbort) state.reviewAbort.abort();
    const reviewAbort = (state.reviewAbort = new AbortController());

    panel.addEventListener('click', (e) => {
      const cand = e.target.closest('[data-candidate]');
      if (cand) {
        const next = candidates[+cand.dataset.candidate];
        if (next && next.proposal.id !== proposal.id) {
          showProposalReview(next.proposal, next.audit, { ...options, autoApprovable: false });
        }
        return;
      }
      const btn = e.target.closest('[data-act], [data-reason]');
      if (!btn) return;
      if (btn.dataset.act === 'speak') e.preventDefault(); // <summary> 안의 버튼: 접기·펼치기가 함께 일어나지 않게
      const includeJs = Boolean(panel.querySelector('#equali-rv-js')?.checked);
      if (btn.dataset.reason) return resolveReview('reject', { reason: btn.dataset.reason });
      switch (btn.dataset.act) {
        case 'compare': {
          // 누르고 있는 동안이 아니라 켜고 끄는 방식: 손 떨림이 있어도 쓸 수 있게
          const showingOriginal = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(showingOriginal));
          btn.textContent = showingOriginal ? '제안한 화면으로 돌아가기' : '원래 화면과 비교';
          if (showingOriginal) clearPreview(); else applyLivePreview(proposal);
          const live = panel.querySelector('.equali-rv-live');
          if (live) live.textContent = showingOriginal ? '지금은 원래 화면입니다 · 비교가 끝나면 다시 눌러 주세요' : '지금 페이지에 입혀서 보여 드리는 중입니다 · 아직 저장되지 않았습니다';
          break;
        }
        case 'speak': {
          if (!('speechSynthesis' in window)) break;
          window.speechSynthesis.cancel();
          const text = [`제안: ${proposal.goalTitle}.`, proposal.summary || '', `위험도: ${risk.text}.`, ...findings.map(f => f.message)].join(' ');
          const utt = utterance(text);
          utt.lang = 'ko-KR';
          window.speechSynthesis.speak(utt);
          break;
        }
        case 'approve': resolveReview('approve', { includeJs }); break;
        case 'once': resolveReview('approve_once', { includeJs }); break;
        case 'reject': {
          const box = panel.querySelector('.equali-rv-reject-box');
          box.hidden = false;
          box.querySelector('input').focus();
          break;
        }
        case 'reject-send': resolveReview('reject', { reason: panel.querySelector('#equali-rv-reason').value.trim() }); break;
        case 'simpler': resolveReview('reject', { signal: 'hesitation' }); break;
        case 'next-candidate': {
          const idx = candidates.findIndex(c => c.proposal.id === proposal.id);
          const next = candidates[(idx + 1) % candidates.length];
          clearPreview();
          showProposalReview(next.proposal, next.audit, { ...options, autoApprovable: false });
          break;
        }
        case 'close': resolveReview('reject', { reason: '안전 검사 후 적용할 내용이 없음', silent: true }); break;
      }
    }, { signal: reviewAbort.signal });

    // 망설임 감지: 검토 카드를 오래 두고 결정하지 못하면, 재촉하지 않고 더 쉬운 선택지를 곁에 놓아 준다
    clearTimeout(state.timers.hesitation);
    if (!audit.isEmpty) {
      state.timers.hesitation = setTimeout(() => {
        const card = panel.querySelector('.equali-rv-card');
        if (!card || !state.pendingReview || state.pendingReview.proposal.id !== proposal.id || card.querySelector('.equali-rv-hesitate')) return;
        const box = document.createElement('div');
        box.className = 'equali-rv-hesitate';
        box.setAttribute('role', 'status');
        box.innerHTML = getTrustedHtml(`
          <div class="equali-rv-findings-title">결정하기 어려우신가요? 천천히 보셔도 됩니다.</div>
          <div class="equali-rv-actions">
            <button class="equali-rv-btn" data-act="simpler">더 간단하게 다시 제안받기</button>
            <button class="equali-rv-btn" data-act="speak">설명 듣기</button>
          </div>
        `);
        card.appendChild(box);
      }, 45000);
    }

    openReviewModal();
    if (ui.layer && ui.layer.dataset.speak === 'on' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const changes = current && current.metrics ? METRIC_ROWS.filter(([k]) => current.metrics.before[k] !== current.metrics.after[k] && current.metrics.after[k] !== undefined)
        .map(([k, label, fmt]) => `${label} ${fmt(current.metrics.before[k])}에서 ${fmt(current.metrics.after[k])}`).join(', ') : '';
      const utt = utterance([`제안이 도착했습니다. ${proposal.goalTitle}.`, proposal.summary || '', changes ? `측정된 변화: ${changes}.` : '', `위험도: ${risk.text}.`, ...findings.map(f => f.message), '탭 키로 승인 또는 거절 버튼으로 이동할 수 있습니다.'].join(' '));
      utt.lang = 'ko-KR';
      window.speechSynthesis.speak(utt);
    }
    const first = panel.querySelector('.equali-rv-card');
    if (first) {
      first.setAttribute('tabindex', '-1');
      first.focus({ preventScroll: true });
    }
  }

  async function resolveReview(decision, opts = {}) {
    let pending = state.pendingReview;
    if (!pending) return { success: false, error: '검토 중인 제안이 없습니다.' };
    if (opts.proposalId && opts.proposalId !== pending.proposal.id) {
      const chosen = (pending.candidates || []).find(c => c.proposal.id === opts.proposalId);
      if (chosen) pending = { ...pending, proposal: chosen.proposal, audit: chosen.audit };
    }
    state.pendingReview = null;
    clearPreview();
    if (modalBackdrop) modalBackdrop.classList.remove('equali-previewing');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const panel = ui.byId('equali-review-panel');
    if (panel) panel.innerHTML = getTrustedHtml('');

    clearTimeout(state.timers.hesitation);
    clearTimeout(state.timers.abandon);

    if (decision === 'reject') {
      const rej = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'REJECT_PROPOSAL',
          proposalId: pending.proposal.id,
          reason: opts.reason || '',
          signal: opts.signal || 'explicit',
          pageSignals: EqualiSignals.collect(),
          activeFeatures: EqualiRecommendationBanner.activeFeatures()
        }, resolve);
      });
      if (rej && rej.alternative) {
        closeReviewModal();
        showAlternativeOffer(rej.alternative);
      } else if (!opts.silent) {
        showToast('제안을 거절했습니다. 페이지는 그대로이며, 다음 제안에 반영할게요.');
      }
      return { success: true, decision, alternativeOffered: Boolean(rej && rej.alternative) };
    }

    const res = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'APPROVE_PROPOSAL',
        proposalId: pending.proposal.id,
        includeJs: Boolean(opts.includeJs),
        persist: decision === 'approve'
      }, resolve);
    });
    if (!res || !res.success) {
      showToast(`⚠️ ${res?.error || '승인 처리에 실패했습니다.'}`);
      return { success: false, error: res?.error };
    }

    const finalPatch = res.proposal;
    injectDynamicCss(finalPatch.generatedCss, finalPatch.goalTitle, finalPatch.generatedDom, finalPatch.generatedJs, finalPatch.components || []);
    renderInpageResult(finalPatch);

    state.sessionConversationHistory.push({ role: 'user', content: pending.instruction || finalPatch.goalTitle });
    state.sessionConversationHistory.push({ role: 'assistant', content: `[${finalPatch.goalTitle}] ${finalPatch.summary || finalPatch.reasoning || ''}` });
    state.sessionConversationHistory = state.sessionConversationHistory.slice(-6);

    if (!opts.silent) {
      closeReviewModal();
      showToast(`적용했습니다: ${finalPatch.goalTitle}`, { label: '실행 취소', onClick: () => revertAllChanges({ emergency: true }) });
    }
    beginPostApplyMonitoring(finalPatch, pending);
    return { success: true, decision, proposal: finalPatch };
  }

  /* --------------------------------------------------------------------------
     적용 "이후"의 피드백 (구조도: 사용 중 피드백 계속 수집 → 지속적 개인화 / 불만족 → 대안 제안)
     -------------------------------------------------------------------------- */
  const QUICK_REVERT_MS = 90 * 1000;
  const CHECKIN_DELAY_MS = 40 * 1000;

  function beginPostApplyMonitoring(finalPatch, pending) {
    clearTimeout(state.timers.checkin);
    state.lastApplied = {
      goalTitle: finalPatch.goalTitle,
      strategy: finalPatch.strategy || null,
      instruction: pending.instruction || '',
      generatedCss: finalPatch.generatedCss,
      hasDomOrJs: finalPatch.generatedDom.length > 0 || Object.keys(finalPatch.generatedJs).length > 0,
      altDepth: pending.altDepth || 0,
      prevAltKind: pending.prevAltKind || null,
      at: Date.now(),
      rageWarned: false
    };
    // 한 번만, 조용히 묻는다: "방금 바꾼 화면, 괜찮으세요?"
    state.timers.checkin = setTimeout(() => {
      if (!state.lastApplied || !state.isAdapted || document.hidden || state.pendingReview) return;
      showCheckIn();
    }, CHECKIN_DELAY_MS);
  }

  async function reportDissatisfaction(signal, extra = {}) {
    const applied = state.lastApplied;
    if (!applied) return null;
    state.lastApplied = null;
    clearTimeout(state.timers.checkin);
    const res = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'REPORT_DISSATISFACTION',
        signal,
        ...applied,
        domain: window.location.hostname || 'local-page',
        pageSignals: EqualiSignals.collect(),
        activeFeatures: EqualiRecommendationBanner.activeFeatures(),
        ...extra
      }, resolve);
    });
    if (res && res.alternative) showAlternativeOffer(res.alternative);
    return res;
  }

  function showCheckIn() {
    const applied = state.lastApplied;
    const el = EqualiRecommendationBanner.buildShell('방금 바꾼 화면, 괜찮으세요?', `"${applied.goalTitle}" 을(를) 적용했어요. 알려주시면 다음 제안에 반영합니다.`, [], { count: false, snooze: false });
    const actions = el.querySelector('.equali-rec-actions');
    actions.innerHTML = getTrustedHtml(`
      <button class="btn-rec-apply" data-act="keep">좋아요, 유지</button>
      <button class="btn-rlhf-subtle" data-act="adjust">조금 고칠래요</button>
      <button class="btn-rlhf-subtle" data-act="revert">되돌리기</button>
    `);
    actions.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      EqualiRecommendationBanner.dismiss();
      if (act === 'keep') {
        chrome.runtime.sendMessage({ type: 'APPLIED_FEEDBACK', outcome: 'kept', goalTitle: applied.goalTitle, strategy: applied.strategy, instruction: applied.instruction, domain: window.location.hostname });
        // 기록은 남겨 둔다: 나중에라도 되돌리면 '좋아한 설계'에서 빼고 불만족으로 학습해야 한다
        if (state.lastApplied) state.lastApplied.at = 0;
        showToast('알려주셔서 고마워요. 앞으로 비슷한 방식으로 제안할게요.');
      } else if (act === 'adjust') {
        openReviewModal();
        const input = ui.byId('equali-inpage-input');
        if (input) {
          input.placeholder = '어떻게 고칠까요? (예: 글자는 조금만 더 작게)';
          input.focus();
        }
      } else {
        if (state.lastApplied) state.lastApplied.viaCheckin = true;
        revertAllChanges({ emergency: true });
      }
    });
    el.querySelector('.equali-rec-close').addEventListener('click', () => EqualiRecommendationBanner.dismiss());
    EqualiRecommendationBanner.armAutoDismiss(() => {});
  }

  // 조작 오류: 적용 직후 같은 곳을 연달아 누르면, 바뀐 화면 때문에 버튼이 안 눌리는 것일 수 있다
  function onRageAfterApply() {
    const applied = state.lastApplied;
    if (!applied || applied.rageWarned || Date.now() - applied.at > QUICK_REVERT_MS) return false;
    applied.rageWarned = true;
    const el = EqualiRecommendationBanner.buildShell('버튼이 잘 눌리지 않나요?', '방금 바꾼 화면 때문일 수 있어요. 되돌리면 원래대로 동작합니다.', [], { count: false, snooze: false });
    const actions = el.querySelector('.equali-rec-actions');
    actions.innerHTML = getTrustedHtml(`
      <button class="btn-rec-apply" data-act="revert">되돌리기</button>
      <button class="btn-rlhf-subtle" data-act="ok">괜찮아요</button>
    `);
    actions.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      EqualiRecommendationBanner.dismiss();
      if (act === 'revert') {
        if (state.lastApplied) state.lastApplied.rageRevert = true;
        revertAllChanges({ emergency: true });
      }
    });
    el.querySelector('.equali-rec-close').addEventListener('click', () => EqualiRecommendationBanner.dismiss());
    EqualiRecommendationBanner.armAutoDismiss(() => {});
    return true;
  }

  /**
   * 대안 인터페이스 자발적 제안: 거절·이탈·복구의 원인을 추론해 "다른 형태"를 먼저 내놓는다.
   * 수락해도 곧바로 적용되지 않고, 같은 검토 카드로 다시 평가받는다 (구조도의 재평가).
   */
  function showAlternativeOffer(alt) {
    const chain = { altDepth: alt.depth, prevAltKind: alt.kind };
    const el = EqualiRecommendationBanner.buildShell(alt.title, alt.why, alt.causeText ? [alt.causeText] : [], { count: false, snooze: false });
    const actions = el.querySelector('.equali-rec-actions');
    actions.classList.add('equali-alt-actions');

    const run = (item) => {
      EqualiRecommendationBanner.dismiss();
      if (item.featureId) EqualiRecommendationBanner.triggerFeature(item.featureId);
      else requestProposalAndReview(item.instruction, { ...chain, cssOnly: item.cssOnly });
    };

    const items = alt.kind === 'clarify' ? alt.options : [{ label: '네, 그렇게 해주세요', featureId: alt.featureId, instruction: alt.instruction, cssOnly: alt.cssOnly }];
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.className = i === 0 && alt.kind !== 'clarify' ? 'btn-rec-apply' : 'btn-rlhf-subtle equali-alt-option';
      btn.textContent = plainLabel(item.label);
      btn.addEventListener('click', () => run(item));
      actions.appendChild(btn);
    });
    const no = document.createElement('button');
    no.className = 'btn-rlhf-subtle';
    no.textContent = '괜찮아요, 그만할게요';
    no.addEventListener('click', () => EqualiRecommendationBanner.dismiss());
    actions.appendChild(no);

    el.querySelector('.equali-rec-close').addEventListener('click', () => EqualiRecommendationBanner.dismiss());
    EqualiRecommendationBanner.armAutoDismiss(() => {});
  }

  function renderInpageResult(proposal) {
    const titleEl = ui.byId('equali-patch-title');
    const descEl = ui.byId('equali-patch-desc');
    const codePreview = ui.byId('equali-code-preview');

    if (titleEl) titleEl.textContent = proposal.goalTitle || '맞춤 코드 적용됨';
    if (descEl) descEl.textContent = proposal.reasoning || '';
    if (codePreview && proposal.generatedCss) {
      codePreview.style.display = 'block';
      codePreview.querySelector('pre').textContent = proposal.generatedCss;
    }
  }

  function toggleReviewModal() {
    if (!modalBackdrop) return;
    if (modalBackdrop.classList.contains('equali-visible')) {
      closeReviewModal();
    } else {
      openReviewModal();
    }
  }

  function openReviewModal() {
    clearTimeout(state.timers.abandon);
    if (modalBackdrop) modalBackdrop.classList.add('equali-visible');
  }

  function closeReviewModal() {
    if (inpageRecognition) { inpageRecognition.abort(); inpageRecognition = null; }
    if (modalBackdrop) modalBackdrop.classList.remove('equali-visible', 'equali-previewing');
    clearPreview();
    // 이탈 감지: 검토 중인 제안을 결정 없이 닫고 1분간 돌아오지 않으면(사이드패널에서도 처리하지 않으면) 이탈로 본다
    clearTimeout(state.timers.abandon);
    if (state.pendingReview) {
      const id = state.pendingReview.proposal.id;
      state.timers.abandon = setTimeout(() => {
        if (state.pendingReview && state.pendingReview.proposal.id === id) resolveReview('reject', { signal: 'abandoned', silent: true });
      }, 60000);
    }
  }

  function updateBadgeStatus(isActive, title = '') {
    const pill = ui.byId('equali-badge-status');
    if (!pill) return;

    pill.textContent = isActive ? '· 맞춤 적용 중' : '· 대기 중';
    pill.title = isActive ? title : '';
    if (floatingBadge) floatingBadge.dataset.active = String(Boolean(isActive));
  }

  // 음성 우선 모드: 화면에 뜨는 알림·제안을 소리로도 알린다 (스크린리더를 쓰지 않는 저시력·전맹 사용자용)
  /* ---------------- 읽어 주기 음성 ----------------
     음성과 속도는 설정에서 고른 값을 쓴다. 고르지 않았으면 설치된 음성 중 가장 자연스러운 것을 고른다
     (예전에는 voice 를 비워 두어 맥의 압축형 기본 음성이 쓰였고, 그래서 기계 소리로 들렸다). */
  const speechPrefs = { voice: null, rate: 'normal' };
  try {
    chrome.storage.local.get(['speechVoice', 'speechRate']).then((d) => {
      speechPrefs.voice = d.speechVoice || null;
      speechPrefs.rate = d.speechRate || 'normal';
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.speechVoice) speechPrefs.voice = changes.speechVoice.newValue || null;
      if (changes.speechRate) speechPrefs.rate = changes.speechRate.newValue || 'normal';
    });
  } catch (e) {}
  function utterance(text, opts = {}) {
    if (typeof EqualiSpeech === 'undefined') { const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; return u; }
    return EqualiSpeech.makeUtterance(text, { voices: window.speechSynthesis.getVoices(), preferredName: speechPrefs.voice, rate: opts.rate || speechPrefs.rate });
  }

  // 크롬은 사용자가 그 페이지를 한 번도 누르거나 키를 치지 않았으면 소리 내기를 막는다(not-allowed). 그때는 한 번만 알려 준다.
  let speechBlockedHintShown = false;
  function speakIfAudioFirst(text) {
    if (!ui.layer || ui.layer.dataset.speak !== 'on' || !('speechSynthesis' in window) || !text) return;
    if (EqualiTTSPlayer.active) return; // 본문을 읽는 중에는 끼어들지 않는다
    const utt = utterance(text);
    utt.onerror = (e) => {
      if (e.error !== 'not-allowed' || speechBlockedHintShown) return;
      speechBlockedHintShown = true;
      showToast('읽어 주기가 켜져 있습니다. 브라우저가 소리를 허용하도록 이 페이지의 아무 곳이나 한 번 눌러 주세요.');
    };
    window.speechSynthesis.speak(utt);
  }

  /* ---------------- 웹페이지의 버튼 · 링크 · 입력 칸 읽어 주기 ----------------
     "읽어 주기"가 켜져 있으면 Re:Cognition 의 버튼뿐 아니라 페이지 자체의 조작 요소도 이름을 읽는다.
     커서가 지나가기만 해도 떠들지 않도록 0.3초 머물렀을 때만 읽고, 비밀번호 칸과 재구성 화면(따로 읽는다)은 뺀다. */
  (function initPageHoverSpeech() {
    const SEL = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input:not([type="hidden"]):not([type="password"]), select, textarea, summary, label';
    let timer = null, last = null;
    const labelOf = (el) => {
      const byId = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      const img = el.querySelector && el.querySelector('img[alt]');
      const raw = el.getAttribute('aria-label') || (byId && byId.textContent) || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || (img && img.alt) || '';
      const name = String(raw).trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!name) return '';
      const kind = el.matches('a[href], [role="link"]') ? '링크' : el.matches('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea') ? '입력 칸' : el.matches('select') ? '선택 상자' : el.matches('button, [role="button"], input[type="button"], input[type="submit"]') ? '버튼' : '';
      return kind ? `${name}, ${kind}` : name;
    };
    const consider = (target, delay) => {
      if (!ui.layer || ui.layer.dataset.speak !== 'on' || !(target instanceof Element) || ui.isOwn(target)) return;
      const el = target.closest(SEL);
      if (!el || el === last) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!el.isConnected || EqualiTTSPlayer.active) return;
        const text = labelOf(el);
        if (!text) return;
        last = el;
        window.speechSynthesis.cancel();
        speakIfAudioFirst(text);
      }, delay);
    };
    document.addEventListener('pointerover', (e) => consider(e.target, 300), true);
    document.addEventListener('focusin', (e) => consider(e.target, 80), true);
    document.addEventListener('pointerout', (e) => { if (last && e.target instanceof Node && last.contains(e.target) && !(e.relatedTarget instanceof Node && last.contains(e.relatedTarget))) { last = null; clearTimeout(timer); } }, true);
  })();

  function describePageAloud() {
    if (!('speechSynthesis' in window)) { showToast('이 브라우저는 음성 안내를 지원하지 않습니다.'); return false; }
    if (window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); return false; }
    const visible = (sel) => Array.from(document.querySelectorAll(sel)).filter(el => !ui.isOwn(el) && isUsable(el));
    const heading = visible('main h1, [role="main"] h1, article h1, h1')
      .map(h => (h.innerText || '').trim().replace(/\s+/g, ' ')).find(Boolean);
    const hasSearch = visible('input[type="search"], [role="search"] input, input[aria-label*="검색"], input[placeholder*="검색"]').length > 0;
    const skip = /^(?:더보기|메뉴|설정|로그인|공유|저장|구독|알림|좋아요|싫어요|닫기|펼치기|접기|광고|이전|다음|재생|일시중지|전체 화면|more|settings|share|save|subscribe|sign in)$/i;
    const actions = [];
    const seen = new Set();
    for (const el of visible('main button, main a[href], [role="main"] button, [role="main"] a[href], header nav a[href], header button, nav a[href]')) {
      if (el.closest('aside, footer, [role="complementary"]') || EqualiExtractor.isAdElement(el)) continue;
      const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
      if (label.length < 2 || label.length > 24 || skip.test(label) || seen.has(label)) continue;
      seen.add(label);
      actions.push(label);
      if (actions.length === 3) break;
    }
    // 마우스를 올려야 펼쳐지는 메뉴는 화면에 보이지 않아 위 목록에서 빠진다 → 묶음 이름과 함께 따로 읽어 준다
    let menus = [];
    try { menus = EqualiExtractor.listHiddenMenus(6); } catch (e) {}
    const menuText = menus.length
      ? `마우스를 올려야 펼쳐지는 메뉴가 ${menus.length}묶음 있습니다. ${menus.map(m => `${m.label}: ${m.children.slice(0, 6).join(', ')}`).join('. ')}.`
      : '';
    const parts = [
      `${document.title || '제목 없는 페이지'}.`,
      heading && !document.title.includes(heading) ? `주요 내용은 ${heading}입니다.` : '',
      hasSearch ? '검색할 수 있습니다.' : '',
      actions.length ? `주요 기능은 ${actions.join(', ')}입니다.` : '',
      document.querySelector('video') ? '영상이 있습니다.' : '',
      menuText,
      '본문을 들으려면 알트 S를 누르세요.'
    ].filter(Boolean);
    const utt = utterance(parts.join(' '));
    utt.lang = 'ko-KR';
    window.speechSynthesis.speak(utt);
    EqualiSignals.usedFeatures.add('read_aloud');
    return true;
  }

  function showToast(message, action = null) {
    const existing = ui.q('.equali-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'equali-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    const body = document.createElement('span');
    body.textContent = plainLabel(message);
    toast.appendChild(body);
    speakIfAudioFirst(plainLabel(message));

    if (action) {
      const btn = document.createElement('button');
      btn.className = 'equali-toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        toast.remove();
        action.onClick();
      });
      toast.appendChild(btn);
    }
    ui.append(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, action ? 9000 : 3200);
  }

  async function checkContextPrompt() {
    try {
      const res = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'GET_CONTEXT_PROMPT', page: { domain: window.location.hostname, pageType: detectPageType() } }, resolve));
      const prompt = res && res.prompt;
      if (!prompt || EqualiRecommendationBanner.toastEl || state.pendingReview) return;

      if (prompt.kind === 'shortcuts') {
        const names = prompt.targets.slice(0, 3).map(t => `'${t.label}'`).join(', ');
        const el = EqualiRecommendationBanner.buildShell('자주 쓰는 버튼을 모아 드릴까요?', `이 사이트에서 ${names} 을(를) 자주 누르셨어요. 위쪽에 바로가기로 모아 둘 수 있습니다.`, ['여러 번의 방문에서 반복해서 누르신 기록을 바탕으로 합니다'], { snooze: false });
        const actions = el.querySelector('.equali-rec-actions');
        actions.innerHTML = getTrustedHtml('<button class="btn-rec-apply" data-act="yes">미리 살펴보기</button><button class="btn-rlhf-subtle" data-act="no">괜찮아요</button>');
        actions.querySelector('[data-act="yes"]').addEventListener('click', async () => {
          EqualiRecommendationBanner.dismiss();
          const r = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'BUILD_SHORTCUT_PROPOSAL', pageData: extractRichPageDomSnapshot() }, resolve));
          if (r && r.success) showProposalReview(r.proposal, r.audit, { instruction: '자주 쓰는 버튼 모아줘' });
        });
        actions.querySelector('[data-act="no"]').addEventListener('click', () => EqualiRecommendationBanner.dismiss());
      } else if (prompt.kind === 'struggle') {
        const el = EqualiRecommendationBanner.buildShell('이 사이트의 맞춤 화면이 아직 불편하신가요?', '맞춤 화면을 쓰시는 동안에도 확대하거나 되돌아가 읽는 일이 이어지고 있어요.', [], { snooze: false });
        const actions = el.querySelector('.equali-rec-actions');
        actions.innerHTML = getTrustedHtml('<button class="btn-rec-apply" data-act="yes">다른 방식 제안받기</button><button class="btn-rlhf-subtle" data-act="no">지금이 좋아요</button>');
        actions.querySelector('[data-act="yes"]').addEventListener('click', () => {
          EqualiRecommendationBanner.dismiss();
          state.lastApplied = state.lastApplied || { goalTitle: prompt.goalTitle || state.goalTitle, instruction: '', generatedCss: state.currentInjectedCss, altDepth: 0, at: 0 };
          reportDissatisfaction('persistent_struggle');
        });
        actions.querySelector('[data-act="no"]').addEventListener('click', () => EqualiRecommendationBanner.dismiss());
      }
      el_close();
      function el_close() {
        const x = EqualiRecommendationBanner.toastEl && EqualiRecommendationBanner.toastEl.querySelector('.equali-rec-close');
        if (x) x.addEventListener('click', () => EqualiRecommendationBanner.dismiss());
        EqualiRecommendationBanner.armAutoDismiss(() => {});
      }
    } catch (e) {}
  }

  /* ==========================================================================
     5. Auto-Adaptation & RLHF Recommendation Check on Page Load
     ========================================================================== */

  async function checkPersistentAutoAdaptation() {
    try {
      const domSnapshot = extractRichPageDomSnapshot();
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'GET_AUTO_ADAPTATION',
          domain: window.location.hostname || 'local-page',
          domSnapshot: domSnapshot
        }, resolve);
      });

      if (res && res.autoApply) {
        injectDynamicCss(res.generatedCss, res.goalTitle, res.generatedDom, res.generatedJs, res.components || []);
        state.autoApplied = true;
        showToast(`이전에 승인하신 맞춤 UI를 적용했습니다: ${res.goalTitle}`, { label: '끄기', onClick: () => revertAllChanges({ emergency: true }) });
      }
    } catch (e) {
      // Content script ready before runtime active
    }
  }

  /* ==========================================================================
     5.5. 페르소나 — 에이전트가 이 사용자에게 어떤 방식으로 일할지를 정한다
     ========================================================================== */
  const rebuild = EqualiRebuild.create({ ui, getTrustedHtml, escapeHtml, showToast, utterance });

  function renderPersonaChooser(personas, currentId) {
    const list = ui.byId('equali-persona-list');
    if (!list) return;
    // '기타'는 적어 둔 내용이 있을 때만 여기서 고를 수 있다 (적는 곳은 사이드 패널의 특성 탭)
    list.innerHTML = getTrustedHtml(personas.filter(p => !p.custom || p.customText).map(p => `
      <button class="equali-persona-opt" data-persona="${p.id}" aria-pressed="${p.id === currentId}">
        <strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.desc)}</span>
      </button>`).join(''));
    list.onclick = (e) => {
      const btn = e.target.closest('[data-persona]');
      if (!btn) return;
      chrome.runtime.sendMessage({ type: 'SET_PERSONA', personaId: btn.dataset.persona }, () => {
        closeReviewModal();
        applyPersona({ announce: true, chosenNow: true });
      });
    };
  }

  let hearingMediaObserver = null;
  let hearingAutoCaptions = false;

  // 저장값 변경 알림과 직접 알림(APPLY_PERSONA)이 거의 동시에 오므로 한 번에 하나씩만 처리한다 (화면을 두 번 다시 그리지 않게)
  let personaQueue = Promise.resolve();
  function applyPersona(opts = {}) {
    personaQueue = personaQueue.then(() => applyPersonaNow(opts)).catch(e => console.warn('[EqualiUI] applyPersona error:', e));
    return personaQueue;
  }

  async function applyPersonaNow(opts = {}) {
    const res = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'GET_PERSONA_STATE' }, resolve));
    if (!res || !res.success) return;
    const signature = `${res.persona.id}|${res.persona.mode}|${res.persona.customText || ''}`;
    const personaChanged = state.personaSignature !== signature;
    state.personaSignature = signature;
    state.persona = res.persona;
    renderPersonaChooser(res.personas, res.persona.id);
    const desc = ui.byId('equali-persona-desc');
    if (desc) desc.textContent = res.persona.id === 'none' ? '고르신 방식에 따라 Re:Cognition이 페이지를 다루는 방법 전체가 달라집니다.' : `지금: ${res.persona.name} — ${res.persona.desc}`;
    const pill = ui.byId('equali-badge-status');
    if (pill) pill.textContent = res.persona.id === 'none' ? '· 대기 중' : `· ${res.persona.short}`;
    await ui.applyViewPrefs();

    if (res.persona.mode === 'visual') {
      const showAvailableCaptions = () => {
        if (!hearingAutoCaptions && !EqualiLiveCaptionsBar.active && document.querySelector('video')) {
          EqualiLiveCaptionsBar.start({ automatic: true });
          hearingAutoCaptions = true;
          if (hearingMediaObserver) { hearingMediaObserver.disconnect(); hearingMediaObserver = null; }
        }
      };
      showAvailableCaptions();
      if (!hearingAutoCaptions && !hearingMediaObserver && document.body) {
        hearingMediaObserver = new MutationObserver(showAvailableCaptions);
        hearingMediaObserver.observe(document.body, { childList: true, subtree: true });
      }
    } else {
      if (hearingMediaObserver) { hearingMediaObserver.disconnect(); hearingMediaObserver = null; }
      if (hearingAutoCaptions) { EqualiLiveCaptionsBar.stop(); hearingAutoCaptions = false; }
    }

    // 구조도 ②: 페이지를 열 때 자동으로 띄우는 경우에는 먼저 "제안"하고 받아들이면 적용한다.
    // 사용자가 방금 페르소나를 골랐거나(그 자체가 요청), 이 탭에서 이미 재구성 화면을 쓰고 있었다면 바로 연다.
    const firstLoad = state.personaApplied !== true;
    state.personaApplied = true;
    if (!res.shouldOpen) rebuild.dismissProposal();
    if (res.shouldOpen && (!rebuild.isOpen() || personaChanged)) {
      if (firstLoad && !res.tabOpen && !opts.chosenNow && !rebuild.isOpen()) rebuild.propose(res.persona);
      else rebuild.open(res.persona);
    }
    else if (!res.shouldOpen && rebuild.isOpen() && (personaChanged || opts.chosenNow)) rebuild.close(false);
    else if (opts.chosenNow && rebuild.isOpen()) rebuild.open(res.persona); // 페르소나가 바뀌면 그 기준으로 다시 구성
    if (opts.announce && res.persona.id !== 'none' && !res.shouldOpen) showToast(`'${res.persona.name}' 방식으로 바꿨습니다.`);

    // 처음 한 번: 어떤 방식으로 쓸지 묻는다 (페르소나를 모르면 에이전트가 무엇을 기준으로 일하는지 알 수 없다)
    if (!res.chosen && !opts.chosenNow && !state.personaPrompted) {
      state.personaPrompted = true;
      const data = await chrome.storage.local.get('personaPrompted');
      if (!data.personaPrompted) {
        chrome.storage.local.set({ personaPrompted: true });
        const el = EqualiRecommendationBanner.buildShell('Re:Cognition을 어떤 방식으로 쓰실지 골라 주세요', '어르신용 쉬운 화면, 시각장애인을 위한 소리 중심 화면, 저시력용 큰 화면 등 고르신 방식에 따라 페이지를 다시 구성해 드립니다.', [], { count: false, snooze: false });
        const actions = el.querySelector('.equali-rec-actions');
        actions.innerHTML = getTrustedHtml('<button class="btn-rec-apply" data-act="choose">고르러 가기</button><button class="btn-rlhf-subtle" data-act="later">나중에</button>');
        actions.querySelector('[data-act="choose"]').addEventListener('click', () => { EqualiRecommendationBanner.dismiss(); openReviewModal(); });
        actions.querySelector('[data-act="later"]').addEventListener('click', () => EqualiRecommendationBanner.dismiss());
        el.querySelector('.equali-rec-close').addEventListener('click', () => EqualiRecommendationBanner.dismiss());
      }
    }
  }

  /* ==========================================================================
     6. Message Router
     ========================================================================== */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'ANALYZE_PAGE': {
        sendResponse({ success: true, data: extractRichPageDomSnapshot() });
        break;
      }

      case 'INJECT_DYNAMIC_CSS': {
        initHITLInterface();
        injectDynamicCss(message.css, message.goalTitle, message.domElements, message.js, message.components || []);
        sendResponse({ success: true });
        break;
      }

      case 'REVERT_ALL': {
        revertAllChanges({ emergency: Boolean(message.emergency) });
        if (message.emergency) {
          closeReviewModal();
          showToast('긴급 복구(Alt+Z): 원래 화면으로 복원했고, 이 사이트의 자동 적용을 껐습니다.');
        }
        sendResponse({ success: true });
        break;
      }

      case 'OPEN_REBUILD': {
        rebuild.open(state.persona || EqualiPersona.get('none'), { manual: true });
        sendResponse({ success: true });
        break;
      }

      case 'CLOSE_REBUILD': {
        rebuild.close(true);
        sendResponse({ success: true });
        break;
      }

      case 'DESCRIBE_PAGE': {
        sendResponse({ success: true, active: describePageAloud() });
        break;
      }

      case 'CAPTION_EVENT': {
        EqualiLiveCaptionsBar.onCaptionEvent(message);
        sendResponse({ success: true });
        break;
      }

      case 'SWITCH_CANDIDATE': {
        const c = state.pendingReview && (state.pendingReview.candidates || []).find(x => x.proposal.id === message.proposalId);
        if (c) showProposalReview(c.proposal, c.audit, { candidates: state.pendingReview.candidates, instruction: state.pendingReview.instruction, altDepth: state.pendingReview.altDepth, prevAltKind: state.pendingReview.prevAltKind });
        sendResponse({ success: Boolean(c) });
        break;
      }

      case 'APPLY_PERSONA': {
        applyPersona({ announce: true }).then(() => sendResponse({ success: true }));
        return true;
      }
      case 'VALIDATE_PROPOSAL': {
        sendResponse({ success: true, report: validateProposalOnPage(message.proposal) });
        break;
      }

      case 'SHOW_PROPOSAL_REVIEW': {
        showProposalReview(message.proposal, message.audit, { autoApprovable: Boolean(message.autoApprovable), candidates: message.candidates || [], instruction: message.instruction || '' });
        sendResponse({ success: true });
        break;
      }

      // 사이드패널/팝업의 승인·거절 버튼 → 페이지의 검토 카드와 같은 경로로 처리
      case 'RESOLVE_REVIEW': {
        resolveReview(message.decision, { includeJs: message.includeJs, reason: message.reason, proposalId: message.proposalId }).then(sendResponse);
        break;
      }

      case 'TOGGLE_TTS_READER': {
        EqualiTTSPlayer.toggle();
        sendResponse({ success: true, active: EqualiTTSPlayer.active });
        break;
      }

      case 'TOGGLE_LIVE_CAPTIONS': {
        EqualiLiveCaptionsBar.toggle();
        sendResponse({ success: true, active: EqualiLiveCaptionsBar.active, needsTranscription: Boolean(EqualiLiveCaptionsBar.active && EqualiLiveCaptionsBar.needsTranscription) });
        break;
      }

      case 'TOGGLE_PLAIN_SUMMARY': {
        EqualiPlainLanguageHelper.toggle();
        sendResponse({ success: true, active: EqualiPlainLanguageHelper.active });
        break;
      }

      case 'TOGGLE_VISUAL_EDITOR': {
        // 캔버스 에디터는 정해진 부품이 아니라 자유 HTML/JS 를 다루는 유일한 경로다 → 설정에서 직접 켠 경우에만 연다
        chrome.storage.local.get('canvasEditorEnabled').then((data) => {
          if (!data.canvasEditorEnabled) { sendResponse({ success: false, disabled: true, active: false }); return; }
          EqualiVisualEditor.toggle();
          sendResponse({ success: true, active: EqualiVisualEditor.active });
        });
        break;
      }

      case 'TRIGGER_FEATURE': {
        EqualiRecommendationBanner.triggerFeature(message.featureId);
        sendResponse({ success: true });
        break;
      }

      // 팝업이 "지금 이 페이지에서 추천할 기능"을 계산할 때 쓰는 측정값
      case 'GET_SIGNALS': {
        sendResponse({
          success: true,
          signals: EqualiSignals.collect(),
          pageType: detectPageType(),
          domain: window.location.hostname,
          activeFeatures: EqualiRecommendationBanner.activeFeatures()
        });
        break;
      }

      case 'GET_STATUS': {
        sendResponse({
          isAdapted: state.isAdapted,
          goalTitle: state.goalTitle,
          hasCss: Boolean(state.currentInjectedCss),
          activeCount: (state.isAdapted ? 1 : 0),
          pendingReview: Boolean(state.pendingReview),
          persona: state.persona ? state.persona.id : 'none',
          rebuildOpen: rebuild.isOpen(),
          ttsActive: EqualiTTSPlayer.active,
          captionsActive: EqualiLiveCaptionsBar.active,
          plainSummaryActive: EqualiPlainLanguageHelper.active,
          rulerActive: state.rulerActive
        });
        break;
      }

      default:
        sendResponse({ error: 'Unknown message' });
    }
    return true;
  });

  // Init
  function initContent() {
    initHITLInterface();
    applyPersona();
    checkPersistentAutoAdaptation();
    EqualiSignals.init();
    EqualiSignals.onBehavior = (key) => {
      if (key === 'rageClicks' && onRageAfterApply()) return;
      EqualiRecommendationBanner.onBehavior();
    };
    setTimeout(() => {
      EqualiRecommendationBanner.check('load');
    }, 1500);
    setTimeout(checkContextPrompt, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContent);
  } else {
    initContent();
  }
})();
