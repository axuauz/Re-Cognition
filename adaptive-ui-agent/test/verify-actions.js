// 캔버스 에디터 "동작 추가"의 정해진 동작 목록 단위 테스트:  node test/verify-actions.js
const assert = require('assert');
const A = require('../shared/actions.js');
const { auditProposal } = require('../shared/safety.js');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✔', name); };

t('목록에 있는 동작만 받고, 값은 범위 안으로 고친다', () => {
  const { spec, notes } = A.sanitizeActionSpec({ trigger: 'dblclick', replace: 'yes', actions: [
    { type: 'scroll_top', extra: 'ignored' },
    { type: 'message', text: '  맨 위로   올라왔어요  ' + 'x'.repeat(300) },
    { type: 'text_size', percent: 999 },
    { type: 'fetch', url: 'https://evil.example' },
    { type: 'eval', code: 'alert(1)' }
  ] });
  assert.strictEqual(spec.trigger, 'click', '모르는 트리거는 click 으로');
  assert.strictEqual(spec.replace, false, 'true 가 아니면 원래 기능을 막지 않는다');
  assert.deepStrictEqual(spec.actions.map(a => a.type), ['scroll_top', 'message', 'text_size']);
  assert.deepStrictEqual(spec.actions[0], { type: 'scroll_top' });
  assert.ok(spec.actions[1].text.length <= 120 && spec.actions[1].text.startsWith('맨 위로 올라왔어요'));
  assert.strictEqual(spec.actions[2].percent, 60);
  assert.strictEqual(notes.filter(n => n.includes('지원하지 않는')).length, 2);
});

t('필요한 값이 없거나 위험한 대상이면 그 동작은 뺀다', () => {
  const { spec, notes } = A.sanitizeActionSpec({ actions: [
    { type: 'scroll_to' }, { type: 'toggle', target: 'form#login' }, { type: 'toggle', target: 'body' }, { type: 'toggle', target: 'input[type="password"]' },
    { type: 'highlight', target: '<img onerror=x>' }, { type: 'speak' }, { type: 'toggle', target: '.sidebar' }
  ] });
  assert.deepStrictEqual(spec.actions, [{ type: 'toggle', target: '.sidebar' }]);
  assert.ok(notes.some(n => n.includes('숨길 수 없어')));
  assert.strictEqual(A.sanitizeActionSpec({ actions: [{ type: 'nope' }] }).spec, null);
  assert.strictEqual(A.sanitizeActionSpec(null).spec, null);
  assert.strictEqual(A.sanitizeActionSpec({ actions: Array.from({ length: 9 }, () => ({ type: 'shake' })) }).spec.actions.length, 4, '한 번에 4개까지');
});

t('저장 형식: 부호화 → 복호화가 같은 값을 돌려주고, 안전 감사를 통과한다', () => {
  const { spec } = A.sanitizeActionSpec({ trigger: 'hover', replace: true, actions: [{ type: 'speak', target: 'main h1' }, { type: 'sound', tone: 'ding' }] });
  const code = A.encode(spec);
  assert.deepStrictEqual(A.decode(code), spec);
  assert.ok(auditProposal({ generatedJs: { '#x': code } }, null).sanitized.generatedJs['#x'], '저장·재적용 경로의 안전 감사가 이 형식을 지우면 안 된다');
  // 저장소가 오염돼도 복호화할 때 다시 검증한다
  assert.deepStrictEqual(A.decode(A.PREFIX + JSON.stringify({ actions: [{ type: 'fetch' }, { type: 'confetti' }] })).actions, [{ type: 'confetti' }]);
  assert.strictEqual(A.decode(A.PREFIX + '{broken'), null);
  assert.strictEqual(A.decode("el.addEventListener('click', () => {})"), null, '예전 스크립트는 정해진 동작이 아니다');
});

t('사람이 읽는 설명과 AI 에 주는 목록', () => {
  const { spec } = A.sanitizeActionSpec({ actions: [{ type: 'scroll_top' }, { type: 'message', text: '도착!' }] });
  assert.strictEqual(A.describe(spec), '누르면 맨 위로 이동 → 안내 문구 보여 주기 ("도착!") · 원래 기능은 그대로');
  assert.ok(A.describe(A.sanitizeActionSpec({ replace: true, actions: [{ type: 'shake' }] }).spec).includes('원래 기능은 막음'));
  const catalog = A.catalogForPrompt();
  for (const type of Object.keys(A.ACTION_CATALOG)) assert.ok(catalog.includes(`"${type}"`));
  assert.ok(!/fetch|submit|cookie|clipboard|storage/i.test(Object.keys(A.ACTION_CATALOG).join(' ')), '네트워크 · 제출 · 저장소 · 클립보드 동작은 목록에 없다');
});

t('다른 페이지로 이동: 주소는 이 페이지의 링크이거나 사용자가 직접 말한 주소여야 한다 (AI 가 지어낸 주소는 버린다)', () => {
  const context = { instruction: '누르면 학사일정 페이지로 이동하게 해 줘', allowedUrls: ['https://www.dshs.kr/school/schedule/', 'https://www.dshs.kr/about/'] };
  const go = (url, ctx = context, extra = {}) => A.sanitizeActionSpec({ trigger: 'hover', replace: false, actions: [{ type: 'navigate', url, ...extra }] }, ctx);
  // 페이지에 실제로 있는 링크 → 통과. 이동은 누를 때만, 원래 기능을 대신한다
  const ok = go('https://www.dshs.kr/school/schedule');
  assert.deepStrictEqual(ok.spec, { v: 1, trigger: 'click', replace: true, actions: [{ type: 'navigate', url: 'https://www.dshs.kr/school/schedule' }] });
  assert.strictEqual(A.describe(ok.spec), '누르면 다른 페이지로 이동: dshs.kr/school/schedule · 원래 기능 대신 이동합니다');
  // AI 가 지어낸 주소 → 버린다 (그리고 왜 뺐는지 알려 준다)
  const invented = go('https://phishing.example/login');
  assert.strictEqual(invented.spec, null);
  assert.ok(invented.notes.some(n => n.includes('주소')));
  // 사용자가 직접 적은 주소 → 통과 (사이트만 말했으면 그 사이트의 첫 화면만, 경로까지 말했으면 그 경로만)
  assert.ok(go('https://www.naver.com/', { instruction: 'naver.com 으로 이동', allowedUrls: [] }).spec);
  assert.strictEqual(go('https://www.naver.com/evil/path', { instruction: 'naver.com 으로 이동', allowedUrls: [] }).spec, null);
  assert.ok(go('https://example.com/docs/guide', { instruction: '누르면 https://example.com/docs/guide 로 보내 줘', allowedUrls: [] }).spec);
  // http(s) 가 아닌 주소 · 로그인 정보가 든 주소 · 상대 주소는 어떤 경우에도 받지 않는다
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'https://user:pw@example.com/', '/relative/path', 'ftp://example.com/x', 'https://exa mple.com'])
    assert.strictEqual(go(bad, { instruction: bad, allowedUrls: [bad] }).spec, null, bad);
  // 새 탭은 true 일 때만, 이동은 항상 맨 마지막에 한 번만
  const mixed = A.sanitizeActionSpec({ actions: [{ type: 'navigate', url: 'https://www.dshs.kr/about/', newTab: 'yes' }, { type: 'message', text: '이동합니다' }, { type: 'navigate', url: 'https://www.dshs.kr/school/schedule/', newTab: true }] }, context);
  assert.deepStrictEqual(mixed.spec.actions.map(a => a.type), ['message', 'navigate']);
  // 저장본을 다시 읽을 때도 주소 형식은 다시 검사한다
  assert.deepStrictEqual(A.decode(A.encode(ok.spec)), ok.spec);
  assert.strictEqual(A.decode(A.PREFIX + JSON.stringify({ actions: [{ type: 'navigate', url: 'javascript:alert(1)' }] })), null);
  assert.strictEqual(A.destinationText('https://www.dshs.kr/school/%ED%95%99%EC%82%AC/'), 'dshs.kr/school/학사');
  assert.strictEqual(A.destinationText('https://example.com/page?tab=2#map'), 'example.com/page?tab=2#map', '같은 문서 안의 위치도 구별되게 보여 준다');
});

console.log(`\n${passed} tests passed`);
