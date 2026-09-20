/**
 * EqualiUI Persona — "누구를 위한 화면인가"를 명시적으로 정하고, 그에 따라 에이전트의 동작 방식 전체를 바꾼다.
 *
 * 페르소나는 세 가지 "맥락 인터페이스 방식(mode)" 중 하나로 이어진다:
 *   - rebuild : 페이지에서 의미(검색창·버튼·목록·본문)를 뽑아 새 화면으로 다시 구성한다 (효자손 방식)
 *   - audio   : rebuild 와 같은 재구성 화면을 "소리 중심"으로 운용한다 (음성 메뉴, 숫자·화살표 키, 말로 조작)
 *   - visual  : 원래 페이지를 볼 수 있게 두고, 주요 맥락·조작·자막 상태를 시각 패널로 구성한다
 *   - restyle : 원래 페이지를 그대로 두고 모양(CSS)과 도움 부품만 더한다 (기존 EqualiUI 방식)
 *
 * 각 페르소나는 자기만의 기능(features)을 가진다 — 같은 재구성 화면이라도 누구를 위한 것이냐에 따라 하는 일이 다르다:
 *   easySummary  : 문서를 그 사람의 말투로 한두 문단으로 요약 (어린이 · 어르신)
 *   highlights   : 요약에서 중요한 부분에 밑줄 (어린이)
 *   glossary     : 모를 만한 낱말을 누르면 뜻이 뜨는 작은 사전 (어린이 · 난독)
 *   actionHints  : 버튼마다 "누르면 어떻게 되는지" 한 줄 설명 (어르신)
 *   outline      : 문서의 목차를 읽고 골라 듣기 (시각장애)
 *   listenBody   : 본문을 문단 단위로 이어 듣기 (시각장애)
 *   focusReader  : 한 문단씩 아주 크게 보기 (저시력)
 *   chunkedReader: 한 문장씩 줄을 나눠 보여 주고, 읽는 문장을 따라 표시 (난독)
 *   scan         : 버튼을 차례로 비춰 주고 한 키로 고르는 자동 선택 (손 떨림)
 *
 * 각 페르소나의 layout 값은 재구성 화면을 짤 때의 제약(버튼 수, 목록 수, 말투, 요약 길이)이며
 * AI 프롬프트와 로컬 설계기, 후보 채점이 모두 같은 값을 쓴다. 순수 데이터 + 순수 함수 (Node 테스트 가능).
 */
(function (root) {
  'use strict';

  const PERSONAS = {
    none: {
      id: 'none', name: '설정 안 함', short: '직접 요청',
      desc: '필요할 때 직접 요청해서 모양만 바꿉니다.',
      mode: 'restyle', autoOpen: false, traits: [],
      view: {},
      layout: { maxActions: 6, maxItems: 7, wording: 'plain', summarySentences: 3, numbered: false },
      features: []
    },
    elderly: {
      id: 'elderly', name: '어르신 · 쉬운 화면', short: '쉬운 화면',
      desc: '복잡한 페이지를 은행 ATM처럼 큰 버튼 몇 개와 핵심 내용만 있는 화면으로 바꿉니다.',
      mode: 'rebuild', autoOpen: true, traits: ['어르신이라 쉬운 말과 큰 글자가 필요함'],
      view: { size: 'large' },
      layout: { maxActions: 4, maxItems: 5, wording: 'very_easy', summarySentences: 3, numbered: true },
      features: ['easySummary', 'actionHints']
    },
    child: {
      id: 'child', name: '어린이', short: '어린이 화면',
      desc: '어려운 말을 쉬운 말로 바꾸고, 고를 것이 적은 단순한 화면으로 바꿉니다.',
      mode: 'rebuild', autoOpen: true, traits: ['초등학생 어린이가 사용함, 쉬운 말이 필요함'],
      view: { size: 'large' },
      layout: { maxActions: 3, maxItems: 4, wording: 'child', summarySentences: 3, numbered: true },
      features: ['easySummary', 'highlights', 'glossary']
    },
    blind: {
      id: 'blind', name: '시각장애 · 소리 중심', short: '소리 중심',
      desc: '화면을 보지 않고도 쓸 수 있게, 페이지를 짧은 음성 메뉴로 바꿔 읽어 드립니다. 숫자 키와 화살표 키, 말로 조작합니다.',
      mode: 'audio', autoOpen: true, traits: ['전맹 시각장애, 음성 안내가 필요함'],
      view: { size: 'xlarge', theme: 'contrast', speak: true },
      layout: { maxActions: 6, maxItems: 6, wording: 'plain', summarySentences: 3, numbered: true },
      features: ['outline', 'listenBody']
    },
    lowVision: {
      id: 'lowVision', name: '저시력', short: '크고 또렷한 화면',
      desc: '아주 큰 글자와 고대비의 단순한 화면으로 다시 구성하고, 필요하면 읽어 드립니다.',
      mode: 'rebuild', autoOpen: true, traits: ['저시력이라 큰 글씨와 고대비가 필요함'],
      view: { size: 'xlarge', theme: 'contrast' },
      layout: { maxActions: 5, maxItems: 5, wording: 'plain', summarySentences: 3, numbered: true },
      features: ['focusReader']
    },
    dyslexia: {
      id: 'dyslexia', name: '난독 · 읽기 어려움', short: '읽기 편한 화면',
      desc: '넓은 줄 간격과 짧은 문단, 요약 위주의 읽기 화면으로 다시 구성합니다.',
      mode: 'rebuild', autoOpen: false, traits: ['난독증이 있어 읽기 보조가 필요함'],
      view: { size: 'large', spacing: true },
      layout: { maxActions: 5, maxItems: 5, wording: 'plain', summarySentences: 3, numbered: false },
      features: ['chunkedReader', 'glossary']
    },
    hearing: {
      id: 'hearing', name: '청각장애 · 난청', short: '소리를 눈으로',
      desc: '페이지의 핵심 정보와 조작을 시각 패널로 구성하고, 제공되는 영상 자막과 소리 상태를 글자로 보여 드립니다.',
      mode: 'visual', autoOpen: true, traits: ['청각장애가 있어 자막이 필요함'],
      view: {},
      layout: { maxActions: 6, maxItems: 7, wording: 'plain', summarySentences: 3, numbered: false },
      features: []
    },
    motor: {
      id: 'motor', name: '손 떨림 · 누르기 어려움', short: '누르기 쉬운 화면',
      desc: '작은 링크 대신 크고 간격이 넓은 버튼으로 다시 구성합니다. 숫자 키로도 고를 수 있습니다.',
      mode: 'rebuild', autoOpen: true, traits: ['손 떨림이 있어 작은 버튼을 누르기 어려움'],
      view: { size: 'large' },
      layout: { maxActions: 5, maxItems: 5, wording: 'plain', summarySentences: 3, numbered: true },
      features: ['scan']
    },
    // 기타: 사용자가 자기 특성을 직접 적는다. 적은 내용은 setCustom() 으로 들어오고, 방식(mode)은 직접 고르거나 적은 글에서 끌어낸다.
    custom: {
      id: 'custom', name: '기타 · 직접 적기', short: '내 특성',
      desc: '위에 없는 특성을 직접 적어 주세요. 적으신 내용에 맞춰 화면 방식과 제안을 정합니다.',
      mode: 'restyle', autoOpen: true, traits: [], custom: true, customText: '', customMode: 'auto',
      view: {},
      layout: { maxActions: 5, maxItems: 6, wording: 'plain', summarySentences: 3, numbered: false },
      features: []
    }
  };

  const CUSTOM_MODES = ['auto', 'rebuild', 'audio', 'visual', 'restyle'];
  /** 적은 글에서 화면 방식을 끌어낸다: 보지 못함 → 소리 중심, 듣지 못함 → 시각 패널, 복잡함·누르기·읽기 어려움 → 새 화면, 그 밖 → 원래 화면에 모양만 */
  function inferMode(text) {
    const t = String(text || '');
    // "잘 안 보여요"(저시력)와 "안 보여요"(전맹)는 다르다: 저시력은 화면을 크게 다시 구성하고, 전혀 보지 못할 때만 소리 중심으로 간다
    const lowVision = /저시력|잘 ?안 ?보|흐릿|침침|한쪽 ?눈|약시|low.?vision/i.test(t);
    if (!lowVision && /전맹|시각 ?장애|안 ?보|보이지 ?않|못 ?보|스크린 ?리더|blind/i.test(t)) return 'audio';
    if (/청각|난청|안 ?들|들리지 ?않|못 ?들|자막|deaf/i.test(t)) return 'visual';
    if (/어르신|노인|고령|복잡|어렵|어려|헷갈|떨림|누르기|작은 ?(글|버튼)|저시력|잘 ?안 ?보|집중|산만|adhd|쉬운|쉽게|어린이|아이|난독|읽기/i.test(t)) return 'rebuild';
    return 'restyle';
  }

  /** 저장된 '기타' 내용을 페르소나 정의에 반영한다. 서비스 워커·content script·확장 페이지가 저장값을 읽은 직후 호출한다. */
  function setCustom(data) {
    const text = String((data && data.text) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const chosen = CUSTOM_MODES.includes(data && data.mode) ? data.mode : 'auto';
    const c = PERSONAS.custom;
    c.customText = text;
    c.customMode = chosen;
    // 쉼표·줄바꿈·마침표로 나눠 특성 메모로 쓴다 (프로필 추론·보기 설정·AI 프롬프트가 모두 이 목록을 읽는다)
    c.traits = text ? String((data && data.text) || '').split(/[\n,.;·]+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x.length >= 2).slice(0, 8) : [];
    c.mode = chosen === 'auto' ? inferMode(text) : chosen;
    c.layout = { ...c.layout, wording: /어린이|아이|초등/.test(text) ? 'child' : /어르신|노인|고령|쉬운 ?말|쉽게/.test(text) ? 'very_easy' : 'plain', numbered: c.mode === 'audio' || /떨림|누르기|키보드/.test(text) };
    // 적은 글에서 그 사람에게 맞는 기능을 고른다
    const want = [];
    if (/어린이|아이|초등|쉬운 ?말|쉽게|어르신|노인|고령|복잡|어렵|어려/.test(text)) want.push('easySummary');
    if (/어린이|아이|초등|집중|산만|adhd/i.test(text)) want.push('highlights');
    if (/어린이|아이|초등|난독|낱말|단어|용어|한자|외국인|한국어/.test(text)) want.push('glossary');
    if (/어르신|노인|고령|헷갈|처음/.test(text)) want.push('actionHints');
    if (/난독|읽기|줄을? ?놓|글이 ?흔들/.test(text)) want.push('chunkedReader');
    if (/저시력|잘 ?안 ?보|흐릿|침침|약시|한쪽 ?눈/.test(text)) want.push('focusReader');
    if (/떨림|누르기|마비|한 ?손|스위치/.test(text)) want.push('scan');
    if (c.mode === 'audio') want.push('outline', 'listenBody');
    c.features = Array.from(new Set(want));
    c.desc = text ? `직접 적은 특성: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}` : '위에 없는 특성을 직접 적어 주세요. 적으신 내용에 맞춰 화면 방식과 제안을 정합니다.';
    return c;
  }

  const get = (id) => PERSONAS[id] || PERSONAS.none;
  const list = () => Object.values(PERSONAS);
  const traitsOf = (id) => get(id).traits.slice();
  const hasFeature = (persona, name) => Boolean(persona && Array.isArray(persona.features) && persona.features.includes(name));
  const needsEnrichment = (persona) => ['easySummary', 'highlights', 'glossary'].some(n => hasFeature(persona, n));

  /** 저장된 특성 메모 앞에 페르소나의 특성을 붙인다 (프로필 추론·보기 설정·프롬프트가 모두 이 목록을 읽는다) */
  function withPersonaTraits(personaId, traits) {
    const base = traitsOf(personaId);
    return [...base, ...(traits || []).filter(t => !base.includes(t))];
  }

  /** AI 에 넘길 설계 지침 (재구성 화면용) */
  function layoutBrief(personaId) {
    const p = get(personaId);
    const wording = {
      very_easy: 'Use VERY simple everyday Korean, like explaining to a grandparent. No English, no technical terms. Short sentences.',
      child: 'Use easy Korean a 9-year-old understands. Friendly tone with the polite-casual endings "~해요 / ~예요" (not "~입니다"), short sentences, explain hard words.',
      plain: 'Use plain, clear Korean. Avoid jargon.'
    }[p.layout.wording];
    return {
      persona: p.name,
      mode: p.mode,
      maxActions: p.layout.maxActions,
      maxItems: p.layout.maxItems,
      summarySentences: p.layout.summarySentences,
      wording,
      audio: p.mode === 'audio'
    };
  }

  /** 음성 설정은 페르소나별로 보관한다. 이전의 전역 끄기 값은 소리 중심 페르소나의 기본값을 덮지 않는다. */
  function resolveVoice(personaId, byPersona = {}, legacyVoice) {
    const p = get(personaId);
    if (p.mode === 'visual') return false;
    if (typeof byPersona[p.id] === 'boolean') return byPersona[p.id];
    if (p.mode === 'audio') return true;
    return typeof legacyVoice === 'boolean' ? legacyVoice : Boolean(p.view.speak);
  }

  const api = { PERSONAS, get, list, traitsOf, withPersonaTraits, layoutBrief, resolveVoice, setCustom, inferMode, hasFeature, needsEnrichment };
  root.EqualiPersona = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
