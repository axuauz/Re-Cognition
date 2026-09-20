/**
 * EqualiUI User Profile / Context Model  (구조도 ① 사용자 특징 인식)
 *
 *   데이터 수집(행동 로그 · 입력 패턴 · 선호 · 이용 환경)
 *     → 특징 분석(숙련도 · 목적 · 인지 스타일 · 상황 맥락 · 접근성 필요)
 *     → 하나의 프로필(userProfile)로 통합 → ② 후보 생성과 최적 선택, ③ 대안 제안이 모두 이 모델을 읽는다.
 *
 * 원칙
 *   - 모든 추론에는 근거(evidence)와 신뢰도(confidence)가 붙는다 → 사용자가 사이드패널에서 보고 고칠 수 있다.
 *   - 관측이 적을 때는 단정하지 않는다 (confidence 가 낮으면 '아직 모름').
 *   - 입력한 글자·방문 주소 전체는 저장하지 않는다. 횟수·비율·버튼 이름(짧은 라벨)만 기기 안에 남긴다.
 * 순수 함수만 포함 (Node 테스트 가능).
 */
(function (root) {
  'use strict';

  const EMA = 0.3; // 최근 방문일수록 더 크게 반영
  const MAX_DOMAINS = 40;
  const MAX_TARGETS = 8;

  function emptyProfile() {
    return {
      version: 1,
      updatedAt: 0,
      sessions: 0,
      environment: {},          // 가장 최근에 관측한 이용 환경
      behavior: {},             // 방문마다 EMA 로 갱신되는 비율·속도
      modalityUse: { visual: 0, text: 0, audio: 0, stepwise: 0 }, // 어떤 형태의 도움을 실제로 썼는가
      domains: {},              // domain -> { visits, lastVisit, pageTypes, targets: {label: {count, selector}}, adapted: {...} }
      overrides: {}             // 사용자가 직접 고친 값 (추론보다 항상 우선)
    };
  }

  const ema = (prev, next) => (prev === undefined || prev === null ? next : prev * (1 - EMA) + next * EMA);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const round = (v, d = 2) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

  /**
   * 한 번의 페이지 방문에서 관측한 내용을 프로필에 합친다.
   * obs = { domain, pageType, dwellSec, sensitive, adapted, environment, signals, input, targets:[{label, selector}], usedFeatures:[] }
   */
  function observeSession(profile, obs, now = Date.now()) {
    const p = JSON.parse(JSON.stringify(profile && profile.version ? profile : emptyProfile()));
    if (!obs || (obs.dwellSec || 0) < 3) return p; // 스쳐 지나간 방문은 세지 않는다
    p.sessions++;
    p.updatedAt = now;
    if (obs.environment) p.environment = { ...p.environment, ...obs.environment };

    const s = obs.signals || {};
    const i = obs.input || {};
    const minutes = Math.max(0.25, (obs.dwellSec || 0) / 60);
    const b = p.behavior;
    b.zoomPerVisit = ema(b.zoomPerVisit, Math.min(3, s.zoomEvents || 0));
    b.rereadPerMin = ema(b.rereadPerMin, (s.rereadScrolls || 0) / minutes);
    b.ragePerVisit = ema(b.ragePerVisit, Math.min(3, s.rageClicks || 0));
    const actions = (i.clicks || 0) + (i.keyNav || 0);
    if (actions >= 3) {
      b.keyboardShare = ema(b.keyboardShare, (i.keyNav || 0) / actions);
      b.missClickRate = ema(b.missClickRate, (i.missClicks || 0) / Math.max(1, i.clicks || 0));
    }
    if ((i.typedChars || 0) >= 15) {
      b.typingCpm = ema(b.typingCpm, (i.typedChars / Math.max(1, i.typingSec || 1)) * 60);
      b.backspaceRate = ema(b.backspaceRate, (i.backspaces || 0) / i.typedChars);
    }
    if (i.firstActionSec !== undefined && i.firstActionSec !== null) b.firstActionSec = ema(b.firstActionSec, Math.min(60, i.firstActionSec));
    if (i.shortcutUses !== undefined) b.shortcutPerVisit = ema(b.shortcutPerVisit, Math.min(5, i.shortcutUses));
    if (s.textLength > 1500 && i.scrollPxPerSec !== undefined) b.readScrollSpeed = ema(b.readScrollSpeed, i.scrollPxPerSec);
    if (s.textLength > 1500) b.longReadDwellSec = ema(b.longReadDwellSec, Math.min(900, obs.dwellSec));

    for (const f of obs.usedFeatures || []) {
      if (f === 'tts_reader' || f === 'read_aloud') p.modalityUse.audio++;
      else if (f === 'plain_summary' || f === 'glossary' || f === 'notice') p.modalityUse.text++;
      else if (f === 'steps') p.modalityUse.stepwise++;
      else p.modalityUse.visual++;
    }

    // 도메인별 맥락: 무엇을 하러 오는 곳인가, 어떤 버튼을 자주 쓰는가 (민감 페이지는 남기지 않는다)
    if (obs.domain && !obs.sensitive) {
      const d = p.domains[obs.domain] || { visits: 0, pageTypes: {}, targets: {}, adapted: { visits: 0, struggleVisits: 0 } };
      d.visits++;
      d.lastVisit = now;
      d.pageTypes[obs.pageType || 'general_webpage'] = (d.pageTypes[obs.pageType || 'general_webpage'] || 0) + 1;
      for (const t of (obs.targets || []).slice(0, 12)) {
        const label = String(t.label || '').trim().slice(0, 24);
        if (!label) continue;
        const cur = d.targets[label] || { count: 0, visits: 0, selector: t.selector };
        cur.count += t.count || 1;
        cur.visits++;
        cur.selector = t.selector || cur.selector;
        d.targets[label] = cur;
      }
      const top = Object.entries(d.targets).sort((a, b2) => b2[1].count - a[1].count).slice(0, MAX_TARGETS);
      d.targets = Object.fromEntries(top);

      // 사용 중 피드백: 맞춤 화면이 적용된 상태에서도 계속 어려움을 겪는가
      if (obs.adapted) {
        d.adapted.visits++;
        if (struggleLevel(s) >= 2) d.adapted.struggleVisits++;
        d.adapted.lastGoal = obs.adapted.goalTitle || d.adapted.lastGoal;
      }
      p.domains[obs.domain] = d;

      const names = Object.keys(p.domains);
      if (names.length > MAX_DOMAINS) {
        names.sort((a, b2) => (p.domains[a].lastVisit || 0) - (p.domains[b2].lastVisit || 0));
        for (const n of names.slice(0, names.length - MAX_DOMAINS)) delete p.domains[n];
      }
    }
    return p;
  }

  /**
   * 구조도 ③ → ① "학습 반영": 불만족에서 추론한 원인을 프로필에 쌓는다.
   * 최근 것일수록 크게 남도록 매번 조금씩 줄이고(0.85배) 1을 더한다 → 한 번의 거절로는 추론이 바뀌지 않고, 두 번째부터 바뀐다.
   * cause: 모양만 방식(too_much · unsafe · uncomfortable · mismatch · unclear · broke_interaction) + 재구성 화면(too_many · not_enough · hard_to_read · hard_to_use · other)
   */
  const FEEDBACK_DECAY = 0.85;
  const FEEDBACK_THRESHOLD = 1.5;
  function learnFromDissatisfaction(profile, { cause, signal } = {}, now = Date.now()) {
    const p = JSON.parse(JSON.stringify(profile && profile.version ? profile : emptyProfile()));
    if (!cause) return p;
    const causes = { ...((p.feedback || {}).causes || {}) };
    for (const k of Object.keys(causes)) { causes[k] = round(causes[k] * FEEDBACK_DECAY, 3); if (causes[k] < 0.05) delete causes[k]; }
    causes[cause] = round((causes[cause] || 0) + 1, 3);
    p.feedback = { causes, lastSignal: String(signal || 'explicit').slice(0, 30), count: ((p.feedback || {}).count || 0) + 1, updatedAt: now };
    p.updatedAt = now;
    return p;
  }

  function struggleLevel(s = {}) {
    let v = 0;
    if (s.zoomEvents > 0) v += 2;
    if (s.rereadScrolls >= 3) v += 1.5;
    if (s.rageClicks > 0) v += 2;
    return v;
  }

  /* ------------------------------------------------------------------------
     특징 분석
     ------------------------------------------------------------------------ */
  const hasTrait = (traits, re) => (traits || []).some(t => re.test(String(t)));

  function inferDimensions(profile, traits = []) {
    const p = profile && profile.version ? profile : emptyProfile();
    const b = p.behavior || {};
    const env = p.environment || {};
    const confidence = round(clamp01(p.sessions / 12));
    const out = {};

    // --- 접근성 필요 (0~1): 사용자가 적은 특성 메모가 가장 강한 근거, 행동·환경이 보조 근거
    const need = (name, score, evidence) => { out.needs[name] = { score: round(clamp01(score)), evidence }; };
    out.needs = {};
    {
      const ev = []; let sc = 0;
      if (hasTrait(traits, /저시력|시력|시각|잘 안 ?보|큰 ?글|전맹|low.?vision/i)) { sc += 0.7; ev.push('특성 메모에 시각 관련 내용이 있습니다'); }
      if (b.zoomPerVisit > 0.4) { sc += 0.3; ev.push('여러 페이지에서 화면을 자주 확대하십니다'); }
      if (env.pageZoom > 1.15 || env.minFontSizeHint) { sc += 0.2; ev.push('브라우저를 확대해서 쓰고 계십니다'); }
      if (env.prefersContrast || env.forcedColors) { sc += 0.3; ev.push('운영체제에서 고대비를 켜 두셨습니다'); }
      need('lowVision', sc, ev);
    }
    {
      const ev = []; let sc = 0;
      if (hasTrait(traits, /전맹|스크린 ?리더|음성 ?안내/i)) { sc += 0.8; ev.push('특성 메모에 음성 안내/스크린리더 내용이 있습니다'); }
      if (b.keyboardShare > 0.8 && p.sessions >= 5) { sc += 0.2; ev.push('거의 키보드로만 이동하십니다'); }
      if (p.modalityUse.audio >= 5) { sc += 0.2; ev.push('읽어주기를 자주 쓰십니다'); }
      need('screenReader', sc, ev);
    }
    {
      const ev = []; let sc = 0;
      if (hasTrait(traits, /청각|난청|자막|소리/i)) { sc += 0.8; ev.push('특성 메모에 청각 관련 내용이 있습니다'); }
      need('hearing', sc, ev);
    }
    {
      const ev = []; let sc = 0;
      if (hasTrait(traits, /난독|dyslex|읽기 ?어려/i)) { sc += 0.7; ev.push('특성 메모에 난독 관련 내용이 있습니다'); }
      if (b.rereadPerMin > 0.8) { sc += 0.3; ev.push('읽던 곳으로 자주 되돌아가십니다'); }
      need('reading', sc, ev);
    }
    {
      const ev = []; let sc = 0;
      if (hasTrait(traits, /떨림|손이|마우스 ?어려|motor|지체/i)) { sc += 0.7; ev.push('특성 메모에 조작 관련 내용이 있습니다'); }
      if (b.missClickRate > 0.35) { sc += 0.3; ev.push('버튼을 빗나가 누르는 일이 잦습니다'); }
      if (b.ragePerVisit > 0.5) { sc += 0.2; ev.push('같은 곳을 연달아 누르는 일이 잦습니다'); }
      need('motor', sc, ev);
    }
    {
      const ev = []; let sc = 0;
      if (hasTrait(traits, /어린이|아이|초등|노인|어르신|고령|쉬운 ?말|쉽게|집중|adhd|산만/i)) { sc += 0.7; ev.push('특성 메모에 쉬운 설명·집중 관련 내용이 있습니다'); }
      if (p.modalityUse.text >= 4) { sc += 0.2; ev.push('요약·낱말 풀이를 자주 쓰십니다'); }
      need('cognitive', sc, ev);
    }

    // --- 숙련도
    {
      let score = 0; const ev = [];
      if (b.shortcutPerVisit > 0.5) { score += 1; ev.push('단축키를 쓰십니다'); }
      if (b.keyboardShare > 0.4 && out.needs.screenReader.score < 0.5) { score += 0.5; ev.push('키보드 이동에 익숙하십니다'); }
      if (b.firstActionSec !== undefined && b.firstActionSec < 4) { score += 0.5; ev.push('페이지가 열리면 바로 원하는 곳을 찾으십니다'); }
      if (b.typingCpm > 220) { score += 0.5; ev.push('입력이 빠릅니다'); }
      if (b.missClickRate > 0.35) { score -= 1; ev.push('버튼을 빗나가 누르는 일이 잦습니다'); }
      if (b.firstActionSec > 15) { score -= 0.5; ev.push('첫 동작까지 시간이 오래 걸립니다'); }
      if (b.backspaceRate > 0.25) { score -= 0.5; ev.push('입력을 자주 고치십니다'); }
      if (hasTrait(traits, /어린이|아이|초등|노인|어르신|고령|처음|서툴/i)) { score -= 1; ev.push('특성 메모를 참고했습니다'); }
      if (hasTrait(traits, /개발자|전문|익숙|능숙/i)) { score += 1; ev.push('특성 메모를 참고했습니다'); }
      const value = score >= 1 ? 'expert' : score <= -1 ? 'novice' : 'intermediate';
      out.proficiency = { value, score: round(score), evidence: ev };
    }

    // --- 인지 스타일: 어떤 "형태"의 인터페이스가 맞는가
    {
      const m = p.modalityUse; const ev = [];
      let modality = 'visual';
      if (out.needs.screenReader.score >= 0.6 || (m.audio >= 3 && m.audio >= m.visual)) { modality = 'audio'; ev.push('소리로 듣는 방식을 선호하십니다'); }
      else if (m.text >= 3 && m.text > m.visual) { modality = 'text'; ev.push('글로 정리된 설명을 선호하십니다'); }
      else if (out.needs.hearing.score >= 0.6) { modality = 'visual'; ev.push('시각 정보 위주가 필요합니다'); }

      let detail = 'full';
      if (out.needs.cognitive.score >= 0.6 || (b.readScrollSpeed > 900 && b.longReadDwellSec < 60)) { detail = 'summary'; ev.push('긴 글은 훑어보거나 요약을 선호하십니다'); }
      else if (b.longReadDwellSec > 180) ev.push('긴 글을 끝까지 읽는 편입니다');

      let pace = 'free';
      if (out.proficiency.value === 'novice' || m.stepwise >= 2 || out.needs.cognitive.score >= 0.6) { pace = 'stepwise'; ev.push('한 번에 한 단계씩 안내하는 방식이 맞습니다'); }

      // 불만족에서 배운 것 (구조도의 "학습 반영"): 같은 종류의 원인이 되풀이되면 그에 맞는 형태로 옮긴다
      const fc = (p.feedback || {}).causes || {};
      const learned = (...keys) => keys.reduce((sum, k) => sum + (fc[k] || 0), 0);
      if (learned('too_much', 'too_many') >= FEEDBACK_THRESHOLD) { detail = 'summary'; ev.push('내용이나 변화가 많은 화면을 여러 번 불편해하셔서, 핵심만 보여 드립니다'); }
      else if (learned('not_enough') >= FEEDBACK_THRESHOLD) { detail = 'full'; ev.push('내용이 부족하다고 여러 번 하셔서, 더 자세히 보여 드립니다'); }
      if (learned('unclear', 'hesitation', 'hard_to_use', 'broke_interaction') >= FEEDBACK_THRESHOLD && pace !== 'stepwise') { pace = 'stepwise'; ev.push('고르기 어렵거나 조작이 어려웠던 적이 여러 번 있어, 한 단계씩 안내합니다'); }
      if (learned('hard_to_read') >= FEEDBACK_THRESHOLD && modality === 'visual') { modality = 'audio'; ev.push('읽기 어렵다고 여러 번 하셔서, 소리로 듣는 방식을 먼저 권합니다'); }

      let change = 'moderate'; // 변화의 세기에 대한 선호는 ②의 선택 학습(strategyStats)에서 보정된다
      out.cognitiveStyle = { modality, detail, pace, change, evidence: ev };
    }

    out.confidence = confidence;

    // 사용자가 직접 고친 값이 항상 우선한다
    const o = p.overrides || {};
    if (o.proficiency) out.proficiency = { value: o.proficiency, score: 0, evidence: ['직접 설정하셨습니다'] };
    for (const k of ['modality', 'detail', 'pace']) {
      if (o[k]) { out.cognitiveStyle[k] = o[k]; if (!out.cognitiveStyle.evidence.includes('직접 설정하신 값이 있습니다')) out.cognitiveStyle.evidence.push('직접 설정하신 값이 있습니다'); }
    }
    return out;
  }

  /* ------------------------------------------------------------------------
     상황 맥락: 지금 이 페이지에서 사용자는 무엇을 하려는가
     ------------------------------------------------------------------------ */
  const PURPOSE_BY_TYPE = { article: 'read', video_streaming: 'watch', ecommerce_shopping: 'shop', documentation_tech: 'lookup', social_feed: 'browse' };
  const PURPOSE_TEXT = { read: '글 읽기', watch: '영상 보기', shop: '물건 고르기', lookup: '자료 찾기', browse: '둘러보기', search: '검색하기', task: '정해진 작업 하기', unknown: '아직 모름' };

  function contextFor(profile, page = {}) {
    const p = profile && profile.version ? profile : emptyProfile();
    const d = p.domains[page.domain] || null;
    let purpose = PURPOSE_BY_TYPE[page.pageType] || 'unknown';
    if (/google\.|bing\.|search\.|duckduckgo/.test(String(page.domain))) purpose = 'search';

    // 같은 버튼을 여러 방문에 걸쳐 반복해서 누르면 "정해진 작업"을 하러 오는 곳이다
    const frequent = d ? Object.entries(d.targets)
      .filter(([, t]) => t.count >= 3 && t.visits >= 2)
      .sort((a, b) => b[1].count - a[1].count).slice(0, 5)
      .map(([label, t]) => ({ label, selector: t.selector, count: t.count })) : [];
    if (frequent.length >= 2) purpose = 'task';

    const adapted = d ? d.adapted : null;
    return {
      domain: page.domain || '',
      pageType: page.pageType || 'general_webpage',
      purpose,
      purposeText: PURPOSE_TEXT[purpose],
      visits: d ? d.visits : 0,
      frequentTargets: frequent,
      // 맞춤 화면을 쓰는 중에도 어려움이 이어지는가 (사용 중 피드백)
      persistentStruggle: Boolean(adapted && adapted.visits >= 2 && adapted.struggleVisits / adapted.visits >= 0.5),
      adaptedGoal: adapted ? adapted.lastGoal : null
    };
  }

  /* ------------------------------------------------------------------------
     내보내기: AI 에 넘길 요약 / 사람에게 보여줄 설명
     ------------------------------------------------------------------------ */
  function summarizeForModel(profile, traits, page) {
    const dims = inferDimensions(profile, traits);
    const ctx = contextFor(profile, page);
    const needs = Object.entries(dims.needs).filter(([, v]) => v.score >= 0.5).map(([k, v]) => ({ need: k, strength: v.score }));
    return {
      confidence: dims.confidence,
      accessibilityNeeds: needs,
      proficiency: dims.proficiency.value,
      cognitiveStyle: { modality: dims.cognitiveStyle.modality, detail: dims.cognitiveStyle.detail, pace: dims.cognitiveStyle.pace },
      environment: profile && profile.environment ? profile.environment : {},
      situation: { purpose: ctx.purpose, visitsToThisSite: ctx.visits, frequentlyUsedControls: ctx.frequentTargets.map(t => ({ label: t.label, selector: t.selector })), persistentStruggle: ctx.persistentStruggle }
    };
  }

  const LABELS = {
    proficiency: { novice: '천천히, 자세한 안내가 필요함', intermediate: '보통', expert: '익숙함 · 간결한 화면 선호' },
    modality: { visual: '눈으로 보는 방식', text: '글로 정리된 설명', audio: '소리로 듣는 방식' },
    detail: { full: '전체 내용', summary: '요약 위주' },
    pace: { free: '자유롭게', stepwise: '한 단계씩' },
    needs: { lowVision: '잘 보이게', screenReader: '음성 안내', hearing: '소리를 눈으로', reading: '읽기 보조', motor: '누르기 쉽게', cognitive: '쉬운 설명' }
  };

  function describe(profile, traits) {
    const dims = inferDimensions(profile, traits);
    const rows = [];
    for (const [k, v] of Object.entries(dims.needs)) {
      if (v.score >= 0.5) rows.push({ key: `needs.${k}`, label: `필요: ${LABELS.needs[k]}`, value: v.score >= 0.8 ? '뚜렷함' : '있음', evidence: v.evidence });
    }
    rows.push({ key: 'proficiency', label: '웹 사용 숙련도', value: LABELS.proficiency[dims.proficiency.value], evidence: dims.proficiency.evidence, options: LABELS.proficiency, current: dims.proficiency.value });
    rows.push({ key: 'modality', label: '선호하는 형태', value: LABELS.modality[dims.cognitiveStyle.modality], evidence: dims.cognitiveStyle.evidence, options: LABELS.modality, current: dims.cognitiveStyle.modality });
    rows.push({ key: 'detail', label: '내용의 양', value: LABELS.detail[dims.cognitiveStyle.detail], evidence: [], options: LABELS.detail, current: dims.cognitiveStyle.detail });
    rows.push({ key: 'pace', label: '안내 방식', value: LABELS.pace[dims.cognitiveStyle.pace], evidence: [], options: LABELS.pace, current: dims.cognitiveStyle.pace });
    return { confidence: dims.confidence, sessions: (profile && profile.sessions) || 0, rows };
  }

  const api = { emptyProfile, observeSession, learnFromDissatisfaction, inferDimensions, contextFor, summarizeForModel, describe, struggleLevel, PURPOSE_TEXT };
  root.EqualiProfile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
