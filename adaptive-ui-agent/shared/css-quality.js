/**
 * EqualiUI CSS Quality Guard — 실제 사이트에서 확인된 "깨지는 패턴"을 적용 전에 고친다.
 *
 * 사례(2026-09-20, google.com 검색 결과): "버튼과 링크를 또렷하게" 요청에 AI 가 모든 a/button 에 border 를 둘렀다.
 *   - 링크(a)는 대부분 inline 이라 여러 줄에 걸치거나 블록(h3, div, img)을 감싸면 상자가 조각나 글자 위로 선이 지나간다.
 *   - 크기가 0 인 링크에도 테두리가 그려져 화면에 막대가 생긴다.
 *   - border 는 자리를 차지해 레이아웃을 민다.
 * 따라서 "넓은 범위의 링크 선택자"에 상자(border/outline/box-shadow 테두리)를 두르는 선언은 밑줄 강조로 바꾸고,
 * "넓은 범위의 버튼 선택자"의 border 는 자리를 차지하지 않는 outline 으로 바꾼다.
 * 사례(같은 날, 같은 페이지): "주요 검색 조작 요소 강조" 요청에 버튼 전체에 연한 배경만 칠해 "로그인" 글자가 보이지 않게 됐다.
 *   → 넓은 범위의 버튼 선택자에 글자색 없이 배경만 칠하는 선언은 뺀다 (글자색을 함께 정한 경우는 실제 페이지에서 대비를 잰다).
 * 좁은 범위(클래스·id 로 특정한 요소)는 AI 의 의도를 존중해 건드리지 않는다. 순수 함수 (Node 테스트 가능).
 */
(function (root) {
  'use strict';

  const LINK_UNDERLINE = ' text-decoration: underline !important; text-decoration-thickness: 2px !important; text-underline-offset: 3px !important;';

  // 선택자의 마지막 부분이 클래스·id 없이 태그(와 가상 클래스)만으로 끝나면 "넓은 범위"로 본다: a, main a, a:link, button:not(.x) ...
  function broadTag(selector) {
    const last = selector.trim().split(/[\s>+~]+/).pop() || '';
    const m = /^(a|button|input|select|summary|\[role=["']?(?:button|link)["']?\])((?::[\w-]+(?:\([^)]*\))?)*)$/i.exec(last);
    if (!m) return null;
    if (/[.#]/.test(last.replace(/:not\([^)]*\)/g, ''))) return null;
    return /^a$/i.test(m[1]) || /link/i.test(m[1]) ? 'link' : 'control';
  }

  // 선언을 하나씩 나눠 속성 이름으로 판단한다 (정규식으로 이어 붙여 지우면 연속된 선언을 놓친다)
  const decls = (body) => body.split(';').map(d => d.trim()).filter(Boolean).map(d => ({ prop: d.slice(0, d.indexOf(':')).trim().toLowerCase(), value: d.slice(d.indexOf(':') + 1).trim(), raw: d }));
  const isBoxProp = (prop) => /^(border(-(top|right|bottom|left))?(-(width|style|color))?|outline(-(width|style|color|offset))?|box-shadow)$/.test(prop);
  const isLayoutProp = (prop) => /^(padding|margin)(-|$)|^display$/.test(prop);

  function splitRules(css) {
    const out = [];
    let i = 0;
    while (i < css.length) {
      const open = css.indexOf('{', i);
      if (open === -1) { out.push({ raw: css.slice(i) }); break; }
      let depth = 1, j = open + 1;
      while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      out.push({ prelude: css.slice(i, open), body: css.slice(open + 1, j - 1) });
      i = j;
    }
    return out;
  }

  function improveCss(css) {
    const notes = [];
    if (!css || typeof css !== 'string') return { css: css || '', notes };
    const result = splitRules(css).map(rule => {
      if (rule.raw !== undefined) return rule.raw;
      const prelude = rule.prelude.trim();
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|layer|container)/i.test(prelude)) {
          const inner = improveCss(rule.body);
          notes.push(...inner.notes);
          return `${rule.prelude}{${inner.css}}`;
        }
        return `${rule.prelude}{${rule.body}}`;
      }
      const selectors = prelude.split(',').map(s => s.trim()).filter(Boolean);
      const kinds = selectors.map(broadTag);
      let body = rule.body;

      const list = decls(body);
      if (kinds.includes('link') && list.some(d => isBoxProp(d.prop) && !/^(0|none)\b/i.test(d.value))) {
        // 링크와 버튼이 한 규칙에 섞여 있으면 나눠서 처리한다
        const links = selectors.filter((s, idx) => kinds[idx] === 'link');
        const others = selectors.filter((s, idx) => kinds[idx] !== 'link');
        const kept = list.filter(d => !isBoxProp(d.prop) && !isLayoutProp(d.prop)).map(d => ` ${d.raw};`).join('');
        notes.push('링크 전체에 상자를 두르면 여러 줄 링크와 제목에서 깨져 보여, 굵은 밑줄 강조로 바꿨습니다.');
        const parts = [`${links.join(', ')} {${kept}${LINK_UNDERLINE}}`];
        if (others.length) {
          const rest = improveCss(`${others.join(', ')} {${body}}`);
          notes.push(...rest.notes);
          parts.push(rest.css);
        }
        return parts.join('\n');
      }

      if (kinds.includes('control') && list.some(d => d.prop === 'border' && !/^(0|none)\b/i.test(d.value))) {
        body = list.map(d => (d.prop === 'border' && !/^(0|none)\b/i.test(d.value)
          ? ` outline: ${d.value.replace(/\s*!important/i, '')} !important; outline-offset: 2px !important;`
          : ` ${d.raw};`)).join('');
        notes.push('버튼 전체의 테두리는 자리를 밀어내지 않도록 바깥선(outline)으로 바꿨습니다.');
      }
      const finalList = decls(body);
      const paintsBg = finalList.some(d => /^background(-color)?$/.test(d.prop) && !/^(none|transparent|inherit|initial|unset)\b/i.test(d.value));
      if (kinds.includes('control') && paintsBg && !finalList.some(d => d.prop === 'color')) {
        body = finalList.filter(d => !/^background(-color)?$/.test(d.prop)).map(d => ` ${d.raw};`).join('');
        notes.push('버튼 전체에 글자색 없이 배경만 칠하면 글자가 안 보일 수 있어, 배경은 빼고 바깥선 강조만 남겼습니다.');
      }
      return `${rule.prelude}{${body}}`;
    }).join('');
    return { css: result, notes: Array.from(new Set(notes)) };
  }

  const api = { improveCss, broadTag };
  root.EqualiCssQuality = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
