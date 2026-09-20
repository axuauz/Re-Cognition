/**
 * EqualiUI Alternative Proposer (구조도 ③ 대안 인터페이스 자발적 제안)
 * 불만족 신호(명시적 거절·이탈·망설임·빠른 복구·조작 오류) → 원인 추론 → "다른 형태"의 대안 1개 선택.
 * 순수 함수만 포함. API 를 호출하지 않으므로 비용이 들지 않고, 실제 생성은 사용자가 대안을 수락했을 때만 일어난다.
 */
(function (root) {
  'use strict';

  const MAX_DEPTH = 2; // 한 요청에서 대안은 최대 2번까지 (끝없는 되묻기 방지)

  const CAUSE_TEXT = {
    too_much: '변화가 너무 컸던 것 같아요',
    unsafe: '기능이 바뀔까 봐 불안하셨던 것 같아요',
    uncomfortable: '바뀐 화면이 보기 불편하셨던 것 같아요',
    mismatch: '원하신 것과 달랐던 것 같아요',
    unclear: '결정하기 어려우셨던 것 같아요',
    broke_interaction: '바뀐 화면에서 버튼이 잘 눌리지 않았던 것 같아요'
  };

  function inferCause({ signal = 'explicit', reason = '', riskLevel = 'low', ruleCount = 0, hasDomOrJs = false } = {}) {
    const r = String(reason || '');
    if (signal === 'rage_after_apply') return 'broke_interaction';
    if (r) {
      if (/위험|기능|무서|불안/.test(r)) return 'unsafe';
      if (/너무|과하|과해|많|커요|크다/.test(r)) return 'too_much';
      if (/불편|어지|눈|안 ?보|답답/.test(r)) return 'uncomfortable';
      return 'mismatch';
    }
    if (signal === 'quick_revert' || signal === 'revert' || signal === 'checkin_negative' || signal === 'persistent_struggle') {
      return ruleCount > 12 ? 'too_much' : 'uncomfortable';
    }
    // 이유를 말하지 않은 이탈·망설임: 제안의 성격에서 추론
    if (riskLevel === 'high' || hasDomOrJs) return 'unsafe';
    if (ruleCount > 12) return 'too_much';
    return signal === 'hesitation' ? 'unclear' : 'mismatch';
  }

  const CLARIFY_OPTIONS = [
    { label: '글자만 크게', instruction: '다른 것은 그대로 두고 본문 글자만 크게, 줄 간격만 넉넉하게 해줘', cssOnly: true },
    { label: '색 대비만 높게', instruction: '다른 것은 그대로 두고 글자와 배경의 색 대비만 높여서 또렷하게 해줘', cssOnly: true },
    { label: '광고·사이드바만 정리', instruction: '본문과 버튼은 그대로 두고 광고, 배너, 사이드바만 가려줘', cssOnly: true },
    { label: '바꾸지 말고 읽어주기', featureId: 'tts_reader' }
  ];

  function proposeAlternative(input) {
    const {
      signal, reason, goalTitle = '', instruction = '', riskLevel, ruleCount, hasDomOrJs,
      depth = 0, prevKind = null, pageSignals = {}, excludedFeatures = [], activeFeatures = []
    } = input || {};
    if (depth >= MAX_DEPTH) return null;

    const cause = inferCause({ signal, reason, riskLevel, ruleCount, hasDomOrJs });
    const unavailable = new Set([...(excludedFeatures || []), ...(activeFeatures || [])]);
    const base = { cause, causeText: CAUSE_TEXT[cause], depth: depth + 1 };
    const goal = goalTitle || instruction || '방금 요청';

    const clarify = () => (prevKind === 'clarify' ? null : {
      ...base, kind: 'clarify', modality: 'stepwise',
      title: '한 가지씩 골라서 바꿔 볼까요?',
      why: '한 번에 여러 가지를 바꾸는 대신, 원하는 것 하나만 골라 주세요.',
      options: CLARIFY_OPTIONS.filter(o => !o.featureId || !unavailable.has(o.featureId))
    });
    const feature = (featureId, title, why) => ({ ...base, kind: 'feature', modality: featureId === 'plain_summary' ? 'text' : 'audio', featureId, title, why });
    const regenerate = (modality, title, why, text) => ({ ...base, kind: 'instruction', modality, title, why, instruction: text, cssOnly: true });

    let alt = null;
    switch (cause) {
      case 'too_much':
        alt = regenerate('visual-lite', '훨씬 약하게 다시 제안할까요?', '페이지 분위기는 그대로 두고 가장 도움이 되는 한두 가지만 바꿉니다.',
          `방금 제안("${goal}")은 변화가 너무 컸어. 같은 목적을 가장 효과가 큰 한두 가지 변경만으로, 페이지의 원래 색과 배치를 유지하면서 아주 약하게 다시 제안해줘.`);
        break;
      case 'unsafe':
      case 'broke_interaction':
        alt = regenerate('visual-safe', '버튼은 건드리지 않고 모양만 바꿀까요?', '요소 추가나 동작 변경 없이, 버튼·링크·입력창은 그대로 두고 글자와 여백만 조정합니다.',
          `같은 목적("${instruction || goal}")을 요소 추가나 동작 스크립트 없이, 버튼·링크·입력창·양식은 전혀 건드리지 않고 본문 글자와 여백·색만 CSS 로 조정해서 다시 제안해줘.`);
        break;
      case 'uncomfortable': {
        const len = pageSignals.textLength || 0;
        if (len > 1200 && !unavailable.has('tts_reader')) {
          alt = feature('tts_reader', '화면을 바꾸는 대신 소리로 읽어드릴까요?', '화면은 원래대로 두고, 본문을 문단별로 읽어드립니다.');
        } else if (len > 600 && !unavailable.has('plain_summary')) {
          alt = feature('plain_summary', '화면을 바꾸는 대신 짧게 요약해 드릴까요?', '화면은 원래대로 두고, 핵심만 쉬운 말로 정리한 카드를 보여드립니다.');
        } else if (pageSignals.hasVideo && !unavailable.has('live_captions')) {
          alt = feature('live_captions', '영상 자막을 크게 보여드릴까요?', '화면은 원래대로 두고, 자막만 크고 또렷하게 표시합니다.');
        } else {
          alt = regenerate('visual-lite', '더 눈이 편한 방식으로 다시 제안할까요?', '강한 색이나 큰 변화 없이, 은은한 조정만 제안합니다.',
            `방금 제안("${goal}")은 보기 불편했어. 강한 색·큰 크기 변화 없이 눈이 편한 은은한 조정만으로 다시 제안해줘.`);
        }
        break;
      }
      default:
        alt = clarify();
    }

    // 같은 형태의 대안을 연달아 내놓지 않는다 → 단계형으로 전환, 그것도 이미 했다면 멈춘다
    if (alt && prevKind && alt.kind === prevKind && alt.kind !== 'clarify') alt = clarify();
    return alt;
  }

  const api = { proposeAlternative, inferCause, MAX_DEPTH, CAUSE_TEXT };
  root.EqualiAlternatives = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
