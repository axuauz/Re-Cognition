// 구조도 ③ 대안 제안 로직 단위 테스트:  node test/verify-alternatives.js
const assert = require('assert');
const A = require('../shared/alternatives.js');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✔', name); };
const base = { goalTitle: '고대비 다크 테마', instruction: '눈이 편하게 해줘', ruleCount: 5 };

t('원인 추론: 사용자가 말한 이유가 최우선', () => {
  assert.strictEqual(A.inferCause({ reason: '변화가 너무 커요' }), 'too_much');
  assert.strictEqual(A.inferCause({ reason: '기능이 바뀌거나 위험해 보여요' }), 'unsafe');
  assert.strictEqual(A.inferCause({ reason: '보기 불편해요' }), 'uncomfortable');
  assert.strictEqual(A.inferCause({ reason: '원한 것과 달라요' }), 'mismatch');
});

t('원인 추론: 이유 없는 신호는 제안의 성격에서 추론', () => {
  assert.strictEqual(A.inferCause({ signal: 'abandoned', riskLevel: 'high' }), 'unsafe');
  assert.strictEqual(A.inferCause({ signal: 'abandoned', ruleCount: 30 }), 'too_much');
  assert.strictEqual(A.inferCause({ signal: 'hesitation', ruleCount: 3 }), 'unclear');
  assert.strictEqual(A.inferCause({ signal: 'quick_revert', ruleCount: 3 }), 'uncomfortable');
  assert.strictEqual(A.inferCause({ signal: 'rage_after_apply' }), 'broke_interaction');
});

t('너무 큼 → 약한 시각 조정(CSS 전용) 재생성', () => {
  const alt = A.proposeAlternative({ ...base, reason: '변화가 너무 커요' });
  assert.strictEqual(alt.kind, 'instruction');
  assert.strictEqual(alt.modality, 'visual-lite');
  assert.ok(alt.cssOnly && alt.instruction.includes(base.goalTitle) && alt.depth === 1);
});

t('불편함 → 형태 전환: 글 많으면 음성, 중간이면 요약, 영상이면 자막', () => {
  const f = (pageSignals, extra = {}) => A.proposeAlternative({ ...base, reason: '보기 불편해요', pageSignals, ...extra });
  assert.strictEqual(f({ textLength: 3000 }).featureId, 'tts_reader');
  assert.strictEqual(f({ textLength: 800 }).featureId, 'plain_summary');
  assert.strictEqual(f({ textLength: 100, hasVideo: true }).featureId, 'live_captions');
  assert.strictEqual(f({ textLength: 100 }).kind, 'instruction');
  // 영구 배제했거나 이미 켜진 기능은 대안으로 내놓지 않는다
  assert.strictEqual(f({ textLength: 3000 }, { excludedFeatures: ['tts_reader'] }).featureId, 'plain_summary');
  assert.strictEqual(f({ textLength: 3000 }, { activeFeatures: ['tts_reader', 'plain_summary'] }).kind, 'instruction');
});

t('불안·조작 오류 → 버튼을 건드리지 않는 CSS 전용안', () => {
  for (const input of [{ reason: '위험해 보여요' }, { signal: 'rage_after_apply' }]) {
    const alt = A.proposeAlternative({ ...base, ...input });
    assert.strictEqual(alt.modality, 'visual-safe');
    assert.ok(alt.cssOnly);
  }
});

t('원한 것과 다름·망설임 → 단계형(하나씩 고르기)', () => {
  const alt = A.proposeAlternative({ ...base, signal: 'hesitation' });
  assert.strictEqual(alt.kind, 'clarify');
  assert.ok(alt.options.length >= 3 && alt.options.every(o => o.featureId || o.cssOnly));
});

t('끝없이 되묻지 않는다: 최대 2회, 같은 형태 반복 금지', () => {
  assert.strictEqual(A.proposeAlternative({ ...base, reason: '너무 커요', depth: 2 }), null);
  const second = A.proposeAlternative({ ...base, reason: '너무 커요', depth: 1, prevKind: 'instruction' });
  assert.strictEqual(second.kind, 'clarify');
  assert.strictEqual(A.proposeAlternative({ ...base, reason: '원한 것과 달라요', depth: 1, prevKind: 'clarify' }), null);
});

console.log(`\n${passed} tests passed`);
