// 구조도 ① 특징 분석 · ② 후보 최적 선택 단위 테스트:  node test/verify-profile-selection.js
const assert = require('assert');
const P = require('../shared/profile.js');
const S = require('../shared/selection.js');
const { auditProposal } = require('../shared/safety.js');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✔', name); };

const visit = (over = {}) => ({ domain: 'mail.example.com', pageType: 'general_webpage', dwellSec: 120, signals: { textLength: 800 }, input: { clicks: 10, keyNav: 0, missClicks: 0 }, environment: {}, targets: [], usedFeatures: [], ...over });
const repeat = (profile, n, obs) => { let p = profile; for (let i = 0; i < n; i++) p = P.observeSession(p, obs, 1e12 + i); return p; };

/* ---------------- ① 데이터 수집 → 특징 분석 ---------------- */
t('스쳐 지나간 방문은 세지 않고, 관측이 적으면 신뢰도가 낮다', () => {
  let p = P.observeSession(P.emptyProfile(), visit({ dwellSec: 1 }));
  assert.strictEqual(p.sessions, 0);
  p = repeat(p, 2, visit());
  assert.ok(P.inferDimensions(p, []).confidence < 0.3);
  assert.ok(P.inferDimensions(repeat(p, 12, visit()), []).confidence >= 0.9);
});

t('숙련도: 빗나간 클릭·느린 첫 동작 → 초보 / 단축키·빠른 입력 → 익숙함', () => {
  const novice = repeat(P.emptyProfile(), 8, visit({ input: { clicks: 10, missClicks: 6, keyNav: 0, firstActionSec: 25, typedChars: 40, backspaces: 15, typingSec: 40 } }));
  assert.strictEqual(P.inferDimensions(novice, []).proficiency.value, 'novice');
  const expert = repeat(P.emptyProfile(), 8, visit({ input: { clicks: 6, keyNav: 8, missClicks: 0, firstActionSec: 2, shortcutUses: 2, typedChars: 200, backspaces: 5, typingSec: 40 } }));
  const dims = P.inferDimensions(expert, []);
  assert.strictEqual(dims.proficiency.value, 'expert');
  assert.ok(dims.proficiency.evidence.length > 0, '근거가 함께 나온다');
});

t('접근성 필요: 특성 메모 + 행동 + 환경을 합쳐 추론한다', () => {
  const p = repeat(P.emptyProfile(), 6, visit({ signals: { zoomEvents: 2, textLength: 800 }, environment: { prefersContrast: true, pageZoom: 1.25 } }));
  const byBehavior = P.inferDimensions(p, []);
  assert.ok(byBehavior.needs.lowVision.score >= 0.5, '메모가 없어도 확대·고대비 환경으로 추론');
  assert.ok(P.inferDimensions(P.emptyProfile(), ['청각장애가 있어요']).needs.hearing.score >= 0.8);
  assert.ok(P.inferDimensions(P.emptyProfile(), []).needs.lowVision.score === 0);
});

t('인지 스타일: 실제로 쓴 도움의 형태에서 추론하고, 사용자가 고친 값이 우선한다', () => {
  let p = repeat(P.emptyProfile(), 4, visit({ usedFeatures: ['tts_reader'] }));
  assert.strictEqual(P.inferDimensions(p, []).cognitiveStyle.modality, 'audio');
  p = { ...p, overrides: { modality: 'text', proficiency: 'expert' } };
  const d = P.inferDimensions(p, []);
  assert.strictEqual(d.cognitiveStyle.modality, 'text');
  assert.strictEqual(d.proficiency.value, 'expert');
  assert.strictEqual(P.inferDimensions(P.emptyProfile(), ['초등학생 아이가 써요']).cognitiveStyle.pace, 'stepwise');
});

t('상황 맥락: 여러 방문에서 반복해 누른 버튼 → "정해진 작업" 목적 + 자주 쓰는 대상', () => {
  const obs = visit({ targets: [{ label: '받은편지함', selector: '#inbox', count: 2 }, { label: '편지쓰기', selector: '#compose', count: 2 }, { label: '설정', selector: '#s', count: 1 }] });
  const p = repeat(P.emptyProfile(), 3, obs);
  const ctx = P.contextFor(p, { domain: 'mail.example.com', pageType: 'general_webpage' });
  assert.strictEqual(ctx.purpose, 'task');
  assert.deepStrictEqual(ctx.frequentTargets.slice(0, 2).map(x => x.label).sort(), ['받은편지함', '편지쓰기'], '많이 누른 순');
  const once = P.observeSession(P.emptyProfile(), obs);
  assert.strictEqual(P.contextFor(once, { domain: 'mail.example.com' }).frequentTargets.length, 0, '한 번의 방문만으로는 단정하지 않는다');
  assert.strictEqual(P.contextFor(p, { domain: 'other.com', pageType: 'article' }).purpose, 'read');
});

t('민감 페이지의 버튼 기록은 남기지 않고, 도메인 수는 제한된다', () => {
  const p = P.observeSession(P.emptyProfile(), visit({ sensitive: true, domain: 'bank.example', targets: [{ label: '이체', selector: '#t' }] }));
  assert.strictEqual(p.domains['bank.example'], undefined);
  let q = P.emptyProfile();
  for (let i = 0; i < 60; i++) q = P.observeSession(q, visit({ domain: `site${i}.com` }), 1e12 + i);
  assert.ok(Object.keys(q.domains).length <= 40);
});

t('사용 중 피드백: 맞춤 화면에서도 어려움이 이어지면 persistentStruggle', () => {
  const p = repeat(P.emptyProfile(), 3, visit({ adapted: { goalTitle: '큰 글자' }, signals: { zoomEvents: 2, rereadScrolls: 4, textLength: 900 } }));
  assert.strictEqual(P.contextFor(p, { domain: 'mail.example.com' }).persistentStruggle, true);
  const ok = repeat(P.emptyProfile(), 3, visit({ adapted: { goalTitle: '큰 글자' } }));
  assert.strictEqual(P.contextFor(ok, { domain: 'mail.example.com' }).persistentStruggle, false);
});

t('AI 에 넘기는 요약에는 입력 내용·주소가 없고 추론 결과만 있다', () => {
  const p = repeat(P.emptyProfile(), 5, visit({ targets: [{ label: '편지쓰기', selector: '#compose', count: 3 }] }));
  const sum = P.summarizeForModel(p, ['저시력'], { domain: 'mail.example.com', pageType: 'general_webpage' });
  assert.ok(sum.accessibilityNeeds.some(n => n.need === 'lowVision'));
  assert.ok(!JSON.stringify(sum).includes('typed'));
  assert.ok(P.describe(p, ['저시력']).rows.every(r => r.label && r.value));
});

/* ---------------- ② 후보 생성 → 최적 선택 ---------------- */
const page = { domain: 'news.example.com', interactiveMap: [{ selector: '#search-btn', text: '검색' }] };
const cand = (strategy, proposal, report, targets) => ({ strategy, targets, audit: auditProposal(proposal, page), report, raw: proposal });
const okReport = (after, extra = {}) => ({ totalSelectors: 3, deadSelectors: [], contrastFailures: [], hiddenInteractive: [], metrics: { before: { fontPx: 12, contrast: 4.2, lineHeightRatio: 1.3, visibleDistractions: 3, smallTargets: 5 }, after: { fontPx: 12, contrast: 4.2, lineHeightRatio: 1.3, visibleDistractions: 3, smallTargets: 5, ...after }, changedAny: true }, ...extra });
const lowVision = { dims: { needs: { lowVision: { score: 0.9 } }, proficiency: { value: 'intermediate' }, cognitiveStyle: {} } };

t('목표를 "측정으로" 달성한 후보가, 말만 한 후보를 이긴다', () => {
  const real = cand('balanced', { generatedCss: 'main p{font-size:20px !important}' }, okReport({ fontPx: 20, contrast: 8 }), ['font', 'contrast']);
  const talk = cand('balanced', { generatedCss: '.nope{font-size:20px !important}' }, okReport({}, { deadSelectors: ['.nope', '.x'], totalSelectors: 2, metrics: { before: { fontPx: 12 }, after: { fontPx: 12 }, changedAny: false } }), ['font', 'contrast']);
  const ranked = S.selectBest([talk, real], lowVision);
  assert.strictEqual(ranked[0].raw, real.raw);
  assert.ok(ranked[0].score.reasons.length > 0 && ranked[1].score.problems.length > 0);
});

t('버튼을 못 쓰게 만들거나 위험 코드가 섞인 후보는 밀린다', () => {
  const safe = cand('minimal', { generatedCss: 'main p{font-size:19px !important}' }, okReport({ fontPx: 19 }), ['font']);
  const breaks = cand('balanced', { generatedCss: 'main p{font-size:22px !important}' }, okReport({ fontPx: 22 }, { hiddenInteractive: [{ label: '검색', selector: '#search-btn' }] }), ['font']);
  const risky = cand('structural', { generatedCss: '@import url("https://evil.test/x.css"); main p{font-size:22px !important}', components: [{ type: 'quick_actions', anchor: 'main', props: { actions: [{ label: '메일 보내기', targetSelector: '#search-btn' }] } }] }, okReport({ fontPx: 22 }), ['font', 'shortcuts']);
  assert.strictEqual(S.selectBest([breaks, risky, safe], lowVision)[0].raw, safe.raw);
});

t('프로필에 따라 선택이 달라진다: 단계형이 맞는 사용자 → 안내 부품이 있는 안', () => {
  const plain = cand('balanced', { generatedCss: 'main p{line-height:1.8 !important}' }, okReport({ lineHeightRatio: 1.8 }), ['spacing']);
  const guided = cand('structural', { generatedCss: 'main p{line-height:1.8 !important}', components: [{ type: 'steps', anchor: 'main', props: { steps: [{ text: '검색창을 누르세요' }] } }] }, okReport({ lineHeightRatio: 1.8 }), ['spacing', 'guide']);
  const novice = { dims: { needs: { cognitive: { score: 0.8 } }, proficiency: { value: 'novice' }, cognitiveStyle: { pace: 'stepwise' } } };
  const expert = { dims: { needs: {}, proficiency: { value: 'expert' }, cognitiveStyle: { pace: 'free' } }, recentCauses: ['too_much'] };
  assert.strictEqual(S.selectBest([plain, guided], novice)[0].raw, guided.raw);
  const minimal = { ...plain, strategy: 'minimal' };
  assert.strictEqual(S.selectBest([guided, minimal], expert)[0].strategy, 'minimal');
});

t('사람 피드백으로 전략 선호를 학습한다: 거절·되돌림이 쌓인 전략은 밀린다', () => {
  let stats = {};
  for (let i = 0; i < 4; i++) { stats = S.updateStrategyStats(stats, 'structural', 'reverted'); stats = S.updateStrategyStats(stats, 'minimal', 'kept'); }
  assert.ok(S.strategyPreference(stats, 'minimal') > 0.8 && S.strategyPreference(stats, 'structural') < 0.2);
  const mk = (strategy) => cand(strategy, { generatedCss: 'main p{font-size:20px !important}' }, okReport({ fontPx: 20 }), ['font']);
  assert.strictEqual(S.selectBest([mk('structural'), mk('minimal')], { dims: lowVision.dims, strategyStats: stats })[0].strategy, 'minimal');
  assert.strictEqual(S.selectBest([mk('structural'), mk('minimal')], { dims: lowVision.dims, strategyStats: {} })[0].strategy, 'structural', '학습 전에는 먼저 온 후보');
});

t('구조도의 "학습 반영": 불만족 원인이 되풀이되면 프로필의 인지 스타일이 바뀐다 (한 번으로는 바뀌지 않는다)', () => {
  let p = P.emptyProfile();
  const base = P.inferDimensions(p, []).cognitiveStyle;
  p = P.learnFromDissatisfaction(p, { cause: 'too_many', signal: 'explicit' });
  assert.strictEqual(P.inferDimensions(p, []).cognitiveStyle.detail, base.detail, '한 번의 불만족으로 단정하지 않는다');
  p = P.learnFromDissatisfaction(p, { cause: 'too_much', signal: 'quick_revert' });
  const after = P.inferDimensions(p, []).cognitiveStyle;
  assert.strictEqual(after.detail, 'summary');
  assert.ok(after.evidence.some(e => e.includes('핵심만')), '근거가 남아야 사용자가 보고 고칠 수 있다');
  // 조작이 어려웠던 신호(망설임 · 조작 오류)는 단계형 안내로
  let q = P.learnFromDissatisfaction(P.emptyProfile(), { cause: 'hard_to_use', signal: 'operation_error' });
  q = P.learnFromDissatisfaction(q, { cause: 'unclear', signal: 'hesitation' });
  assert.strictEqual(P.inferDimensions(q, []).cognitiveStyle.pace, 'stepwise');
  assert.strictEqual(q.feedback.count, 2);
  // 사용자가 직접 고친 값이 학습보다 우선한다
  q.overrides = { pace: 'free' };
  assert.strictEqual(P.inferDimensions(q, []).cognitiveStyle.pace, 'free');
  // 오래된 원인은 옅어진다
  let r = P.learnFromDissatisfaction(P.emptyProfile(), { cause: 'hard_to_read' });
  for (let i = 0; i < 12; i++) r = P.learnFromDissatisfaction(r, { cause: 'mismatch' });
  assert.ok((r.feedback.causes.hard_to_read || 0) < 0.2);
});

console.log(`\n${passed} tests passed`);
