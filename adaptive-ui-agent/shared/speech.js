/**
 * Re:Cognition Speech — 읽어 주기에 쓸 "가장 자연스러운 음성" 고르기
 *
 * 왜 필요한가
 *   지금까지는 utterance 에 lang='ko-KR' 만 지정하고 voice 는 비워 두었다. 그러면 브라우저가 시스템 기본 한국어 음성을 쓰는데,
 *   macOS 의 기본값은 압축형(Compact) Yuna 여서 기계 소리처럼 들린다. 같은 기기에 대체로 더 자연스러운 음성이
 *   이미 깔려 있다: Chrome 의 "Google 한국의"(네트워크 음성), macOS 의 Yuna(프리미엄/고급), Siri 계열.
 *   그래서 설치된 음성을 점수로 매겨 가장 자연스러운 것을 고르고, 사용자가 직접 고른 음성이 있으면 그것을 항상 우선한다.
 *
 * 원칙
 *   - 한국어가 아닌 음성으로 한국어를 읽으면 알아들을 수 없으므로 절대 고르지 않는다 (사용자가 직접 고른 경우는 예외).
 *   - 기기마다 설치된 음성이 다르므로 이름을 하드코딩하지 않고 "이름에 담긴 품질 표시 + 네트워크 여부"로 판단한다.
 * 순수 함수만 포함 (Node 테스트 가능).
 */
(function (root) {
  'use strict';

  // 이름에 이런 말이 들어간 음성은 사람 목소리에 가깝다 (Google/Apple/MS 가 품질 등급을 이름에 적어 둔다)
  const NATURAL_RE = /(neural|premium|enhanced|natural|siri|wavenet|studio|journey|online|plus)/i;
  // 용량을 줄인 저품질 음성 (맥의 기본값이 여기에 해당해 지금까지 기계 소리가 났다)
  const POOR_RE = /(compact|eloquence|espeak|festival|pico|robot)/i;

  const RATES = { slow: 0.85, normal: 1, fast: 1.25, faster: 1.5 };
  const isKorean = (voice) => /^ko\b/i.test(String((voice && voice.lang) || '').replace('_', '-'));

  /** 높을수록 자연스러운 음성. 한국어가 아니면 후보에서 뺀다(-Infinity). */
  function scoreVoice(voice, preferredName) {
    if (!voice || !voice.name) return -Infinity;
    if (preferredName && voice.name === preferredName) return 1000; // 사용자가 직접 고른 음성이 언제나 먼저
    if (!isKorean(voice)) return -Infinity;
    let score = 0;
    if (/^ko-KR/i.test(String(voice.lang).replace('_', '-'))) score += 10;
    if (NATURAL_RE.test(voice.name)) score += 50;
    if (POOR_RE.test(voice.name)) score -= 40;
    if (voice.localService === false) score += 25; // 네트워크 음성(구글)이 대체로 더 자연스럽다
    if (voice.default) score += 2;
    return score;
  }

  /** 쓸 수 있는 음성 중 가장 자연스러운 것. 한국어 음성이 하나도 없으면 null (브라우저 기본값에 맡긴다). */
  function pickVoice(voices, preferredName) {
    const list = Array.isArray(voices) ? voices : [];
    const chosen = preferredName && list.find(v => v && v.name === preferredName);
    if (chosen) return chosen;
    let best = null;
    let bestScore = -Infinity;
    for (const voice of list) {
      const score = scoreVoice(voice);
      if (score > bestScore) { best = voice; bestScore = score; }
    }
    return bestScore === -Infinity ? null : best;
  }

  /** 설정 화면의 음성 목록: 자연스러운 순서로, 사람이 알아볼 설명과 함께 */
  function listVoices(voices) {
    return (Array.isArray(voices) ? voices : []).filter(isKorean)
      .map(v => ({ name: v.name, lang: v.lang, natural: NATURAL_RE.test(v.name) || v.localService === false, score: scoreVoice(v) }))
      .sort((a, b) => b.score - a.score)
      .map(v => ({ ...v, label: `${v.name}${v.natural ? ' · 자연스러움' : POOR_RE.test(v.name) ? ' · 기계음' : ''}` }));
  }

  /** 모든 읽어 주기가 같은 음성·속도를 쓰도록 utterance 를 여기서 만든다 */
  function makeUtterance(text, { voices, preferredName, rate, pitch } = {}) {
    const utt = new (root.SpeechSynthesisUtterance || SpeechSynthesisUtterance)(String(text || ''));
    const voice = pickVoice(voices, preferredName);
    // 음성 지정이 실패해도(브라우저가 거부하는 값 등) 읽기 자체는 멈추지 않아야 한다 → 실패하면 언어만 지정하고 계속한다
    utt.lang = (voice && voice.lang) || 'ko-KR';
    if (voice) { try { utt.voice = voice; } catch (e) { utt.lang = 'ko-KR'; } }
    utt.rate = typeof rate === 'number' ? rate : (RATES[rate] || RATES.normal);
    if (typeof pitch === 'number') utt.pitch = pitch;
    return utt;
  }

  const api = { RATES, scoreVoice, pickVoice, listVoices, makeUtterance };
  root.EqualiSpeech = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
