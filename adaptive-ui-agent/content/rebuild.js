/**
 * EqualiUI Rebuild — 재구성 화면 (효자손의 ATM 화면을 페이지 안 Shadow DOM 으로 옮기고, 소리 중심 조작을 더했다)
 *
 *   추출(EqualiExtractor) → 설계·감사·선택(서비스 워커의 PLAN_LAYOUT → EqualiLayout) → 여기서 그리기 → 조작을 원래 페이지에 전달
 *
 * 안전
 *   - 새 화면의 버튼은 추출 때 기억해 둔 "실제 요소"만 누른다 (AI 가 selector 를 지어낼 수 없다).
 *   - 결제·삭제처럼 되돌리기 어려운 동작은 누르기 전에 원래 이름을 보여 주고 한 번 더 묻는다.
 *   - 비밀번호·결제 입력은 새 화면으로 옮기지 않는다. 그런 페이지에서는 원래 화면으로 안내한다.
 *   - 언제든 Esc / "원래 화면 보기" 로 돌아간다. 원래 페이지는 전혀 고치지 않는다.
 *
 * 소리 중심(audio) 페르소나
 *   - 화면이 열리면 제목 → 요약 → 버튼 번호 → 내용 개수를 읽어 준다.
 *   - 1~9: 버튼 · ↑↓: 내용 하나씩 듣기 · Enter: 열기 · /: 입력 · R: 다시 듣기 · N/P: 다음·이전 페이지 · H: 도움말 · Esc: 원래 화면
 *   - "말로 조작"을 켜면 "1번", "다음", "다시", "검색 날씨" 같은 말로도 조작한다.
 */
(function (root) {
  'use strict';

  function create(deps) {
    const { ui, getTrustedHtml, escapeHtml, showToast } = deps;
    const st = { open: false, busy: false, persona: null, layouts: [], index: 0, refs: new Map(), model: null, focusItem: -1, voice: false, listening: null, el: null, usedAI: false, feedbackTimer: null, feedbackDialog: null, feedbackDepth: 0, trial: null, visualCaption: '', visualSound: '', hoverTarget: null };

    /* ---------------- 음성 ---------------- */
    const canSpeak = 'speechSynthesis' in window;
    function say(text, { interrupt = true } = {}) {
      if (!st.voice || !canSpeak || !text) return;
      if (interrupt) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(deps.utterance(text));
    }
    const hush = () => { if (canSpeak) window.speechSynthesis.cancel(); };

    /* ---------------- 원래 페이지에 조작 전달 ---------------- */
    function elementOf(ref) {
      const el = st.refs.get(ref);
      if (el && el.isConnected) return el;
      const item = st.model && [...st.model.actions, ...st.model.inputs].find(x => x.ref === ref);
      try { return item ? document.querySelector(item.selector) : null; } catch (e) { return null; }
    }

    function setNativeValue(el, value) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function afterAction(label) {
      say(`${label}. 새 화면을 읽는 중입니다.`);
      setStatus(`'${label}' 을(를) 눌렀습니다. 새 화면을 읽는 중입니다...`);
      // 페이지가 통째로 바뀌면 새 content script 가 이어받는다. 같은 문서 안에서만 바뀌는 사이트(SPA)는 여기서 다시 읽는다.
      setTimeout(() => { if (st.open) load(); }, 1600);
    }

    async function press(ref, label, sensitive) {
      const el = elementOf(ref);
      if (!el) { setStatus('그 버튼을 원래 화면에서 찾지 못했습니다. 화면을 새로 읽습니다.'); say('그 버튼을 찾지 못했습니다. 화면을 새로 읽습니다.'); return load(); }
      if (sensitive && !(await confirmSensitive(label, el))) return;
      afterAction(label);
      if (el.tagName === 'A' && el.href && el.target !== '_blank') window.location.assign(el.href);
      else el.click();
    }

    function submitInput(ref, value) {
      const el = elementOf(ref);
      if (!el || !value.trim()) { say('입력한 내용이 없습니다.'); return; }
      el.focus();
      setNativeValue(el, value.trim());
      afterAction(`${value.trim()} 검색`);
      const form = el.closest('form');
      if (form) {
        const submit = form.querySelector('[type="submit"], button:not([type="button"])');
        if (submit) submit.click(); else { try { form.requestSubmit(); } catch (e) { form.submit(); } }
      } else {
        for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }
    }

    function confirmSensitive(label, el) {
      return new Promise(resolve => {
        const original = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40) || label;
        const box = document.createElement('div');
        box.className = 'equali-rb-confirm';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-label', '누르기 전에 확인');
        box.innerHTML = getTrustedHtml(`
          <div class="equali-rb-confirm-card">
            <p class="equali-rb-confirm-title">한 번 더 확인할게요</p>
            <p>원래 페이지의 <strong>'${escapeHtml(original)}'</strong> 버튼을 누릅니다. 되돌리기 어려운 동작일 수 있습니다.</p>
            <div class="equali-rb-row"><button class="equali-rb-btn" data-c="no">누르지 않기</button><button class="equali-rb-btn equali-rb-primary" data-c="yes">누르기</button></div>
          </div>`);
        st.el.appendChild(box);
        say(`한 번 더 확인할게요. 원래 페이지의 ${original} 버튼을 누릅니다. 되돌리기 어려운 동작일 수 있습니다. 누르려면 와이 키, 취소하려면 엔 키를 누르세요.`);
        const done = (ok) => { box.remove(); st.confirm = null; resolve(ok); };
        st.confirm = done;
        box.querySelector('[data-c="no"]').addEventListener('click', () => done(false));
        box.querySelector('[data-c="yes"]').addEventListener('click', () => done(true));
        box.querySelector('[data-c="no"]').focus();
      });
    }

    /* ---------------- 그리기 ---------------- */
    function setStatus(text) {
      const s = st.el && st.el.querySelector('.equali-rb-status');
      if (s) s.textContent = text || '';
    }

    function shell() {
      if (!st.el) {
        const el = document.createElement('div');
        el.className = 'equali-rb';
        el.tabIndex = -1;
        ui.append(el);
        st.el = el;
      }
      const el = st.el;
      const visual = st.persona && st.persona.mode === 'visual';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', visual ? 'Re:Cognition 시각 중심 맥락 화면' : 'Re:Cognition 재구성 화면');
      return el;
    }

    function renderLoading(message) {
      const el = shell();
      el.innerHTML = getTrustedHtml(`
        <div class="equali-rb-loading" role="status">
          <div class="equali-summary-spinner" aria-hidden="true"></div>
          <p>${escapeHtml(message)}</p>
          <button class="equali-rb-btn" data-rb="close">원래 화면 보기</button>
        </div>`);
      el.querySelector('[data-rb="close"]').addEventListener('click', () => close(true));
    }

    function render() {
      dismissFeedback();
      const layout = st.layouts[st.index];
      const el = shell();
      const numbered = st.persona.layout.numbered;
      const simpler = st.layouts.findIndex(l => l.density === 'essential');
      const richer = st.layouts.findIndex(l => l.density === 'detailed');
      const visual = st.persona.mode === 'visual';
      const media = document.querySelector('video, audio');
      st.focusItem = -1;
      const has = (name) => root.EqualiPersona.hasFeature(st.persona, name);
      // 보기 형태: full(기본) · text(글로만) · steps(하나씩 고르며 보기). 구조도 ③의 "다른 형태의 인터페이스".
      const view = visual ? 'full' : (st.view || 'full');
      const step = view === 'steps' ? (st.step || null) : null;
      const arr = root.EqualiLayout.sanitizeArrangement(st.arrangement, layout);
      const show = (section) => !arr.hide.includes(section) && (view !== 'steps' || step === section);
      const stepChoices = [
        layout.input && { id: 'input', label: '찾기 · 입력하기', note: layout.input.label },
        layout.actions.length && { id: 'actions', label: '할 일 고르기', note: `버튼 ${layout.actions.length}개` },
        layout.items.length && { id: 'items', label: '내용 읽기', note: `내용 ${layout.items.length}개` },
        (layout.menus || []).length && { id: 'menus', label: '메뉴 보기', note: `메뉴 ${layout.menus.length}묶음` }
      ].filter(Boolean);
      st.stepChoices = view === 'steps' && !step ? stepChoices : [];

      el.dataset.mode = st.persona.mode;
      el.innerHTML = getTrustedHtml(`
        <header class="equali-rb-head">
          <div class="equali-rb-titles">
            <h1 class="equali-rb-title">${escapeHtml(layout.title)}</h1>
            <p class="equali-rb-sub">${escapeHtml(st.model.hostname)} · ${escapeHtml(st.persona.short)}${st.usedAI ? '' : ' · AI 없이 구성'}</p>
          </div>
          <div class="equali-rb-tools">
            ${visual ? '' : `<button class="equali-rb-tool" data-rb="voice" aria-pressed="${st.voice}">${st.voice ? '음성 안내 끄기' : '음성 안내 켜기'}</button>`}
            ${st.persona.mode === 'audio' && (window.SpeechRecognition || window.webkitSpeechRecognition) ? `<button class="equali-rb-tool" data-rb="listen" aria-pressed="false">말로 조작</button>` : ''}
            ${simpler >= 0 && simpler !== st.index ? '<button class="equali-rb-tool" data-rb="simpler">더 간단하게</button>' : ''}
            ${richer >= 0 && richer !== st.index ? '<button class="equali-rb-tool" data-rb="richer">더 자세히</button>' : ''}
            ${has('scan') ? `<button class="equali-rb-tool" data-rb="scan" aria-pressed="${Boolean(st.scanTimer)}">${st.scanTimer ? '자동 선택 끄기' : '자동 선택 켜기'}</button>` : ''}
            ${visual ? '' : `<button class="equali-rb-tool" data-rb="arrange" aria-pressed="${Boolean(st.arranging)}">배치 바꾸기</button>`}
            <button class="equali-rb-tool equali-rb-exit" data-rb="close">원래 화면 보기 (Esc)</button>
          </div>
        </header>
        <p class="equali-rb-status" role="status" aria-live="polite"></p>
        ${visual ? `<section class="equali-rb-visual-context" aria-label="현재 페이지를 한눈에 보기">
          <h2>현재 페이지를 한눈에 보기</h2>
          <div class="equali-rb-visual-facts">
            <span>주요 조작 <strong>${layout.actions.length}개</strong></span>
            <span>주요 내용 <strong>${layout.items.length}개</strong></span>
            <span>${media ? '영상·소리 콘텐츠 있음' : '영상·소리 콘텐츠 없음'}</span>
          </div>
          <div class="equali-rb-visual-media" aria-live="polite">
            <strong>소리 정보</strong>
            <p class="equali-rb-visual-sound">${escapeHtml(st.visualSound || (media ? '제공되는 자막을 확인합니다.' : '이 페이지에서 확인된 소리 콘텐츠가 없습니다.'))}</p>
            <p class="equali-rb-visual-caption">${escapeHtml(st.visualCaption || (media ? '자막이 없으면 확장 팝업의 ‘소리를 글자로 바꾸기’를 눌러 주세요.' : '영상이나 소리가 나타나면 이곳에 상태를 표시합니다.'))}</p>
          </div>
        </section>` : ''}
        <main class="equali-rb-main" data-view="${view}" data-actions-pos="${view === 'full' ? arr.actionsPosition : 'top'}" ${arr.actionsColumns ? `data-actions-cols="${arr.actionsColumns}"` : ''} style="font-size: ${arr.textScale}em;">
          ${st.arranging ? `
          <form class="equali-rb-arrange" data-rb="arrange-form">
            <label class="equali-rb-label" for="equali-rb-arrange-input">화면을 어떻게 바꿀까요?</label>
            <div class="equali-rb-row">
              <input id="equali-rb-arrange-input" class="equali-rb-input" type="text" placeholder="예: 버튼을 오른쪽으로 옮겨 줘 · 글자 더 크게 · 내용은 숨겨 줘" autocomplete="off" />
              <button type="submit" class="equali-rb-btn equali-rb-primary">바꾸기</button>
            </div>
          </form>` : ''}
          ${view !== 'full' ? `<p class="equali-rb-viewbar">${view === 'text' ? '글로만 보는 중입니다.' : '하나씩 고르며 보는 중입니다.'} <button class="equali-rb-tool" data-rb="view-full">모두 한 화면에 보기</button></p>` : ''}
          ${view === 'steps' && !step ? `
          <section class="equali-rb-steps" aria-label="무엇을 하시겠어요?">
            <h2 class="equali-rb-step-q">무엇을 하시겠어요?</h2>
            ${stepChoices.map((c, i) => `<button class="equali-rb-btn equali-rb-step-choice" data-rb="step" data-step="${c.id}"><span class="equali-rb-num" aria-hidden="true">${i + 1}</span><span>${escapeHtml(c.label)}</span><span class="equali-rb-step-note">${escapeHtml(c.note)}</span></button>`).join('')}
          </section>` : ''}
          ${view === 'steps' && step ? '<button class="equali-rb-btn equali-rb-step-back" data-rb="step" data-step="">← 처음 질문으로</button>' : ''}
          ${st.model.sensitivePage ? '<p class="equali-rb-notice">이 페이지에는 비밀번호나 결제 정보를 넣는 곳이 있습니다. 안전을 위해 그 부분은 새 화면으로 옮기지 않았습니다. 입력은 "원래 화면 보기"에서 직접 해 주세요.</p>' : ''}
          ${(view !== 'steps' || !step) ? personaSections(layout) : ''}
          ${layout.input && show('input') ? `
          <form class="equali-rb-inputrow" data-rb="form">
            <label class="equali-rb-label" for="equali-rb-input">${escapeHtml(layout.input.label)}</label>
            <div class="equali-rb-row">
              <input id="equali-rb-input" class="equali-rb-input" type="text" placeholder="${escapeHtml(layout.input.placeholder)}" autocomplete="off" />
              <button type="submit" class="equali-rb-btn equali-rb-primary">확인</button>
            </div>
          </form>` : ''}
          ${layout.actions.length && show('actions') ? `
          <nav class="equali-rb-actions" aria-label="이 페이지에서 할 수 있는 일">
            ${layout.actions.map((a, i) => `
              <button class="equali-rb-btn equali-rb-action ${a.primary ? 'equali-rb-primary' : ''} ${has('actionHints') ? 'equali-rb-hinted' : ''}" data-ref="${a.ref}" data-i="${i}"
                      aria-label="${numbered ? `${i + 1}번 ` : ''}${escapeHtml(a.label)}${a.label !== a.original ? `, 원래 이름 ${escapeHtml(a.original)}` : ''}">
                ${numbered ? `<span class="equali-rb-num" aria-hidden="true">${i + 1}</span>` : ''}<span>${escapeHtml(a.label)}</span>
                ${has('actionHints') ? `<span class="equali-rb-hint">${escapeHtml(root.EqualiLayout.actionHint((st.model.actions || []).find(x => x.ref === a.ref)))}</span>` : ''}
              </button>`).join('')}
          </nav>` : ''}
          ${!show('items') ? '' : layout.items.length ? `
          <section aria-label="주요 내용">
            <h2 class="equali-rb-h2">주요 내용</h2>
            <ul class="equali-rb-items">
              ${layout.items.map((it, i) => `
                <li><${it.ref ? 'button' : 'div'} class="equali-rb-item" data-item="${i}" ${it.ref ? `data-ref="${it.ref}"` : 'tabindex="0"'}>
                  <span class="equali-rb-item-title">${escapeHtml(it.title)}</span>
                  ${it.description ? `<span class="equali-rb-item-desc">${escapeHtml(it.description)}</span>` : ''}
                </${it.ref ? 'button' : 'div'}></li>`).join('')}
            </ul>
          </section>` : '<p class="equali-rb-summary">이 페이지에서 보여 드릴 내용을 찾지 못했습니다.</p>'}
          ${(layout.menus || []).length && show('menus') ? `
          <section aria-label="펼쳐야 보이는 메뉴" class="equali-rb-menus">
            <h2 class="equali-rb-h2">메뉴 <span class="equali-rb-h2-note">원래 화면에서는 마우스를 올려야 펼쳐집니다</span></h2>
            ${layout.menus.map((m, gi) => `
              <details class="equali-rb-menu" ${gi === 0 && layout.menus.length <= 3 ? 'open' : ''}>
                <summary class="equali-rb-menu-head" data-menu="${gi}">${escapeHtml(m.label)} <span class="equali-rb-menu-count">${m.children.length}개</span></summary>
                <div class="equali-rb-menu-list">
                  ${m.children.map(c => `<button class="equali-rb-btn equali-rb-menu-item" data-ref="${c.ref}" data-label="${escapeHtml(c.label)}" aria-label="${escapeHtml(m.label)} 메뉴의 ${escapeHtml(c.label)}">${escapeHtml(c.label)}</button>`).join('')}
                </div>
              </details>`).join('')}
          </section>` : ''}
          ${(layout.pagination.prevRef || layout.pagination.nextRef) && show('items') ? `
          <div class="equali-rb-row equali-rb-pages">
            ${layout.pagination.prevRef ? `<button class="equali-rb-btn" data-ref="${layout.pagination.prevRef}" data-label="이전 페이지">← 이전 페이지</button>` : ''}
            ${layout.pagination.nextRef ? `<button class="equali-rb-btn" data-ref="${layout.pagination.nextRef}" data-label="다음 페이지">다음 페이지 →</button>` : ''}
          </div>` : ''}
          ${layout.notes.length ? `<p class="equali-rb-foot">${layout.notes.map(escapeHtml).join(' ')}</p>` : ''}
        </main>
        <footer class="equali-rb-footer">
          <button class="equali-rb-btn" data-rb="evaluate">이 화면 평가하기</button>
          <button class="equali-rb-btn" data-rb="home">처음으로</button>
          <button class="equali-rb-btn" data-rb="back">뒤로</button>
          <button class="equali-rb-btn" data-rb="reload">새로 읽기</button>
          ${st.persona.mode === 'audio' ? '<button class="equali-rb-btn" data-rb="help">조작 방법 듣기 (H)</button>' : ''}
        </footer>`);

      el.onclick = (e) => {
        const termEl = e.target.closest('[data-term]');
        if (termEl) { st.interactions++; return showTerm(+termEl.dataset.term); }
        const t = e.target.closest('[data-rb], [data-ref]');
        if (!t) {
          // 누를 수 없는 곳을 짧은 시간에 여러 번 누르면 조작이 어려운 것이다 (구조도 ③ 조작 오류)
          if (!e.target.closest('button, input, summary, details, [data-item], .equali-rb-feedback')) {
            const now = Date.now();
            st.missClicks = (st.missClicks || []).filter(ts => now - ts < 4000).concat(now);
            if (st.missClicks.length >= 3) { st.missClicks = []; implicitDissatisfaction('operation_error'); }
          }
          return;
        }
        st.interactions++;
        if (t.dataset.rb) return tool(t.dataset.rb, t);
        const label = t.dataset.label || (t.querySelector('.equali-rb-item-title, span:last-child') || t).textContent.trim();
        const action = layout.actions.find(a => a.ref === t.dataset.ref);
        const item = t.dataset.item !== undefined ? layout.items[+t.dataset.item] : null;
        press(t.dataset.ref, label, Boolean((action && action.sensitive) || (item && item.sensitive)));
      };
      el.onpointerover = (e) => {
        if (!st.voice) return;
        const target = e.target.closest('button, input, summary, [data-item]');
        if (!target || target === st.hoverTarget) return;
        st.hoverTarget = target;
        let spoken = '';
        if (target.dataset.menu !== undefined) {
          const menu = layout.menus[+target.dataset.menu];
          return say(`${menu.label} 메뉴. ${menu.children.map(c => c.label).join(', ')}.`.slice(0, 260));
        }
        if (target.dataset.ref) {
          const action = layout.actions.find(a => a.ref === target.dataset.ref);
          const item = target.dataset.item !== undefined ? layout.items[+target.dataset.item] : null;
          spoken = action ? `${action.label} 버튼. 누르면 이 기능을 엽니다.` : item ? `${item.title}. ${item.description || ''}` : target.textContent.trim();
        } else if (target.dataset.item !== undefined) {
          const item = layout.items[+target.dataset.item];
          spoken = item ? `${item.title}. ${item.description || ''}` : '';
        } else if (target.tagName === 'INPUT') spoken = `${layout.input?.label || '입력'} 입력창`;
        else spoken = (target.getAttribute('aria-label') || target.textContent || '').trim().replace(/\s+/g, ' ');
        if (spoken) say(spoken.slice(0, 180));
      };
      el.onpointerout = (e) => {
        if (!st.hoverTarget || !st.hoverTarget.contains(e.target) || (e.relatedTarget && st.hoverTarget.contains(e.relatedTarget))) return;
        st.hoverTarget = null;
      };
      // 구역 순서: 말로 요청한 순서대로 (이전·다음 페이지는 내용 바로 뒤에 붙는다)
      const orderOf = (section) => arr.order.indexOf(section) + 1;
      const place = (selector, n) => el.querySelectorAll(selector).forEach(node => { node.style.order = String(n); });
      place('.equali-rb-inputrow', orderOf('input'));
      place('.equali-rb-actions', orderOf('actions'));
      place('.equali-rb-main > section[aria-label="주요 내용"], .equali-rb-pages', orderOf('items'));
      place('.equali-rb-menus', orderOf('menus'));
      place('.equali-rb-foot', 9);
      const arrangeForm = el.querySelector('[data-rb="arrange-form"]');
      if (arrangeForm) arrangeForm.addEventListener('submit', (e) => { e.preventDefault(); const input = el.querySelector('#equali-rb-arrange-input'); adjust(input.value); });
      const form = el.querySelector('[data-rb="form"]');
      if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submitInput(layout.input.ref, el.querySelector('#equali-rb-input').value); });

      if (!visual) el.focus({ preventScroll: true });
      say(root.EqualiLayout.spokenIntro(layout));
    }

    function tool(name, btn) {
      if (name === 'close') return close(true);
      if (name === 'scan') return toggleScan();
      if (name === 'focus-prev' || name === 'focus-next') { const n = (st.model.bodyText || []).length; st.focusPara = Math.max(0, Math.min(n - 1, (st.focusPara || 0) + (name === 'focus-next' ? 1 : -1))); render(); const p = st.el.querySelector('.equali-rb-focus-text'); if (p) say(p.textContent); return; }
      if (name === 'read-para') return readParagraph(+btn.dataset.para);
      if (name === 'listen-body') return listenBody();
      if (name === 'heading') { const h = (st.model.headings || [])[+btn.dataset.i]; if (h) say(h.text); return; }
      if (name === 'arrange') { st.arranging = !st.arranging; render(); const input = st.el.querySelector('#equali-rb-arrange-input'); if (input) { input.focus(); say('화면을 어떻게 바꿀지 적거나, 말로 조작을 켜고 말씀해 주세요. 예를 들어 버튼을 오른쪽으로 옮겨 줘.'); } return; }
      if (name === 'view-full') { st.view = 'full'; st.step = null; chrome.storage.local.get('rebuildViewByPersona').then(data => { const next = { ...(data.rebuildViewByPersona || {}) }; delete next[st.persona.id]; chrome.storage.local.set({ rebuildViewByPersona: next }); }); render(); return setStatus('모두 한 화면에 보여 드립니다.'); }
      if (name === 'step') { st.step = btn.dataset.step || null; render(); const h = st.el.querySelector('.equali-rb-step-q, .equali-rb-step-back'); if (h) h.focus && h.focus(); return; }
      if (name === 'reload') return load();
      if (name === 'evaluate') return showEvaluation();
      if (name === 'home') { afterAction('처음으로'); return window.location.assign(`${location.protocol}//${location.host}/`); }
      if (name === 'back') { afterAction('뒤로'); return history.back(); }
      if (name === 'help') return say(HELP);
      if (name === 'simpler' || name === 'richer') {
        st.index = st.layouts.findIndex(l => l.density === (name === 'simpler' ? 'essential' : 'detailed'));
        sendFeedback('selected');
        return render();
      }
      if (name === 'voice') {
        st.voice = !st.voice;
        chrome.storage.local.get('rebuildVoiceByPersona').then(data => chrome.storage.local.set({ rebuildVoiceByPersona: { ...(data.rebuildVoiceByPersona || {}), [st.persona.id]: st.voice } }));
        if (!st.voice) hush();
        btn.setAttribute('aria-pressed', String(st.voice));
        btn.textContent = st.voice ? '음성 안내 끄기' : '음성 안내 켜기';
        if (st.voice) say(root.EqualiLayout.spokenIntro(st.layouts[st.index]));
        return;
      }
      if (name === 'listen') return toggleListening(btn);
    }

    function dismissFeedback() {
      if (st.feedbackDialog) st.feedbackDialog.remove();
      st.feedbackDialog = null;
    }

    function feedbackDialog(title, detail, choices, onChoice) {
      dismissFeedback();
      if (!st.open || !st.el) return;
      const box = document.createElement('div');
      box.className = 'equali-rb-confirm equali-rb-feedback';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', title);
      box.innerHTML = getTrustedHtml(`
        <div class="equali-rb-confirm-card">
          <p class="equali-rb-confirm-title">${escapeHtml(title)}</p>
          <p>${escapeHtml(detail)}</p>
          <div class="equali-rb-feedback-actions">${choices.map(c => `<button class="equali-rb-btn" data-feedback="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`).join('')}</div>
        </div>`);
      box.addEventListener('click', e => {
        const btn = e.target.closest('[data-feedback]');
        if (btn) onChoice(btn.dataset.feedback);
      });
      box.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        const buttons = Array.from(box.querySelectorAll('button'));
        const first = buttons[0], last = buttons[buttons.length - 1];
        const active = ui.root ? ui.root.activeElement : document.activeElement;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      });
      st.el.appendChild(box);
      st.feedbackDialog = box;
      box.querySelector('button').focus();
      say(`${title}. ${detail}`);
    }

    function sendFeedback(outcome, reason = '', signal = 'explicit') {
      const layout = st.layouts[st.index];
      return new Promise(resolve => chrome.runtime.sendMessage({
        type: 'REBUILD_FEEDBACK', outcome, reason, signal, density: layout.density,
        personaId: st.persona.id, domain: st.model.hostname,
        voice: st.voice || !canSpeak, available: st.layouts.map(l => l.density),
        views: st.persona.mode === 'visual' ? [] : ['steps', 'text'], view: st.view || 'full', tried: st.triedViews || []
      }, resolve));
    }

    /* ---------------- 모드(페르소나)별 고유 기능 ----------------
       같은 재구성 화면이라도 누구를 위한 것이냐에 따라 하는 일이 다르다 (shared/persona.js 의 features). */
    function personaSections(layout) {
      const has = (name) => root.EqualiPersona.hasFeature(st.persona, name);
      const body = st.model.bodyText || [];
      const out = [];
      const en = st.enrichment;

      // 쉬운 요약 + 밑줄 + 작은 사전 (어린이 · 어르신 · 난독)
      if (root.EqualiPersona.needsEnrichment(st.persona) && body.join(' ').length >= 200) {
        if (!en) out.push('<section class="equali-rb-easy" aria-label="쉽게 읽기"><h2 class="equali-rb-h2">쉽게 읽기</h2><p class="equali-rb-easy-loading" role="status">이 글을 쉽게 풀고 있어요...</p></section>');
        else if (en.summary.length) {
          const marks = has('highlights') ? en.highlights : [];
          const terms = has('glossary') ? en.glossary : [];
          const para = (p) => root.EqualiLayout.markSummary(p, marks, terms).map(piece => {
            const text = escapeHtml(piece.text);
            if (piece.kind === 'term') { const i = terms.findIndex(g => g.term === piece.text); const btn = `<button class="equali-rb-term" data-term="${i}" aria-label="${text}, 낱말 뜻 보기">${text}</button>`; return piece.within ? `<u class="equali-rb-underline">${btn}</u>` : btn; }
            return piece.kind === 'highlight' ? `<u class="equali-rb-underline">${text}</u>` : text;
          }).join('');
          out.push(`<section class="equali-rb-easy" aria-label="쉽게 읽기">
            <h2 class="equali-rb-h2">${st.persona.layout.wording === 'child' ? '쉽게 알려 줄게요' : '쉽게 읽기'} <span class="equali-rb-h2-note">${en.source === 'ai' ? 'AI 가 원문을 줄였어요. 정확한 내용은 원래 화면에서 확인해 주세요.' : '원문의 앞부분입니다.'}</span></h2>
            ${en.summary.map(p => `<p class="equali-rb-easy-text">${para(p)}</p>`).join('')}
            ${(en.points || []).length ? `<div class="equali-rb-points"><p class="equali-rb-dict-title">핵심 정리</p><ul>${en.points.map(pt => `<li>${pt.section ? `<strong>${escapeHtml(pt.section)}</strong> ` : ''}${para(pt.text)}</li>`).join('')}</ul></div>` : ''}
            ${marks.length ? '<p class="equali-rb-easy-legend"><u class="equali-rb-underline">밑줄</u>은 꼭 기억할 부분이에요.</p>' : ''}
            ${terms.length ? `
            <div class="equali-rb-dict" aria-label="작은 사전">
              <p class="equali-rb-dict-title">작은 사전 <span class="equali-rb-h2-note">점선 낱말을 누르면 뜻이 나와요</span></p>
              <div class="equali-rb-dict-tabs" role="tablist">${terms.map((g, i) => `<button class="equali-rb-dict-tab" role="tab" aria-selected="${i === (st.term || 0)}" data-term="${i}">${escapeHtml(g.term)}</button>`).join('')}</div>
              <p class="equali-rb-dict-meaning" role="tabpanel" aria-live="polite"><strong>${escapeHtml(terms[st.term || 0].term)}</strong> — ${escapeHtml(terms[st.term || 0].meaning)}</p>
            </div>` : ''}
          </section>`);
        }
      } else if (layout.summary) out.push(`<p class="equali-rb-summary">${escapeHtml(layout.summary)}</p>`);

      // 한 문단씩 아주 크게 (저시력)
      if (has('focusReader') && body.length) {
        const i = Math.max(0, Math.min(body.length - 1, st.focusPara || 0));
        out.push(`<section class="equali-rb-focus" aria-label="한 문단씩 크게 보기">
          <h2 class="equali-rb-h2">한 문단씩 크게 보기 <span class="equali-rb-h2-note">${i + 1} / ${body.length}</span></h2>
          <p class="equali-rb-focus-text">${escapeHtml(body[i])}</p>
          <div class="equali-rb-row"><button class="equali-rb-btn" data-rb="focus-prev" ${i === 0 ? 'disabled' : ''}>← 앞 문단</button><button class="equali-rb-btn equali-rb-primary" data-rb="focus-next" ${i === body.length - 1 ? 'disabled' : ''}>다음 문단 →</button></div>
        </section>`);
      }

      // 한 문장씩 줄을 나눠 보기 + 읽는 문장 따라 표시 (난독)
      if (has('chunkedReader') && body.length) {
        out.push(`<section class="equali-rb-chunks" aria-label="한 문장씩 읽기">
          <h2 class="equali-rb-h2">한 문장씩 읽기</h2>
          ${body.slice(0, 8).map((p, pi) => `<div class="equali-rb-chunk" data-para-box="${pi}">
            ${splitSentences(p).map((sen, si) => `<p class="equali-rb-sentence" data-sentence="${pi}-${si}">${escapeHtml(sen)}</p>`).join('')}
            <button class="equali-rb-tool" data-rb="read-para" data-para="${pi}">이 문단 읽어 주기</button>
          </div>`).join('')}
        </section>`);
      }

      // 목차를 듣고 고르기 + 본문 이어 듣기 (시각장애)
      if ((has('outline') || has('listenBody')) && (body.length || (st.model.headings || []).length)) {
        const heads = (st.model.headings || []).slice(0, 10);
        out.push(`<section class="equali-rb-outline" aria-label="문서 듣기">
          <h2 class="equali-rb-h2">문서 듣기</h2>
          ${has('listenBody') && body.length ? `<button class="equali-rb-btn equali-rb-primary" data-rb="listen-body">${st.listeningBody ? '본문 듣기 멈추기 (B)' : `본문 ${body.length}문단 이어 듣기 (B)`}</button>` : ''}
          ${has('outline') && heads.length ? `<ol class="equali-rb-heads" aria-label="목차">${heads.map((h, i) => `<li><button class="equali-rb-tool" data-rb="heading" data-i="${i}" style="margin-left: ${(h.level - 1) * 1.2}em">${escapeHtml(h.text)}</button></li>`).join('')}</ol>` : ''}
        </section>`);
      }
      return out.join('');
    }

    const splitSentences = (text) => String(text || '').split(/(?<=[.!?。])\s+|(?<=다\.)\s*/).map(x => x.trim()).filter(Boolean);

    function showTerm(i) {
      const terms = (st.enrichment && st.enrichment.glossary) || [];
      if (!terms[i]) return;
      st.term = i;
      render();
      const panel = st.el.querySelector('.equali-rb-dict');
      if (panel) panel.scrollIntoView({ block: 'nearest' });
      say(`${terms[i].term}. ${terms[i].meaning}`);
    }

    // 말하기를 문장 단위로 이어 붙이고, 지금 읽는 문장을 화면에 표시한다 (음성 안내가 꺼져 있어도 직접 누른 읽기는 들려준다)
    function speakQueue(list, onEach, onDone) {
      if (!canSpeak) { setStatus('이 브라우저는 읽어 주기를 지원하지 않습니다.'); return; }
      window.speechSynthesis.cancel();
      const token = (st.speakToken = (st.speakToken || 0) + 1);
      const next = (i) => {
        if (token !== st.speakToken || !st.open) return;
        if (i >= list.length) { if (onDone) onDone(); return; }
        if (onEach) onEach(i);
        const utt = deps.utterance(list[i]);
        utt.onend = () => next(i + 1);
        utt.onerror = () => next(i + 1);
        window.speechSynthesis.speak(utt);
      };
      next(0);
    }
    function stopSpeakQueue() { st.speakToken = (st.speakToken || 0) + 1; hush(); st.el && st.el.querySelectorAll('.equali-rb-reading').forEach(n => n.classList.remove('equali-rb-reading')); }

    function readParagraph(pi) {
      const body = st.model.bodyText || [];
      if (!body[pi]) return;
      st.interactions++;
      const list = splitSentences(body[pi]);
      speakQueue(list, (si) => {
        st.el.querySelectorAll('.equali-rb-reading').forEach(n => n.classList.remove('equali-rb-reading'));
        const node = st.el.querySelector(`[data-sentence="${pi}-${si}"]`);
        if (node) { node.classList.add('equali-rb-reading'); node.scrollIntoView({ block: 'nearest' }); }
      }, () => st.el && st.el.querySelectorAll('.equali-rb-reading').forEach(n => n.classList.remove('equali-rb-reading')));
    }

    function listenBody() {
      const body = st.model.bodyText || [];
      if (!body.length) return say('읽을 본문이 없는 페이지입니다.');
      st.interactions++;
      if (st.listeningBody) { st.listeningBody = false; stopSpeakQueue(); render(); return setStatus('본문 듣기를 멈췄습니다.'); }
      st.listeningBody = true;
      render();
      speakQueue(body.map((p, i) => `${i + 1}번째 문단. ${p}`), (i) => setStatus(`본문 ${i + 1} / ${body.length} 문단을 읽는 중입니다. 멈추려면 B 키.`), () => { st.listeningBody = false; if (st.open) { render(); setStatus('본문을 끝까지 읽었습니다.'); } });
    }

    // 자동 선택(스캔): 버튼을 차례로 비춰 주고, 스페이스 · 엔터 한 번으로 고른다 (손 떨림 · 한 스위치 사용자)
    function toggleScan() {
      st.interactions++;
      if (st.scanTimer) { clearInterval(st.scanTimer); st.scanTimer = null; render(); return setStatus('자동 선택을 껐습니다.'); }
      st.scanIndex = -1;
      const tick = () => {
        if (!st.open || !st.el || st.feedbackDialog) return;
        const targets = Array.from(st.el.querySelectorAll('.equali-rb-main .equali-rb-action, .equali-rb-main .equali-rb-item[data-ref], .equali-rb-main .equali-rb-menu-item, .equali-rb-main .equali-rb-step-choice'));
        if (!targets.length) return;
        st.scanIndex = (st.scanIndex + 1) % targets.length;
        targets[st.scanIndex].focus({ preventScroll: false });
      };
      st.scanTimer = setInterval(tick, st.scanMs || 1800);
      render();
      tick();
      setStatus('자동 선택을 켰습니다. 버튼이 차례로 비춰집니다. 원하는 버튼에서 스페이스나 엔터를 누르세요.');
      say('자동 선택을 켰습니다. 원하는 버튼에서 스페이스나 엔터를 누르세요.');
    }

    // 쉬운 요약 · 밑줄 · 낱말 풀이를 받아 온다 (화면은 먼저 뜨고, 받는 대로 채운다)
    async function enrich() {
      if (!root.EqualiPersona.needsEnrichment(st.persona) || (st.model.bodyText || []).join(' ').length < 200) return;
      const url = location.href;
      if (st.enrichment && st.enrichmentFor === `${st.persona.id}|${url}`) return;
      st.enrichment = null;
      const res = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'ENRICH_CONTENT', personaId: st.persona.id, model: { title: st.model.title, bodyText: st.model.bodyText, headings: st.model.headings } }, (r) => resolve(chrome.runtime.lastError ? null : r)));
      if (!st.open) return;
      st.enrichment = (res && res.success && res.enrichment) ? res.enrichment : root.EqualiLayout.localEnrichment(st.model, st.persona);
      st.enrichmentFor = `${st.persona.id}|${url}`;
      st.term = 0;
      if (!st.feedbackDialog && !st.arranging) render();
    }

    /* ---------------- 말(또는 글)로 하는 화면 재구성 ----------------
       요청은 재구성 화면의 배치만 바꾼다: 구역 순서, 버튼 위치·순서·열 수, 글자 크기, 숨김. 원래 페이지와 버튼 연결은 그대로다. */
    const arrangementKey = () => `${st.persona.id}:${(st.model && st.model.hostname) || ''}`;
    function applyArrangement(arrangement, { save = true } = {}) {
      st.arrangement = arrangement;
      const order = (arrangement && arrangement.actionOrder) || [];
      for (const l of st.layouts) {
        l.actions.forEach((a, i) => { if (a._orig === undefined) a._orig = i; });
        l.actions.sort((a, b) => {
          const ia = order.indexOf(a.ref), ib = order.indexOf(b.ref);
          return (ia < 0 ? 1000 + a._orig : ia) - (ib < 0 ? 1000 + b._orig : ib);
        });
      }
      if (save) chrome.storage.local.get('rebuildArrangement').then(data => {
        const next = { ...(data.rebuildArrangement || {}) };
        const isDefault = JSON.stringify(arrangement) === JSON.stringify(root.EqualiLayout.defaultArrangement());
        if (isDefault) delete next[arrangementKey()]; else next[arrangementKey()] = arrangement;
        chrome.storage.local.set({ rebuildArrangement: next });
      });
    }

    async function adjust(text) {
      const request = String(text || '').trim();
      if (!request || !st.layouts.length) return false;
      st.interactions++;
      setStatus(`요청: "${request}" — 화면을 바꾸는 중입니다...`);
      // 자주 쓰는 말은 페이지 안에서 바로 알아듣는다 (서비스 워커를 거치지 않아 빠르고, 워커가 예전 버전이어도 동작한다)
      let res = root.EqualiLayout.interpretArrangement(request, st.layouts[st.index], st.arrangement || null);
      if (res) res = { success: true, ...res };
      else {
        res = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'ADJUST_LAYOUT', instruction: request, layout: st.layouts[st.index], arrangement: st.arrangement || null }, (r) => resolve(chrome.runtime.lastError ? null : r)));
        // 확장 폴더의 파일은 바뀌었는데 확장을 새로고침하지 않으면, 페이지 쪽 코드만 새것이고 서비스 워커는 예전 것이다
        if (res && /Unknown message/i.test(res.error || '')) res = { success: false, error: '확장 프로그램이 예전 상태입니다. 크롬의 확장 프로그램 관리 화면에서 Re:Cognition 을 새로고침한 뒤 이 페이지도 새로고침해 주세요.' };
      }
      if (!st.open) return false;
      if (!res || !res.success) { const msg = (res && res.error) || '요청을 처리하지 못했습니다.'; setStatus(msg); say(msg); return false; }
      applyArrangement(res.arrangement);
      st.arranging = false;
      render();
      setStatus(`"${request}" → ${res.say}`);
      say(res.say);
      return true;
    }

    /* ---------------- 구조도 ③: 말하지 않아도 드러나는 불만족 (망설임 · 조작 오류 · 이탈) ---------------- */
    const IMPLICIT = {
      hesitation: { reason: 'hesitation', lead: '어디를 눌러야 할지 고민되시는 것 같아요.' },
      operation_error: { reason: 'hard_to_use', lead: '조작이 잘 되지 않는 것 같아요.' }
    };
    async function implicitDissatisfaction(signal) {
      if (!st.open || st.busy || st.feedbackDialog || st.implicitDone || !st.layouts.length) return;
      st.implicitDone = true; // 한 화면에서 한 번만 먼저 묻는다 (끝없는 되묻기 방지)
      clearTimeout(st.hesitateTimer);
      const res = await sendFeedback('rejected', IMPLICIT[signal].reason, signal);
      if (!st.open || !res || !res.success || !res.alternative) return;
      offerAlternative(res.alternative, IMPLICIT[signal].lead);
    }

    function watchHesitation() {
      clearTimeout(st.hesitateTimer);
      st.hesitateTimer = setTimeout(() => {
        if (!st.open || st.interactions > 0 || st.implicitDone) return;
        // 화면 안내를 듣는 중이면 망설이는 것이 아니다 → 조금 뒤에 다시 본다
        if (document.hidden || st.feedbackDialog || (canSpeak && window.speechSynthesis.speaking)) return watchHesitation();
        implicitDissatisfaction('hesitation');
      }, st.hesitateMs || 30000);
    }

    function offerAlternative(alt, lead = '') {
      feedbackDialog('다른 화면을 제안합니다', `${lead ? lead + ' ' : ''}${alt.title}. ${alt.why}`, [
        { id: 'try', label: alt.kind === 'original' ? '원래 화면 보기' : '제안한 화면 시험하기' },
        { id: 'stay', label: '지금 화면 유지' }
      ], choice => {
        dismissFeedback();
        if (choice === 'stay') return;
        if (alt.kind === 'original') return close(true);
        st.feedbackDepth++;
        st.trial = alt;
        if (alt.kind === 'density') {
          const index = st.layouts.findIndex(l => l.density === alt.density);
          if (index < 0) return;
          st.index = index;
        } else if (alt.kind === 'audio') {
          st.voice = true;
        } else if (alt.kind === 'view') {
          st.view = alt.view;
          st.step = null;
          st.triedViews = [...(st.triedViews || []), alt.view];
        }
        render();
        setStatus('제안한 구성을 시험 중입니다. 편한지 다시 평가해 주세요.');
        scheduleEvaluation();
      });
    }

    function scheduleEvaluation() {
      clearTimeout(st.feedbackTimer);
      st.feedbackTimer = setTimeout(() => {
        if (st.open && !st.busy && !st.feedbackDialog && !document.hidden) showEvaluation();
      }, 40000);
    }

    function showEvaluation() {
      clearTimeout(st.feedbackTimer);
      feedbackDialog('이 화면이 편하신가요?', '사용해 보신 느낌을 알려주시면 다음 화면에 반영합니다.', [
        { id: 'keep', label: '네, 편해요' }, { id: 'issues', label: '불편해요' }, { id: 'later', label: '나중에 평가' }
      ], async choice => {
        if (choice === 'later') { dismissFeedback(); return; }
        if (choice === 'issues') return showReasons();
        const res = await sendFeedback('kept');
        if (st.trial && st.trial.kind === 'view') chrome.storage.local.get('rebuildViewByPersona').then(data => chrome.storage.local.set({ rebuildViewByPersona: { ...(data.rebuildViewByPersona || {}), [st.persona.id]: st.trial.view } }));
        if (st.trial && st.trial.kind === 'audio') chrome.storage.local.get('rebuildVoiceByPersona').then(data => chrome.storage.local.set({ rebuildVoiceByPersona: { ...(data.rebuildVoiceByPersona || {}), [st.persona.id]: true } }));
        st.trial = null;
        st.feedbackDepth = 0;
        dismissFeedback();
        setStatus(res && res.success ? '평가를 저장했습니다. 다음에 이 사이트에서 이 구성을 우선합니다.' : '평가를 저장하지 못했습니다.');
      });
    }

    function showReasons() {
      feedbackDialog('어떤 점이 불편하신가요?', '가장 가까운 이유를 고르면 다른 구성을 제안합니다.', [
        { id: 'too_many', label: '너무 복잡해요' }, { id: 'not_enough', label: '내용이 부족해요' },
        { id: 'hard_to_read', label: '읽기 어려워요' }, { id: 'hard_to_use', label: '조작하기 어려워요' },
        { id: 'other', label: '원하는 형태가 아니에요' }, { id: 'cancel', label: '취소' }
      ], async reason => {
        if (reason === 'cancel') { dismissFeedback(); return; }
        const res = await sendFeedback('rejected', reason);
        if (!res || !res.success) { dismissFeedback(); setStatus('평가를 저장하지 못했습니다.'); return; }
        st.trial = null;
        const alt = st.feedbackDepth >= 2 ? { kind: 'original', title: '원래 화면 보기', why: '다른 구성을 두 번 시도했습니다.' } : res.alternative;
        if (!alt) { dismissFeedback(); return; }
        offerAlternative(alt);
      });
    }

    const HELP = '조작 방법입니다. 숫자 키는 그 번호의 버튼을 누릅니다. 아래 화살표와 위 화살표는 내용을 하나씩 읽습니다. 엔터는 읽고 있는 내용을 엽니다. 슬래시는 입력 칸으로 갑니다. 알 키는 화면 설명을 다시 듣습니다. 엠 키는 펼쳐야 보이는 메뉴를 모두 읽습니다. 엔 키는 다음 페이지, 피 키는 이전 페이지입니다. 에스 키는 읽기를 멈춥니다. 이에스씨 키는 원래 화면으로 돌아갑니다.';

    /* ---------------- 키보드 · 말로 조작 ---------------- */
    function focusItem(delta) {
      const layout = st.layouts[st.index];
      if (!layout.items.length) return say('읽을 내용이 없습니다.');
      st.focusItem = Math.max(0, Math.min(layout.items.length - 1, st.focusItem + delta));
      const node = st.el.querySelector(`[data-item="${st.focusItem}"]`);
      if (node) { node.focus(); node.scrollIntoView({ block: 'center' }); }
      say(root.EqualiLayout.spokenItem(layout.items[st.focusItem], st.focusItem, layout.items.length));
    }

    function command(cmd, arg) {
      const layout = st.layouts[st.index];
      if (!layout) return;
      // 하나씩 보기의 첫 질문에서는 숫자 키가 선택지를 고른다 (화면에 보이는 번호와 같아야 한다)
      if (cmd === 'action' && (st.stepChoices || []).length) { const c = st.stepChoices[arg]; if (c) { st.step = c.id; render(); say(`${c.label}.`); } else say(`${arg + 1}번은 없습니다.`); return; }
      if (cmd === 'action' && st.view === 'steps' && st.step && st.step !== 'actions') { return say('지금은 버튼을 고르는 화면이 아닙니다. 처음 질문으로 돌아가려면 탭 키로 처음 질문으로 버튼을 고르세요.'); }
      if (cmd === 'action') { const a = layout.actions[arg]; if (a) press(a.ref, a.label, a.sensitive); else { say(`${arg + 1}번 버튼은 없습니다.`); st.badCommands = (st.badCommands || 0) + 1; if (st.badCommands >= 2) { st.badCommands = 0; implicitDissatisfaction('operation_error'); } } }
      else if (cmd === 'next-item') focusItem(1);
      else if (cmd === 'prev-item') focusItem(-1);
      else if (cmd === 'open-item') { const it = layout.items[st.focusItem]; if (it && it.ref) press(it.ref, it.title, it.sensitive); }
      else if (cmd === 'menus') {
        say(root.EqualiLayout.spokenMenus(layout));
        const first = st.el.querySelector('.equali-rb-menu');
        if (first) { st.el.querySelectorAll('.equali-rb-menu').forEach(d => { d.open = true; }); first.scrollIntoView({ block: 'start' }); const head = first.querySelector('summary'); if (head) head.focus({ preventScroll: true }); }
      }
      else if (cmd === 'listen-body') { if (root.EqualiPersona.hasFeature(st.persona, 'listenBody')) listenBody(); else say('이 방식에서는 본문 이어 듣기를 쓰지 않습니다.'); }
      else if (cmd === 'repeat') say(root.EqualiLayout.spokenIntro(layout, { brief: true }));
      else if (cmd === 'next-page') layout.pagination.nextRef ? press(layout.pagination.nextRef, '다음 페이지') : say('다음 페이지가 없습니다.');
      else if (cmd === 'prev-page') layout.pagination.prevRef ? press(layout.pagination.prevRef, '이전 페이지') : say('이전 페이지가 없습니다.');
      else if (cmd === 'input') { const i = st.el.querySelector('#equali-rb-input'); if (i) { i.focus(); say(`${layout.input.label} 입력하고 엔터를 누르세요.`); } else say('입력 칸이 없는 페이지입니다.'); }
      else if (cmd === 'search') { if (layout.input) submitInput(layout.input.ref, arg); else say('입력 칸이 없는 페이지입니다.'); }
      else if (cmd === 'help') say(HELP);
      else if (cmd === 'stop') hush();
      else if (cmd === 'close') close(true);
    }

    function onKey(e) {
      if (!st.open || e.ctrlKey || e.metaKey || e.altKey) return;
      if (st.confirm) {
        if (e.key === 'y' || e.key === 'Y' || e.key === 'ㅛ') { e.preventDefault(); st.confirm(true); }
        else if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ' || e.key === 'Escape') { e.preventDefault(); st.confirm(false); }
        return;
      }
      if (st.feedbackDialog) {
        if (e.key === 'Escape') { e.preventDefault(); dismissFeedback(); st.el.focus(); }
        return;
      }
      if (st.persona.mode === 'visual') {
        if (e.key === 'Escape' && ui.isOwn(e.target)) { e.preventDefault(); close(true); }
        return;
      }
      const active = ui.root ? ui.root.activeElement : null;
      const typing = Boolean(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
      if (e.key === 'Escape') { e.preventDefault(); return typing ? st.el.focus() : command('close'); }
      if (typing) return;
      const map = { ArrowDown: 'next-item', ArrowUp: 'prev-item', r: 'repeat', R: 'repeat', 'ㄱ': 'repeat', n: 'next-page', N: 'next-page', 'ㅜ': 'next-page', p: 'prev-page', P: 'prev-page', 'ㅔ': 'prev-page', h: 'help', H: 'help', 'ㅗ': 'help', s: 'stop', S: 'stop', 'ㄴ': 'stop', '/': 'input', m: 'menus', M: 'menus', 'ㅡ': 'menus', b: 'listen-body', B: 'listen-body', 'ㅠ': 'listen-body' };
      if (/^[1-9]$/.test(e.key)) { e.preventDefault(); st.interactions++; return command('action', +e.key - 1); }
      if (e.key === 'Enter') { if (active && active.dataset && active.dataset.item !== undefined && !active.dataset.ref) { e.preventDefault(); } return; } // 버튼은 자체 클릭으로 처리된다
      if (map[e.key]) { e.preventDefault(); st.interactions++; command(map[e.key]); }
    }

    function toggleListening(btn) {
      if (st.listening) { st.listening.stop(); return; }
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new Rec();
      rec.lang = 'ko-KR';
      rec.continuous = true;
      rec.onresult = (ev) => {
        const text = ev.results[ev.results.length - 1][0].transcript.trim();
        setStatus(`들은 말: "${text}"`);
        const num = /(\d)\s*번|([일이삼사오육칠팔구])\s*번/.exec(text);
        if (num) return command('action', num[1] ? +num[1] - 1 : '일이삼사오육칠팔구'.indexOf(num[2]));
        const search = /^(?:검색|찾아\s?줘?)\s+(.+)$/.exec(text) || /^(.+?)\s*(?:검색|찾아\s?줘)$/.exec(text);
        if (search) return command('search', search[1]);
        // 펼침 메뉴: "메뉴" → 전부 읽기, 항목 이름("급식실", "학교소식 공지사항") → 그 항목 열기
        const layoutNow = st.layouts[st.index];
        const spokenKey = text.replace(/\s+/g, '');
        const menuHit = layoutNow && (layoutNow.menus || []).flatMap(m => m.children.map(c => ({ ...c, group: m.label })))
          .filter(c => c.label.replace(/\s+/g, '').length >= 2 && spokenKey.includes(c.label.replace(/\s+/g, '')))
          .sort((x, y) => (spokenKey.includes(y.group.replace(/\s+/g, '')) - spokenKey.includes(x.group.replace(/\s+/g, ''))) || (y.label.length - x.label.length))[0];
        if (menuHit) return press(menuHit.ref, menuHit.label, false);
        if (/메뉴/.test(text)) return command('menus');
        if (/옮겨|옮기|이동해|배치|숨겨|없애|빼 ?줘|크게|작게|키워|줄여|한 ?줄|칸|원래대로|처음대로|보여 ?줘/.test(text) && !/^(검색|찾아)/.test(text)) return adjust(text).then(ok => { if (!ok) say('예를 들어 버튼을 오른쪽으로 옮겨 줘, 글자 더 크게, 내용은 숨겨 줘 라고 말해 보세요.', { interrupt: false }); });
        if (/다음 ?페이지/.test(text)) return command('next-page');
        if (/이전 ?페이지/.test(text)) return command('prev-page');
        if (/다음/.test(text)) return command('next-item');
        if (/이전|앞/.test(text)) return command('prev-item');
        if (/열어|들어가|선택/.test(text)) return command('open-item');
        if (/다시|처음부터/.test(text)) return command('repeat');
        if (/멈춰|그만|조용/.test(text)) return command('stop');
        if (/도움|방법/.test(text)) return command('help');
        if (/원래|닫아|나가/.test(text)) return command('close');
        // 정해진 명령이 아니면 "화면을 이렇게 바꿔 달라"는 요청으로 보고 재구성한다 (예: 버튼을 오른쪽으로 옮겨 줘)
        adjust(text).then(ok => {
          if (ok) { st.badCommands = 0; return; }
          st.badCommands = (st.badCommands || 0) + 1;
          if (st.badCommands >= 2) { st.badCommands = 0; implicitDissatisfaction('operation_error'); }
        });
      };
      rec.onerror = (ev) => { if (ev.error === 'not-allowed') { setStatus('마이크 사용이 허용되지 않았습니다.'); say('마이크 사용이 허용되지 않았습니다.'); } };
      rec.onend = () => { st.listening = null; btn.setAttribute('aria-pressed', 'false'); btn.textContent = '말로 조작'; };
      rec.start();
      st.listening = rec;
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = '듣는 중 · 끄기';
      say('말로 조작을 켰습니다. 일 번, 다음, 다시, 메뉴, 검색 날씨 처럼 말해 보세요. 버튼을 오른쪽으로 옮겨 줘 처럼 화면을 바꿔 달라고 하셔도 됩니다.');
    }

    /* ---------------- 열기 · 닫기 ---------------- */
    async function load() {
      if (st.busy) return;
      st.busy = true;
      try {
        renderLoading('화면을 읽고 있습니다...');
        say('화면을 읽고 있습니다.');
        let plan = null;
        for (let depth = 0; depth <= 1; depth++) {
          const { model, refs } = await root.EqualiExtractor.extract(depth);
          st.model = model;
          st.refs = refs;
          plan = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'PLAN_LAYOUT', model, personaId: st.persona.id, lastAttempt: depth === 1 }, resolve));
          if (!plan || !plan.needMoreData) break;
          renderLoading('내용이 부족해 페이지를 더 읽고 있습니다...');
        }
        if (!st.open) return;
        if (!plan || !plan.success || !plan.layouts.length) {
          renderLoading('이 페이지는 새 화면으로 구성하지 못했습니다.');
          say('이 페이지는 새 화면으로 구성하지 못했습니다. 이에스씨 키로 원래 화면으로 돌아갑니다.');
          return;
        }
        st.layouts = plan.layouts;
        st.usedAI = Boolean(plan.usedAI);
        const preferred = st.layouts.findIndex(l => l.density === plan.preferredDensity);
        st.index = preferred >= 0 ? preferred : 0;
        const savedArr = await chrome.storage.local.get('rebuildArrangement');
        applyArrangement(root.EqualiLayout.sanitizeArrangement((savedArr.rebuildArrangement || {})[arrangementKey()], st.layouts[st.index]), { save: false });
        st.shownAt = Date.now();
        st.interactions = 0;
        st.implicitDone = false;
        st.missClicks = [];
        st.badCommands = 0;
        st.focusPara = 0;
        st.listeningBody = false;
        render();
        scheduleEvaluation();
        watchHesitation();
        enrich();
        if (plan.error) setStatus(`AI 연결에 문제가 있어 AI 없이 구성했습니다. (${plan.error})`);
      } finally {
        st.busy = false;
      }
    }

    async function open(persona, { manual = false } = {}) {
      dismissProposal();
      st.persona = persona;
      if (!st.open) {
        st.open = true;
        st.feedbackDepth = 0;
        st.trial = null;
        st.step = null;
        st.triedViews = [];
        // 예전에 "편해요"라고 한 보기 형태(글로만 · 하나씩)가 있으면 그것부터 보여 준다
        const savedView = await chrome.storage.local.get('rebuildViewByPersona');
        st.view = ((savedView.rebuildViewByPersona || {})[persona.id]) || 'full';
        document.addEventListener('keydown', onKey, true);
      }
      document.documentElement.style.setProperty('overflow', 'hidden'); // 모든 방식이 전체 화면이다 (시각 중심 화면 포함)
      const saved = await chrome.storage.local.get(['rebuildVoice', 'rebuildVoiceByPersona']);
      st.voice = root.EqualiPersona.resolveVoice(persona.id, saved.rebuildVoiceByPersona || {}, saved.rebuildVoice);
      // 이 화면에서 따로 켜거나 끈 적이 없으면 "읽어 주기" 보기 설정을 따른다 (설정은 켜져 있는데 여기서만 조용하던 문제)
      if (persona.mode !== 'visual' && typeof (saved.rebuildVoiceByPersona || {})[persona.id] !== 'boolean' && ui.layer && ui.layer.dataset.speak === 'on') st.voice = true;
      chrome.runtime.sendMessage({ type: 'SET_REBUILD_TAB', on: true });
      if (manual && typeof deps.onOpen === 'function') deps.onOpen();
      return load();
    }

    function close(byUser) {
      if (!st.open) return;
      // 구조도 ③ 이탈: 열자마자 아무것도 하지 않고 닫았다면 이 구성이 맞지 않은 것이다 → 기록하고 프로필에 반영 (닫는 중이라 대안은 다음에 반영)
      const abandoned = byUser && st.layouts.length && !st.interactions && st.shownAt && (Date.now() - st.shownAt) < (st.abandonMs || 12000);
      if (abandoned) sendFeedback('rejected', 'other', 'abandoned');
      st.open = false;
      clearTimeout(st.feedbackTimer);
      clearTimeout(st.hesitateTimer);
      if (st.scanTimer) { clearInterval(st.scanTimer); st.scanTimer = null; }
      st.listeningBody = false;
      st.speakToken = (st.speakToken || 0) + 1;
      dismissFeedback();
      hush();
      if (st.listening) st.listening.stop();
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.removeProperty('overflow');
      if (st.el) { st.el.remove(); st.el = null; }
      st.hoverTarget = null;
      chrome.runtime.sendMessage({ type: 'SET_REBUILD_TAB', on: false });
      if (byUser) {
        showToast(abandoned ? '원래 화면입니다. 금방 닫으셔서, 다음에는 다른 구성을 먼저 보여 드릴게요.' : '원래 화면입니다. Re:Cognition 배지에서 "화면 다시 구성"을 누르면 돌아옵니다.');
      }
    }

    function onCaptionText(value) {
      st.visualCaption = String(value || '').slice(0, 400);
      if (st.open && st.persona.mode === 'visual') {
        const node = st.el && st.el.querySelector('.equali-rb-visual-caption');
        if (node) node.textContent = st.visualCaption;
      }
    }

    function onCaptionEvent(event) {
      if (event.kind === 'sound') st.visualSound = event.active ? '소리가 나는 중입니다.' : '지금은 조용합니다.';
      else if (event.kind === 'state') st.visualSound = '소리를 글자로 바꾸는 중입니다.';
      else if (event.kind === 'error') st.visualSound = `소리 변환 오류: ${String(event.error || '').slice(0, 120)}`;
      if (st.open && st.persona.mode === 'visual') {
        const node = st.el && st.el.querySelector('.equali-rb-visual-sound');
        if (node) node.textContent = st.visualSound;
      }
    }

    /* ---------------- 구조도 ②: 먼저 "제안"하고, 받아들이면 적용한다 ----------------
       페이지를 열 때 자동으로 재구성 화면을 띄우기 전에 한 번 묻는다. "이 사이트는 항상"을 고른 곳은 다시 묻지 않는다.
       원래 페이지를 가리지 않는 작은 카드로 묻고, 소리 중심 사용자에게는 읽어 주고 엔터 · 이에스씨 키로 답하게 한다. */
    let proposal = null;
    function dismissProposal() {
      if (!proposal) return;
      document.removeEventListener('keydown', proposal.onKey, true);
      proposal.el.remove();
      proposal = null;
    }
    async function propose(persona) {
      if (st.open || proposal) return;
      const key = `${persona.id}:${location.hostname}`;
      const saved = await chrome.storage.local.get(['rebuildConsent', 'rebuildVoice', 'rebuildVoiceByPersona']);
      if ((saved.rebuildConsent || {})[key] === 'always') return open(persona);
      const speakIt = persona.mode === 'audio' || root.EqualiPersona.resolveVoice(persona.id, saved.rebuildVoiceByPersona || {}, saved.rebuildVoice);
      const what = persona.mode === 'audio' ? '소리 중심 화면' : persona.mode === 'visual' ? '한눈에 보는 시각 패널' : '쉬운 화면';
      const el = document.createElement('div');
      el.className = 'equali-rb-propose';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', '화면 다시 구성 제안');
      el.innerHTML = getTrustedHtml(`
        <p class="equali-rb-propose-title">이 페이지를 ${escapeHtml(what)}으로 바꿔 드릴까요?</p>
        <p class="equali-rb-propose-desc">${escapeHtml(persona.name)} 방식입니다. 원래 페이지는 그대로 두고 새 화면을 위에 띄우며, 언제든 원래 화면으로 돌아갈 수 있습니다.</p>
        <div class="equali-rb-propose-actions">
          <button class="equali-rb-btn equali-rb-primary" data-choice="once">바꿔 보기</button>
          <button class="equali-rb-btn" data-choice="always">이 사이트는 항상 바꾸기</button>
          <button class="equali-rb-btn" data-choice="no">원래 화면으로 볼게요</button>
        </div>`);
      const choose = async (choice) => {
        dismissProposal();
        hush();
        if (choice === 'no') { chrome.runtime.sendMessage({ type: 'SET_REBUILD_TAB', on: false }); showToast('원래 화면으로 둡니다. Re:Cognition 배지에서 "화면 다시 구성"을 누르면 언제든 바꿀 수 있습니다.'); return; }
        if (choice === 'always') { const data = await chrome.storage.local.get('rebuildConsent'); await chrome.storage.local.set({ rebuildConsent: { ...(data.rebuildConsent || {}), [key]: 'always' } }); }
        open(persona);
      };
      el.addEventListener('click', (e) => { const btn = e.target.closest('[data-choice]'); if (btn) choose(btn.dataset.choice); });
      const onKey = (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
        if (e.key === 'Escape') { e.preventDefault(); choose('no'); }
        else if (e.key === 'Enter' && !typing && speakIt && !ui.isOwn(e.target)) { e.preventDefault(); choose('once'); }
      };
      document.addEventListener('keydown', onKey, true);
      ui.append(el);
      proposal = { el, onKey };
      if (speakIt) {
        st.voice = true;
        el.querySelector('[data-choice="once"]').focus({ preventScroll: true });
        say(`이 페이지를 ${what}으로 바꿔 드릴까요? 엔터 키는 바꿔 보기, 이에스씨 키는 원래 화면입니다.`);
      }
    }

    return { open, close, propose, dismissProposal, isProposing: () => Boolean(proposal), isOpen: () => st.open, currentGoal: () => (st.model && st.model.title) || st.persona?.name || '재구성 화면', onCaptionText, onCaptionEvent };
  }

  root.EqualiRebuild = { create };
})(typeof self !== 'undefined' ? self : this);
