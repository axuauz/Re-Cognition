/**
 * EqualiUI Candidate Selection  (구조도 ② 맥락에 맞는 인터페이스 후보 생성 → 최적 인터페이스 선택)
 *
 * AI 가 서로 다른 전략의 후보를 여러 개 만들면, 각 후보를
 *   (1) 안전 감사 결과  (2) 실제 페이지에 입혀 측정한 결과  (3) 사용자 프로필과의 적합도  (4) 사람 피드백으로 학습한 전략 선호
 * 로 채점해 가장 좋은 하나를 고른다. 나머지 후보는 버리지 않고 "다른 후보 보기"와 ③ 대안 제안에 쓴다.
 * AI 의 자기 평가는 점수에 넣지 않는다 — 측정값과 기록만 쓴다. 순수 함수만 포함 (Node 테스트 가능).
 */
(function (root) {
  'use strict';

  const STRATEGIES = {
    minimal: '가장 필요한 한두 가지만 바꾸는 안',
    balanced: '요청을 고르게 반영한 안',
    structural: '안내·바로가기 같은 도움 부품까지 더한 안'
  };
  // 후보를 고르는 버튼에 쓰는 짧은 이름
  const STRATEGY_LABELS = { minimal: '조금만', balanced: '고르게', structural: '도움 더하기' };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v) => Math.round(v * 10) / 10;

  /* 사람 피드백(승인·유지 = 성공 / 거절·되돌림 = 실패)으로 전략별 선호를 학습한다: Beta(1,1) 사후 평균 */
  function updateStrategyStats(stats, strategy, outcome) {
    if (!STRATEGIES[strategy]) return stats || {};
    const next = { ...(stats || {}) };
    const cur = { success: 0, failure: 0, ...(next[strategy] || {}) };
    if (outcome === 'approved') cur.success += 1;
    else if (outcome === 'kept') cur.success += 1.5;          // 써 보고도 좋다고 한 것은 더 강한 신호
    else if (outcome === 'rejected') cur.failure += 1;
    else if (outcome === 'reverted') cur.failure += 1.5;      // 승인했다가 되돌린 것은 더 강한 신호
    next[strategy] = cur;
    return next;
  }

  function strategyPreference(stats, strategy) {
    const s = (stats || {})[strategy];
    if (!s) return 0.5;
    return (s.success + 1) / (s.success + s.failure + 2);
  }

  /* 후보가 스스로 밝힌 목표(targets)를 실제 측정값으로 검증한다 */
  function verifyTargets(targets, metrics, components) {
    const b = (metrics && metrics.before) || {};
    const a = (metrics && metrics.after) || {};
    const types = new Set((components || []).map(c => c.type));
    const checks = {
      font: () => a.fontPx && b.fontPx && a.fontPx >= b.fontPx * 1.1,
      contrast: () => a.contrast && (a.contrast >= 7 || (a.contrast >= 4.5 && a.contrast > (b.contrast || 0) + 0.5)),
      spacing: () => a.lineHeightRatio && b.lineHeightRatio && a.lineHeightRatio >= b.lineHeightRatio + 0.1,
      declutter: () => b.visibleDistractions > 0 && a.visibleDistractions < b.visibleDistractions,
      targets: () => b.smallTargets > 0 && a.smallTargets < b.smallTargets,
      emphasis: () => (a.underlinedLinks || 0) > (b.underlinedLinks || 0) || (a.outlinedButtons || 0) > (b.outlinedButtons || 0),
      width: () => a.lineLengthCh && b.lineLengthCh && a.lineLengthCh < b.lineLengthCh - 5,
      explain: () => types.has('notice') || types.has('glossary'),
      guide: () => types.has('steps') || types.has('toc'),
      shortcuts: () => types.has('quick_actions'),
      audio: () => types.has('read_aloud')
    };
    const declared = (targets || []).filter(t => checks[t]);
    const achieved = declared.filter(t => { try { return Boolean(checks[t]()); } catch (e) { return false; } });
    return { declared, achieved };
  }

  function scoreCandidate(candidate, ctx) {
    const { audit, report, strategy } = candidate;
    const dims = (ctx && ctx.dims) || { needs: {}, proficiency: {}, cognitiveStyle: {} };
    const need = (k) => ((dims.needs || {})[k] || {}).score || 0;
    const reasons = [];
    const problems = [];
    const comps = (audit.sanitized && audit.sanitized.components) || [];

    if (audit.isEmpty) return { total: 0, parts: { safety: 0, validity: 0, goal: 0, fit: 0 }, reasons: [], problems: ['안전 검사 후 남는 변경이 없습니다'] };

    // (1) 안전 — 30점
    let safety = 30;
    const blocks = audit.findings.filter(f => f.severity === 'block').length;
    const highs = audit.findings.filter(f => f.severity === 'high').length;
    const mediums = audit.findings.filter(f => f.severity === 'medium' && f.code !== 'COMPONENT_ADD').length;
    safety -= Math.min(18, blocks * 6) + highs * 10 + mediums * 3;
    if (blocks) problems.push(`위험해서 제거된 내용 ${blocks}건`);
    if (highs) problems.push(`주의가 필요한 변경 ${highs}건`);
    if (!blocks && !highs) reasons.push('안전 검사에서 걸린 것이 없습니다');
    safety = clamp(safety, 0, 30);

    // (2) 실제 페이지에서의 타당성 — 25점
    let validity = 25;
    const r = report || {};
    if (r.totalSelectors > 0) {
      const dead = (r.deadSelectors || []).length / r.totalSelectors;
      validity -= dead * 12;
      if (dead > 0.4) problems.push('이 페이지에 없는 요소를 많이 가리킵니다');
    }
    validity -= Math.min(15, (r.contrastFailures || []).length * 5);
    if ((r.contrastFailures || []).length) problems.push('글자와 배경의 대비가 떨어지는 곳이 있습니다');
    validity -= (r.hiddenInteractive || []).length * 8;
    if ((r.hiddenInteractive || []).length) problems.push(`쓸 수 없게 되는 버튼·입력창 ${(r.hiddenInteractive || []).length}개`);
    if (r.hiddenMainContent) { validity -= 25; problems.push('본문이 보이지 않게 됩니다'); }
    if (r.horizontalOverflow) { validity -= 8; problems.push('화면이 가로로 넘칩니다'); }
    validity -= (r.missingPartSelectors || []).length * 4;
    const art = r.visualArtifacts;
    if (art) {
      const broken = (art.fragmentedBoxes || 0) + (art.strayBoxes || 0) + (art.clippedBoxes || 0) + Math.ceil((art.overlappingBoxes || 0) / 2);
      if (broken > 0) { validity -= Math.min(18, 6 + broken * 2); problems.push(`테두리가 깨져 보이는 곳 ${broken}군데`); }
      // 요청과 무관하게 화면 요소의 절반 이상이 밀렸다면 레이아웃을 흔든 것이다
      const asksLayout = (candidate.targets || []).some(t => ['font', 'spacing', 'width', 'declutter'].includes(t)) || comps.length > 0;
      if (!asksLayout && art.shifted > 20) { validity -= 6; problems.push('요청과 무관하게 화면 배치가 밀립니다'); }
    }
    validity = clamp(validity, 0, 25);

    // (3) 목표 달성 — 25점 (후보가 밝힌 목표를 측정값으로 검증)
    const metrics = r.metrics || {};
    const { declared, achieved } = verifyTargets(candidate.targets, metrics, comps);
    let goal;
    if (declared.length === 0) goal = 10;
    else {
      goal = 25 * (achieved.length / declared.length);
      if (achieved.length) reasons.push(`목표 ${declared.length}개 중 ${achieved.length}개가 실제 측정으로 확인됐습니다`);
      if (achieved.length < declared.length) problems.push('밝힌 목표 중 측정으로 확인되지 않은 것이 있습니다');
    }
    if (report && metrics.changedAny === false && comps.length === 0) { goal = 0; problems.push('이 페이지에서 실제로 바뀌는 것이 없습니다'); }

    // (4) 사용자 프로필 적합도 — 20점
    let fit = 8;
    const a = metrics.after || {};
    if (need('lowVision') >= 0.5) {
      if (a.fontPx >= 18) { fit += 4; reasons.push(`본문 글자가 ${Math.round(a.fontPx)}px로 충분히 큽니다`); } else fit -= 3;
      if (a.contrast >= 7) { fit += 3; reasons.push(`대비 ${a.contrast}:1 로 또렷합니다`); }
    }
    if (need('reading') >= 0.5 && a.lineHeightRatio >= 1.6) { fit += 4; reasons.push('줄 간격이 넉넉합니다'); }
    if (need('motor') >= 0.5 && metrics.before && a.smallTargets < metrics.before.smallTargets) { fit += 4; reasons.push('누르기 어려운 작은 버튼이 줄었습니다'); }
    const helpParts = comps.some(c => ['steps', 'notice', 'glossary', 'toc'].includes(c.type));
    if ((need('cognitive') >= 0.5 || (dims.cognitiveStyle || {}).pace === 'stepwise') && helpParts) { fit += 5; reasons.push('한 단계씩·쉬운 말로 안내하는 방식이 맞습니다'); }
    if ((dims.cognitiveStyle || {}).modality === 'audio' && comps.some(c => c.type === 'read_aloud')) { fit += 4; reasons.push('소리로 듣는 방식을 선호하십니다'); }
    if ((dims.proficiency || {}).value === 'expert' && strategy === 'minimal') { fit += 3; reasons.push('익숙한 분께는 간결한 변경이 맞습니다'); }
    if ((dims.proficiency || {}).value === 'novice' && strategy === 'structural') { fit += 3; }

    // 최근 거절·되돌림의 원인을 반영
    const causes = (ctx && ctx.recentCauses) || [];
    const count = (c) => causes.filter(x => x === c).length;
    if (count('too_much')) { if (strategy === 'minimal') { fit += 5; reasons.push('최근에 "변화가 너무 크다"고 하셔서 약한 안을 우선했습니다'); } else if (strategy === 'structural') fit -= 5; }
    if (count('unsafe') || count('broke_interaction')) { if (comps.length === 0) fit += 4; else fit -= 3; }
    if (count('uncomfortable') && strategy === 'minimal') fit += 2;

    // 사람 피드백으로 학습한 전략 선호
    const pref = strategyPreference(ctx && ctx.strategyStats, strategy);
    fit += (pref - 0.5) * 12;
    if (pref >= 0.65) reasons.push(`'${STRATEGIES[strategy] || strategy}'을 자주 승인하셨습니다`);
    fit = clamp(fit, 0, 20);

    const total = round(safety + validity + goal + fit);
    return { total, parts: { safety: round(safety), validity: round(validity), goal: round(goal), fit: round(fit) }, reasons: reasons.slice(0, 4), problems: problems.slice(0, 4), achieved, declared };
  }

  /** @returns 후보를 점수순으로 정렬한 목록 (index 0 이 선택된 안) */
  function selectBest(candidates, ctx) {
    const scored = (candidates || []).map((c, i) => ({ ...c, index: i, score: scoreCandidate(c, ctx) }));
    scored.sort((x, y) => y.score.total - x.score.total || x.index - y.index);
    return scored;
  }

  const api = { STRATEGIES, STRATEGY_LABELS, scoreCandidate, selectBest, verifyTargets, updateStrategyStats, strategyPreference };
  root.EqualiSelection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
