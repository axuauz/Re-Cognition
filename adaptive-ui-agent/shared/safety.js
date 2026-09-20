/**
 * EqualiUI Safety Auditor
 * AI가 생성한 패치(CSS / DOM / JS)를 적용 전에 정적 검사하여
 *  - 위험 코드는 제거(block)하고
 *  - 기능 변조 가능성이 있는 변경은 사용자 검토 항목(finding)으로 올린다.
 * Service Worker(importScripts), Content Script(manifest), Node 테스트(require)에서 공용으로 사용.
 */
(function (root) {
  'use strict';

  const SEVERITY_RANK = { info: 0, medium: 1, high: 2, block: 3 };

  /* ------------------------------------------------------------------------
     1. 민감 페이지 판별 (로그인 / 결제 / 금융) → CSS 외 주입 전면 차단
     ------------------------------------------------------------------------ */
  const SENSITIVE_URL_RE = /(bank|banking|pay(ment)?s?\b|checkout|billing|wallet|login|signin|sign-in|signup|auth|account|passport|cert|인증|결제|로그인)/i;

  function isSensitiveContext(pageData) {
    if (!pageData) return false;
    if (pageData.hasPasswordField || pageData.hasPaymentField) return true;
    const target = `${pageData.domain || ''} ${pageData.url || ''}`;
    return SENSITIVE_URL_RE.test(target);
  }

  /* ------------------------------------------------------------------------
     2. CSS 검사
     ------------------------------------------------------------------------ */
  const HIDE_DECL_RE = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*(hidden|collapse)|opacity\s*:\s*0(\.0+)?(?![.\d])|pointer-events\s*:\s*none)/i;
  const HIDE_DECL_STRIP_RE = /(display\s*:\s*none|visibility\s*:\s*(hidden|collapse)|opacity\s*:\s*0(\.0+)?(?![.\d])|pointer-events\s*:\s*none)\s*(!important)?\s*;?/gi;
  // 선택자 전체가 이 중 하나면 "페이지 핵심/전역 요소"를 통째로 건드리는 것
  const GLOBAL_TARGETS = new Set(['*', 'html', 'body', 'main', 'form', 'input', 'button', 'select', 'textarea', 'a', 'label', '[role="main"]', '[role=main]']);
  const INTERACTIVE_TAIL_RE = /(^|[\s>+~])(button|input|select|textarea|form|a|label)(?![\w-])[^\s>+~]*$|\[type=["']?(submit|password)["']?\]|\[role=["']?button["']?\]/i;

  function splitCssRules(css) {
    // 최상위 규칙을 { prelude, body, isAtBlock } 으로 분리 (중첩 @media 는 body 에 원문 유지)
    const rules = [];
    let i = 0;
    const n = css.length;
    while (i < n) {
      const open = css.indexOf('{', i);
      const semi = css.indexOf(';', i);
      if (semi !== -1 && (open === -1 || semi < open)) {
        const stmt = css.slice(i, semi + 1).trim();
        if (stmt) rules.push({ statement: stmt });
        i = semi + 1;
        continue;
      }
      if (open === -1) break;
      let depth = 1;
      let j = open + 1;
      while (j < n && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      rules.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) });
      i = j;
    }
    return rules;
  }

  function sanitizeUrlsInCss(text, findings) {
    return text.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, q, url) => {
      const u = url.trim();
      if (/^https:\/\//i.test(u) || /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(u) || /^chrome-extension:\/\//i.test(u)) {
        return m;
      }
      findings.push({ severity: 'block', code: 'CSS_UNSAFE_URL', target: u.slice(0, 80), message: `안전하지 않은 주소의 리소스를 불러오려 해서 제거했습니다: ${u.slice(0, 60)}` });
      return 'none';
    });
  }

  function auditRuleBlock(prelude, body, findings) {
    let outBody = body;
    const selectors = prelude.split(',').map(s => s.trim()).filter(Boolean);

    // (a) 입력값을 CSS 로 빼돌리는 패턴: input[value^=...] { background: url(...) }
    if (/\[\s*value\s*[\^$*~|]?=/i.test(prelude) && /url\(/i.test(body)) {
      findings.push({ severity: 'block', code: 'CSS_EXFIL', target: prelude.slice(0, 80), message: '입력한 값을 외부로 유출할 수 있는 CSS 패턴을 제거했습니다.' });
      return null;
    }

    // (a-2) 안전 장치의 UI(검토 카드·승인 버튼·복구 배지)를 겨냥한 규칙은 통째로 버린다.
    //       Shadow DOM 으로 이미 닿지 않지만, 시도 자체를 사용자에게 알려야 한다.
    if (selectors.some(sel => /equali-(?!inj-|injected-element)/i.test(sel))) {
      findings.push({ severity: 'block', code: 'CSS_TARGETS_SAFETY_UI', target: prelude.slice(0, 80), message: 'EqualiUI 의 검토·복구 화면을 건드리려는 규칙이 있어 제거했습니다.' });
      return null;
    }

    // (b) 핵심/전역 요소 숨김
    if (HIDE_DECL_RE.test(body)) {
      const globalHits = selectors.filter(s => GLOBAL_TARGETS.has(s.toLowerCase()));
      if (globalHits.length > 0) {
        findings.push({ severity: 'block', code: 'CSS_HIDE_GLOBAL', target: globalHits.join(', '), message: `페이지 전체 또는 모든 입력/버튼(${globalHits.join(', ')})을 숨기려는 규칙을 제거했습니다.` });
        outBody = outBody.replace(HIDE_DECL_STRIP_RE, '');
      } else {
        const interactiveHits = selectors.filter(s => INTERACTIVE_TAIL_RE.test(s));
        if (interactiveHits.length > 0) {
          findings.push({ severity: 'medium', code: 'CSS_HIDE_INTERACTIVE', target: interactiveHits.join(', ').slice(0, 120), message: `버튼·링크·입력창을 숨기거나 누를 수 없게 만듭니다: ${interactiveHits.join(', ').slice(0, 80)}` });
        }
      }
    }

    // (c) 버튼/링크의 표시 문구를 CSS content 로 바꿔치기
    if (/content\s*:\s*['"]/i.test(body) && selectors.some(s => /(button|input|a|\[role=["']?button)[^\s]*::?(before|after)/i.test(s))) {
      findings.push({ severity: 'high', code: 'CSS_LABEL_SPOOF', target: prelude.slice(0, 80), message: '버튼이나 링크에 표시되는 문구를 바꿉니다. 실제 기능과 표시가 달라질 수 있습니다.' });
    }

    if (!outBody.trim()) return null; // 위험 선언을 걷어낸 뒤 빈 규칙은 남기지 않는다
    return `${prelude} {${outBody}}`;
  }

  function sanitizeCss(css, findings) {
    if (!css || typeof css !== 'string') return '';
    let text = css.replace(/<\/?style[^>]*>/gi, '').replace(/\/\*[\s\S]*?\*\//g, '');

    if (/expression\s*\(|behavior\s*:|-moz-binding/i.test(text)) {
      findings.push({ severity: 'block', code: 'CSS_SCRIPT', target: 'expression/behavior', message: 'CSS 안에 스크립트를 실행하는 구문이 있어 제거했습니다.' });
      text = text.replace(/[^;{}]*(expression\s*\(|behavior\s*:|-moz-binding)[^;{}]*;?/gi, '');
    }
    text = sanitizeUrlsInCss(text, findings);

    const out = [];
    for (const rule of splitCssRules(text)) {
      if (rule.statement) {
        if (/^@import/i.test(rule.statement)) {
          findings.push({ severity: 'block', code: 'CSS_IMPORT', target: rule.statement.slice(0, 80), message: '외부 스타일시트를 불러오는 @import 를 제거했습니다.' });
        } else if (/^@(charset|namespace)/i.test(rule.statement)) {
          out.push(rule.statement);
        }
        continue;
      }
      if (/^@(media|supports|layer|container)/i.test(rule.prelude)) {
        const inner = sanitizeCss(rule.body, findings);
        out.push(`${rule.prelude} {\n${inner}\n}`);
      } else if (/^@(keyframes|-webkit-keyframes|font-face|page)/i.test(rule.prelude)) {
        out.push(`${rule.prelude} {${rule.body}}`);
      } else if (rule.prelude.startsWith('@')) {
        findings.push({ severity: 'info', code: 'CSS_UNKNOWN_AT', target: rule.prelude.slice(0, 40), message: `지원하지 않는 at-rule 을 제외했습니다: ${rule.prelude.slice(0, 40)}` });
      } else {
        const audited = auditRuleBlock(rule.prelude, rule.body, findings);
        if (audited) out.push(audited);
      }
    }
    return out.join('\n');
  }

  /* ------------------------------------------------------------------------
     3. JS 검사
     ------------------------------------------------------------------------ */
  const JS_BLOCK_PATTERNS = [
    [/\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|sendBeacon|EventSource|\bnew\s+Image\s*\(/, 'JS_NETWORK', '외부로 데이터를 전송할 수 있는 네트워크 호출'],
    [/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(|\bimport\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/, 'JS_DYNAMIC_CODE', '문자열을 코드로 실행하는 구문'],
    [/document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB|\bcaches\b/, 'JS_STORAGE', '쿠키·저장소 접근'],
    [/\blocation\s*(\.\s*(href|host|pathname|search|hash))?\s*=[^=]|location\s*\.\s*(assign|replace|reload)\s*\(|window\s*\.\s*open\s*\(|history\s*\.\s*(pushState|replaceState)/, 'JS_NAVIGATION', '다른 페이지로 이동시키는 동작'],
    [/\.\s*submit\s*\(|\.\s*requestSubmit\s*\(|\.\s*action\s*=[^=]|formAction/, 'JS_FORM_SUBMIT', '양식을 자동 제출하거나 제출 대상을 바꾸는 동작'],
    [/mailto:|sms:|tel:/i, 'JS_MESSAGING', '메일·문자 보내기 동작'],
    [/navigator\s*\.\s*(clipboard|credentials|geolocation|mediaDevices|serviceWorker)/, 'JS_SENSITIVE_API', '클립보드·인증정보·위치·카메라 등 민감 API 접근'],
    [/\bchrome\s*\.|\bbrowser\s*\.\s*runtime|postMessage\s*\(/, 'JS_EXTENSION_API', '확장 프로그램/다른 창과의 통신'],
    [/createElement\s*\(\s*['"`](script|iframe|object|embed|form|link)['"`]|<script|<iframe|\.src\s*=\s*[^;]*\.js/i, 'JS_SCRIPT_INJECTION', '새 스크립트·프레임·양식 삽입'],
    [/type\s*=\s*["']?password|\[type=["']?password|autocomplete/i, 'JS_CREDENTIALS', '비밀번호 입력란 접근'],
    [/\batob\s*\(|\bbtoa\s*\(|fromCharCode|\\x[0-9a-f]{2}|\\u00[0-9a-f]{2}|\[\s*['"`]\w+['"`]\s*\]\s*\(/i, 'JS_OBFUSCATION', '내용을 숨기는 난독화 구문'],
    [/equali-ui-host|equali-root|shadowRoot|attachShadow/i, 'JS_TARGETS_SAFETY_UI', 'EqualiUI 의 검토·복구 화면에 접근'],
    [/__proto__|\.\s*constructor\s*[.[(]|\bprototype\b|\bReflect\b|\bProxy\b|globalThis|window\s*\[/, 'JS_SANDBOX_ESCAPE', '실행 환경을 우회하려는 구문']
  ];

  const JS_HIGH_PATTERNS = [
    [/\.\s*click\s*\(\s*\)|dispatchEvent\s*\(/, 'JS_SYNTHETIC_CLICK', '다른 버튼을 대신 눌러 주는 동작이 포함되어 있습니다.'],
    [/\.\s*value\s*=[^=]/, 'JS_WRITE_INPUT', '입력창의 값을 자동으로 바꿉니다.'],
    [/stopImmediatePropagation|stopPropagation/, 'JS_BLOCK_ORIGINAL', '요소의 원래 동작이 실행되지 않도록 막습니다.']
  ];

  function auditJsBlock(selector, code, interactiveSelectors, findings) {
    if (typeof code !== 'string' || !code.trim()) return false;
    if (code.length > 6000) {
      findings.push({ severity: 'block', code: 'JS_TOO_LARGE', target: selector, message: '동작 스크립트가 비정상적으로 길어 제외했습니다.' });
      return false;
    }
    for (const [re, id, label] of JS_BLOCK_PATTERNS) {
      if (re.test(code)) {
        findings.push({ severity: 'block', code: id, target: selector, message: `허용되지 않는 동작(${label})이 포함되어 이 스크립트를 제외했습니다.` });
        return false;
      }
    }
    for (const [re, id, label] of JS_HIGH_PATTERNS) {
      if (re.test(code)) findings.push({ severity: 'high', code: id, target: selector, message: label });
    }

    const existing = interactiveSelectors.get(selector);
    if (existing) {
      findings.push({
        severity: 'high',
        code: 'JS_REMAP_EXISTING_CONTROL',
        target: selector,
        message: `페이지에 원래 있던 '${existing}' 요소에 새 동작을 연결합니다. 원래 기능(${existing})과 다르게 동작할 수 있으니 꼭 확인하세요.`
      });
    } else if (!/equali-inj-|equali-injected/i.test(selector)) {
      findings.push({ severity: 'medium', code: 'JS_ATTACH', target: selector, message: `페이지 요소(${selector.slice(0, 60)})에 새 동작 스크립트를 연결합니다.` });
    } else {
      findings.push({ severity: 'medium', code: 'JS_ATTACH_NEW', target: selector, message: '새로 추가한 요소에 동작 스크립트를 연결합니다.' });
    }
    return true;
  }

  /* ------------------------------------------------------------------------
     4. DOM 검사 (정규식 기반 1차 검사. Content Script 가 DOM 기반으로 2차 정화)
     ------------------------------------------------------------------------ */
  const DOM_FORBIDDEN_TAG_RE = /<\s*(script|iframe|frame|object|embed|form|link|meta|base|style|applet|portal)\b/i;

  function auditDomItem(item, interactiveSelectors, findings) {
    if (!item || typeof item.parentSelector !== 'string' || !item.parentSelector.trim()) return null;
    const sel = item.parentSelector.trim();

    if (item.isModify) {
      const existing = interactiveSelectors.get(sel);
      if (existing && item.textContent !== undefined) {
        findings.push({ severity: 'high', code: 'DOM_LABEL_CHANGE', target: sel, message: `'${existing}' 의 표시 문구를 '${String(item.textContent).slice(0, 30)}'(으)로 바꿉니다. 기능은 그대로인데 이름만 달라질 수 있습니다.` });
      }
      if (item.src !== undefined && !/^(https:\/\/|data:image\/)/i.test(String(item.src))) return null;
      return { parentSelector: sel, isModify: true, textContent: item.textContent, src: item.src };
    }

    const html = typeof item.html === 'string' ? item.html : '';
    if (!html.trim()) return null;
    if (html.length > 8000) {
      findings.push({ severity: 'block', code: 'DOM_TOO_LARGE', target: sel, message: '삽입하려는 요소가 비정상적으로 커서 제외했습니다.' });
      return null;
    }
    if (DOM_FORBIDDEN_TAG_RE.test(html)) {
      findings.push({ severity: 'block', code: 'DOM_FORBIDDEN_TAG', target: sel, message: '스크립트·프레임·양식 등 허용되지 않는 태그가 있어 제외했습니다.' });
      return null;
    }
    if (/\son\w+\s*=|javascript\s*:|data\s*:\s*text\/html|srcdoc\s*=/i.test(html)) {
      findings.push({ severity: 'block', code: 'DOM_INLINE_SCRIPT', target: sel, message: '요소 안에 숨겨진 스크립트(on* 속성 등)가 있어 제외했습니다.' });
      return null;
    }
    if (/<\s*(input|textarea|select)\b/i.test(html)) {
      findings.push({ severity: 'high', code: 'DOM_INPUT_FIELD', target: sel, message: '페이지에 새 입력창을 추가합니다. 개인정보를 입력하지 않도록 주의하세요.' });
    }
    if (/<\s*a\b[^>]*href\s*=\s*["']?\s*https?:/i.test(html)) {
      findings.push({ severity: 'medium', code: 'DOM_EXTERNAL_LINK', target: sel, message: '외부 사이트로 연결되는 링크를 추가합니다.' });
    }
    findings.push({ severity: 'info', code: 'DOM_INSERT', target: sel, message: `새 요소를 페이지에 추가합니다 (위치: ${sel.slice(0, 60)}).` });
    return { parentSelector: sel, html };
  }

  /* ------------------------------------------------------------------------
     4.5. 부품(Component) 검사
     AI 는 HTML/JS 를 직접 쓰지 않고, 정해진 부품의 "종류 + 글자 속성 + 위치"만 고른다.
     부품의 모양과 동작은 확장 프로그램 코드(content/parts.js)가 그리므로 스크립트가 끼어들 길이 없다.
     ------------------------------------------------------------------------ */
  const T = (max) => ({ kind: 'text', max });
  const SEL = { kind: 'selector' };
  const COMPONENT_CATALOG = {
    notice: { name: '안내 카드', props: { title: T(60), body: T(400), tone: { kind: 'enum', values: ['info', 'tip', 'warning'] } }, required: ['body'] },
    steps: { name: '단계 안내', props: { title: T(60), steps: { kind: 'list', max: 8, item: { text: T(160), targetSelector: SEL } } }, required: ['steps'], usesTargets: true },
    toc: { name: '목차', props: { title: T(60), maxItems: { kind: 'int', min: 3, max: 20 } }, required: [] },
    quick_actions: { name: '바로가기 버튼', props: { title: T(60), actions: { kind: 'list', max: 6, item: { label: T(24), targetSelector: SEL } } }, required: ['actions'], usesTargets: true },
    glossary: { name: '낱말 풀이', props: { title: T(60), terms: { kind: 'list', max: 10, item: { term: T(40), meaning: T(160) } } }, required: ['terms'] },
    read_aloud: { name: '읽어주기 버튼', props: { label: T(24), targetSelector: SEL }, required: ['targetSelector'], usesTargets: true },
    back_to_top: { name: '맨 위로 버튼', props: { label: T(16) }, required: [] },
    text_size_control: { name: '글자 크기 조절', props: { targetSelector: SEL }, required: [] }
  };
  const COMPONENT_POSITIONS = ['before', 'after', 'prepend', 'append', 'floating'];
  const SENSITIVE_SAFE_COMPONENTS = new Set(['notice', 'toc', 'glossary', 'back_to_top', 'text_size_control']);
  const FLOATING_ONLY = new Set(['back_to_top', 'text_size_control']);

  function cleanSelector(value) {
    if (typeof value !== 'string') return null;
    const sel = value.trim();
    if (!sel || sel.length > 200 || /[<>{}]|equali-|javascript:/i.test(sel)) return null;
    return sel;
  }

  function cleanProp(spec, value) {
    if (value === undefined || value === null) return undefined;
    switch (spec.kind) {
      case 'text': {
        if (typeof value !== 'string' && typeof value !== 'number') return undefined;
        const text = String(value).replace(/\s+/g, ' ').trim().slice(0, spec.max);
        return text || undefined;
      }
      case 'enum': return spec.values.includes(value) ? value : undefined;
      case 'int': return Number.isFinite(+value) ? Math.min(spec.max, Math.max(spec.min, Math.round(+value))) : undefined;
      case 'selector': return cleanSelector(value) || undefined;
      case 'list': {
        if (!Array.isArray(value)) return undefined;
        const items = value.slice(0, spec.max).map(raw => {
          if (!raw || typeof raw !== 'object') return null;
          const out = {};
          for (const [k, sub] of Object.entries(spec.item)) {
            const v = cleanProp(sub, raw[k]);
            if (v !== undefined) out[k] = v;
          }
          const firstKey = Object.keys(spec.item)[0]; // 각 항목의 첫 속성(글자)은 필수
          return out[firstKey] ? out : null;
        }).filter(Boolean);
        return items.length ? items : undefined;
      }
    }
    return undefined;
  }

  function collectTexts(value, out = []) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(v => collectTexts(v, out));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { if (k !== 'targetSelector') collectTexts(v, out); });
    return out;
  }

  const norm = (str) => String(str || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  function auditComponent(raw, interactiveSelectors, sensitive, findings) {
    if (!raw || typeof raw !== 'object') return null;
    const def = COMPONENT_CATALOG[raw.type];
    if (!def) {
      findings.push({ severity: 'block', code: 'COMPONENT_UNKNOWN', target: String(raw.type).slice(0, 40), message: `허용 목록에 없는 부품(${String(raw.type).slice(0, 30)})이라 제외했습니다.` });
      return null;
    }
    if (sensitive && !SENSITIVE_SAFE_COMPONENTS.has(raw.type)) {
      findings.push({ severity: 'block', code: 'COMPONENT_SENSITIVE_PAGE', target: raw.type, message: `로그인·결제 등 민감한 페이지에서는 페이지의 버튼·입력창과 이어지는 부품(${def.name})을 쓰지 않습니다.` });
      return null;
    }

    const props = {};
    for (const [key, spec] of Object.entries(def.props)) {
      const v = cleanProp(spec, raw.props ? raw.props[key] : undefined);
      if (v !== undefined) props[key] = v;
    }
    if (def.required.some(k => props[k] === undefined)) {
      findings.push({ severity: 'info', code: 'COMPONENT_INCOMPLETE', target: raw.type, message: `${def.name}에 필요한 내용이 빠져 있어 제외했습니다.` });
      return null;
    }

    let position = COMPONENT_POSITIONS.includes(raw.position) ? raw.position : 'prepend';
    let anchor = cleanSelector(raw.anchor);
    if (FLOATING_ONLY.has(raw.type)) position = 'floating';
    if (!anchor && position !== 'floating') anchor = 'main, article, [role="main"], body';

    // 비밀번호·결제 입력란을 가리키는 부품은 만들지 않는다
    const targets = collectTargets(props);
    if (targets.some(t => /password|passwd|card|cvc|cvv|otp|\[type=["']?(password|hidden)/i.test(t))) {
      findings.push({ severity: 'block', code: 'COMPONENT_SENSITIVE_TARGET', target: raw.type, message: `${def.name}이(가) 비밀번호·결제 입력란을 가리키고 있어 제외했습니다.` });
      return null;
    }

    // 바로가기 버튼의 이름과 실제 대상이 다르면 (예: '검색' 이라고 써 놓고 '메일 보내기' 버튼을 가리킴) 반드시 알린다
    if (raw.type === 'quick_actions') {
      for (const action of props.actions) {
        const actual = action.targetSelector && interactiveSelectors.get(action.targetSelector);
        if (!action.targetSelector) continue;
        if (actual && !(norm(actual).includes(norm(action.label)) || norm(action.label).includes(norm(actual)))) {
          findings.push({ severity: 'high', code: 'COMPONENT_LABEL_MISMATCH', target: action.targetSelector, message: `바로가기 '${action.label}' 이(가) 가리키는 실제 대상은 페이지의 '${actual}' 입니다. 이름과 대상이 다릅니다.` });
        }
      }
    }

    const texts = collectTexts(props).join(' ');
    if (/https?:\/\/|www\.|[\w.+-]+@[\w-]+\.\w+|\d{2,4}[-\s]\d{3,4}[-\s]\d{4}/i.test(texts)) {
      findings.push({ severity: 'high', code: 'COMPONENT_CONTACT_TEXT', target: raw.type, message: `${def.name}의 글에 웹 주소·이메일·전화번호가 들어 있습니다. 페이지에 원래 있던 안내가 아닐 수 있으니 주의하세요.` });
    }
    if (/비밀번호|인증번호|계좌|카드 ?번호|주민등록|password|otp/i.test(texts)) {
      findings.push({ severity: 'high', code: 'COMPONENT_SENSITIVE_TEXT', target: raw.type, message: `${def.name}의 글이 비밀번호·인증번호 같은 민감한 정보를 언급합니다. 입력을 유도하는 내용이 아닌지 확인하세요.` });
    }

    const where = position === 'floating' ? '화면 구석에 떠 있는 형태' : `위치: ${String(anchor).slice(0, 50)}`;
    findings.push({ severity: 'medium', code: 'COMPONENT_ADD', target: raw.type, message: `새 부품 '${def.name}'을(를) 추가합니다 (${where}). 부품 안의 글은 이 사이트가 아니라 EqualiUI가 넣는 것입니다.` });
    return { type: raw.type, anchor: position === 'floating' ? null : anchor, position, props };
  }

  function collectTargets(props) {
    const out = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (k === 'targetSelector' ? out.push(String(x)) : walk(x)));
    };
    walk(props);
    return out;
  }

  /* ------------------------------------------------------------------------
     5. 통합 감사
     ------------------------------------------------------------------------ */
  function auditProposal(proposal, pageData) {
    const findings = [];
    const p = proposal || {};
    const interactiveSelectors = new Map();
    for (const it of (pageData && Array.isArray(pageData.interactiveMap) ? pageData.interactiveMap : [])) {
      if (it && it.selector) interactiveSelectors.set(it.selector, (it.text || it.tag || '요소').slice(0, 30));
    }

    const sensitive = isSensitiveContext(pageData);
    const css = sanitizeCss(p.generatedCss || '', findings);

    let dom = [];
    let js = {};
    const rawDom = Array.isArray(p.generatedDom) ? p.generatedDom : [];
    const rawJs = p.generatedJs && typeof p.generatedJs === 'object' ? p.generatedJs : {};

    if (sensitive && (rawDom.length > 0 || Object.keys(rawJs).length > 0)) {
      findings.push({ severity: 'block', code: 'SENSITIVE_PAGE', target: (pageData && pageData.domain) || '', message: '로그인·결제 등 민감한 페이지에서는 안전을 위해 모양(CSS)만 바꾸고, 요소 추가와 동작 스크립트는 적용하지 않습니다.' });
    } else {
      dom = rawDom.slice(0, 12).map(item => auditDomItem(item, interactiveSelectors, findings)).filter(Boolean);
      for (const [selector, code] of Object.entries(rawJs).slice(0, 6)) {
        if (auditJsBlock(selector, code, interactiveSelectors, findings)) js[selector] = code;
      }
    }

    const components = (Array.isArray(p.components) ? p.components : []).slice(0, 4)
      .map(c => auditComponent(c, interactiveSelectors, sensitive, findings)).filter(Boolean);
    if (Array.isArray(p.components) && p.components.length > 4) {
      findings.push({ severity: 'info', code: 'COMPONENT_LIMIT', target: '', message: '부품은 한 번에 4개까지만 추가합니다. 나머지는 제외했습니다.' });
    }

    let rank = 0;
    for (const f of findings) rank = Math.max(rank, SEVERITY_RANK[f.severity] || 0);
    const hasJs = Object.keys(js).length > 0;
    let riskLevel = 'low';
    if (rank >= SEVERITY_RANK.high) riskLevel = 'high';
    else if (rank >= SEVERITY_RANK.medium || hasJs) riskLevel = 'medium';

    return {
      riskLevel,
      sensitiveContext: sensitive,
      findings,
      blockedCount: findings.filter(f => f.severity === 'block').length,
      sanitized: { generatedCss: css, generatedDom: dom, generatedJs: js, components },
      isEmpty: !css.trim() && dom.length === 0 && !hasJs && components.length === 0
    };
  }

  const api = { auditProposal, sanitizeCss, isSensitiveContext, SEVERITY_RANK, COMPONENT_CATALOG };
  root.EqualiSafety = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
