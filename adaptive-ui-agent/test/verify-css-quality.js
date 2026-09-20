// 실제 사이트에서 깨진 패턴에 대한 회귀 테스트:  node test/verify-css-quality.js
const assert = require('assert');
const { improveCss, broadTag } = require('../shared/css-quality.js');
const S = require('../shared/selection.js');
const { auditProposal } = require('../shared/safety.js');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✔', name); };

t('넓은 범위 선택자 판별: 태그만으로 끝나면 넓다, 클래스·id 로 특정하면 좁다', () => {
  for (const s of ['a', 'main a', 'a:link', 'a:hover', '#search a', 'a:not(.x)']) assert.strictEqual(broadTag(s), 'link', s);
  for (const s of ['button', 'form button', '[role="button"]', 'input']) assert.strictEqual(broadTag(s), 'control', s);
  for (const s of ['a.btn', '#login', '.card a.more', 'nav', 'main p']) assert.strictEqual(broadTag(s), null, s);
});

t('사고 재현(google.com): 모든 링크·버튼에 border → 링크는 밑줄로, 버튼은 outline 으로', () => {
  const { css, notes } = improveCss('a, button { border: 2px solid #fff !important; padding: 2px !important; }');
  const linkRule = css.split('\n').find(r => r.startsWith('a '));
  assert.ok(/text-decoration: underline/.test(linkRule) && !/border|padding/.test(linkRule), linkRule);
  assert.ok(/button \{[^}]*outline: 2px solid #fff/.test(css) && !/button \{[^}]*border:/.test(css), css);
  assert.strictEqual(notes.length, 2);
  assert.ok(auditProposal({ generatedCss: css }, {}).sanitized.generatedCss.includes('underline'), '안전 감사도 통과');
});

t('outline·box-shadow 로 링크를 두른 것도 같은 문제다 / @media 안도 고친다', () => {
  assert.ok(!/outline|box-shadow/.test(improveCss('main a { outline: 2px solid red; box-shadow: 0 0 0 2px red; color: blue; }').css.replace(/text-underline-offset/g, '')));
  assert.ok(/color: blue/.test(improveCss('main a { outline: 2px solid red; color: blue; }').css));
  assert.ok(/@media \(min-width: 600px\)\s*\{a \{[^}]*underline/.test(improveCss('@media (min-width: 600px) { a { border: 1px solid red; } }').css));
});

t('특정한 요소·이미 안전한 CSS·테두리 제거는 건드리지 않는다', () => {
  for (const css of ['a.button-like { border: 2px solid red; }', '#search-btn { border: 2px solid red; }', 'a { color: #0645ad; text-decoration: underline; }', 'button { border: none; }', 'main p { font-size: 20px !important; }']) {
    const out = improveCss(css);
    assert.strictEqual(out.css, css);
    assert.strictEqual(out.notes.length, 0);
  }
});

t('검증기가 잰 "깨진 상자"가 있으면 그 후보는 밀리고, 이유가 남는다', () => {
  const mk = (artifacts) => ({ strategy: 'balanced', targets: ['emphasis'], audit: auditProposal({ generatedCss: 'x{y:z}' }, {}),
    report: { totalSelectors: 1, deadSelectors: [], visualArtifacts: artifacts, metrics: { before: { underlinedLinks: 0 }, after: { underlinedLinks: 12 }, changedAny: true } } });
  const clean = mk({ fragmentedBoxes: 0, strayBoxes: 0, shifted: 0 });
  const broken = mk({ fragmentedBoxes: 9, strayBoxes: 6, shifted: 40 });
  const ranked = S.selectBest([broken, clean], {});
  assert.strictEqual(ranked[0].report, clean.report);
  assert.ok(ranked[1].score.problems.some(p => p.includes('깨져')));
  assert.ok(ranked[0].score.total - ranked[1].score.total >= 18);
  assert.deepStrictEqual(ranked[0].score.achieved, ['emphasis'], '"또렷하게"는 밑줄 링크 수 증가로 검증된다');
});

t('버튼 전체에 글자색 없이 배경만 칠하면 배경을 뺀다 ("로그인" 글자가 안 보이던 사례)', () => {
  const out = improveCss('button, [role="button"] { background: #cfe8ff !important; outline: 2px solid #8ab4ff !important; }');
  assert.ok(!/background/.test(out.css), out.css);
  assert.ok(/outline: 2px solid #8ab4ff/.test(out.css));
  assert.ok(out.notes.some(n => n.includes('배경')));
  // 글자색을 함께 정했으면 그대로 둔다 (대비는 실제 페이지에서 잰다)
  const paired = 'button { background: #0b3d91 !important; color: #ffffff !important; }';
  assert.strictEqual(improveCss(paired).css, paired);
  // 특정한 버튼은 건드리지 않는다
  const narrow = '#login-btn { background: #cfe8ff; }';
  assert.strictEqual(improveCss(narrow).css, narrow);
});

t('잘리거나 겹친 강조 테두리가 있으면 그 후보는 밀린다 (탭 줄의 세로 막대, 붙어 있는 아이콘 버튼)', () => {
  const mk = (artifacts) => ({ strategy: 'balanced', targets: ['emphasis'], audit: auditProposal({ generatedCss: 'x{y:z}' }, {}),
    report: { totalSelectors: 1, deadSelectors: [], visualArtifacts: artifacts, metrics: { before: {}, after: {}, changedAny: true } } });
  const clean = mk({ fragmentedBoxes: 0, strayBoxes: 0, clippedBoxes: 0, overlappingBoxes: 0, shifted: 0 });
  const messy = mk({ fragmentedBoxes: 0, strayBoxes: 0, clippedBoxes: 2, overlappingBoxes: 4, shifted: 0 });
  const ranked = S.selectBest([messy, clean], {});
  assert.strictEqual(ranked[0].report, clean.report);
  assert.ok(ranked[1].score.problems.some(p => p.includes('깨져')));
  assert.ok(ranked[0].score.total - ranked[1].score.total >= 10);
});

console.log(`\n${passed} tests passed`);
