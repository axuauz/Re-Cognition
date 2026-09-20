// 보기 설정(글자 크기 · 화면 색 · 읽어 주기) 단위 테스트:  node test/verify-view-prefs.js
const assert = require('assert');
const V = require('../shared/view-prefs.js');
const Persona = require('../shared/persona.js');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✔', name); };

t('읽어 주기는 읽기가 도움이 되는 방식(시각장애 · 저시력 · 어르신 · 어린이 · 난독)에서 기본으로 켜진다', () => {
  const speakOf = (id) => V.resolvePrefs(null, Persona.withPersonaTraits(id, [])).prefs.speak;
  assert.deepStrictEqual(['blind', 'lowVision', 'elderly', 'child', 'dyslexia'].map(speakOf), [true, true, true, true, true]);
  // 소리가 필요 없거나(청각장애) 방해가 될 수 있는 방식에서는 꺼 둔다 — 설정 탭에서 켤 수 있다
  assert.deepStrictEqual(['none', 'hearing', 'motor'].map(speakOf), [false, false, false]);
  // "큰 글자"라는 말만으로 저시력 취급(고대비)을 하지 않는다
  const elderly = V.resolvePrefs(null, Persona.withPersonaTraits('elderly', [])).prefs;
  assert.deepStrictEqual([elderly.size, elderly.theme], ['large', 'auto']);
});

t('직접 켠 읽어 주기는 페르소나를 바꿔도 남고, 글자 크기 · 화면 색은 새 방식에 맞게 되돌아간다', () => {
  // 사용자가 어르신 방식에서 읽어 주기만 켰다
  const stored = { speak: true, speakSet: true };
  const motor = V.resolvePrefs(stored, Persona.withPersonaTraits('motor', [])).prefs;
  assert.deepStrictEqual([motor.speak, motor.size], [true, 'large']);
  // 페르소나를 어린이로 바꾼다 → 서비스 워커는 keepAcrossPersona 가 돌려준 값만 남긴다
  const kept = V.keepAcrossPersona({ size: 'xlarge', theme: 'dark', speak: true, speakSet: true, userSet: true });
  assert.deepStrictEqual(kept, { speak: true, speakSet: true });
  const child = V.resolvePrefs(kept, Persona.withPersonaTraits('child', [])).prefs;
  assert.deepStrictEqual([child.speak, child.size, child.theme], [true, 'large', 'auto'], '예전의 xlarge · dark 가 새 방식을 가리면 안 된다');
  // 직접 끈 사람에게는 기본이 켜짐인 방식으로 바꿔도 다시 켜지지 않는다
  assert.strictEqual(V.resolvePrefs({ speak: false, speakSet: true }, Persona.withPersonaTraits('elderly', [])).prefs.speak, false);
  // 직접 끈 것도 남는다: 저시력은 기본이 켜짐이지만 끈 사람에게 다시 켜지지 않는다
  const off = V.keepAcrossPersona({ speak: false, speakSet: true, userSet: true });
  assert.strictEqual(V.resolvePrefs(off, Persona.withPersonaTraits('lowVision', [])).prefs.speak, false);
  // 읽어 주기를 직접 고른 적이 없으면 남길 것이 없다
  assert.strictEqual(V.keepAcrossPersona({ size: 'large', speak: true, userSet: true }), null);
  assert.strictEqual(V.keepAcrossPersona(null), null);
});

t('글자 크기 · 화면 색을 직접 고른 값(userSet)은 예전처럼 전부 우선한다', () => {
  const prefs = V.resolvePrefs({ size: 'normal', theme: 'light', speak: false, userSet: true }, Persona.withPersonaTraits('lowVision', [])).prefs;
  assert.deepStrictEqual([prefs.size, prefs.theme, prefs.speak], ['normal', 'light', false]);
});

console.log(`\n${passed} tests passed`);
