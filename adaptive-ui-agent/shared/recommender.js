/**
 * EqualiUI Proactive Recommender
 * 페이지 신호(글자 크기·대비·영상·가독성) + 행동 신호(확대, 되읽기) + 사용자 특성 + 학습된 수락률을
 * 합쳐 "지금 이 페이지에서 제안할 만한 기능"과 그 이유를 계산한다. 순수 함수만 포함 (Node 테스트 가능).
 */
(function (root) {
  'use strict';

  const FEATURE_IDS = ['tts_reader', 'live_captions', 'plain_summary', 'dyslexic_ruler', 'high_contrast', 'large_font', 'rain_ambient'];

  const SHOW_THRESHOLD = 2.5;
  const COOLDOWN_MS = {
    accepted: 0,
    dismissed: 24 * 3600 * 1000,
    ignored: 6 * 3600 * 1000,
    disliked: 7 * 24 * 3600 * 1000
  };

  // 도메인은 약한 사전 확률로만 사용 (실제 페이지 신호가 우선)
  const DOMAIN_PRIORS = [
    [/wiki|namu/, { plain_summary: 1.5, tts_reader: 1 }],
    [/youtube|twitch|vimeo|tv\.naver|chzzk/, { live_captions: 1.5, plain_summary: -2, tts_reader: -2 }],
    [/news|blog|tistory|medium|velog|brunch/, { tts_reader: 1, plain_summary: 1 }],
    [/google\.|bing\.|search\.|duckduckgo/, { plain_summary: -3, tts_reader: -3, live_captions: -3 }],
    [/coupang|amazon|gmarket|11st|shopping/, { large_font: 1, tts_reader: -1.5, plain_summary: -1.5 }]
  ];

  const TRAIT_KEYWORDS = [
    [/저시력|시력|시각|눈이|잘 안 ?보|큰 ?글|low.?vision/i, ['large_font', 'high_contrast', 'tts_reader'], '시각 보조'],
    [/전맹|스크린 ?리더|음성|읽어/i, ['tts_reader'], '음성 안내 선호'],
    [/청각|난청|자막|소리/i, ['live_captions'], '청각 보조'],
    [/난독|dyslex|읽기 ?어려/i, ['dyslexic_ruler', 'large_font'], '난독 보조'],
    [/어린이|아이|초등|노인|어르신|고령|쉬운 ?말|쉽게/i, ['plain_summary', 'large_font'], '쉬운 설명 선호'],
    [/눈부심|다크|어두운|고대비/i, ['high_contrast'], '고대비 선호'],
    [/집중|adhd|산만/i, ['dyslexic_ruler', 'plain_summary'], '집중 보조']
  ];

  function evidenceFor(featId, s, pageType) {
    const ev = [];
    const add = (score, reason) => ev.push({ score, reason });
    const textLen = s.textLength || 0;

    switch (featId) {
      case 'large_font':
        if (s.fontPx && s.fontPx < 14) add(2, `본문 글자가 ${Math.round(s.fontPx)}px로 작습니다`);
        if (s.zoomEvents > 0) add(2.5, '방금 화면을 확대하셨어요');
        break;
      case 'high_contrast':
        if (s.contrastRatio && s.contrastRatio < 4.5) add(2.5, `글자와 배경의 대비가 낮습니다 (${s.contrastRatio.toFixed(1)}:1, 권장 4.5:1 이상)`);
        if (s.zoomEvents > 1) add(0.5, '글자를 읽기 어려워하시는 것 같아요');
        break;
      case 'tts_reader':
        if (textLen > 1500) add(1.5, '읽을 글이 많은 페이지입니다');
        if (pageType === 'article') add(1, '기사/본문 형태의 페이지입니다');
        if (textLen < 400) add(-3, '');
        break;
      case 'plain_summary':
        if (textLen > 2500) add(1.5, '글이 깁니다');
        if (s.avgSentenceLength > 60) add(1.5, '문장이 길고 복잡합니다');
        if (s.rereadScrolls >= 3) add(1.5, '같은 부분을 여러 번 다시 읽으셨어요');
        if (textLen < 600) add(-3, '');
        break;
      case 'live_captions':
        if (!s.hasVideo) add(-6, '');
        else if (s.videoHasCaptions === false) add(3, '자막이 켜져 있지 않은 영상이 있습니다');
        else add(1.5, '영상이 있는 페이지입니다');
        break;
      case 'dyslexic_ruler':
        if (s.rereadScrolls >= 3) add(1.5, '읽던 줄을 자주 놓치시는 것 같아요');
        if (s.lineLengthCh > 110) add(1, '한 줄이 너무 길어 줄을 따라가기 어렵습니다');
        if (textLen < 800) add(-2, '');
        break;
      case 'rain_ambient':
        add(-1.5, '');
        break;
    }
    return ev;
  }

  function acceptancePrior(stat) {
    if (!stat) return 0;
    const acc = stat.accepted || 0;
    const neg = (stat.dismissed || 0) + 0.5 * (stat.ignored || 0);
    const mean = (acc + 1) / (acc + neg + 2); // Beta(1,1) 사후 평균
    return (mean - 0.5) * 4; // -2 ~ +2
  }

  function rankRecommendations(input) {
    const {
      signals = {}, pageType = 'general_webpage', domain = '', traitInsights = [],
      rlhfWeights = {}, negativeRules = [], featureUsageStats = {}, recStats = {},
      cooldowns = {}, activeFeatures = [], snoozeUntil = 0, now = Date.now()
    } = input || {};

    if (snoozeUntil && now < snoozeUntil) return [];

    const excluded = new Set((negativeRules || []).map(r => (typeof r === 'string' ? r : r && r.featureId)));
    const active = new Set(activeFeatures || []);
    const host = String(domain).toLowerCase();
    const results = [];

    for (const featId of FEATURE_IDS) {
      if (excluded.has(featId) || active.has(featId)) continue;
      const weight = rlhfWeights[featId] !== undefined ? rlhfWeights[featId] : 1.0;
      if (weight <= 0.2) continue;
      const cd = cooldowns[`${host}:${featId}`] || cooldowns[`*:${featId}`];
      if (cd && now < cd) continue;

      const reasons = [];
      let score = (weight - 1) * 2;
      score += Math.min((featureUsageStats[featId] || 0) * 0.15, 1.2);

      for (const e of evidenceFor(featId, signals, pageType)) {
        score += e.score;
        if (e.reason && e.score > 0) reasons.push(e.reason);
      }
      for (const [re, priors] of DOMAIN_PRIORS) {
        if (re.test(host) && priors[featId]) score += priors[featId];
      }
      for (const trait of traitInsights || []) {
        for (const [re, feats, label] of TRAIT_KEYWORDS) {
          if (feats.includes(featId) && re.test(String(trait))) {
            score += 2;
            const r = `등록된 사용자 특성(${label})에 맞습니다`;
            if (!reasons.includes(r)) reasons.push(r);
          }
        }
      }
      const learned = acceptancePrior(recStats[featId] && recStats[featId][pageType]);
      score += learned;
      if (learned >= 1) reasons.push('비슷한 페이지에서 자주 사용하셨어요');

      // 근거 없는 제안은 하지 않는다 (설명 가능성)
      if (score >= SHOW_THRESHOLD && reasons.length > 0) {
        results.push({ featureId: featId, score: Math.round(score * 100) / 100, reasons: reasons.slice(0, 3) });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 2);
  }

  function updateRecStats(recStats, featId, pageType, outcome) {
    const next = { ...(recStats || {}) };
    const byCtx = { ...(next[featId] || {}) };
    const stat = { shown: 0, accepted: 0, dismissed: 0, ignored: 0, ...(byCtx[pageType] || {}) };
    if (outcome === 'shown') stat.shown++;
    else if (outcome === 'accepted') stat.accepted++;
    else if (outcome === 'dismissed' || outcome === 'disliked') stat.dismissed++;
    else if (outcome === 'ignored') stat.ignored++;
    byCtx[pageType] = stat;
    next[featId] = byCtx;
    return next;
  }

  function cooldownFor(outcome, now = Date.now()) {
    const ms = COOLDOWN_MS[outcome];
    return ms ? now + ms : 0;
  }

  // 사용자가 어려움을 겪는 신호가 충분할 때만 AI 맞춤 제안(API 호출)을 시도한다
  function struggleScore(s = {}) {
    let v = 0;
    if (s.zoomEvents > 0) v += 2;
    if (s.rereadScrolls >= 3) v += 1.5;
    if (s.fontPx && s.fontPx < 13) v += 1;
    if (s.contrastRatio && s.contrastRatio < 4.5) v += 1;
    if (s.rageClicks > 0) v += 2;
    if (s.distractionCount > 6) v += 1;
    return v;
  }

  const api = { rankRecommendations, updateRecStats, cooldownFor, struggleScore, FEATURE_IDS, SHOW_THRESHOLD };
  root.EqualiRecommender = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
