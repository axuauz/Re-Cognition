/**
 * EqualiUI Parts — AI 가 고를 수 있는 "정해진 부품 세트"의 렌더러.
 *
 * AI 는 부품의 종류·글자·위치만 정한다 (shared/safety.js 의 COMPONENT_CATALOG 로 검증).
 * 모양(HTML/CSS)과 동작(JS)은 전부 이 파일에 고정되어 있다:
 *   - 글자는 textContent 로만 넣는다 → HTML/스크립트가 끼어들 수 없다.
 *   - 동작은 "보여주기·읽어주기·크기 조절"뿐이다. 페이지의 버튼을 대신 누르거나, 값을 넣거나, 이동하지 않는다.
 *   - 부품마다 닫힌 Shadow DOM 에 그려 사이트 CSS 와 서로 영향을 주지 않는다.
 *   - 모든 부품은 접근성 기준(44px 대상, 7:1 대비, 키보드 조작, 스크린리더 이름)을 지킨 상태로 나온다.
 */
(function (root) {
  'use strict';

  const CSS = `
:host { all: initial; display: block; margin: 12px 0; }
:host([data-floating]) { margin: 0; }
.part {
  --bg: #FFFFFF; --fg: #0F172A; --muted: #475569; --line: #E2E8F0; --ctrl: #7C8797; --accent: #1E40AF; --on-accent: #FFFFFF; --soft: #F8FAFC; --focus: #B45309;
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Segoe UI", sans-serif;
  font-size: var(--eq-base, 16px); line-height: 1.6; color: var(--fg); background: var(--bg);
  border: 1px solid var(--ctrl); border-radius: 14px; padding: 16px 18px; text-align: left;
  letter-spacing: normal; word-spacing: normal; box-sizing: border-box; max-width: 100%;
}
.part[data-tone="dark"] { --bg: #151A20; --fg: #F3F4F6; --muted: #B6BDC8; --line: #2A313B; --ctrl: #6B7686; --accent: #8AB4FF; --on-accent: #0B1220; --soft: #1B2027; --focus: #FFD166; }
.part[data-tone="contrast"] { --bg: #000000; --fg: #FFFFFF; --muted: #FFFFFF; --line: #FFFFFF; --ctrl: #FFFFFF; --accent: #FFE600; --on-accent: #000000; --soft: #000000; --focus: #00E5FF; }
.part * { box-sizing: border-box; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.title { font-size: 1.05em; font-weight: 700; margin: 0; }
.by { font-size: 0.75em; color: var(--muted); margin: 0 0 8px; }
button {
  font: inherit; min-height: 44px; min-width: 44px; padding: 8px 14px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--ctrl); background: var(--bg); color: var(--fg); font-weight: 600;
}
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
button.close { min-height: 36px; min-width: 36px; padding: 0 8px; border-color: transparent; color: var(--muted); }
:focus-visible { outline: 4px solid var(--focus); outline-offset: 2px; }
p { margin: 0; }
.tone::before { content: ""; display: inline-block; width: 0.6em; height: 0.6em; border-radius: 50%; margin-right: 0.5em; background: var(--accent); }
.tone-tip::before { background: #047857; } .tone-warning::before { background: #B45309; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.step-text { font-size: 1.1em; background: var(--soft); border-radius: 10px; padding: 12px 14px; }
dl, ul { border-top: 1px solid var(--line); padding-top: 8px; }
.count { color: var(--muted); font-size: 0.9em; margin-left: auto; }
ol, ul { margin: 0; padding-left: 1.3em; } li { margin: 4px 0; }
a.toc-link { color: var(--accent); text-decoration: underline; cursor: pointer; display: inline-block; padding: 6px 0; min-height: 32px; }
.lvl-3 { margin-left: 1em; font-size: 0.95em; }
.action { display: flex; flex-direction: column; align-items: flex-start; text-align: left; flex: 1 1 140px; }
.action small { font-weight: 400; color: var(--muted); font-size: 0.78em; }
dl { margin: 0; } dt { font-weight: 700; margin-top: 8px; } dd { margin: 0 0 0 0; color: var(--fg); }
.floating { border-radius: 999px; padding: 6px; display: flex; gap: 6px; align-items: center; box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
.floating .pct { min-width: 3.5em; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: no-preference) { button { transition: border-color 0.15s ease; } }
`;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const query = (selector) => {
    try { return selector ? document.querySelector(selector) : null; } catch (e) { return null; }
  };
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const labelOf = (node) => (node.innerText || node.value || node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 30);

  function isDarkAround(node) {
    let cur = node;
    while (cur && cur.nodeType === 1) {
      const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(getComputedStyle(cur).backgroundColor || '');
      if (m && (m[4] === undefined || parseFloat(m[4]) > 0.5)) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) < 110;
      cur = cur.parentElement;
    }
    return false;
  }

  // 대상을 "보여주기"만 한다: 화면 안으로 가져오고, 잠깐 테두리로 표시하고, 원래 초점을 받을 수 있는 요소면 초점을 준다.
  function pointAt(target) {
    if (!target) return;
    target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    const prev = { outline: target.style.outline, offset: target.style.outlineOffset };
    target.style.outline = '4px solid #F59E0B';
    target.style.outlineOffset = '3px';
    setTimeout(() => { target.style.outline = prev.outline; target.style.outlineOffset = prev.offset; }, 2500);
    if (typeof target.focus === 'function' && target.matches('a[href], button, input, select, textarea, [tabindex]')) target.focus({ preventScroll: true });
  }

  function shell(def, title, withClose = true) {
    const part = el('section', 'part');
    part.setAttribute('aria-label', `Re:Cognition ${def.name}${title ? ': ' + title : ''}`);
    const head = el('div', 'head');
    head.appendChild(el('h2', 'title', title || def.name));
    if (withClose) {
      const close = el('button', 'close', '×');
      close.setAttribute('aria-label', `${def.name} 닫기`);
      close.addEventListener('click', () => part.getRootNode().host.remove());
      head.appendChild(close);
    }
    part.appendChild(head);
    part.appendChild(el('p', 'by', 'Re:Cognition이 추가한 도움말 · 이 사이트가 만든 내용이 아닙니다'));
    return part;
  }

  const BUILDERS = {
    notice(def, p) {
      const part = shell(def, p.title);
      const body = el('p', `tone tone-${p.tone || 'info'}`, p.body);
      part.appendChild(body);
      return part;
    },

    steps(def, p) {
      const part = shell(def, p.title);
      let index = 0;
      const text = el('p', 'step-text');
      text.setAttribute('aria-live', 'polite');
      const row = el('div', 'row');
      const prev = el('button', '', '◀ 이전');
      const next = el('button', 'primary', '다음 ▶');
      const show = el('button', '', '여기 보기');
      const count = el('span', 'count');
      const update = () => {
        const step = p.steps[index];
        text.textContent = `${index + 1}. ${step.text}`;
        count.textContent = `${index + 1} / ${p.steps.length}`;
        prev.disabled = index === 0;
        next.disabled = index === p.steps.length - 1;
        show.hidden = !query(step.targetSelector);
      };
      prev.addEventListener('click', () => { index--; update(); });
      next.addEventListener('click', () => { index++; update(); });
      show.addEventListener('click', () => pointAt(query(p.steps[index].targetSelector)));
      row.append(prev, next, show, count);
      part.append(text, row);
      update();
      return part;
    },

    toc(def, p) {
      const scope = query('main, article, [role="main"]') || document.body;
      const headings = Array.from(scope.querySelectorAll('h1, h2, h3'))
        .filter(h => (h.innerText || '').trim().length > 1 && h.getClientRects().length > 0 && h.tagName !== 'EQUALI-PART')
        .slice(0, p.maxItems || 12);
      if (headings.length < 2) return null; // 목차로 만들 제목이 없으면 부품을 넣지 않는다
      const part = shell(def, p.title || '이 페이지의 목차');
      const nav = el('nav');
      nav.setAttribute('aria-label', '페이지 목차');
      const list = el('ul');
      headings.forEach(h => {
        const li = el('li', `lvl-${h.tagName[1]}`);
        const link = el('a', 'toc-link', h.innerText.trim().replace(/\s+/g, ' ').slice(0, 70));
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        const go = () => pointAt(h);
        link.addEventListener('click', go);
        link.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        li.appendChild(link);
        list.appendChild(li);
      });
      nav.appendChild(list);
      part.appendChild(nav);
      return part;
    },

    quick_actions(def, p) {
      const part = shell(def, p.title || '자주 쓰는 기능');
      const row = el('div', 'row');
      p.actions.forEach(action => {
        const target = query(action.targetSelector);
        const btn = el('button', 'action');
        btn.appendChild(el('span', '', action.label));
        // 버튼 이름은 AI 가 지었지만, 실제로 어디로 데려가는지는 페이지에서 직접 읽어 보여준다 (이름과 대상이 다른 것을 숨길 수 없다)
        btn.appendChild(el('small', '', target ? `→ 페이지의 '${labelOf(target) || target.tagName.toLowerCase()}'(으)로 이동` : '→ 이 페이지에서 찾을 수 없음'));
        btn.disabled = !target;
        btn.addEventListener('click', () => pointAt(target));
        row.appendChild(btn);
      });
      part.appendChild(row);
      part.appendChild(el('p', 'by', '눌러도 대신 실행하지 않습니다. 해당 위치로 이동해 표시만 합니다.'));
      return part;
    },

    glossary(def, p) {
      const part = shell(def, p.title || '어려운 낱말 풀이');
      const dl = el('dl');
      p.terms.forEach(t => { dl.appendChild(el('dt', '', t.term)); dl.appendChild(el('dd', '', t.meaning || '')); });
      part.appendChild(dl);
      return part;
    },

    read_aloud(def, p) {
      const target = query(p.targetSelector);
      if (!target || !('speechSynthesis' in window)) return null;
      const part = shell(def, '');
      part.querySelector('.head .title').textContent = def.name;
      const btn = el('button', 'primary', p.label || '이 부분 읽어주기');
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-pressed') === 'true') {
          window.speechSynthesis.cancel();
          return;
        }
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance((target.innerText || '').trim().slice(0, 5000));
        utt.lang = document.documentElement.lang || navigator.language || 'ko-KR';
        utt.onend = utt.onerror = () => { btn.setAttribute('aria-pressed', 'false'); btn.textContent = p.label || '이 부분 읽어주기'; };
        btn.setAttribute('aria-pressed', 'true');
        btn.textContent = '읽기 멈추기';
        window.speechSynthesis.speak(utt);
      });
      part.appendChild(btn);
      return part;
    },

    back_to_top(def, p) {
      const part = el('div', 'part floating');
      const btn = el('button', 'primary', `▲ ${p.label || '맨 위로'}`);
      btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));
      part.appendChild(btn);
      return part;
    },

    text_size_control(def, p) {
      const selector = p.targetSelector || 'main, article, [role="main"]';
      const part = el('div', 'part floating');
      part.setAttribute('role', 'group');
      part.setAttribute('aria-label', '글자 크기 조절');
      let pct = 100;
      const minus = el('button', '', 'A−');
      const plus = el('button', '', 'A+');
      const label = el('span', 'pct', '100%');
      label.setAttribute('aria-live', 'polite');
      minus.setAttribute('aria-label', '글자 작게');
      plus.setAttribute('aria-label', '글자 크게');
      const apply = () => {
        let style = document.getElementById('equali-textsize-style');
        if (!style) {
          style = document.createElement('style');
          style.id = 'equali-textsize-style';
          style.className = 'equali-injected-element';
          document.head.appendChild(style);
        }
        style.textContent = pct === 100 ? '' : `${selector} { zoom: ${pct / 100} !important; }`;
        label.textContent = `${pct}%`;
        minus.disabled = pct <= 100;
        plus.disabled = pct >= 200;
      };
      minus.addEventListener('click', () => { pct -= 10; apply(); });
      plus.addEventListener('click', () => { pct += 10; apply(); });
      part.append(minus, label, plus);
      apply();
      return part;
    }
  };

  function partId(component) {
    const src = JSON.stringify(component);
    let h = 0;
    for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
    return 'equali-part-' + (h >>> 0).toString(36);
  }

  /**
   * @param components  EqualiSafety.auditProposal(...).sanitized.components
   * @param options.floatingLayer  떠 있는 부품을 담을 컨테이너 (확장 UI 의 Shadow DOM 안)
   * @param options.catalog        EqualiSafety.COMPONENT_CATALOG
   */
  function render(components, options) {
    const pending = [];
    for (const component of components || []) {
      const def = options.catalog[component.type];
      const build = BUILDERS[component.type];
      if (!def || !build) continue;
      const id = partId(component);
      if (document.getElementById(id) || (options.floatingLayer && options.floatingLayer.querySelector(`#${id}`))) continue;

      const floating = component.position === 'floating';
      const anchor = floating ? document.body : query(component.anchor);
      if (!anchor) { pending.push(component); continue; }

      const body = build(def, component.props || {});
      if (!body) continue;
      // 사용자가 고대비를 쓰면 부품도 고대비로, 아니면 부품이 놓이는 자리의 밝기에 맞춘다
      body.dataset.tone = options.theme === 'contrast' ? 'contrast' : (isDarkAround(floating ? document.body : anchor) ? 'dark' : 'light');
      // 글자 크기는 부품이 놓이는 "자리"의 본문 크기를 따른다 (제목 옆에 놓였다고 제목만큼 커지지 않게)
      const sizeSource = (component.position === 'before' || component.position === 'after') && anchor.parentElement ? anchor.parentElement : anchor;
      const scale = { large: 1.15, xlarge: 1.3 }[options.size] || 1;
      const basePx = Math.min(20, Math.max(16, parseFloat(getComputedStyle(sizeSource).fontSize) || 16)) * scale;

      const host = document.createElement('equali-part');
      host.id = id;
      host.className = 'equali-injected-element'; // "원래대로" 시 함께 제거된다
      host.style.setProperty('--eq-base', `${basePx}px`);
      if (floating) host.setAttribute('data-floating', '');
      const shadow = host.attachShadow({ mode: options.shadowMode || 'closed' });
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        shadow.adoptedStyleSheets = [sheet];
      } catch (e) {
        const style = document.createElement('style');
        style.textContent = CSS;
        shadow.appendChild(style);
      }
      shadow.appendChild(body);

      if (floating) options.floatingLayer.appendChild(host);
      else if (component.position === 'before') anchor.before(host);
      else if (component.position === 'after') anchor.after(host);
      else if (component.position === 'append') anchor.appendChild(host);
      else anchor.prepend(host);
    }
    return pending;
  }

  function missingSelectors(components) {
    const missing = [];
    const check = (sel) => { if (sel && !query(sel)) missing.push(sel); };
    for (const c of components || []) {
      if (c.position !== 'floating') check(c.anchor);
      const walk = (v) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (k === 'targetSelector' ? check(x) : walk(x)));
      };
      walk(c.props);
    }
    return missing;
  }

  root.EqualiParts = { render, missingSelectors };
})(typeof self !== 'undefined' ? self : this);
