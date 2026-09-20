// 읽어 주기 음성 고르기 단위 테스트:  node test/verify-speech.js
const assert = require('assert');
const S = require('../shared/speech.js');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✔', name); };

// 실제 macOS + Chrome 에서 보이는 목록에 가깝게 (기본값은 압축형이라 기계 소리가 난다)
const macChrome = [
  { name: 'Yuna', lang: 'ko-KR', localService: true, default: true },
  { name: 'Yuna (Premium)', lang: 'ko-KR', localService: true },
  { name: 'Google 한국의', lang: 'ko-KR', localService: false },
  { name: 'Samantha', lang: 'en-US', localService: true },
  { name: 'Google US English', lang: 'en-US', localService: false }
];

t('한국어가 아닌 음성은 절대 고르지 않는다 (한국어 음성이 없으면 브라우저 기본값에 맡긴다)', () => {
  assert.ok(/^ko/.test(S.pickVoice(macChrome).lang));
  assert.strictEqual(S.pickVoice([{ name: 'Samantha', lang: 'en-US' }]), null);
  assert.strictEqual(S.pickVoice([]), null);
  assert.strictEqual(S.pickVoice(null), null);
});

t('설치된 음성 중 가장 자연스러운 것을 고른다 (기본 압축형 Yuna 가 아니라)', () => {
  assert.notStrictEqual(S.pickVoice(macChrome).name, 'Yuna', '브라우저 기본값을 그대로 쓰면 기계 소리가 난다');
  assert.ok(['Google 한국의', 'Yuna (Premium)'].includes(S.pickVoice(macChrome).name));
  // 품질 표시가 있는 음성 · 네트워크 음성이 압축형보다 높다
  assert.ok(S.scoreVoice(macChrome[1]) > S.scoreVoice(macChrome[0]));
  assert.ok(S.scoreVoice(macChrome[2]) > S.scoreVoice(macChrome[0]));
  assert.ok(S.scoreVoice({ name: 'Yuna Compact', lang: 'ko-KR', localService: true }) < S.scoreVoice(macChrome[0]));
  // 한국어 음성이 압축형 하나뿐이면 그것이라도 고른다
  assert.strictEqual(S.pickVoice([macChrome[0], macChrome[3]]).name, 'Yuna');
});

t('사용자가 직접 고른 음성이 언제나 우선한다', () => {
  assert.strictEqual(S.pickVoice(macChrome, 'Yuna').name, 'Yuna');
  // 고른 음성이 그 기기에 없으면(다른 컴퓨터 등) 자동 선택으로 돌아간다
  assert.strictEqual(S.pickVoice(macChrome, '없는 음성').name, S.pickVoice(macChrome).name);
});

t('설정 화면 목록: 한국어만, 자연스러운 순서로, 사람이 알아볼 설명과 함께', () => {
  const list = S.listVoices(macChrome);
  // 기기에 깔린 고품질 음성이 네트워크 음성보다 앞선다 (인터넷 없이도 같은 소리가 난다)
  assert.deepStrictEqual(list.map(v => v.name), ['Yuna (Premium)', 'Google 한국의', 'Yuna']);
  assert.ok(list[0].label.includes('자연스러움') && !list[2].label.includes('자연스러움'));
  assert.deepStrictEqual(S.listVoices([{ name: 'Samantha', lang: 'en-US' }]), []);
});

t('읽어 주기는 고른 음성과 속도로 만들어진다', () => {
  global.SpeechSynthesisUtterance = function (text) { this.text = text; };
  const utt = S.makeUtterance('안녕하세요', { voices: macChrome, rate: 'fast' });
  assert.strictEqual(utt.voice.name, 'Yuna (Premium)');
  assert.strictEqual(utt.lang, 'ko-KR');
  assert.strictEqual(utt.rate, S.RATES.fast);
  // 음성을 못 찾아도 한국어로 읽도록 lang 은 남긴다
  const fallback = S.makeUtterance('안녕하세요', { voices: [] });
  assert.deepStrictEqual([fallback.voice, fallback.lang, fallback.rate], [undefined, 'ko-KR', 1]);
  // 브라우저가 음성 지정을 거부해도 읽기는 계속된다 (지정이 실패했다고 아무 소리도 안 나면 안 된다)
  global.SpeechSynthesisUtterance = function (text) { this.text = text; Object.defineProperty(this, 'voice', { set() { throw new TypeError('거부'); } }); };
  const guarded = S.makeUtterance('안녕하세요', { voices: macChrome });
  assert.strictEqual(guarded.lang, 'ko-KR');
  delete global.SpeechSynthesisUtterance;
});

console.log(`\n${passed} tests passed`);
