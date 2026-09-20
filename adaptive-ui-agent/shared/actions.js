/**
 * EqualiUI Element Actions — 캔버스 에디터의 "동작 추가"가 쓰는 정해진 동작 목록
 *
 * 왜 필요한가
 *   예전에는 AI 가 쓴 JavaScript 를 <script> 태그로 페이지에 넣어 실행했다. 그런데 대부분의 큰 사이트(구글, 나무위키, 깃허브 …)는
 *   콘텐츠 보안 정책(CSP)으로 인라인 스크립트를 막기 때문에, 코드는 조용히 버려지고 화면에는 "적용 완료"만 떴다.
 *   MV3 확장은 임의의 코드 문자열을 페이지에서 실행할 방법이 없다 → AI 는 코드를 쓰지 않고, 아래 목록에서 동작을 "고르기만" 한다.
 *   동작은 확장의 content script 가 직접 수행하므로 어떤 사이트에서도 돌고, 무엇을 하는지 한눈에 검토할 수 있다.
 *
 * 안전
 *   - 기본은 "원래 기능은 그대로 두고 동작을 더한다"(replace: false). 원래 기능을 막는 것은 사용자가 그렇게 말했을 때만.
 *   - 네트워크 · 양식 제출 · 저장소 · 클립보드에 닿는 동작은 목록에 없다.
 *   - "다른 페이지로 이동"은 가장 조심해야 하는 동작이다 (버튼이 엉뚱한 곳으로 데려가는 것이 이 프로젝트가 막으려는 일이다):
 *       · 목적지는 http(s) 주소만, 그리고 사용자가 직접 말한 주소이거나 지금 페이지에 실제로 있는 링크여야 한다 (AI 가 지어낸 주소는 버린다)
 *       · 어디로 가는지를 설명과 요소의 말풍선(title)에 항상 드러낸다
 *   - 대상 선택자와 글자는 길이와 형식을 검사한다. 순수 함수만 포함 (Node 테스트 가능).
 */
(function (root) {
  'use strict';

  const PREFIX = '/*equali-action*/';
  const TRIGGERS = ['click', 'hover', 'focus'];
  const T = (max) => ({ kind: 'text', max });
  const SEL = { kind: 'selector' };
  const ACTION_CATALOG = {
    scroll_top: { name: '맨 위로 이동', params: {} },
    scroll_to: { name: '다른 곳으로 스크롤', params: { target: SEL }, required: ['target'] },
    navigate: { name: '다른 페이지로 이동', params: { url: { kind: 'url' }, newTab: { kind: 'bool' } }, required: ['url'] },
    toggle: { name: '다른 요소 보이기 · 숨기기', params: { target: SEL }, required: ['target'] },
    message: { name: '안내 문구 보여 주기', params: { text: T(120) }, required: ['text'] },
    speak: { name: '소리로 읽어 주기', params: { text: T(300), target: SEL } },
    highlight: { name: '다른 요소 강조하기', params: { target: SEL, seconds: { kind: 'int', min: 1, max: 10 } }, required: ['target'] },
    text_size: { name: '글자 크기 바꾸기', params: { target: SEL, percent: { kind: 'int', min: -30, max: 60 } }, required: ['percent'] },
    focus: { name: '입력 칸으로 이동', params: { target: SEL }, required: ['target'] },
    sound: { name: '알림 소리', params: { tone: { kind: 'enum', values: ['beep', 'ding'] } } },
    confetti: { name: '축하 색종이', params: {} },
    shake: { name: '요소 흔들기', params: {} },
    counter: { name: '누른 횟수 세기', params: {} }
  };

  // 기능을 없애거나 가로챌 수 있는 대상은 보이기·숨기기에 쓸 수 없다
  const PROTECTED_TARGET_RE = /(^|[\s>+~,])(html|body|form|input|select|textarea)(?![\w-])|\[type=["']?(submit|password)["']?\]/i;

  function cleanSelector(value) {
    const s = String(value || '').trim();
    if (!s || s.length > 200 || /[<>{};]|\/\*|javascript:/i.test(s)) return null;
    return s;
  }

  function cleanParam(spec, value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (spec.kind === 'text') { const t = String(value).replace(/\s+/g, ' ').trim().slice(0, spec.max); return t || undefined; }
    if (spec.kind === 'selector') return cleanSelector(value) || undefined;
    if (spec.kind === 'int') { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(spec.min, Math.min(spec.max, n)) : undefined; }
    if (spec.kind === 'enum') return spec.values.includes(value) ? value : undefined;
    if (spec.kind === 'bool') return value === true ? true : undefined;
    if (spec.kind === 'url') return cleanUrl(value) || undefined;
    return undefined;
  }

  // 이동할 주소: http(s) 의 완전한 주소만. javascript: · data: · 상대 주소 · 로그인 정보가 든 주소는 받지 않는다.
  function cleanUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 300 || /\s/.test(raw)) return null;
    let u;
    try { u = new URL(raw); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    return u.href;
  }

  const sameUrl = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '') && x.search === y.search; } catch (e) { return false; } };

  /** 목적지가 믿을 만한 출처에서 왔는가: 지금 페이지의 링크이거나, 사용자가 요청에 직접 적은 주소 */
  function urlIsGrounded(url, context) {
    if (!context) return true; // 저장된 동작을 다시 읽을 때 (만들 때 이미 검사했다)
    if ((context.allowedUrls || []).some(x => sameUrl(x, url))) return true;
    const said = String(context.instruction || '');
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      if (!said.toLowerCase().includes(host.toLowerCase())) return false;
      // 주소의 경로까지 말했다면 경로도 맞아야 한다 (말한 사이트의 엉뚱한 하위 주소로 보내지 않게)
      const path = u.pathname.replace(/\/+$/, '');
      return !path || said.includes(path) || said.includes(decodeURIComponent(path));
    } catch (e) { return false; }
  }

  /** AI 가 돌려준 값을 목록과 대조해 고친다. 쓸 수 있는 동작이 하나도 없으면 null. */
  function sanitizeActionSpec(raw, context) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const notes = [];
    const actions = [];
    // 앞의 것이 걸러져도 뒤의 쓸 만한 동작을 놓치지 않도록, 검증을 통과한 것이 4개가 될 때까지 본다
    for (const a of (Array.isArray(r.actions) ? r.actions : []).slice(0, 12)) {
      if (actions.length >= 4) break;
      const def = a && ACTION_CATALOG[a.type];
      if (!def) { if (a && a.type) notes.push(`'${String(a.type).slice(0, 30)}' 은(는) 지원하지 않는 동작이라 뺐습니다.`); continue; }
      const out = { type: a.type };
      for (const [key, spec] of Object.entries(def.params)) { const v = cleanParam(spec, a[key]); if (v !== undefined) out[key] = v; }
      if ((def.required || []).some(k => out[k] === undefined)) { notes.push(`'${def.name}' 에 필요한 값이 없어 뺐습니다.`); continue; }
      if (a.type === 'toggle' && PROTECTED_TARGET_RE.test(out.target)) { notes.push('입력 칸 · 양식 · 페이지 전체는 숨길 수 없어 뺐습니다.'); continue; }
      if (a.type === 'navigate' && !urlIsGrounded(out.url, context)) { notes.push('이동할 주소가 이 페이지의 링크도, 직접 말씀하신 주소도 아니어서 뺐습니다. 주소를 그대로 적어 주세요 (예: https://example.com).'); continue; }
      if (a.type === 'speak' && !out.text && !out.target) { notes.push("'소리로 읽어 주기' 에 읽을 글이 없어 뺐습니다."); continue; }
      actions.push(out);
    }
    if (!actions.length) return { spec: null, notes };
    // 이동은 누를 때만 (마우스를 올리거나 초점이 갔다고 페이지가 넘어가면 안 된다), 그리고 원래 기능을 대신한다 (둘 다 하면 어디로 갈지 알 수 없다)
    const goes = actions.some(a => a.type === 'navigate');
    const trigger = goes ? 'click' : (TRIGGERS.includes(r.trigger) ? r.trigger : 'click');
    if (goes && actions[actions.length - 1].type !== 'navigate') { const nav = actions.filter(a => a.type === 'navigate')[0]; actions.splice(actions.indexOf(nav), 1); actions.push(nav); } // 이동은 맨 마지막에
    return { spec: { v: 1, trigger, replace: goes ? true : r.replace === true, actions: actions.filter((a, i) => a.type !== 'navigate' || i === actions.length - 1) }, notes };
  }

  const encode = (spec) => PREFIX + JSON.stringify(spec);
  function decode(code) {
    const s = String(code || '').trim();
    if (!s.startsWith(PREFIX)) return null;
    try { return sanitizeActionSpec(JSON.parse(s.slice(PREFIX.length))).spec; } catch (e) { return null; }
  }

  /** 사람이 읽는 설명 (에디터의 상태 줄 · 검토용) */
  function describe(spec) {
    if (!spec) return '';
    const when = { click: '누르면', hover: '마우스를 올리면', focus: '초점이 가면' }[spec.trigger];
    const what = spec.actions.map(a => {
      const name = ACTION_CATALOG[a.type].name;
      if (a.type === 'message') return `${name} ("${a.text}")`;
      if (a.type === 'text_size') return `${name} (${a.percent > 0 ? '+' : ''}${a.percent}%)`;
      if (a.type === 'navigate') return `${name}: ${destinationText(a.url)}${a.newTab ? ' (새 탭)' : ''}`;
      return a.target ? `${name} (${a.target})` : name;
    }).join(' → ');
    const goes = spec.actions.some(x => x.type === 'navigate');
    return `${when} ${what}${goes ? ' · 원래 기능 대신 이동합니다' : spec.replace ? ' · 원래 기능은 막음' : ' · 원래 기능은 그대로'}`;
  }

  /** 어디로 가는지 사람이 알아볼 수 있게: 사이트 이름 + 경로 */
  function destinationText(url) {
    // 같은 문서 안의 위치(#)나 검색 조건(?)만 다른 주소도 구별되도록 끝까지 보여 준다
    try { const u = new URL(url); let rest = u.pathname.replace(/\/+$/, '') + u.search + u.hash; try { rest = decodeURIComponent(rest); } catch (e) {} return (u.hostname.replace(/^www\./, '') + (rest.length > 48 ? rest.slice(0, 47) + '…' : rest)) || url; } catch (e) { return String(url).slice(0, 60); }
  }

  const catalogForPrompt = () => Object.entries(ACTION_CATALOG).map(([type, def]) => {
    const params = Object.entries(def.params).map(([k, p]) => `${k}${(def.required || []).includes(k) ? '' : '?'}: ${p.kind === 'text' ? `string<=${p.max}` : p.kind === 'selector' ? 'CSS selector' : p.kind === 'int' ? `int ${p.min}..${p.max}` : p.kind === 'url' ? 'absolute http(s) URL' : p.kind === 'bool' ? 'true|false' : p.values.join('|')}`).join(', ');
    return `- "${type}" (${def.name}) { ${params} }`;
  }).join('\n');

  const api = { PREFIX, ACTION_CATALOG, TRIGGERS, sanitizeActionSpec, encode, decode, describe, catalogForPrompt, cleanUrl, destinationText };
  root.EqualiActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
