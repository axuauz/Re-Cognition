/**
 * EqualiUI View Preferences — 보기 설정(글자 크기 · 화면 색 · 간격)의 단일 출처.
 * 확장 페이지(ui-src: 사이드패널·팝업·새 탭)와 웹페이지 안 UI(content script)가 같은 규칙을 쓴다.
 * 사용자가 직접 고른 값(newtabPrefs.userSet)이 항상 우선하고, 없으면 특성 메모에서 기본값을 끌어낸다.
 */
(function (root) {
  'use strict';

  const DEFAULT_PREFS = { size: 'normal', theme: 'auto', spacing: false, simple: false, speak: false };
  const SIZE_RANK = { normal: 0, large: 1, xlarge: 2 };

  const TRAIT_RULES = [
    [/전맹|스크린 ?리더|음성 ?안내/i, { speak: true }, '음성 안내를 선호하셔서 버튼 이름을 읽어드립니다'],
    // "큰 글자"만으로는 저시력이라고 볼 수 없다 (어르신 방식의 "큰 글자가 필요함"이 고대비 · 읽어 주기까지 켜던 문제) → 크기만 키운다
    [/큰 ?글/i, { size: 'large' }, '글자를 크게 표시합니다'],
    [/저시력|시력|시각|잘 안 ?보|low.?vision/i, { size: 'xlarge', theme: 'contrast', speak: true }, '저시력에 맞춰 아주 큰 글자와 고대비 색을 쓰고, 버튼에 커서를 올리면 이름을 읽어 드립니다'],
    [/눈부심|다크|어두운/i, { theme: 'dark' }, '눈부심을 줄이기 위해 어두운 화면을 사용합니다'],
    [/난독|dyslex|읽기 ?어려/i, { spacing: true, size: 'large', speak: true }, '읽기 편하도록 글자·줄 간격을 넓히고, 버튼에 커서를 올리면 이름을 읽어 드립니다'],
    [/노인|어르신|고령/i, { size: 'large', speak: true }, '글자와 버튼을 크게 표시하고, 버튼에 커서를 올리면 이름을 읽어 드립니다'],
    [/떨림|누르기 ?어려|마비/i, { size: 'large' }, '누르기 쉽도록 글자와 버튼을 크게 표시합니다'],
    [/어린이|아이|초등/i, { speak: true }, '버튼에 커서를 올리면 이름을 읽어 드립니다'],
    [/어린이|아이|초등|집중|adhd|산만|쉬운 ?말|쉽게/i, { simple: true, size: 'large' }, '헷갈리지 않도록 검색창 위주로 단순하게 보여드립니다']
  ];

  function derivePrefs(traits) {
    const prefs = { ...DEFAULT_PREFS };
    const reasons = [];
    for (const [re, patch, reason] of TRAIT_RULES) {
      if (!(traits || []).some(t => re.test(String(t)))) continue;
      reasons.push(reason);
      if (patch.size && SIZE_RANK[patch.size] > SIZE_RANK[prefs.size]) prefs.size = patch.size;
      if (patch.theme && prefs.theme !== 'contrast') prefs.theme = patch.theme;
      if (patch.spacing) prefs.spacing = true;
      if (patch.simple) prefs.simple = true;
      if (patch.speak) prefs.speak = true;
    }
    return { prefs, reasons };
  }

  // "커서를 올리면 읽어 주기"는 글자 크기·화면 색과 달리 페르소나와 무관한 개인 취향이다.
  // 직접 켜거나 끈 값(speakSet)은 페르소나를 바꿔 글자 크기·화면 색이 다시 맞춰져도 그대로 남는다.
  function resolvePrefs(stored, traits) {
    if (stored && stored.userSet) return { prefs: { ...DEFAULT_PREFS, ...stored }, reasons: [] };
    const derived = derivePrefs(traits);
    if (stored && stored.speakSet && typeof stored.speak === 'boolean') derived.prefs.speak = stored.speak;
    return derived;
  }

  /** 페르소나를 새로 골랐을 때 남길 값: 글자 크기·화면 색은 그 방식에 맞게 되돌리고, 읽어 주기처럼 따로 고른 값만 남긴다 */
  function keepAcrossPersona(stored) {
    if (!stored || !stored.speakSet || typeof stored.speak !== 'boolean') return null;
    return { speak: stored.speak, speakSet: true };
  }

  const api = { DEFAULT_PREFS, derivePrefs, resolvePrefs, keepAcrossPersona };
  root.EqualiViewPrefs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
