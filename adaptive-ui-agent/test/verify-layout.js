// 화면 재구성 알고리즘(페르소나 · 설계 · 안전 감사 · 선택 · 음성 대본) 단위 테스트:  node test/verify-layout.js
const assert = require('assert');
const Persona = require('../shared/persona.js');
const L = require('../shared/layout.js');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✔', name); };

const model = {
  title: '대전대신고 - 검색', hostname: 'search.example.com', description: '검색 결과를 보여 주는 페이지',
  inputs: [{ ref: 'I1', label: '검색', placeholder: '검색어', type: 'search', isSearch: true, prominence: 50 }],
  actions: [
    { ref: 'A1', kind: 'link', text: '뉴스', region: 'nav', sameSite: true, prominence: 40 },
    { ref: 'A2', kind: 'link', text: '이미지', region: 'nav', sameSite: true, prominence: 39 },
    { ref: 'A3', kind: 'button', text: '메일 보내기', region: 'header', sameSite: true, prominence: 30 },
    { ref: 'A4', kind: 'link', text: '특가 쿠폰 받기', region: 'aside', sameSite: false, isAd: true, prominence: 60 },
    { ref: 'A5', kind: 'button', text: '바로구매', region: 'main', sameSite: true, sensitive: true, prominence: 45 },
    { ref: 'A6', kind: 'link', text: '대전대신고등학교', region: 'main', sameSite: false, prominence: 35 },
    { ref: 'A7', kind: 'link', text: '나무위키 대전대신고등학교', region: 'main', sameSite: false, prominence: 34 },
    { ref: 'A8', kind: 'link', text: '다음', region: 'main', sameSite: true, prominence: 10 },
    { ref: 'A9', kind: 'link', text: '지도', region: 'nav', sameSite: true, prominence: 38 }
  ],
  items: [
    { ref: 'C1', heading: '오늘만 특가', description: '쿠폰 받기', linkRef: 'A4', isAd: true },
    { ref: 'C2', heading: '대전대신고등학교', description: '학사일정, 공지사항, 입학안내', linkRef: 'A6' },
    { ref: 'C3', heading: '나무위키 대전대신고등학교', description: '대전광역시 서구의 자율형 사립고', linkRef: 'A7' },
    { ref: 'C4', heading: '학교 소식 모음', description: '최근 소식', linkRef: null }
  ],
  bodyText: [], pagination: { prevRef: null, nextRef: 'A8' }, stats: { textLength: 0 }
};

t('페르소나가 방식(mode)과 설계 제약을 정한다', () => {
  assert.strictEqual(Persona.get('blind').mode, 'audio');
  assert.strictEqual(Persona.get('elderly').mode, 'rebuild');
  assert.strictEqual(Persona.get('hearing').mode, 'visual');
  assert.strictEqual(Persona.get('hearing').autoOpen, true);
  assert.strictEqual(Persona.get('없는것').id, 'none');
  assert.ok(Persona.get('child').layout.maxActions < Persona.get('lowVision').layout.maxActions);
  assert.deepStrictEqual(Persona.withPersonaTraits('blind', ['메모'])[1], '메모');
  assert.ok(Persona.layoutBrief('blind').audio && /grandparent/.test(Persona.layoutBrief('elderly').wording));
});

t('시각장애인은 전역 음성 끄기 설정과 관계없이 낭독이 기본값이다', () => {
  assert.strictEqual(Persona.resolveVoice('blind', {}, false), true);
  assert.strictEqual(Persona.resolveVoice('blind', { blind: false }, true), false, '해당 페르소나에서 직접 끈 값은 존중한다');
  assert.strictEqual(Persona.resolveVoice('hearing', { blind: true }, true), false);
});

t('AI 없이도 화면이 구성된다: 검색창 + 내비게이션 버튼 + 광고를 뺀 내용', () => {
  const plan = L.planLocally(model, Persona.get('elderly'));
  assert.strictEqual(plan.input.ref, 'I1');
  assert.ok(plan.actions.length <= 4 && plan.actions.every(a => !['A4', 'A5', 'A8'].includes(a.ref)), '광고·결제·페이지 넘김은 버튼에 넣지 않는다');
  assert.deepStrictEqual(plan.actions.slice(0, 3).map(a => a.label), ['뉴스', '이미지', '지도'], '내비게이션을 먼저');
  assert.ok(plan.items.length >= 2 && plan.items.every(i => i.title !== '오늘만 특가'));
  assert.strictEqual(plan.pagination.nextRef, 'A8');
});

t('문서의 시나리오: "검색"이라 써 놓고 "메일 보내기"를 가리키면 실제 이름으로 되돌린다', () => {
  const out = L.auditLayout({ actions: [{ ref: 'A3', label: '검색' }, { ref: 'A1', label: '소식' }], items: [] }, model, Persona.get('elderly'));
  assert.strictEqual(out.actions[0].label, '메일 보내기');
  assert.strictEqual(out.actions[1].label, '소식', '뜻이 같은 쉬운 말은 허용');
  assert.strictEqual(out.stats.relabeled, 1);
  assert.ok(out.notes.some(n => n.includes('되돌렸')));
  assert.ok(L.sameMeaning('들어가기', '로그인') && L.sameMeaning('뉴스 보기', '뉴스') && !L.sameMeaning('영상 보기', '더 보기'));
});

t('AI 가 지어낸 대상·광고는 버리고, 다른 글로 데려가는 제목도 되돌린다', () => {
  const out = L.auditLayout({
    input: { ref: 'I9', label: 'x' },
    actions: [{ ref: 'A99', label: '로그인' }, { ref: 'A4', label: '쿠폰' }, { ref: 'A1', label: '뉴스' }, { ref: 'A1', label: '뉴스' }],
    items: [{ title: '교육청 공지사항', description: 'x', ref: 'A7' }, { title: '대신고 누리집', description: '학교 공식 누리집', ref: 'A6' }, { title: '요약', description: '링크 없는 요약', ref: null }]
  }, model, Persona.get('elderly'));
  assert.strictEqual(out.input, null);
  assert.deepStrictEqual(out.actions.map(a => a.ref), ['A1']);
  assert.deepStrictEqual([out.stats.invalidRefs, out.stats.adsDropped, out.stats.duplicates], [2, 1, 1]);
  assert.strictEqual(out.items[0].title, '나무위키 대전대신고등학교', '제목이 실제 글과 다르면 원문 제목으로');
  assert.strictEqual(out.items[1].title, '대신고 누리집', '원문과 이어지는 쉬운 제목은 허용');
  assert.strictEqual(out.items[2].ref, null);
});

t('결제·삭제 같은 버튼은 표시되어 누를 때 다시 확인한다', () => {
  const out = L.auditLayout({ actions: [{ ref: 'A5', label: '바로구매' }], items: [] }, model, Persona.get('none'));
  assert.strictEqual(out.actions[0].sensitive, true);
});

t('후보 선택: 페이지의 검색창을 빼먹거나 페르소나 한도를 넘긴 AI 후보는 밀린다', () => {
  const good = { density: 'balanced', title: '검색', summary: '찾은 결과', input: { ref: 'I1', label: '무엇을 찾으시나요?' }, actions: [{ ref: 'A1', label: '뉴스' }, { ref: 'A9', label: '지도' }], items: [{ title: '대전대신고등학교', description: '학교 누리집', ref: 'A6' }, { title: '나무위키 대전대신고등학교', description: '백과 설명', ref: 'A7' }] };
  const bad = { density: 'balanced', title: '검색', input: null, actions: model.actions.map(a => ({ ref: a.ref, label: a.text })), items: [] };
  const persona = Persona.get('child');
  const sGood = L.scoreLayout(L.auditLayout(good, model, persona), model, persona);
  const sBad = L.scoreLayout(L.auditLayout(bad, model, persona), model, persona);
  assert.ok(sGood.total > sBad.total + 15, `${sGood.total} vs ${sBad.total}`);
  assert.ok(sBad.problems.some(p => p.includes('검색창')));
  const ranked = L.selectLayout([good, bad], model, persona);
  assert.strictEqual(ranked[0].source, 'ai');
  assert.ok(new Set(ranked.map(l => l.density)).size === ranked.length, '밀도별로 하나씩 → "더 간단하게 / 더 자세히"가 서로 다른 화면');
  assert.ok(L.selectLayout([], model, persona).length >= 2, 'AI 후보가 없어도 로컬 후보로 구성된다');
});

t('기사 페이지는 본문 요약이 첫 내용이 된다', () => {
  const article = { ...model, inputs: [], items: [], bodyText: ['대전대신고등학교는 대전광역시 서구에 있는 자율형 사립 고등학교이다. 1964년에 문을 열었다. 학생 수는 약 천 명이다. 교훈은 성실이다.', '학교는 여러 동아리 활동을 운영하며 매년 가을에 축제를 연다. 지역 사회와 함께하는 봉사 활동도 이어 가고 있다. 최근에는 소프트웨어 교육을 강화하였다.', '졸업생들은 전국의 여러 대학으로 진학하고 있으며 동문회 활동도 활발하다. 학교 도서관은 지역 주민에게도 열려 있다. 운동장은 주말마다 시민들이 찾는 쉼터가 된다. 해마다 신입생을 위한 안내 행사가 열린다.'], stats: { textLength: 500 } };
  const plan = L.planLocally(article, Persona.get('dyslexia'));
  assert.strictEqual(plan.items[0].title, '이 글의 핵심');
  assert.ok(plan.items[0].description.length > 30 && plan.items[0].ref === null);
});

t('소리 중심 대본: 제목 → 요약 → 번호 붙은 버튼 → 내용 개수 → 조작법', () => {
  const layout = L.selectLayout([], model, Persona.get('blind'))[0];
  const intro = L.spokenIntro(layout);
  assert.ok(intro.startsWith(`${layout.title} 화면입니다.`));
  assert.ok(/1번 뉴스/.test(intro) && /슬래시 키/.test(intro) && /숫자 키/.test(intro) && /내용은 \d+개/.test(intro));
  assert.ok(!/숫자 키/.test(L.spokenIntro(layout, { brief: true })), '다시 듣기는 짧게');
  const many = { ...layout, actions: [
    { label: '검색' }, { label: '뉴스' }, { label: '지도' }, { label: '설정' }, { label: '공유' }
  ] };
  assert.ok(!L.spokenIntro(many).includes('4번 설정') && !L.spokenIntro(many).includes('5번 공유'), '처음 안내에서는 핵심 버튼 세 개만 읽는다');
  assert.ok(/1번째 내용, 전체/.test(L.spokenItem(layout.items[0], 0, layout.items.length)));
});

t('재구성 화면 불만족 이유에 따라 실제 있는 다른 보기만 제안한다', () => {
  const available = ['essential', 'balanced', 'detailed'];
  assert.deepStrictEqual(L.suggestAlternative({ reason: 'too_many', density: 'balanced', available }).density, 'essential');
  assert.deepStrictEqual(L.suggestAlternative({ reason: 'not_enough', density: 'balanced', available }).density, 'detailed');
  assert.strictEqual(L.suggestAlternative({ reason: 'hard_to_read', density: 'balanced', voice: false, available }).kind, 'audio');
  assert.strictEqual(L.suggestAlternative({ reason: 'hard_to_use', density: 'essential', available }).kind, 'original');
  assert.strictEqual(L.suggestAlternative({ reason: 'not_enough', density: 'balanced', available: ['balanced'] }).kind, 'original');
});

t('사용 기록이 충분하면 로컬 후보에도 정보량·진행 방식 선호를 반영한다', () => {
  const persona = Persona.get('elderly');
  const essential = L.auditLayout(L.planLocally(model, persona, 'essential'), model, persona);
  const detailed = L.auditLayout(L.planLocally(model, persona, 'detailed'), model, persona);
  const profile = { dimensions: { confidence: 1, cognitiveStyle: { detail: 'summary', pace: 'stepwise' }, proficiency: { value: 'novice' }, needs: {} } };
  assert.ok(L.scoreLayout(essential, model, persona, profile).parts.personalFit > 0);
  assert.ok(L.scoreLayout(detailed, model, persona, profile).parts.personalFit < 0);
  const lowConfidence = { ...profile, dimensions: { ...profile.dimensions, confidence: 0 } };
  assert.strictEqual(L.scoreLayout(essential, model, persona, lowConfidence).parts.personalFit, 0);
});

t('펼쳐야 보이는 메뉴는 주요 버튼에 섞지 않고, 페이지에서 읽은 그대로 메뉴 구역과 음성 대본에 넣는다', () => {
  const withMenus = { ...model,
    actions: [...model.actions,
      { ref: 'A20', kind: 'link', text: '법인소개', region: 'nav', sameSite: true, prominence: 0, hidden: true, menuGroup: '학교소개' },
      { ref: 'A21', kind: 'link', text: '급식실', region: 'nav', sameSite: true, prominence: 0, hidden: true, menuGroup: '학교생활' }],
    menus: [{ label: '학교소개', ref: 'A1', children: [{ ref: 'A20', text: '법인소개' }] }, { label: '학교생활', ref: null, children: [{ ref: 'A21', text: '급식실' }] }, { label: '빈 묶음', ref: null, children: [] }] };
  const persona = Persona.get('elderly');
  const local = L.planLocally(withMenus, persona);
  assert.ok(!local.actions.some(a => ['A20', 'A21'].includes(a.ref)), '숨은 메뉴 항목이 주요 버튼에 들어가면 안 된다');
  assert.deepStrictEqual(local.menus.map(m => m.label), ['학교소개', '학교생활']);
  // AI 가 숨은 항목을 주요 버튼으로 끌어오거나 메뉴 이름을 바꿔 보내도 받아들이지 않는다
  const audited = L.auditLayout({ title: 'x', actions: [{ ref: 'A21', label: '메일 보내기' }], menus: [{ label: '가짜', children: [{ ref: 'A3', label: '검색' }] }] }, withMenus, persona);
  assert.ok(!audited.actions.some(a => a.ref === 'A21'));
  assert.deepStrictEqual(audited.menus.map(m => m.label), ['학교소개', '학교생활']);
  assert.strictEqual(audited.menus[1].children[0].label, '급식실');
  assert.ok(L.spokenIntro(local).includes('엠 키'));
  const spoken = L.spokenMenus(local);
  assert.ok(spoken.includes('학교소개: 법인소개') && spoken.includes('학교생활: 급식실'), spoken);
  assert.ok(L.spokenMenus({ menus: [] }).includes('없는'));
});

t("'기타' 페르소나: 직접 적은 특성이 특성 메모와 화면 방식을 정한다", () => {
  assert.strictEqual(Persona.get('custom').traits.length, 0);
  let c = Persona.setCustom({ text: '한쪽 눈이 잘 안 보여요, 빨강·초록 구분이 어려워요', mode: 'auto' });
  assert.strictEqual(c.mode, 'rebuild');
  assert.ok(Persona.withPersonaTraits('custom', ['키보드 선호']).length >= 3);
  assert.strictEqual(Persona.setCustom({ text: '전맹이라 스크린리더를 씁니다' }).mode, 'audio');
  assert.strictEqual(Persona.setCustom({ text: '난청이라 자막이 필요해요' }).mode, 'visual');
  assert.strictEqual(Persona.setCustom({ text: '왼손만 써요' }).mode, 'restyle');
  // 직접 고른 방식이 자동 추론보다 우선한다
  assert.strictEqual(Persona.setCustom({ text: '전맹이라 스크린리더를 씁니다', mode: 'restyle' }).mode, 'restyle');
  // 글자 수를 제한하고, 설계 제약은 항상 채워져 있다 (재구성 화면이 이 값을 그대로 쓴다)
  c = Persona.setCustom({ text: '가'.repeat(900), mode: 'rebuild' });
  assert.ok(c.customText.length <= 300 && c.layout.maxActions > 0);
  assert.ok(L.planLocally(model, c).actions.length > 0);
  Persona.setCustom(null);
  assert.strictEqual(Persona.get('custom').customText, '');
});

t('재구성 화면의 대안에 "다른 형태"(하나씩 · 글로만)가 들어가고, 이미 시도한 형태는 되풀이하지 않는다', () => {
  const available = ['essential', 'balanced', 'detailed'];
  const views = ['steps', 'text'];
  assert.strictEqual(L.suggestAlternative({ reason: 'hard_to_use', density: 'balanced', available, views }).view, 'steps');
  assert.strictEqual(L.suggestAlternative({ reason: 'hesitation', density: 'balanced', available, views }).view, 'steps');
  assert.strictEqual(L.suggestAlternative({ reason: 'hard_to_read', density: 'balanced', voice: true, available, views }).view, 'text');
  assert.strictEqual(L.suggestAlternative({ reason: 'hard_to_read', density: 'balanced', voice: false, available, views }).kind, 'audio');
  // 이미 하나씩 보기 중이거나 시도했다면 다른 것으로
  assert.strictEqual(L.suggestAlternative({ reason: 'hard_to_use', density: 'balanced', available, views, view: 'steps' }).density, 'essential');
  assert.strictEqual(L.suggestAlternative({ reason: 'other', density: 'balanced', available, views, tried: ['steps'] }).view, 'text');
  // 시각 중심(청각장애) 화면처럼 다른 형태가 없는 곳에서는 예전과 같다
  assert.strictEqual(L.suggestAlternative({ reason: 'hard_to_use', density: 'essential', available, views: [] }).kind, 'original');
});

t('말로 하는 화면 재구성: 자주 쓰는 말은 AI 없이 알아듣고, 배치는 허용된 값만 받는다', () => {
  const layout = { input: { ref: 'I1' }, items: [{}], menus: [],
    actions: [{ ref: 'A1', label: '학사일정' }, { ref: 'A2', label: '찾아오시는길' }, { ref: 'A3', label: '학교소식' }, { ref: 'A4', label: '교직원소개' }, { ref: 'A5', label: '입학안내' }] };
  // 실제 시연에서 음성 인식이 돌려준 문장 (버튼 이름이 띄어쓰기와 함께 들어온다)
  const moved = L.interpretArrangement('학사 일정과 찾아오시는 길 학교 소식 교직원 소개 입학 안내를 오른쪽으로 옮겨 줘', layout);
  assert.strictEqual(moved.arrangement.actionsPosition, 'right');
  assert.deepStrictEqual(moved.arrangement.actionOrder, ['A1', 'A2', 'A3', 'A4', 'A5']);
  // 이름을 부른 버튼이 부른 순서대로 앞에 온다
  assert.deepStrictEqual(L.interpretArrangement('입학안내랑 학교소식 버튼을 왼쪽으로 옮겨 줘', layout).arrangement.actionOrder.slice(0, 2), ['A5', 'A3']);
  // 이어서 말하면 앞의 배치 위에 쌓인다
  const bigger = L.interpretArrangement('글자 더 크게', layout, moved.arrangement);
  assert.strictEqual(bigger.arrangement.actionsPosition, 'right');
  assert.strictEqual(bigger.arrangement.textScale, 1.15);
  assert.deepStrictEqual(L.interpretArrangement('내용을 맨 위로 올려 줘', layout).arrangement.order[0], 'items');
  assert.deepStrictEqual(L.interpretArrangement('내용은 숨겨 줘', layout).arrangement.hide, ['items']);
  assert.strictEqual(L.interpretArrangement('버튼을 한 줄에 두 개씩 놓아 줘', layout).arrangement.actionsColumns, 2);
  assert.deepStrictEqual(L.interpretArrangement('원래대로 해 줘', layout, bigger.arrangement).arrangement, L.defaultArrangement());
  // 배치와 상관없는 말은 로컬에서 처리하지 않는다 (서비스 워커가 AI 에 묻거나 거절한다)
  assert.strictEqual(L.interpretArrangement('오늘 날씨 어때', layout), null);
  // AI 가 무엇을 돌려줘도 허용된 값만 남는다: 없는 버튼·없는 구역·범위를 벗어난 크기·전부 숨기기
  const clean = L.sanitizeArrangement({ actionsPosition: 'center', order: ['items', 'evil', 'items'], actionsColumns: 99, textScale: 9, hide: ['input', 'actions', 'items', 'menus'], actionOrder: ['A3', 'A99', 'A3'], generatedJs: 'alert(1)' }, layout);
  assert.deepStrictEqual(clean, { actionsPosition: 'top', order: ['items', 'input', 'actions', 'menus'], actionsColumns: 0, textScale: 1, hide: [], actionOrder: ['A3'] });
});

t('모드마다 고유 기능이 다르고, 읽기 도움(요약 · 밑줄 · 낱말 풀이)은 검증을 거친다', () => {
  // 모드별 개성: 같은 기능 묶음을 가진 모드가 없어야 한다 (설정 안 함 · 청각장애는 재구성 화면의 읽기 기능이 없다)
  const sets = Persona.list().filter(p => p.features.length).map(p => p.features.slice().sort().join(','));
  assert.strictEqual(new Set(sets).size, sets.length, '두 모드가 똑같은 기능 묶음을 가지고 있다');
  assert.ok(Persona.hasFeature(Persona.get('child'), 'glossary') && Persona.hasFeature(Persona.get('child'), 'highlights'));
  assert.ok(Persona.hasFeature(Persona.get('elderly'), 'actionHints') && !Persona.hasFeature(Persona.get('elderly'), 'glossary'));
  assert.ok(Persona.hasFeature(Persona.get('motor'), 'scan') && Persona.hasFeature(Persona.get('lowVision'), 'focusReader') && Persona.hasFeature(Persona.get('blind'), 'listenBody'));
  assert.ok(Persona.needsEnrichment(Persona.get('child')) && !Persona.needsEnrichment(Persona.get('motor')));
  // '기타'는 적은 글에서 기능을 고른다
  assert.deepStrictEqual(Persona.setCustom({ text: '초등학생 아이가 써요. 어려운 단어를 몰라요' }).features.sort(), ['easySummary', 'glossary', 'highlights']);
  assert.ok(Persona.setCustom({ text: '손 떨림이 있어요' }).features.includes('scan'));
  Persona.setCustom(null);

  const doc = { title: '고래', bodyText: ['고래는 바다에 사는 포유류이다. 허파로 숨을 쉬며 새끼에게 젖을 먹인다.', '대왕고래는 지구에서 가장 큰 동물로 알려져 있다.'] };
  const clean = L.sanitizeEnrichment({
    summary: ['고래는 바다에 사는 포유류예요. 물고기처럼 보이지만 허파로 숨을 쉬어요.', '<img src=x onerror=alert(1)> 가장 큰 고래는 대왕고래예요.', '세 번째 문단은 버린다. 길이가 충분해도 두 문단까지만 받는다.'],
    highlights: ['바다에 사는 포유류', '요약에 없는 구절', '바다에 사는 포유류'],
    glossary: [{ term: '포유류', meaning: '새끼를 낳아 젖을 먹여 키우는 동물이에요.' }, { term: '양자역학', meaning: '원문에도 요약에도 없는 낱말' }, { term: '허파', meaning: '숨을 쉴 때 쓰는 몸속 기관이에요.' }, { term: '허파', meaning: '중복' }]
  }, doc);
  assert.strictEqual(clean.summary.length, 2);
  assert.deepStrictEqual(clean.highlights, ['바다에 사는 포유류']);
  assert.deepStrictEqual(clean.glossary.map(g => g.term), ['포유류', '허파']);
  // 화면은 조각을 글자로만 그린다: 밑줄 안의 낱말도 놓치지 않는다
  const pieces = L.markSummary(clean.summary[0], clean.highlights, clean.glossary);
  assert.deepStrictEqual(pieces.map(p => p.kind), ['text', 'highlight', 'term', 'text', 'term', 'text']);
  assert.strictEqual(pieces.map(p => p.text).join(''), clean.summary[0]);
  // AI 가 없으면 원문의 앞 문장으로 대신하고, 밑줄과 낱말 풀이는 지어내지 않는다
  const local = L.localEnrichment(doc, Persona.get('child'));
  assert.ok(local.summary[0].startsWith('고래는 바다에 사는 포유류이다.') && local.source === 'local');
  assert.deepStrictEqual([local.highlights, local.glossary], [[], []]);
  // 버튼 설명 (어르신)
  assert.ok(L.actionHint({ kind: 'link', sameSite: false }).includes('다른 사이트'));
  assert.ok(L.actionHint({ kind: 'button', sensitive: true }).includes('한 번 더'));
});

t('요약 분량은 본문 길이를 따라가고, 긴 문서는 앞부분만이 아니라 전체에서 고르게 읽힌다', () => {
  assert.deepStrictEqual([L.summaryPlan(800).size, L.summaryPlan(3800).size, L.summaryPlan(16000).size], ['short', 'medium', 'long']);
  assert.ok(L.summaryPlan(16000).paragraphs > L.summaryPlan(800).paragraphs && L.summaryPlan(16000).points >= 6 && L.summaryPlan(800).points === 0);
  // 긴 문서: 요약 문단과 요점을 더 받는다 / 짧은 문서: AI 가 길게 돌려줘도 두 문단, 요점 없음
  const para = (i) => `${i}번째 문단입니다. 이 문단은 길이를 채우기 위한 충분히 긴 설명 문장을 담고 있습니다. 같은 이야기를 조금 더 이어 갑니다.`;
  const long = { bodyText: Array.from({ length: 60 }, (_, i) => para(i).repeat(4)) };
  const short = { bodyText: [para(1), para(2)] };
  const P = (n) => `${n}번째 문단 요약입니다. 한 문단은 여러 문장으로 이루어져 있어야 읽는 사람에게 내용이 남습니다. 그래서 문장을 충분히 이어 붙였습니다.`;
  const raw = { summary: [P('첫'), P('둘'), P('셋'), P('넷'), P('다섯')],
    points: [{ section: '역사', text: '역사 갈래의 요점 문장입니다.' }, '문자열로 온 요점 문장입니다.', { section: '역사', text: '역사 갈래의 요점 문장입니다.' }], highlights: ['요점 문장'], glossary: [] };
  const a = L.sanitizeEnrichment(raw, long), b = L.sanitizeEnrichment(raw, short);
  assert.deepStrictEqual([a.summary.length, a.points.length, a.size], [4, 2, 'long']);
  // 문단이라고 할 수 없는 조각(한 줄)은 받지 않는다
  assert.deepStrictEqual(L.sanitizeEnrichment({ summary: ['고래에 대한 글입니다.', P('둘')] }, long).summary, [P('둘')]);
  assert.deepStrictEqual(a.points[0], { section: '역사', text: '역사 갈래의 요점 문장입니다.' });
  assert.deepStrictEqual(a.highlights, ['요점 문장'], '밑줄은 요점 안의 구절에도 그을 수 있다');
  assert.deepStrictEqual([b.summary.length, b.points.length, b.size], [2, 0, 'short']);
  // 예산을 넘으면 앞 6문단을 지키고 나머지는 문서 끝까지 고르게 뽑는다
  const picked = L.pickForSummary(long.bodyText, 12000);
  assert.ok(picked.join('\n').length <= 12000 && picked.length > 6);
  assert.deepStrictEqual(picked.slice(0, 6), long.bodyText.slice(0, 6));
  assert.ok(picked.some(p => /^5\d번째/.test(p)), '문서 뒤쪽 문단도 들어가야 한다');
  assert.deepStrictEqual(L.pickForSummary(short.bodyText, 12000), short.bodyText);
  // AI 가 없을 때도 긴 문서는 뒤쪽 문단의 첫 문장을 요점으로 보탠다 (원문 그대로)
  const local = L.localEnrichment(long, Persona.get('child'));
  assert.ok(local.points.length >= 4 && local.points.every(p => long.bodyText.some(x => x.includes(p.text.replace(/…$/, '')))));
});

t('요약은 한 문단 분량이어야 한다: 한 줄로 끝나면 다시 받는다', () => {
  const sentence = (i) => `${i}번째 문장으로 내용을 설명합니다.`;
  const body = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ');
  const model = { title: '긴 글', bodyText: [body], description: '한 줄짜리 소개 문구입니다.' };
  const persona = Persona.get('elderly');

  // 맨 위 요약이 한 문장으로 끝나지 않는다 (예전에는 첫 문장만 잘라 썼다)
  const plan = L.planLocally(model, persona);
  assert.ok(plan.summary.length >= 100, `요약이 너무 짧다: ${plan.summary.length}자`);
  assert.ok(plan.summary.split(/(?<=다\.)\s*/).filter(Boolean).length >= 3, '요약은 여러 문장이어야 한다');
  assert.notStrictEqual(plan.summary, model.description, '본문이 있으면 소개 문구 한 줄로 대신하지 않는다');
  // 맨 위 요약과 '이 글의 핵심'이 같은 문장을 되풀이하지 않는다
  assert.ok(!plan.items[0].description.startsWith(plan.summary.slice(0, 40)));

  // AI 없이 만드는 요약도 한 문단 분량이다
  assert.ok(L.localEnrichment(model, persona).summary[0].length >= 150);

  // 길이 판정: 한 문장짜리 요약은 "너무 짧다"로 본다
  assert.strictEqual(L.summaryTooShort({ summary: ['이 글은 접근성에 대한 글입니다.'] }, 4000), true);
  assert.strictEqual(L.summaryTooShort({ summary: [] }, 4000), true);
  const full = [Array.from({ length: 16 }, (_, i) => sentence(i)).join(' ')];
  assert.strictEqual(L.summaryTooShort({ summary: full }, 4000), false);
  // 짧은 문서에는 짧은 요약도 충분하다
  assert.strictEqual(L.summaryTooShort({ summary: [Array.from({ length: 7 }, (_, i) => sentence(i)).join(' ')] }, 900), false);

  // 문단 뽑기: 문장이 짧으면 글자 수를 채울 때까지 더 담고, 정해진 길이에서 멈춘다
  assert.ok(L.paragraphOf(body, { max: 2, minChars: 200 }).length >= 200);
  assert.ok(L.paragraphOf(body, { max: 99, minChars: 100, maxChars: 300 }).length <= 300);
  assert.ok(L.paragraphOf(body, { skip: 3 }).startsWith('3번째'));
});

console.log(`\n${passed} tests passed`);
