/**
 * EqualiUI Page Extractor — 페이지에서 "의미"를 뽑아 페이지 모델을 만든다. (효자손 extractor.js 를 바탕으로 다시 작성)
 *
 * 재구성 화면(rebuild/audio)은 이 모델만 보고 새로 그려진다. 효자손과 달라진 점:
 *   - 모든 요소에 참조 번호(ref: A1, I1, C1 …)를 붙인다. AI 는 selector 를 직접 쓰지 못하고 ref 만 고를 수 있다
 *     → 재구성 화면의 버튼이 "추출된 실제 요소" 말고 다른 것을 누를 방법이 없다.
 *   - 각 ref 의 실제 DOM 요소를 기억해 두었다가(refs) 그대로 누른다. selector 는 요소가 사라졌을 때의 예비 수단.
 *   - 비밀번호·결제 입력란은 아예 추출하지 않고, 결제·삭제처럼 되돌리기 어려운 동작은 sensitive 로 표시한다.
 *   - 광고 판별: class 에 'ad' 가 "글자로" 들어 있기만 해도 광고로 보던 것(header, download, shadow 가 모두 광고가 됨)을 단어 경계로 고쳤다.
 *   - 기본은 스크롤 없이 읽고(depth 0), 내용이 부족할 때만 스크롤하며 더 읽는다.
 */
(function (root) {
  'use strict';

  const AD_TOKEN_RE = /(^|[-_\s])(ad|ads|adsense|advert\w*|sponsor\w*|promoted|banner[-_]?ad|powerlink)([-_\s\d]|$)/i;
  const AD_SELECTOR = '[data-ad], [data-ad-type], [data-advertisement], iframe[src*="doubleclick"], iframe[src*="googlesyndication"], .adsbygoogle, [aria-label*="광고"], [aria-label*="Sponsored" i]';
  const AD_BADGES = new Set(['광고', 'AD', 'Ad', 'ad', '스폰서', 'Sponsored', '파워링크', '파워컨텐츠', '브랜드검색']);
  const PROMO_PATTERNS = ['포인트를 받을 수 있습니다', '클립 올리면', '클립을 올리면', '매월 포인트', '매월 최대', '쿠폰 받기', '첫 구매 혜택'];
  const SENSITIVE_ACTION_RE = /결제|구매|주문하기|바로구매|송금|이체|삭제|탈퇴|해지|환불|승인|pay\b|purchase|buy now|checkout|delete|remove account|unsubscribe/i;
  const PAGINATION_RE = /^(다음|이전|다음\s?페이지|이전\s?페이지|next|prev|previous|›|»|‹|«|>|<)$/i;
  const BODY_ROOTS = 'main, [role="main"], article, .content, #content, #main, #mw-content-text, .article-body, .news_end, #mainPackContents, .mw-parser-output, .se-main-container, .postViewArea, #articleBodyContents, #newsct_article, .news_view, #dic_area, .wiki-paragraph';
  const ITEM_SELECTOR = 'article, [role="article"], .card, .item, .result, .post, li, .bx, .api_subject_bx, .news_area, .g, .tF2Cxc, section, [class*="_item"], [class*="_card"], [class*="total_tit"]';

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const clean = (str, max) => String(str || '').replace(/\s+/g, ' ').trim().slice(0, max);

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0.05;
  }

  function isAdElement(el) {
    for (let node = el, depth = 0; node && node !== document.body && depth < 6; node = node.parentElement, depth++) {
      const cls = typeof node.className === 'string' ? node.className : '';
      if (AD_TOKEN_RE.test(cls) || AD_TOKEN_RE.test(node.id || '')) return true;
      try { if (node.matches(AD_SELECTOR)) return true; } catch (e) {}
    }
    for (const badge of el.querySelectorAll('span, em, strong, label')) {
      if (AD_BADGES.has(badge.textContent.trim())) return true;
    }
    const text = (el.textContent || '').trim();
    return text.length < 200 && PROMO_PATTERNS.some(p => text.includes(p));
  }

  function regionOf(el) {
    if (el.closest('nav, [role="navigation"]')) return 'nav';
    if (el.closest('header, [role="banner"]')) return 'header';
    if (el.closest('footer, [role="contentinfo"]')) return 'footer';
    if (el.closest('aside, [role="complementary"]')) return 'aside';
    if (el.closest('main, article, [role="main"]')) return 'main';
    return 'other';
  }

  function buildSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const path = [];
    for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
      if (cur.id) { path.unshift(`#${CSS.escape(cur.id)}`); break; }
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) seg += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      path.unshift(seg);
    }
    return path.join(' > ');
  }

  function findLabel(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return clean(label.textContent, 40);
    }
    const wrap = el.closest('label');
    if (wrap) return clean(wrap.textContent, 40);
    return clean(el.getAttribute('aria-label') || el.placeholder || el.title || el.name, 40);
  }

  // 눈에 잘 띄는 요소일수록 높은 값: 크기, 글자 크기, 위쪽, 내비게이션/헤더
  function prominence(el, region) {
    const rect = el.getBoundingClientRect();
    const fontPx = parseFloat(getComputedStyle(el).fontSize) || 14;
    let score = Math.min(40, (rect.width * rect.height) / 600) + Math.min(20, fontPx);
    if (rect.top + window.scrollY < window.innerHeight) score += 15;
    if (region === 'nav' || region === 'header') score += 12;
    if (region === 'footer') score -= 15;
    if (region === 'aside') score -= 8;
    return Math.round(score);
  }

  /* ---------------- 펼침 메뉴 (마우스를 올려야 나타나는 하위 메뉴) ---------------- */
  const MENU_ROOTS = 'nav, header, [role="navigation"], [role="menubar"], [role="menu"], [id*="gnb" i], [class*="gnb" i], [id*="lnb" i], [class*="lnb" i], [class*="menu" i], [class*="nav" i]';
  const ownText = (node) => clean(node.innerText || node.textContent, 30);
  const groupLabelOf = (el) => {
    // (1) 조상 li 가운데, 지금 보이는 첫 링크·버튼을 가진 것 (가장 흔한 구조: li > a + ul > li > a)
    for (let li = el.parentElement && el.parentElement.closest('li'); li; li = li.parentElement && li.parentElement.closest('li')) {
      const head = Array.from(li.querySelectorAll('a, button, [role="button"], [role="menuitem"]')).find(x => x !== el && !x.contains(el) && isVisible(x));
      if (head && ownText(head)) return { label: ownText(head), headEl: head };
    }
    // (2) 같은 칸 안의 제목 (전체 메뉴 판에 칸마다 제목이 있는 구조)
    for (let box = el.parentElement; box && !box.matches('nav, header, body'); box = box.parentElement) {
      const title = box.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > strong, :scope > .tit, :scope > .title, :scope > dt, :scope > a:first-child, :scope > p:first-child');
      if (title && !title.contains(el)) { const label = clean(title.textContent, 30); if (label && label !== clean(el.textContent, 30)) return { label, headEl: null }; }
    }
    return { label: '', headEl: null };
  };

  /** 화면 설명처럼 가볍게 쓰는 곳을 위한 목록: [{ label, children: [글자] }] (재구성 화면은 extract() 의 model.menus 를 쓴다) */
  function listHiddenMenus(maxGroups = 8) {
    const groups = new Map();
    const seen = new Set();
    document.querySelectorAll(MENU_ROOTS).forEach(rootEl => {
      if (rootEl.closest('equali-ui-host, equali-part, footer')) return;
      rootEl.querySelectorAll('a[href]').forEach(el => {
        if (isVisible(el) || el.closest('footer') || /^javascript:/i.test(el.getAttribute('href') || '')) return;
        const text = clean(el.textContent || el.getAttribute('aria-label') || el.title, 40);
        if (!text || seen.has(text + '|' + el.href) || isAdElement(el) || SENSITIVE_ACTION_RE.test(text)) return;
        seen.add(text + '|' + el.href);
        const label = groupLabelOf(el).label || '그 밖의 메뉴';
        if (!groups.has(label)) groups.set(label, []);
        if (groups.get(label).length < 10) groups.get(label).push(text);
      });
    });
    return Array.from(groups.entries()).filter(([, c]) => c.length).slice(0, maxGroups).map(([label, children]) => ({ label, children }));
  }

  /* ---------------- 본문 글자 덩어리 찾기 (태그 이름이나 클래스에 기대지 않는다) ----------------
     글자 노드를 모두 돌며 가장 가까운 블록 요소별로 글을 모은다. 문장처럼 끝나는 50자 이상의 덩어리만 문단으로 본다.
     메뉴·머리말·꼬리말·목차·각주·양식 안의 글과, 저작권·이용 약관 같은 상투 문구는 뺀다. */
  const MAX_PARAGRAPHS = 60;
  const BOILERPLATE_RE = /CC BY|reCAPTCHA|Privacy Policy|Terms of Service|All rights reserved|Copyright|저작권|이용 ?약관|개인정보 ?처리방침|무단 ?전재|쿠키를 사용/i;
  const BLOCK_DISPLAY_RE = /^(block|list-item|table-cell|flex|grid|flow-root|table-caption)$/;
  const SKIP_TEXT_SEL = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], script, style, noscript, button, select, textarea, form, sup, #toc, .toc, [class*="toc" i], [class*="footnote" i], equali-ui-host, equali-part';
  const cleanParagraph = (text) => clean(String(text || '').replace(/\[\d+\]|\[편집\]|\[edit\]/g, ''), 600);

  function textBlocks() {
    const blocks = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, visited = 0;
    while ((node = walker.nextNode()) && visited++ < 30000) {
      const text = node.nodeValue.replace(/\s+/g, ' ');
      if (!text.trim()) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_TEXT_SEL)) continue;
      let el = parent;
      while (el && el !== document.body && !BLOCK_DISPLAY_RE.test(getComputedStyle(el).display)) el = el.parentElement;
      if (!el || el === document.body) continue;
      blocks.set(el, (blocks.get(el) || '') + text);
    }
    const out = [];
    for (const [el, raw] of blocks) {
      if (out.length >= MAX_PARAGRAPHS) break;
      const t = cleanParagraph(raw);
      if (t.length < 50 || !/[.!?。]|[다요죠음함임]\s*$/.test(t) || BOILERPLATE_RE.test(t) || out.includes(t)) continue;
      if (!isVisible(el) || el.getBoundingClientRect().width < 200 || isAdElement(el)) continue;
      out.push(t);
    }
    return out;
  }

  function waitForHydration() {
    return new Promise(resolve => {
      const app = document.querySelector('#__next, #__nuxt, #__gatsby, #app, #root, [data-reactroot]');
      if (!app || (app.children.length > 0 && app.textContent.trim().length > 0)) return resolve();
      let done = false;
      const finish = () => { if (!done) { done = true; observer.disconnect(); resolve(); } };
      const observer = new MutationObserver(() => { if (app.children.length > 0 && app.textContent.trim().length > 0) setTimeout(finish, 400); });
      observer.observe(app, { childList: true, subtree: true });
      setTimeout(finish, 3000);
    });
  }

  function collectItems(seen, items, actionRefByEl) {
    document.querySelectorAll(ITEM_SELECTOR).forEach(el => {
      if (items.length >= 40 || el.closest('nav, header, footer, equali-ui-host, equali-part')) return;
      // 메뉴 묶음(보이든 숨었든)은 "내용"이 아니다 → 메뉴 구역에서 따로 다룬다
      if (el.closest('[role="navigation"], [role="menubar"], [role="menu"], [id*="gnb" i], [class*="gnb" i], [id*="lnb" i], [class*="lnb" i]') || !isVisible(el)) return;
      // 제목 태그가 있으면 그것을 쓴다 (링크 전체를 쓰면 주소·제목이 한 덩어리로 붙는다)
      const heading = el.querySelector('h1, h2, h3, h4') || el.querySelector('a[class*="tit"]') || el.querySelector('a');
      const desc = el.querySelector('p, .desc, .description, .summary, .snippet, [class*="desc"], [class*="dsc"]');
      const link = el.querySelector('a[href]');
      let headingText = clean(heading && (heading.innerText || heading.textContent), 100);
      let descText = clean(desc && desc.textContent, 220);
      if (!headingText && !descText) {
        const full = clean(el.textContent, 220);
        if (full.length > 20) descText = full;
      }
      if (!headingText && !descText) return;
      if (headingText && descText.startsWith(headingText)) descText = descText.slice(headingText.length).trim();
      const key = headingText.slice(0, 40) + '|' + descText.slice(0, 40);
      if (seen.has(key)) return;
      seen.add(key);
      // 같은 글을 담은 바깥 상자(li 안의 div 등)는 하나만 남긴다
      if (items.some(it => it.heading === headingText && headingText)) return;
      items.push({ heading: headingText, description: descText, linkEl: link || null, isAd: isAdElement(el), words: (headingText + descText).length });
    });
  }

  async function extract(depth = 0) {
    await waitForHydration();
    const refs = new Map(); // ref → Element (이 방문 동안만 유효)
    const seen = new Set();
    const rawItems = [];

    if (depth > 0) {
      const savedY = window.scrollY;
      const viewH = window.innerHeight;
      let prevH = 0;
      for (let i = 0; i < 4 + depth * 4; i++) {
        window.scrollTo({ top: viewH * (i + 1), behavior: 'instant' });
        await sleep(200);
        collectItems(seen, rawItems);
        const h = document.documentElement.scrollHeight;
        if (h === prevH && viewH * (i + 1) >= h) break;
        prevH = h;
      }
      window.scrollTo({ top: savedY, behavior: 'instant' });
    } else {
      collectItems(seen, rawItems);
    }

    const sensitivePage = Boolean(document.querySelector('input[type="password"], input[autocomplete^="cc-"], input[name*="card" i][name*="num" i]'));

    // --- 입력란 (비밀번호·결제·숨김 제외)
    const inputs = [];
    document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="number"], input:not([type]), textarea, select').forEach(el => {
      if (inputs.length >= 12 || !isVisible(el) || el.closest('equali-ui-host, equali-part')) return;
      if (/^cc-|password|one-time-code/i.test(el.autocomplete || '') || /card|cvc|cvv|passw|주민|계좌/i.test(`${el.name} ${el.id}`)) return;
      const ref = `I${inputs.length + 1}`;
      refs.set(ref, el);
      const form = el.closest('form');
      inputs.push({
        ref, label: findLabel(el), type: el.tagName === 'SELECT' ? 'select' : (el.type || 'text'), placeholder: clean(el.placeholder, 40),
        isSearch: el.type === 'search' || /search|query|검색|^q$/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''} ${form ? form.getAttribute('role') || '' : ''}`),
        options: el.tagName === 'SELECT' ? Array.from(el.options).slice(0, 12).map(o => ({ value: o.value, text: clean(o.textContent, 30) })) : [],
        selector: buildSelector(el), prominence: prominence(el, regionOf(el))
      });
    });

    // --- 누를 수 있는 것 (링크·버튼)
    const actions = [];
    const seenAction = new Set();
    const pagination = { prevRef: null, nextRef: null };
    document.querySelectorAll('a[href], button, [role="button"], input[type="button"], input[type="submit"]').forEach(el => {
      if (actions.length >= 120 || el.closest('equali-ui-host, equali-part')) return;
      const isLink = el.tagName === 'A';
      if (isLink && (!el.href || /^javascript:/i.test(el.getAttribute('href') || ''))) return;
      const text = clean(el.innerText || el.value || el.getAttribute('aria-label') || el.title || (el.querySelector('img') && el.querySelector('img').alt), 50);
      if (!text || !isVisible(el)) return;
      const key = `${text}|${isLink ? el.href : ''}`;
      if (seenAction.has(key)) return;
      seenAction.add(key);
      const region = regionOf(el);
      const ref = `A${actions.length + 1}`;
      refs.set(ref, el);
      const inPasswordForm = Boolean(el.closest('form') && el.closest('form').querySelector('input[type="password"]'));
      actions.push({
        ref, kind: isLink ? 'link' : 'button', text, href: isLink ? el.href : undefined, region,
        sameSite: isLink ? (() => { try { return new URL(el.href).hostname === location.hostname; } catch (e) { return false; } })() : true,
        isAd: isAdElement(el), sensitive: inPasswordForm || SENSITIVE_ACTION_RE.test(text),
        submits: !isLink && (el.type === 'submit' || (el.tagName === 'BUTTON' && el.type !== 'button' && Boolean(el.closest('form')))),
        selector: buildSelector(el), prominence: prominence(el, region)
      });
      if (PAGINATION_RE.test(text) || /다음|next/i.test(el.getAttribute('aria-label') || '') || /이전|prev/i.test(el.getAttribute('aria-label') || '')) {
        const isNext = /다음|next|›|»|>/i.test(text + (el.getAttribute('aria-label') || ''));
        if (isNext && !pagination.nextRef) pagination.nextRef = ref; else if (!isNext && !pagination.prevRef) pagination.prevRef = ref;
      }
    });
    // --- 펼침 메뉴: 마우스를 올려야 나타나는 하위 메뉴는 화면에 보이지 않아 위에서 모두 빠진다.
    // 마우스를 정밀하게 다루기 어렵거나 화면을 보지 못하는 사용자는 이 메뉴에 닿을 방법이 없으므로, 묶음 이름과 함께 따로 읽어 둔다.
    const menus = [];
    const menuByLabel = new Map();
    let hiddenCount = 0;
    document.querySelectorAll(MENU_ROOTS).forEach(rootEl => {
      if (rootEl.closest('equali-ui-host, equali-part, footer')) return;
      rootEl.querySelectorAll('a[href]').forEach(el => {
        if (hiddenCount >= 80 || isVisible(el) || el.closest('footer')) return;
        if (!el.href || /^javascript:/i.test(el.getAttribute('href') || '')) return;
        const text = clean(el.textContent || el.getAttribute('aria-label') || el.title, 40);
        if (!text || isAdElement(el) || SENSITIVE_ACTION_RE.test(text)) return;
        const key = `${text}|${el.href}`;
        if (seenAction.has(key)) return; // 이미 보이는 링크로 잡혔다
        seenAction.add(key);
        const { label, headEl } = groupLabelOf(el);
        const groupKey = label || '그 밖의 메뉴';
        if (!menuByLabel.has(groupKey)) {
          const group = { label: groupKey, ref: headEl ? (Array.from(refs.entries()).find(([, x]) => x === headEl) || [null])[0] : null, children: [] };
          menuByLabel.set(groupKey, group);
          menus.push(group);
        }
        const group = menuByLabel.get(groupKey);
        if (group.children.length >= 14) return;
        const ref = `A${actions.length + 1}`;
        refs.set(ref, el);
        hiddenCount++;
        let sameSite = false;
        try { sameSite = new URL(el.href).hostname === location.hostname; } catch (e) {}
        // hidden: 화면 설계의 "주요 조작"에는 쓰지 않고 메뉴 구역에만 쓴다
        actions.push({ ref, kind: 'link', text, href: el.href, region: 'nav', sameSite, isAd: false, sensitive: false, submits: false, selector: buildSelector(el), prominence: 0, hidden: true, menuGroup: groupKey });
        group.children.push({ ref, text });
      });
    });
    const menuList = menus.filter(m => m.children.length > 0).slice(0, 10);

    const refByEl = new Map(Array.from(refs.entries()).map(([ref, el]) => [el, ref]));

    // --- 내용 묶음 (검색 결과·기사 목록·카드)
    const items = rawItems.slice(0, 40).map((it, i) => ({
      ref: `C${i + 1}`, heading: it.heading, description: it.description, isAd: it.isAd,
      linkRef: it.linkEl ? (refByEl.get(it.linkEl) || null) : null
    }));

    // --- 본문: 먼저 <p> 문단을 읽고, 글이 거의 안 잡히면(<p> 를 쓰지 않는 사이트: 나무위키 등) 글자 덩어리를 직접 찾는다
    let bodyText = [];
    const bodyRoots = document.querySelectorAll(BODY_ROOTS);
    (bodyRoots.length ? Array.from(bodyRoots) : [document.body]).forEach(rootEl => {
      rootEl.querySelectorAll('p').forEach(p => {
        const t = cleanParagraph(p.textContent);
        if (bodyText.length < MAX_PARAGRAPHS && t.length > 40 && !isAdElement(p) && !BOILERPLATE_RE.test(t) && !bodyText.includes(t)) bodyText.push(t);
      });
    });
    if (bodyText.join(' ').length < 600) {
      const blocks = textBlocks();
      if (blocks.join(' ').length > bodyText.join(' ').length) bodyText = blocks;
    }

    const tables = [];
    document.querySelectorAll('table').forEach(table => {
      if (tables.length >= 2 || isAdElement(table)) return;
      const headers = Array.from(table.querySelectorAll('th')).slice(0, 8).map(th => clean(th.textContent, 30));
      const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 8).map(tr => Array.from(tr.querySelectorAll('td')).slice(0, 8).map(td => clean(td.textContent, 50))).filter(r => r.length);
      if (headers.length || rows.length) tables.push({ headers, rows });
    });

    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(isVisible).slice(0, 15).map(h => ({ level: +h.tagName[1], text: clean(h.textContent, 80) })).filter(h => h.text);
    const media = { video: Boolean(document.querySelector('video, iframe[src*="youtube"], iframe[src*="vimeo"]')), audio: Boolean(document.querySelector('audio')) };

    const model = {
      title: clean(document.title, 100), url: location.href, hostname: location.hostname,
      description: clean((document.querySelector('meta[name="description"]') || {}).content || (document.querySelector('meta[property="og:description"]') || {}).content, 200),
      language: document.documentElement.lang || '', sensitivePage, media,
      headings, inputs, actions, items, bodyText, tables, pagination, menus: menuList,
      stats: { links: actions.filter(a => a.kind === 'link').length, buttons: actions.filter(a => a.kind === 'button').length, ads: actions.filter(a => a.isAd).length + items.filter(i => i.isAd).length, textLength: bodyText.join(' ').length }
    };
    return { model, refs };
  }

  root.EqualiExtractor = { extract, isAdElement, buildSelector, listHiddenMenus };
})(typeof self !== 'undefined' ? self : this);
