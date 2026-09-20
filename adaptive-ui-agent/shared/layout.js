/**
 * EqualiUI Layout Planner — 화면 재구성 알고리즘
 *
 *   페이지 모델(content/extractor.js) + 페르소나(shared/persona.js)
 *     → 설계 후보 여러 개 (AI 후보 + AI 없이 만드는 로컬 후보)
 *     → 후보마다 안전 감사(auditLayout): AI 는 추출된 요소의 참조 번호(ref)만 고를 수 있고,
 *        버튼 이름이 실제 대상과 다르면 실제 이름으로 되돌린다. 광고·민감 동작을 걸러낸다.
 *     → 채점(scoreLayout): 타당성 · 페이지 핵심 기능의 보존 · 페르소나 적합 · 깔끔함
 *     → 1위를 그리고, 나머지는 "더 간단하게 / 더 자세히"로 바로 바꿔 볼 수 있게 남긴다.
 *
 * 재구성 화면은 원래 페이지를 고치지 않는 "보기"이므로 띄우는 데 승인이 필요 없다.
 * 위험은 "새 화면의 버튼이 원래 페이지에서 무엇을 누르는가"에 있고, 그것을 여기서 막는다.
 * 순수 함수만 포함 (Node 테스트 가능).
 */
(function (root) {
  'use strict';

  const DENSITIES = { essential: '꼭 필요한 것만', balanced: '고르게', detailed: '자세히' };

  /** 재구성 화면의 불만족 이유를 실제로 제공 가능한 다른 보기로 연결한다. */
  // views: 화면이 제공하는 다른 "형태"(text = 글로만, steps = 하나씩). 주지 않으면 정보량·소리·원래 화면 안에서만 고른다.
  function suggestAlternative({ reason, density, voice = false, available = [], views = [], view = 'full', tried = [] } = {}) {
    const choices = new Set(available.filter(d => DENSITIES[d]));
    const viewOption = (next) => (views.includes(next) && view !== next && !tried.includes(next)) ? {
      kind: 'view', view: next,
      title: next === 'steps' ? '하나씩 고르며 보기' : '글로만 보기',
      why: next === 'steps' ? '한 화면에 한 가지만 묻고, 고르신 것만 이어서 보여 드립니다.' : '버튼과 꾸밈을 빼고, 제목과 내용만 글로 차례대로 보여 드립니다.'
    } : null;
    if (views.length) {
      if (reason === 'too_many') return densityOption2(choices, density, 'essential', '핵심만 보기', '버튼과 내용을 줄여 한눈에 살펴봅니다.') || viewOption('steps') || { kind: 'original', title: '원래 화면 보기', why: '이미 가장 간단한 보기입니다.' };
      if (reason === 'hard_to_read' && voice) return viewOption('text') || viewOption('steps') || { kind: 'original', title: '원래 화면 보기', why: '다른 보기를 모두 시도했습니다.' };
      if (reason === 'hard_to_use') return viewOption('steps') || densityOption2(choices, density, 'essential', '조작을 단순하게 보기', '고를 버튼을 줄여 다시 구성합니다.') || { kind: 'original', title: '원래 화면 보기', why: '원래 페이지의 조작을 직접 이용할 수 있습니다.' };
      if (reason === 'other' || reason === 'hesitation') { const v = viewOption('steps') || viewOption('text'); if (v) return v; }
    }
    const densityOption = (next, title, why) => choices.has(next) && next !== density
      ? { kind: 'density', density: next, title, why } : null;
    if (reason === 'too_many') return densityOption('essential', '핵심만 보기', '버튼과 내용을 줄여 한눈에 살펴봅니다.') || { kind: 'original', title: '원래 화면 보기', why: '이미 가장 간단한 보기입니다.' };
    if (reason === 'not_enough') return densityOption('detailed', '더 자세히 보기', '빠진 내용과 선택지를 더 보여 줍니다.') || { kind: 'original', title: '원래 화면 보기', why: '원래 페이지에서 모든 내용을 볼 수 있습니다.' };
    if (reason === 'hard_to_read' && !voice) return { kind: 'audio', title: '소리로 듣기', why: '현재 화면의 제목과 주요 내용을 음성으로 읽어 드립니다.' };
    if (reason === 'hard_to_use') return densityOption('essential', '조작을 단순하게 보기', '고를 버튼을 줄여 다시 구성합니다.') || { kind: 'original', title: '원래 화면 보기', why: '원래 페이지의 조작을 직접 이용할 수 있습니다.' };
    return densityOption('balanced', '다른 구성 보기', '내용과 버튼의 양을 바꿔 다시 살펴봅니다.')
      || densityOption('essential', '핵심만 보기', '간단한 구성으로 다시 살펴봅니다.')
      || densityOption('detailed', '더 자세히 보기', '내용을 늘려 다시 살펴봅니다.')
      || { kind: 'original', title: '원래 화면 보기', why: '현재 페이지에서 제공할 다른 구성이 없습니다.' };
  }

  const densityOption2 = (choices, current, next, title, why) => (choices.has(next) && next !== current ? { kind: 'density', density: next, title, why } : null);

  // 쉬운 말로 바꿔 부르는 것이 허용되는 짝 (이 밖의 이름 바꾸기는 실제 이름으로 되돌린다)
  const SYNONYMS = [
    ['검색', '찾기', '찾아보기', 'search'], ['로그인', '들어가기', 'login', 'sign in'], ['회원가입', '가입', 'sign up', 'join'],
    ['홈', '처음으로', '첫 화면', 'home', '메인'], ['뉴스', '소식', 'news'], ['쇼핑', '물건 사기', 'shopping', '장보기'],
    ['메일', '편지', 'mail', '이메일'], ['지도', '길찾기', 'map'], ['다음', 'next', '다음 페이지'], ['이전', 'prev', '이전 페이지', '뒤로'],
    ['더보기', '더 보기', 'more', '전체보기'], ['동영상', '영상', 'video'], ['이미지', '사진', 'image'], ['설정', '환경설정', 'settings'],
    ['문의', '고객센터', '도움말', 'help', 'contact'], ['장바구니', 'cart'], ['카페', 'cafe'], ['블로그', 'blog']
  ];

  // 비교할 때는 뜻이 없는 꼬리말(보기·하기·바로가기 등)을 떼어, '영상 보기'와 '더 보기'가 같은 것으로 통과하지 않게 한다
  const norm = (s) => {
    const base = String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const core = base.replace(/(바로가기|보러가기|보기|하기|가기|페이지|으로|에서)/g, '');
    return core.length >= 2 ? core : base;
  };
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  function sameMeaning(label, original) {
    const a = norm(label), b = norm(original);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;
    for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) return true; // 두 글자 이상 겹침
    return SYNONYMS.some(group => group.some(w => a.includes(norm(w))) && group.some(w => b.includes(norm(w))));
  }

  const sentenceList = (text) => String(text || '').split(/(?<=[.!?。])\s+|(?<=다\.)\s*/).map(s => s.trim()).filter(s => s.length > 8);
  const sentences = (text, n) => sentenceList(text).slice(0, n).join(' ');

  /**
   * 원문에서 "한 문단" 분량을 뽑는다. 한 문장짜리 요약은 무엇에 대한 글인지만 알려 주고 끝나므로 쓰지 않는다.
   * 문장이 짧으면 글자 수(minChars)를 채울 때까지 더 담고, 아무리 길어도 maxChars 에서 멈춘다.
   */
  function paragraphOf(text, { max = 4, minChars = 140, maxChars = 560, skip = 0 } = {}) {
    const list = sentenceList(text).slice(skip);
    const out = [];
    for (const sentence of list) {
      if (out.length && out.join(' ').length + sentence.length > maxChars) break;
      out.push(sentence);
      if (out.length >= max && out.join(' ').length >= minChars) break;
    }
    return out.join(' ');
  }

  /* ------------------------------------------------------------------------
     1. 로컬 설계기 — AI 없이도 항상 하나의 후보를 만든다 (API 키가 없거나 실패해도 화면은 구성된다)
     ------------------------------------------------------------------------ */
  // 펼침 메뉴는 설계 대상이 아니라 "있는 그대로 닿게 해 주는" 대상이다. 이름도 대상도 페이지에서 읽은 값만 쓴다.
  const menusOf = (model) => (model.menus || []).slice(0, 10).map(m => ({
    label: clip(m.label, 16), ref: m.ref || null,
    children: (m.children || []).slice(0, 14).map(c => ({ ref: c.ref, label: clip(c.text, 24) }))
  })).filter(m => m.children.length > 0);

  function planLocally(model, persona, density = 'balanced') {
    const L = persona.layout;
    const factor = { essential: 0.6, balanced: 1, detailed: 1.4 }[density];
    const maxActions = Math.max(2, Math.round(L.maxActions * factor));
    const maxItems = Math.max(2, Math.round(L.maxItems * factor));

    const search = (model.inputs || []).filter(i => i.type !== 'select').sort((a, b) => (b.isSearch - a.isSearch) || (b.prominence - a.prominence))[0] || null;

    const usable = (model.actions || []).filter(a => !a.isAd && !a.sensitive && !a.hidden && a.text.length <= 14 && a.text.length >= 1);
    const regionRank = { nav: 0, header: 1, main: 2, other: 3, aside: 4, footer: 5 };
    const actions = usable
      .filter(a => a.ref !== (model.pagination || {}).nextRef && a.ref !== (model.pagination || {}).prevRef)
      // 내비게이션·헤더 안에서는 사이트가 정해 둔 순서(=추출 순서)를 그대로 따른다. 그 밖은 눈에 띄는 순서.
      .sort((a, b) => (regionRank[a.region] - regionRank[b.region]) || (b.sameSite - a.sameSite)
        || (regionRank[a.region] <= 1 ? (parseInt(a.ref.slice(1), 10) - parseInt(b.ref.slice(1), 10)) : (b.prominence - a.prominence)))
      .slice(0, maxActions)
      .map((a, i) => ({ ref: a.ref, label: clip(a.text, 12), primary: i === 0 && !search }));

    const items = [];
    const body = (model.bodyText || []).join(' ');
    // 맨 위 요약: 한 문단 분량 (예전에는 첫 문장 하나만 잘라 써서 "한 줄 요약"이 되었다)
    const leadParagraph = paragraphOf(body, { max: L.summarySentences + 1, minChars: 150 });
    // 맨 위 요약이 앞부분을 담당하므로, 여기에는 그 뒤에 이어지는 내용을 담는다 (같은 문장을 두 번 보여 주지 않는다)
    const leadSentences = sentenceList(leadParagraph).length;
    const more = body.length > 200 ? paragraphOf(body, { max: L.summarySentences + 1, minChars: 160, skip: leadSentences }) : '';
    if (body.length > 200) items.push({ title: '이 글의 핵심', description: clip(more || leadParagraph, 460), ref: null });
    for (const it of (model.items || [])) {
      if (items.length >= maxItems) break;
      if (it.isAd || !it.heading || it.heading.length < 4) continue;
      items.push({ title: clip(it.heading, 50), description: clip(it.description, 110), ref: it.linkRef });
    }

    return {
      source: 'local', density,
      title: clip((model.title || '').split(/[-|–:·]/)[0] || model.hostname, 18),
      summary: clip(leadParagraph.length >= 80 ? leadParagraph : (model.description || leadParagraph), 460),
      input: search ? { ref: search.ref, label: search.isSearch ? '무엇을 찾으시나요?' : (search.label || '입력'), placeholder: search.placeholder || '여기에 입력하세요' } : null,
      actions, items, menus: menusOf(model),
      pagination: { prevRef: (model.pagination || {}).prevRef || null, nextRef: (model.pagination || {}).nextRef || null }
    };
  }

  /* ------------------------------------------------------------------------
     2. 안전 감사 — AI 가 돌려준 설계를 페이지 모델과 대조해 고친다
     ------------------------------------------------------------------------ */
  function auditLayout(raw, model, persona) {
    const notes = [];
    const stats = { invalidRefs: 0, relabeled: 0, adsDropped: 0, sensitive: 0, duplicates: 0 };
    const actionByRef = new Map((model.actions || []).map(a => [a.ref, a]));
    const inputByRef = new Map((model.inputs || []).map(i => [i.ref, i]));
    const itemByLink = new Map((model.items || []).filter(i => i.linkRef).map(i => [i.linkRef, i]));
    const L = persona.layout;
    const r = raw && typeof raw === 'object' ? raw : {};

    let input = null;
    if (r.input && inputByRef.has(r.input.ref)) {
      input = { ref: r.input.ref, label: clip(r.input.label || inputByRef.get(r.input.ref).label || '입력', 30), placeholder: clip(r.input.placeholder || '', 40) };
    } else if (r.input) stats.invalidRefs++;

    const seen = new Set();
    const actions = [];
    for (const a of Array.isArray(r.actions) ? r.actions : []) {
      const target = a && actionByRef.get(a.ref);
      if (!target) { stats.invalidRefs++; continue; }
      if (target.isAd) { stats.adsDropped++; continue; }
      if (target.hidden) continue; // 펼침 메뉴 항목은 메뉴 구역에서만 보여 준다
      if (seen.has(a.ref)) { stats.duplicates++; continue; }
      seen.add(a.ref);
      let label = clip(a.label || target.text, 14);
      // 핵심 안전 규칙: 버튼 이름이 실제 대상과 뜻이 다르면(예: '검색'이라 쓰고 '메일 보내기'를 가리킴) 실제 이름으로 되돌린다
      if (!sameMeaning(label, target.text)) { label = clip(target.text, 14); stats.relabeled++; }
      if (target.sensitive) stats.sensitive++;
      actions.push({ ref: a.ref, label, original: target.text, sensitive: Boolean(target.sensitive), primary: Boolean(a.primary) });
    }
    if (actions.filter(a => a.primary).length !== 1) actions.forEach((a, i) => { a.primary = i === 0 && !input; });

    const items = [];
    for (const it of Array.isArray(r.items) ? r.items : []) {
      if (!it || !(it.title || it.description)) continue;
      let ref = it.ref || null;
      if (ref && !actionByRef.has(ref)) { stats.invalidRefs++; ref = null; }
      if (ref && actionByRef.get(ref).isAd) { stats.adsDropped++; continue; }
      let title = clip(it.title || '', 60);
      const source = ref ? (itemByLink.get(ref) || { heading: actionByRef.get(ref).text }) : null;
      // 링크가 달린 항목의 제목은 원문 제목과 이어져야 한다 (다른 글로 데려가는 제목을 막는다)
      if (source && source.heading && !sameMeaning(title, source.heading)) { title = clip(source.heading, 60); stats.relabeled++; }
      items.push({ title, description: clip(it.description || '', 160), ref, sensitive: Boolean(ref && actionByRef.get(ref).sensitive) });
    }

    const pg = r.pagination || {};
    const pagination = {
      prevRef: actionByRef.has(pg.prevRef) ? pg.prevRef : ((model.pagination || {}).prevRef || null),
      nextRef: actionByRef.has(pg.nextRef) ? pg.nextRef : ((model.pagination || {}).nextRef || null)
    };

    if (stats.invalidRefs) notes.push(`페이지에 없는 대상 ${stats.invalidRefs}개를 뺐습니다.`);
    if (stats.relabeled) notes.push(`이름이 실제 대상과 달랐던 ${stats.relabeled}곳을 원래 이름으로 되돌렸습니다.`);
    if (stats.adsDropped) notes.push(`광고 ${stats.adsDropped}개를 뺐습니다.`);

    return {
      source: r.source || 'ai',
      density: DENSITIES[r.density] ? r.density : 'balanced',
      title: clip(r.title || model.title || model.hostname, 24),
      summary: clip(r.summary || '', 460),
      input,
      actions: actions.slice(0, Math.round(L.maxActions * 1.5)),
      items: items.slice(0, Math.round(L.maxItems * 1.5)),
      menus: menusOf(model), pagination, notes, stats
    };
  }

  /* ------------------------------------------------------------------------
     3. 채점과 선택
     ------------------------------------------------------------------------ */
  function scoreLayout(layout, model, persona, profile = null) {
    const L = persona.layout;
    const reasons = [], problems = [];
    const st = layout.stats || {};

    // (1) 타당성 30: AI 가 지어낸 대상, 고쳐야 했던 이름
    let validity = 30 - Math.min(18, (st.invalidRefs || 0) * 6) - Math.min(9, (st.relabeled || 0) * 3) - Math.min(6, (st.duplicates || 0) * 2);
    if (st.invalidRefs) problems.push(`페이지에 없는 대상을 ${st.invalidRefs}개 골랐습니다`);
    if (st.relabeled) problems.push(`버튼 이름이 실제와 달라 ${st.relabeled}곳을 되돌렸습니다`);
    if (!st.invalidRefs && !st.relabeled) reasons.push('모든 버튼이 페이지의 실제 요소와 이름이 맞습니다');

    // (2) 핵심 기능 보존 30: 이 페이지에서 할 수 있는 중요한 일이 새 화면에도 남아 있는가
    let coverage = 0;
    const hasSearch = (model.inputs || []).some(i => i.isSearch);
    if (hasSearch) { if (layout.input) { coverage += 10; reasons.push('검색창을 그대로 쓸 수 있습니다'); } else problems.push('페이지의 검색창이 빠졌습니다'); } else coverage += 10;
    const pageHasContent = (model.items || []).filter(i => !i.isAd).length >= 3 || (model.stats || {}).textLength > 200;
    if (pageHasContent) { if (layout.items.length >= 2) coverage += 10; else { coverage += layout.items.length * 4; problems.push('페이지의 주요 내용이 거의 담기지 않았습니다'); } } else coverage += 10;
    if (layout.actions.length >= 2) coverage += 5; else problems.push('이동할 수 있는 버튼이 너무 적습니다');
    if (layout.summary) coverage += 3;
    if (!(model.pagination || {}).nextRef || layout.pagination.nextRef) coverage += 2;

    // (3) 페르소나 적합 25
    let fit = 25;
    const over = Math.max(0, layout.actions.length - L.maxActions) + Math.max(0, layout.items.length - L.maxItems);
    if (over) { fit -= Math.min(12, over * 4); problems.push(`${persona.short}에는 고를 것이 너무 많습니다 (${over}개 초과)`); }
    else reasons.push(`버튼 ${layout.actions.length}개 · 내용 ${layout.items.length}개로 ${persona.short}에 맞는 양입니다`);
    const longLabels = layout.actions.filter(a => a.label.length > (L.wording === 'plain' ? 12 : 8)).length;
    if (longLabels) { fit -= Math.min(6, longLabels * 2); problems.push('버튼 이름이 깁니다'); }
    if (L.wording !== 'plain') {
      const avg = layout.items.length ? layout.items.reduce((n, it) => n + it.description.length, 0) / layout.items.length : 0;
      if (avg > 90) { fit -= 5; problems.push('설명이 길어 읽기 어렵습니다'); }
      if (/[A-Za-z]{4,}/.test(layout.actions.map(a => a.label).join(' '))) { fit -= 3; problems.push('버튼에 영어가 남아 있습니다'); }
    }
    fit = Math.max(0, fit);

    // 같은 페르소나 안에서도 실제 사용 기록과 직접 고른 선호에 맞춰 밀도를 조정한다.
    // 관측이 적으면 추론의 영향력을 낮춘다. 안전·핵심 기능 점수는 바꾸지 않는다.
    let personalFit = 0;
    if (profile && profile.dimensions) {
      const dims = profile.dimensions;
      const style = dims.cognitiveStyle || {};
      const weight = profile.explicit ? 1 : Math.max(0, Math.min(1, dims.confidence || 0));
      if (style.detail === 'summary') personalFit += layout.density === 'essential' ? 6 : layout.density === 'detailed' ? -5 : 0;
      if (style.pace === 'stepwise') personalFit += layout.density === 'essential' ? 4 : layout.density === 'detailed' ? -3 : 0;
      if (dims.proficiency?.value === 'expert' && style.detail === 'full') personalFit += layout.density === 'detailed' ? 3 : 0;
      if ((dims.needs?.motor?.score || 0) >= 0.5 && layout.density === 'essential') personalFit += 2;
      personalFit = Math.round(personalFit * weight * 10) / 10;
      if (personalFit > 0) reasons.push('사용 기록과 선호하는 정보량에 맞습니다');
    }

    // (4) 깔끔함 15
    let clean = 15 - Math.min(6, (st.adsDropped || 0) * 2) - Math.min(6, layout.actions.filter(a => a.sensitive).length * 3);
    if (layout.actions.some(a => a.sensitive)) problems.push('결제·삭제 같은 되돌리기 어려운 버튼이 포함되어 있습니다 (누를 때 다시 확인합니다)');
    clean = Math.max(0, clean);

    validity = Math.max(0, validity);
    // 로컬 후보는 페이지의 글자를 그대로 옮길 뿐이다. 감사에서 아무것도 걸리지 않은 AI 후보는 쉬운 말·요약으로 다듬은 만큼 우선한다.
    let polish = 0;
    if (layout.source === 'ai' && !st.invalidRefs && !st.relabeled && !st.adsDropped) { polish = 6; reasons.push('쉬운 말과 요약으로 다듬은 설계입니다'); }
    return { total: Math.round((validity + coverage + fit + clean + polish + personalFit) * 10) / 10, parts: { validity, coverage, fit, clean, polish, personalFit }, reasons: reasons.slice(0, 3), problems: problems.slice(0, 3) };
  }

  /** @param rawCandidates AI 가 돌려준 설계들 (없어도 된다). 로컬 후보 3종은 항상 함께 겨룬다. */
  function selectLayout(rawCandidates, model, persona, profile = null) {
    const pool = [];
    for (const raw of rawCandidates || []) pool.push(auditLayout({ ...raw, source: 'ai' }, model, persona));
    for (const density of ['balanced', 'essential', 'detailed']) pool.push(auditLayout(planLocally(model, persona, density), model, persona));
    const ranked = pool
      .filter(l => l.actions.length + l.items.length + (l.input ? 1 : 0) > 0)
      .map(l => ({ ...l, score: scoreLayout(l, model, persona, profile) }))
      .sort((a, b) => b.score.total - a.score.total || (a.source === 'ai' ? -1 : 1));
    // 같은 밀도는 점수 높은 하나만 남겨, "더 간단하게 / 더 자세히"가 서로 다른 화면이 되게 한다
    const byDensity = [];
    for (const l of ranked) if (!byDensity.some(x => x.density === l.density)) byDensity.push(l);
    return byDensity;
  }

  /* ------------------------------------------------------------------------
     4. 소리 중심 인터페이스용 대본
     ------------------------------------------------------------------------ */
  function spokenIntro(layout, opts = {}) {
    const parts = [`${layout.title} 화면입니다.`];
    // 소리로 들을 때는 메뉴에 빨리 닿아야 하므로 앞 두 문장만 읽고, 나머지는 화면에 둔다 (본문 전체는 B 키)
    if (layout.summary) parts.push(opts.brief ? sentences(layout.summary, 1) : sentences(layout.summary, 2));
    if (layout.input) parts.push(`${layout.input.label} 입력하려면 슬래시 키를 누르세요.`);
    if (layout.actions.length) {
      const keyActions = layout.actions.slice(0, 3).map((a, i) => `${i + 1}번 ${a.label}`).join(', ');
      parts.push(`주요 버튼은 ${keyActions}입니다.${layout.actions.length > 3 && !opts.brief ? ' 나머지 버튼도 숫자 키로 고를 수 있습니다.' : ''}`);
    }
    if (layout.items.length) parts.push(`내용은 ${layout.items.length}개입니다. 아래 화살표로 하나씩 들을 수 있습니다.`);
    if ((layout.menus || []).length) parts.push(`펼쳐야 보이는 메뉴가 ${layout.menus.length}묶음 있습니다. 엠 키를 누르면 읽어 드립니다.`);
    if (!opts.brief) parts.push('숫자 키로 버튼을 누르고, 알 키로 다시 듣고, 이에스씨 키로 원래 화면으로 돌아갑니다.');
    return parts.join(' ');
  }

  /* ------------------------------------------------------------------------
     5. 말로 하는 화면 재구성 — "버튼을 오른쪽으로 옮겨 줘", "글자 더 크게", "내용은 숨겨 줘"
        요청은 재구성 화면(확장이 그린 화면)의 배치만 바꾼다. 원래 페이지와 버튼의 연결은 건드리지 않는다.
        배치는 아래 허용 값만 받는다 (AI 가 돌려준 값도 sanitizeArrangement 를 거친다).
     ------------------------------------------------------------------------ */
  const SECTIONS = ['input', 'actions', 'items', 'menus'];
  const POSITIONS = ['top', 'right', 'left', 'bottom'];
  const defaultArrangement = () => ({ actionsPosition: 'top', order: SECTIONS.slice(), actionsColumns: 0, textScale: 1, hide: [], actionOrder: [] });

  function sanitizeArrangement(raw, layout) {
    const base = defaultArrangement();
    const r = raw && typeof raw === 'object' ? raw : {};
    if (POSITIONS.includes(r.actionsPosition)) base.actionsPosition = r.actionsPosition;
    if (Array.isArray(r.order)) {
      const seen = r.order.filter((x, i) => SECTIONS.includes(x) && r.order.indexOf(x) === i);
      base.order = [...seen, ...SECTIONS.filter(x => !seen.includes(x))];
    }
    const cols = Math.round(Number(r.actionsColumns));
    if (cols >= 1 && cols <= 4) base.actionsColumns = cols;
    const scale = Number(r.textScale);
    if (scale >= 0.85 && scale <= 1.6) base.textScale = Math.round(scale * 100) / 100;
    if (Array.isArray(r.hide)) base.hide = r.hide.filter((x, i) => SECTIONS.includes(x) && r.hide.indexOf(x) === i);
    if (base.hide.length >= SECTIONS.length) base.hide = []; // 전부 숨기면 쓸 수 없는 화면이 된다
    // 버튼 순서: 지금 화면에 있는 버튼의 ref 만 받는다 (없는 버튼을 만들어 낼 수 없다)
    const refs = new Set(((layout && layout.actions) || []).map(a => a.ref));
    if (Array.isArray(r.actionOrder)) base.actionOrder = r.actionOrder.filter((x, i) => refs.has(x) && r.actionOrder.indexOf(x) === i);
    return base;
  }

  /** 자주 쓰는 말은 AI 없이 바로 알아듣는다. 알아듣지 못하면 null → 서비스 워커가 AI 에 묻는다. */
  function interpretArrangement(text, layout, current) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const key = t.replace(/\s+/g, '');
    const now = sanitizeArrangement(current, layout);
    const next = JSON.parse(JSON.stringify(now));
    const done = [];

    if (/원래대로|처음대로|처음 ?배치|배치 ?초기화|되돌려/.test(t)) return { arrangement: defaultArrangement(), say: '화면 배치를 처음대로 되돌렸습니다.', source: 'local' };

    // 무엇을: 버튼 이름을 말했거나 "버튼"이라고 했으면 버튼 묶음, 그 밖에는 말한 구역
    // 한 글자 이름("홈")은 다른 낱말 속에 우연히 들어 있을 수 있어, 낱말로 따로 말했을 때만 인정한다
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const saidAlone = (label) => new RegExp(`(^|[\\s,])${esc(label)}(이랑|랑|과|와|하고|이나|나|도|은|는|을|를|,|\\s|버튼|$)`).test(t);
    const named = ((layout && layout.actions) || []).filter(a => { const l = a.label.replace(/\s+/g, ''); return l.length >= 2 ? key.includes(l) : (l.length === 1 && saidAlone(l)); });
    const target = (named.length || /버튼|단추|바로가기/.test(t)) ? 'actions' : /내용|결과|목록|글/.test(t) ? 'items' : /메뉴/.test(t) ? 'menus' : /검색|입력|찾기/.test(t) ? 'input' : null;
    const SECTION_NAME = { input: '입력 칸', actions: '버튼', items: '내용', menus: '메뉴' };

    const pos = /오른쪽|우측/.test(t) ? 'right' : /왼쪽|좌측/.test(t) ? 'left' : /맨 ?아래|아래|밑|하단/.test(t) ? 'bottom' : /맨 ?위|위로|위에|상단|먼저|앞으로|처음에/.test(t) ? 'top' : null;
    if (pos && /옮|이동|보내|놓|두|배치|올려|내려|보여|먼저|앞으로/.test(t)) {
      const what = target || 'actions';
      if (what === 'actions' && (pos === 'right' || pos === 'left')) { next.actionsPosition = pos; done.push(`버튼을 ${pos === 'right' ? '오른쪽' : '왼쪽'}으로 옮겼습니다`); }
      else if (pos === 'top' || pos === 'bottom') {
        if (what === 'actions') next.actionsPosition = 'top';
        next.order = pos === 'top' ? [what, ...next.order.filter(x => x !== what)] : [...next.order.filter(x => x !== what), what];
        done.push(`${SECTION_NAME[what]}을(를) ${pos === 'top' ? '맨 위' : '맨 아래'}로 옮겼습니다`);
      }
      // 이름을 부른 버튼은 부른 순서대로 앞에 둔다
      if (named.length && what === 'actions') {
        const spoken = named.slice().sort((a, b) => key.indexOf(a.label.replace(/\s+/g, '')) - key.indexOf(b.label.replace(/\s+/g, ''))).map(a => a.ref);
        next.actionOrder = [...spoken, ...layout.actions.map(a => a.ref).filter(r => !spoken.includes(r))];
      }
    }

    if (/(글자|글씨|화면|버튼).*(크게|키워|확대)|더 ?크게/.test(t)) { next.textScale = Math.min(1.6, Math.round((now.textScale + 0.15) * 100) / 100); done.push('글자를 더 크게 했습니다'); }
    else if (/(글자|글씨|화면|버튼).*(작게|줄여|축소)|더 ?작게/.test(t)) { next.textScale = Math.max(0.85, Math.round((now.textScale - 0.15) * 100) / 100); done.push('글자를 더 작게 했습니다'); }

    const colWord = /한 ?줄에 ?(\d|한|두|세|네)|(\d|한|두|세|네) ?(칸|열|개씩)/.exec(t);
    if (colWord) { const w = colWord[1] || colWord[2]; const n = { 한: 1, 두: 2, 세: 3, 네: 4 }[w] || +w; if (n >= 1 && n <= 4) { next.actionsColumns = n; done.push(`버튼을 한 줄에 ${n}개씩 놓았습니다`); } }
    else if (/한 ?줄로|세로로|아래로 ?나란히/.test(t) && (target === 'actions' || !target)) { next.actionsColumns = 1; done.push('버튼을 세로로 한 줄로 놓았습니다'); }

    if (target && /숨겨|빼 ?줘|없애|가려|안 ?보이게|치워/.test(t)) { if (!next.hide.includes(target)) next.hide.push(target); done.push(`${SECTION_NAME[target]}을(를) 숨겼습니다`); }
    else if (/모두 ?보여|다시 ?보여|전부 ?보여|다 ?보여/.test(t)) { next.hide = []; done.push('숨긴 것을 모두 다시 보여 드립니다'); }
    else if (target && /만 ?보여|만 ?남겨|만 ?볼래/.test(t)) { next.hide = SECTIONS.filter(x => x !== target && x !== 'input'); done.push(`${SECTION_NAME[target]}만 보여 드립니다`); }

    if (!done.length) return null;
    return { arrangement: sanitizeArrangement(next, layout), say: done.join('. ') + '. 처음대로 하려면 원래대로 라고 말씀하세요.', source: 'local' };
  }

  /* ------------------------------------------------------------------------
     6. 읽기 도움 (쉬운 요약 · 밑줄 · 낱말 풀이) — 글자만 다루고, 원문에 없는 낱말의 풀이는 받지 않는다
     ------------------------------------------------------------------------ */
  /** 본문 길이에 맞는 요약 분량: 긴 문서를 두 문장으로 줄이면 아무것도 전하지 못한다 */
  // paragraphs = 문단 수, minChars = 요약 전체의 최소 글자 수 (이보다 짧으면 "한 줄 요약"이라 다시 받는다)
  function summaryPlan(bodyLength) {
    if (bodyLength < 1500) return { paragraphs: 2, points: 0, size: 'short', minChars: 110 };
    if (bodyLength < 6000) return { paragraphs: 3, points: 4, size: 'medium', minChars: 260 };
    return { paragraphs: 4, points: 7, size: 'long', minChars: 380 };
  }

  /** 받은 요약이 문단이라고 하기에 너무 짧은가 (한 문장으로 끝났는가) */
  const summaryTooShort = (enrichment, bodyLength) => {
    const text = ((enrichment && enrichment.summary) || []).join(' ');
    return text.length < summaryPlan(bodyLength).minChars || sentenceList(text).length < 2;
  };

  /** AI 에 보낼 문단 고르기: 예산 안이면 전부, 넘치면 앞부분(정의·개요)을 지키고 나머지는 문서 전체에서 고르게 뽑는다 (앞부분만 요약되는 일을 막는다) */
  function pickForSummary(paragraphs, budget = 12000) {
    const list = (paragraphs || []).map(p => String(p || '')).filter(Boolean);
    if (list.join('\n').length <= budget) return list;
    const head = list.slice(0, 6);
    const rest = list.slice(6);
    let used = head.join('\n').length;
    const room = Math.max(0, budget - used);
    const avg = rest.reduce((a, p) => a + p.length, 0) / Math.max(1, rest.length);
    const take = Math.max(1, Math.floor(room / Math.max(1, avg)));
    const step = rest.length / take;
    const picked = [];
    for (let i = 0; i < take; i++) { const p = rest[Math.floor(i * step)]; if (p && !picked.includes(p) && used + p.length <= budget) { picked.push(p); used += p.length; } }
    return [...head, ...picked];
  }

  function sanitizeEnrichment(raw, model) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const body = (model && model.bodyText || []).join(' ');
    const plan = summaryPlan(body.length);
    const summary = (Array.isArray(r.summary) ? r.summary : [r.summary]).map(p => clip(p, 460)).filter(p => p.length > 24).slice(0, plan.paragraphs);
    // 핵심 정리: 긴 문서에서 요약 문단이 다 담지 못한 갈래별 요점
    const points = plan.points ? (Array.isArray(r.points) ? r.points : []).map(p => (typeof p === 'string' ? { section: '', text: p } : { section: clip(p && p.section, 24), text: clip(p && p.text, 170) }))
      .map(p => ({ section: p.section, text: clip(p.text, 170) })).filter((p, i, arr) => p.text.length > 8 && arr.findIndex(x => x.text === p.text) === i).slice(0, plan.points) : [];
    const joined = [...summary, ...points.map(p => p.text)].join(' ');
    // 밑줄: 요약 문장 안에 실제로 있는 구절만 (없는 말에 밑줄을 그을 수는 없다)
    const highlights = (Array.isArray(r.highlights) ? r.highlights : []).map(h => String(h || '').trim()).filter((h, i, arr) => h.length >= 2 && h.length <= 28 && joined.includes(h) && arr.indexOf(h) === i).slice(0, 5);
    // 낱말 풀이: 요약이나 원문에 실제로 나오는 낱말만
    const seen = new Set();
    const glossary = (Array.isArray(r.glossary) ? r.glossary : []).map(g => ({ term: clip(g && g.term, 20), meaning: clip(g && g.meaning, 90) }))
      .filter(g => g.term.length >= 2 && g.meaning.length >= 4 && (joined.includes(g.term) || body.includes(g.term)) && !seen.has(g.term) && seen.add(g.term)).slice(0, 8);
    return { summary, points, highlights, glossary, size: plan.size, source: r.source === 'local' ? 'local' : 'ai' };
  }

  /** AI 가 없을 때: 본문의 앞 문장들로 요약을 대신한다 (밑줄·낱말 풀이는 만들지 않는다 — 지어낼 수 없다) */
  function localEnrichment(model, persona) {
    const body = (model && model.bodyText || []).join(' ');
    const n = Math.max(3, ((persona && persona.layout && persona.layout.summarySentences) || 3) + 1);
    const text = paragraphOf(body, { max: n, minChars: 180 });
    // 긴 문서는 뒤쪽 문단들의 첫 문장을 요점으로 보탠다 (원문 그대로 — 지어내지 않는다)
    const plan = summaryPlan(body.length);
    const later = (model && model.bodyText || []).slice(3);
    const step = Math.max(1, Math.floor(later.length / Math.max(1, plan.points)));
    const points = plan.points ? later.filter((_, i) => i % step === 0).map(p => sentences(p, 1)).filter(Boolean).slice(0, plan.points) : [];
    return sanitizeEnrichment({ summary: text ? [text] : [], points, highlights: [], glossary: [], source: 'local' }, model);
  }

  /** 요약 문장을 [글, 밑줄, 낱말] 조각으로 나눈다 (화면은 조각을 글자로만 그린다 → 요약 속 HTML 은 실행되지 않는다) */
  function markSummary(paragraph, highlights = [], glossary = []) {
    const marks = [...highlights.map(h => ({ text: h, kind: 'highlight' })), ...glossary.map(g => ({ text: g.term, kind: 'term' }))].sort((a, b) => b.text.length - a.text.length);
    let pieces = [{ text: String(paragraph || ''), kind: 'text' }];
    for (const m of marks) {
      pieces = pieces.flatMap(p => {
        if (p.kind !== 'text' && !(p.kind === 'highlight' && m.kind === 'term')) return [p];
        const i = p.text.indexOf(m.text);
        if (i < 0) return [p];
        const inner = { text: m.text, kind: m.kind, within: p.kind === 'highlight' ? 'highlight' : undefined };
        return [{ text: p.text.slice(0, i), kind: p.kind, within: p.within }, inner, { text: p.text.slice(i + m.text.length), kind: p.kind, within: p.within }].filter(x => x.text);
      });
    }
    return pieces;
  }

  /** 버튼을 누르면 어떻게 되는지 한 줄로 (어르신: 눌러도 되는지 몰라 망설이는 일을 줄인다) */
  function actionHint(action) {
    if (!action) return '';
    if (action.sensitive) return '누르기 전에 한 번 더 여쭤봅니다';
    if (action.kind === 'button') return action.submits ? '누르면 적은 내용을 보냅니다' : '누르면 이 페이지에서 바로 실행됩니다';
    return action.sameSite === false ? '누르면 다른 사이트로 나갑니다' : '누르면 이 사이트의 다른 화면으로 갑니다';
  }

  const spokenMenus = (layout) => {
    const menus = layout.menus || [];
    if (!menus.length) return '펼쳐지는 메뉴가 없는 페이지입니다.';
    return `메뉴는 ${menus.length}묶음입니다. ` + menus.map(m => `${m.label}: ${m.children.map(c => c.label).join(', ')}.`).join(' ') + ' 탭 키로 옮겨 가며 고르거나, 메뉴 이름을 말씀해 주세요.';
  };

  const spokenItem = (item, index, total) => `${index + 1}번째 내용, 전체 ${total}개 중. ${item.title}. ${item.description || ''} ${item.ref ? '엔터 키로 엽니다.' : ''}`;

  const api = { DENSITIES, suggestAlternative, planLocally, auditLayout, scoreLayout, selectLayout, sameMeaning, spokenIntro, spokenItem, spokenMenus, defaultArrangement, sanitizeArrangement, interpretArrangement, sanitizeEnrichment, localEnrichment, markSummary, actionHint, summaryPlan, summaryTooShort, pickForSummary, paragraphOf };
  root.EqualiLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
