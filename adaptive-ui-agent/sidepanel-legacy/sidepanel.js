/**
 * EqualiUI Side Panel Controller - Dynamic Code Injection & User Traits Memory Edition
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Navigation & Header Elements
  const spBtnModel = document.getElementById('sp-btn-model');
  const spModelDropdown = document.getElementById('sp-model-dropdown');
  const spTraitsQuickList = document.getElementById('sp-traits-quick-list');
  const spBtnNewChat = document.getElementById('sp-btn-new-chat');
  const spTabButtons = document.querySelectorAll('.sp-tab-btn');
  const spTabPanes = document.querySelectorAll('.sp-tab-pane');

  // 2. Status & Domain
  const ctxDomain = document.getElementById('ctx-domain');
  const spAppliedCount = document.getElementById('sp-applied-count');
  const spHeaderRevert = document.getElementById('sp-header-revert');

  // 3. Tab 1: Chat Feed & Input
  const chatFeed = document.getElementById('chat-feed');
  const customInstructionInput = document.getElementById('custom-instruction-input');
  const btnSendInstruction = document.getElementById('btn-send-instruction');
  const promptChips = document.querySelectorAll('.sp-capsule-chip');

  // 4. Tab 2: Persona Traits & RLHF Elements
  const spTraitsFullList = document.getElementById('sp-traits-full-list');
  const inputNewTrait = document.getElementById('input-new-trait');
  const btnAddTrait = document.getElementById('btn-add-trait');
  const btnResetTraits = document.getElementById('btn-reset-traits');
  const spRlhfWeightsList = document.getElementById('sp-rlhf-weights-list');
  const spNegativeRulesList = document.getElementById('sp-negative-rules-list');
  const btnResetRlhf = document.getElementById('btn-reset-rlhf');

  // 5. Tab 3: Site Registry Elements
  const siteRegistryList = document.getElementById('site-registry-list');

  // 6. Tab 4: Settings Elements
  const inputApiKey = document.getElementById('input-api-key');
  const selectModel = document.getElementById('select-model');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnToggleKeyVisibility = document.getElementById('btn-toggle-key-visibility');

  let activeTab = null;
  let lastRestrictedNoticeTabId = null;
  const defaultPlaceholder = customInstructionInput.placeholder;
  let sidepanelConversationHistory = [];

  /* ==========================================================================
     A. Initialization
     ========================================================================== */
  async function init() {
    const data = await chrome.storage.local.get(['openaiApiKey', 'openaiModel', 'hitlMode', 'proactiveAiSuggestions']);
    document.getElementById('select-hitl-mode').value = data.hitlMode || 'always';
    document.getElementById('chk-proactive-ai').checked = data.proactiveAiSuggestions !== false;
    if (data.openaiApiKey) {
      inputApiKey.value = data.openaiApiKey;
    }
    if (data.openaiModel) {
      selectModel.value = data.openaiModel;
    } else {
      selectModel.value = 'gpt-5.6-luna';
    }

    await refreshActiveTab();
    await refreshTraitsDropdown();
    await renderTraitsTab();
    await renderRegistryTab();
  }

  async function refreshActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    // 새 탭·chrome:// 등 바꿀 수 없는 페이지는 요청을 보내기 전에, 패널을 여는 순간 바로 알려준다
    const restricted = !isInjectableTab(tab);
    customInstructionInput.disabled = restricted;
    customInstructionInput.placeholder = restricted
      ? '이 페이지는 바꿀 수 없어요. 일반 웹페이지를 열어주세요.'
      : defaultPlaceholder;
    promptChips.forEach(chip => (chip.disabled = restricted));
    if (restricted) {
      ctxDomain.textContent = '지원되지 않는 페이지';
      spAppliedCount.textContent = '사용 불가';
      if (lastRestrictedNoticeTabId !== tab?.id) {
        lastRestrictedNoticeTabId = tab?.id;
        const isOwnNewTab = (tab?.url || tab?.pendingUrl || '').startsWith(chrome.runtime.getURL('newtab/'));
        appendAssistantMessage(isOwnNewTab
          ? 'ℹ️ 새 탭 화면은 오른쪽 위 "⚙️ 보기 설정"에서 글자 크기·색·간격을 바로 바꿀 수 있어요. 다른 웹페이지를 바꾸고 싶으면 그 페이지를 연 뒤 요청해주세요.'
          : RESTRICTED_PAGE_NOTICE, null);
      }
      return;
    }
    lastRestrictedNoticeTabId = null;

    if (tab && tab.id) {
      try {
        const urlObj = new URL(tab.url);
        ctxDomain.textContent = urlObj.hostname;
      } catch (e) {
        ctxDomain.textContent = tab.title || '현재 웹페이지';
      }

      try {
        const statusRes = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
        if (statusRes && statusRes.activeCount > 0) {
          spAppliedCount.textContent = `${statusRes.activeCount}개 적용중`;
        } else {
          spAppliedCount.textContent = '준비됨';
        }
      } catch (e) {
        spAppliedCount.textContent = '준비됨';
      }
    }
  }

  function isInjectableTab(tab) {
    if (!tab || !tab.url) return false;
    const u = tab.url.toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('file://');
  }


  // 요청 전에 페이지와 연결되는지 확인하고, 안 되면 content script 를 직접 주입해 복구한다
  // (확장 설치/새로고침 전에 열려 있던 탭은 content script 가 없거나 죽어 있다)
  async function ensureContentScript(tab) {
    if (!tab || !tab.id || !isInjectableTab(tab)) return false;
    const ping = async () => {
      try {
        const r = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
        return Boolean(r);
      } catch (e) {
        return false;
      }
    };
    if (await ping()) return true;
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['shared/safety.js', 'content/ui-css.js', 'content/parts.js', 'content/content.js'] });
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      return false;
    }
    return ping();
  }

  const RESTRICTED_PAGE_NOTICE = 'ℹ️ 지금 보고 계신 페이지(새 탭, chrome:// 설정 화면, Chrome 웹 스토어 등)는 브라우저 보안 정책상 확장 프로그램이 바꿀 수 없는 페이지입니다. 네이버·위키백과·뉴스 같은 일반 웹페이지를 연 뒤 다시 요청해주세요.';

  async function injectDynamicCssToTab(tab, cssText, goalTitle, domElements = [], js = {}) {
    if (!tab || !tab.id) return { success: false, reason: '활성 탭을 찾을 수 없습니다.' };

    if (!isInjectableTab(tab)) {
      return {
        success: false,
        isRestricted: true,
        reason: `현재 페이지(${tab.url?.split('/')[0]}//...)는 브라우저 보안 정책상 확장 프로그램 동작이 제한된 시스템 페이지입니다. 일반 웹페이지(예: 네이버, 구글, 블로그 등)에서 이용해주세요.`
      };
    }

    // 1차: 표준 메시지 전송
    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'INJECT_DYNAMIC_CSS',
        css: cssText,
        goalTitle: goalTitle,
        domElements: domElements,
        js: js
      });
      if (res && res.success) return { success: true };
    } catch (e) {
      console.log('[EqualiUI Sidepanel] sendMessage failed, attempting self-healing injection:', e.message);
    }

    // 2차: chrome.scripting.executeScript로 content.js 자가 치유 주입
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['shared/safety.js', 'content/ui-css.js', 'content/parts.js', 'content/content.js']
      });
      await new Promise(r => setTimeout(r, 120));

      const res2 = await chrome.tabs.sendMessage(tab.id, {
        type: 'INJECT_DYNAMIC_CSS',
        css: cssText,
        goalTitle: goalTitle,
        domElements: domElements,
        js: js
      });
      if (res2 && res2.success) return { success: true };
    } catch (e2) {
      console.log('[EqualiUI Sidepanel] executeScript re-message failed, attempting direct DOM fallback:', e2.message);
    }

    // 3차: 직접 DOM style 태그 주입 폴백
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (injectedCss) => {
          let styleEl = document.getElementById('equali-dynamic-patch');
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'equali-dynamic-patch';
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = injectedCss;
        },
        args: [cssText]
      });
      return { success: true, directDom: true };
    } catch (e3) {
      return { success: false, reason: e3.message };
    }
  }

  async function revertTab(tab) {
    if (!tab || !tab.id || !isInjectableTab(tab)) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'REVERT_ALL' });
    } catch (e) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const el = document.getElementById('equali-dynamic-patch');
            if (el) el.remove();
          }
        });
      } catch (err) {}
    }
  }

  /* ==========================================================================
     B. User Traits Header Inspector
     ========================================================================== */
  async function refreshTraitsDropdown() {
    const { traitInsights = [], userTraits = {} } = await chrome.storage.local.get(['traitInsights', 'userTraits']);
    spTraitsQuickList.innerHTML = '';

    const list = traitInsights.length > 0 ? traitInsights : Object.values(userTraits);
    if (list.length === 0) {
      spTraitsQuickList.innerHTML = '<div style="color:#8E8E8E; font-size:10.5px; padding: 4px 0;">아직 확인된 특화 정보가 없습니다.</div>';
      return;
    }

    list.slice(0, 6).forEach((trait) => {
      const item = document.createElement('div');
      item.className = 'sp-trait-item';
      item.style.padding = '5px 8px';
      item.style.fontSize = '11px';
      item.textContent = `• ${trait}`;
      spTraitsQuickList.appendChild(item);
    });
  }

  spBtnModel.addEventListener('click', async (e) => {
    e.stopPropagation();
    await refreshTraitsDropdown();
    spModelDropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!spModelDropdown.contains(e.target) && e.target !== spBtnModel) {
      spModelDropdown.classList.remove('open');
    }
  });

  /* ==========================================================================
     C. Tab Navigation & Quick Actions
     ========================================================================== */
  const spBtnCanvas = document.getElementById('sp-btn-canvas');
  if (spBtnCanvas) {
    spBtnCanvas.addEventListener('click', () => {
      if (activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_VISUAL_EDITOR' }, (res) => {
          if (chrome.runtime.lastError || !res || res.error) {
            appendAssistantMessage('⚠️ 캔버스 에디터를 열 수 없습니다. 적용을 위해 웹페이지(F5)를 새로고침한 후 다시 시도해주세요.', null);
            return;
          }
          if (res.active) {
            appendAssistantMessage('🎨 피그마 스타일 캔버스 에디터를 활성화했습니다! 웹페이지에서 원하는 요소를 직접 편집해보세요.', null);
          } else {
            appendAssistantMessage('🎨 캔버스 에디터를 종료했습니다.', null);
          }
        });
      }
    });
  }

  spTabButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      spTabButtons.forEach((b) => b.classList.remove('active'));
      spTabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(`tab-${btn.dataset.tab}`);
      if (targetPane) targetPane.classList.add('active');

      if (btn.dataset.tab === 'traits') {
        await renderTraitsTab();
      } else if (btn.dataset.tab === 'registry') {
        await renderRegistryTab();
      }
    });
  });

  /* ==========================================================================
     D. Tab 1: Chat & Dynamic Code Generation
     ========================================================================== */
  customInstructionInput.addEventListener('input', () => {
    const hasText = customInstructionInput.value.trim().length > 0;
    btnSendInstruction.disabled = !hasText;
    if (hasText) {
      btnSendInstruction.classList.add('active');
    } else {
      btnSendInstruction.classList.remove('active');
    }
  });

  customInstructionInput.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!btnSendInstruction.disabled) {
        handleSendInstruction(customInstructionInput.value);
      }
    }
  });

  btnSendInstruction.addEventListener('click', () => {
    if (!btnSendInstruction.disabled) {
      handleSendInstruction(customInstructionInput.value);
    }
  });

  promptChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      handleSendInstruction(chip.dataset.prompt);
    });
  });

  async function handleSendInstruction(text) {
    const query = text.trim();
    if (!query) return;

    appendUserMessage(query);
    customInstructionInput.value = '';
    btnSendInstruction.disabled = true;
    btnSendInstruction.classList.remove('active');

    // Intercept Canvas Editor specific command
    if (query === '캔버스 에디터 켜기' || query === '캔버스 에디터') {
      if (activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_VISUAL_EDITOR' }, (res) => {
          if (chrome.runtime.lastError || !res || res.error) {
            appendAssistantMessage('⚠️ 캔버스 에디터를 열 수 없습니다. 적용을 위해 웹페이지(F5)를 새로고침한 후 다시 시도해주세요.', null);
            return;
          }
          if (res.active) {
            appendAssistantMessage('🎨 피그마 스타일 캔버스 에디터를 활성화했습니다! 웹페이지에서 원하는 요소를 직접 편집해보세요.', null);
          } else {
            appendAssistantMessage('🎨 캔버스 에디터를 종료했습니다.', null);
          }
        });
      }
      return;
    }

    await refreshActiveTab();
    if (!isInjectableTab(activeTab)) {
      appendAssistantMessage(RESTRICTED_PAGE_NOTICE, null);
      return;
    }
    if (!(await ensureContentScript(activeTab))) {
      appendAssistantMessage('⚠️ 이 웹페이지와 연결할 수 없습니다. 페이지를 새로고침(F5)한 뒤 다시 요청해주세요.', null);
      return;
    }

    const thinkingNode = appendThinkingMessage();

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'DIRECT_INSTRUCTION',
        instruction: query,
        conversationHistory: sidepanelConversationHistory || []
      });

      thinkingNode.remove();

      if (!res || !res.success || !res.proposal) {
        if (res?.needsApiKey) {
          appendAssistantMessage(`🔑 ${res.error}\n(설정 탭에서 OpenAI / OpenRouter / Gemini API 키를 입력해주세요.)`, null);
          return;
        }
        throw new Error(res?.error || '요청 처리에 실패했습니다.');
      }

      const proposal = res.proposal;

      // 1. Revert case
      if (proposal.isRevert) {
        if (activeTab) {
          await revertTab(activeTab);
        }
        await refreshActiveTab();
        sidepanelConversationHistory = [];
        appendAssistantMessage('모든 맞춤 코드를 제거하고 웹페이지 원래 상태로 복원했습니다. ↩', null);
        return;
      }

      // 2. Human-in-the-Loop: 제안은 아직 적용되지 않았다. 검토 카드를 보여주고 승인을 기다린다.
      appendReviewMessage(query, proposal, res.audit || { riskLevel: 'medium', findings: [] }, res);
      await refreshTraitsDropdown();
    } catch (err) {
      thinkingNode.remove();
      appendAssistantMessage(`⚠️ 오류가 발생했습니다: ${escapeHTML(err.message)}`, null);
    }
  }


  /* ==========================================================================
     D-1. Human-in-the-Loop Review Card (승인 전에는 페이지가 바뀌지 않는다)
     ========================================================================== */
  const RISK_VIEW = {
    low: { label: '위험 낮음 · 모양만 바뀝니다', color: '#10A37F' },
    medium: { label: '확인 필요', color: '#D97706' },
    high: { label: '주의 · 기능이 달라질 수 있습니다', color: '#DC2626' }
  };
  const SEVERITY_VIEW = { block: '🛡️ 차단됨', high: '⚠️ 주의', medium: 'ℹ️ 확인' };

  function appendReviewMessage(query, proposal, audit, res) {
    const risk = RISK_VIEW[audit.riskLevel] || RISK_VIEW.medium;
    const findings = (audit.findings || []).filter(f => f.severity !== 'info');
    const jsCount = Object.keys(proposal.generatedJs || {}).length;
    const msg = document.createElement('div');
    msg.className = 'chat-message assistant';

    if (res.autoApprovable) {
      // 사용자가 '저위험 자동 적용'을 켠 경우: 페이지에서 이미 적용됨 (실행 취소 제공)
      sidepanelConversationHistory.push({ role: 'user', content: query }, { role: 'assistant', content: `[${proposal.goalTitle}] ${proposal.summary || ''}` });
      sidepanelConversationHistory = sidepanelConversationHistory.slice(-6);
      appendAssistantMessage(`저위험 변경이라 바로 적용했습니다: ${proposal.goalTitle}\n(설정에서 '항상 검토 후 적용'으로 바꿀 수 있습니다.)`, proposal);
      return;
    }

    const findingsHtml = findings.length
      ? `<ul style="list-style:none; padding:0; margin:6px 0;">${findings.map(f => `<li style="font-size:11.5px; padding:5px 7px; margin-bottom:3px; border-radius:6px; background:rgba(148,163,184,0.15);"><strong>${SEVERITY_VIEW[f.severity] || ''}</strong> ${escapeHTML(f.message)}</li>`).join('')}</ul>`
      : '<div style="font-size:11.5px; color:#10A37F; margin:6px 0;">✔ 안전 검사에서 발견된 문제가 없습니다.</div>';

    msg.innerHTML = `
      <div class="assistant-avatar">🔍</div>
      <div class="assistant-content">
        <div style="border:2px solid ${risk.color}; border-radius:10px; padding:10px;">
          <div style="display:flex; justify-content:space-between; gap:6px; flex-wrap:wrap; align-items:center;">
            <strong style="font-size:12px;">적용 전 검토</strong>
            <span style="font-size:10.5px; font-weight:700; color:#fff; background:${risk.color}; border-radius:999px; padding:2px 8px;">${risk.label}</span>
          </div>
          <div style="font-weight:700; margin-top:6px;">${escapeHTML(proposal.goalTitle)}</div>
          <div style="font-size:12px; margin-top:2px;">${escapeHTML(proposal.summary || proposal.reasoning || '')}</div>
          ${audit.repaired ? '<div style="font-size:11px; color:#10A37F; margin-top:4px;">✔ 실제 페이지에서 측정한 문제를 에이전트가 한 차례 스스로 수정했습니다.</div>' : ''}
          ${audit.isEmpty ? '<div style="font-size:12px; color:#EF4444; margin-top:6px;">안전 검사를 통과한 변경 내용이 없어 적용할 것이 없습니다.</div>' : ''}
          ${findingsHtml}
          ${jsCount ? `<label style="display:flex; gap:6px; align-items:center; font-size:11.5px; margin:6px 0;"><input type="checkbox" class="rv-js"> 동작 스크립트 ${jsCount}개도 허용 (기본: 허용 안 함)</label>` : ''}
          ${audit.riskLevel === 'high' && !audit.isEmpty ? '<label style="display:flex; gap:6px; align-items:center; font-size:11.5px; font-weight:700; color:#EF4444; margin:6px 0;"><input type="checkbox" class="rv-ack"> 위 주의 사항을 확인했습니다</label>' : ''}
          <details style="font-size:11px; margin:6px 0;"><summary>코드 직접 보기</summary><pre class="code-box-pre" style="max-height:140px; overflow:auto;">${escapeHTML(proposal.generatedCss || '')}${jsCount ? '\n\n/* JS */\n' + escapeHTML(Object.values(proposal.generatedJs).join('\n\n')) : ''}</pre></details>
          <div class="rv-actions" style="display:${audit.isEmpty ? 'none' : 'flex'}; gap:6px; flex-wrap:wrap;">
            <button class="sp-img-search-btn rv-approve" style="flex:2; min-height:36px;">✅ 승인 · 항상 적용</button>
            <button class="sp-img-search-btn rv-once" style="flex:1; min-height:36px;">이번만</button>
            <button class="btn-subtle-reset rv-reject" style="flex:1; min-height:36px;">거절</button>
          </div>
          <div class="rv-status" style="font-size:11px; color:var(--chatgpt-muted); margin-top:6px;">${res.reviewShown ? '같은 검토 카드가 웹페이지에도 떠 있습니다. 미리보기는 페이지의 카드에서 할 수 있어요.' : ''}</div>
        </div>
      </div>
    `;
    chatFeed.appendChild(msg);
    scrollToBottom();

    const approveBtns = msg.querySelectorAll('.rv-approve, .rv-once');
    const ack = msg.querySelector('.rv-ack');
    if (ack) {
      approveBtns.forEach(b => (b.disabled = true));
      ack.addEventListener('change', () => approveBtns.forEach(b => (b.disabled = !ack.checked)));
    }
    const status = msg.querySelector('.rv-status');
    const finish = (text) => {
      msg.querySelector('.rv-actions').style.display = 'none';
      status.textContent = text;
    };

    const resolve = async (decision, reason) => {
      if (!activeTab) return;
      try {
        const r = await chrome.tabs.sendMessage(activeTab.id, {
          type: 'RESOLVE_REVIEW', decision, reason,
          includeJs: Boolean(msg.querySelector('.rv-js')?.checked)
        });
        if (!r || !r.success) {
          finish(`⚠️ ${r?.error || '이미 페이지에서 처리되었거나 만료된 제안입니다.'}`);
          return;
        }
        if (decision === 'reject') {
          finish('거절했습니다. 페이지는 그대로이며, 다음 제안부터 이 방식은 피합니다.');
        } else {
          sidepanelConversationHistory.push({ role: 'user', content: query }, { role: 'assistant', content: `[${proposal.goalTitle}] ${proposal.summary || ''}` });
          sidepanelConversationHistory = sidepanelConversationHistory.slice(-6);
          finish(decision === 'approve' ? '✅ 승인되어 적용했습니다. 이 사이트에 다시 오면 자동으로 적용됩니다.' : '✅ 이번 방문에만 적용했습니다.');
          await refreshActiveTab();
          await refreshTraitsDropdown();
        }
      } catch (e) {
        finish('⚠️ 웹페이지와 연결할 수 없습니다. 페이지를 새로고침한 뒤 다시 요청해주세요.');
      }
    };

    msg.querySelector('.rv-approve').addEventListener('click', () => resolve('approve'));
    msg.querySelector('.rv-once').addEventListener('click', () => resolve('approve_once'));
    msg.querySelector('.rv-reject').addEventListener('click', () => {
      const reason = prompt('거절 이유를 알려주시면 다음부터 같은 제안을 피합니다. (선택)', '') || '';
      resolve('reject', reason);
    });
  }

  function appendUserMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'chat-message user';
    msg.innerHTML = `
      <div class="user-bubble">${escapeHTML(text)}</div>
    `;
    chatFeed.appendChild(msg);
    scrollToBottom();
  }

  function appendThinkingMessage() {
    const msg = document.createElement('div');
    msg.className = 'chat-message assistant';
    msg.innerHTML = `
      <div class="assistant-avatar">✨</div>
      <div class="assistant-content" style="color: var(--chatgpt-muted); font-style: italic;">
        GPT-5.6-luna가 사용자 특화 성향과 DOM 구조를 분석하여 삽입용 코드를 작성 중입니다...
      </div>
    `;
    chatFeed.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function appendAssistantMessage(text, proposal) {
    const msg = document.createElement('div');
    msg.className = 'chat-message assistant';

    let extraHtml = '';

    // Code Box for dynamically generated CSS
    if (proposal && proposal.generatedCss) {
      extraHtml += `
        <div class="chatgpt-code-box">
          <div class="code-box-header">
            <span>✨ 적용된 CSS</span>
            <button class="code-box-copy" data-code="${encodeURIComponent(proposal.generatedCss)}">코드 복사</button>
          </div>
          <pre class="code-box-pre">${escapeHTML(proposal.generatedCss)}</pre>
          <div class="code-box-footer">
            <span style="font-size: 10px; color: var(--chatgpt-muted);">웹페이지 head 태그 내 실시간 주입 완료</span>
            <button class="btn-revert-flat" title="되돌리기">↩ 복원</button>
          </div>
        </div>
      `;
    }

    // Image Studio Card (Real-time image search results & direct link input form)
    const images = proposal?.searchedImages || [];
    if (images.length > 0 || (proposal?.generatedCss && /background(-image)?\s*:\s*url/i.test(proposal.generatedCss))) {
      const itemsHtml = images.slice(0, 6).map(img => `
        <div class="sp-gallery-item" data-url="${escapeHTML(img.url)}" title="${escapeHTML(img.title)}">
          <img class="sp-gallery-img" src="${escapeHTML(img.previewUrl || img.url)}" alt="${escapeHTML(img.title)}" loading="lazy" />
          <div class="sp-gallery-overlay">${escapeHTML(img.title)}</div>
        </div>
      `).join('');

      extraHtml += `
        <div class="sp-image-studio-card">
          <div class="sp-image-studio-header">
            <span class="sp-image-studio-title">🖼️ 이미지 스튜디오 &amp; 실시간 검색</span>
            <span class="sp-image-studio-badge">실시간 검색됨</span>
          </div>

          <div class="sp-img-form-wrap">
            <div class="sp-img-form-label">🔗 이미지 링크(URL) 직접 입력</div>
            <div class="sp-img-input-row">
              <input type="text" class="sp-img-direct-input" placeholder="https://... 이미지 주소 붙여넣기" />
              <button class="sp-img-direct-apply-btn">배경에 적용</button>
            </div>
          </div>

          <div class="sp-img-form-wrap" style="margin-top: 4px;">
            <div class="sp-img-form-label">🔍 실시간 이미지 검색</div>
            <div class="sp-img-input-row">
              <input type="text" class="sp-img-search-kw" placeholder="검색어 (예: 비, rain, 밤하늘, 숲, 바다, 고양이)..." />
              <button class="sp-img-search-btn">검색</button>
            </div>
          </div>

          <div class="sp-img-presets-row">
            <button class="sp-img-preset-btn" data-preset="rain">🌧️ 비</button>
            <button class="sp-img-preset-btn" data-preset="night">🌌 밤하늘</button>
            <button class="sp-img-preset-btn" data-preset="nature">🌿 숲</button>
            <button class="sp-img-preset-btn" data-preset="ocean">🌊 바다</button>
            <button class="sp-img-preset-btn" data-preset="cafe">☕ 카페</button>
          </div>

          <div class="sp-img-gallery-grid">
            ${itemsHtml || '<div style="grid-column:1/-1; font-size:11px; color:#94A3B8; text-align:center; padding:12px;">검색어를 입력하거나 원하는 이미지 링크를 직접 입력하세요.</div>'}
          </div>
        </div>
      `;
    }

    // Traits notice
    if (proposal && proposal.identifiedTraits && proposal.identifiedTraits.length > 0) {
      const traitsBadges = proposal.identifiedTraits
        .map((t) => `<span class="sp-traits-badge" style="margin-right: 4px;">+ ${escapeHTML(t)}</span>`)
        .join('');
      extraHtml += `
        <div style="margin-top: 8px; font-size: 11px; color: var(--chatgpt-subtext);">
          🧠 <strong>사용자 특화 성향 학습됨:</strong> ${traitsBadges}
        </div>
      `;
    }

    msg.innerHTML = `
      <div class="assistant-avatar">✨</div>
      <div class="assistant-content">
        <div>${escapeHTML(text)}</div>
        ${extraHtml}
      </div>
    `;

    chatFeed.appendChild(msg);
    scrollToBottom();

    // Event listeners inside message
    const copyBtn = msg.querySelector('.code-box-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const code = decodeURIComponent(copyBtn.dataset.code);
        navigator.clipboard.writeText(code);
        copyBtn.textContent = '복사됨!';
        setTimeout(() => (copyBtn.textContent = '코드 복사'), 1500);
      });
    }

    const revBtn = msg.querySelector('.btn-revert-flat');
    if (revBtn) {
      revBtn.addEventListener('click', async () => {
        if (activeTab) {
          await revertTab(activeTab);
          await refreshActiveTab();
          appendAssistantMessage('삽입된 코드를 제거하고 원래 상태로 복원했습니다. ↩', null);
        }
      });
    }

    // Image Studio handlers
    const studioCard = msg.querySelector('.sp-image-studio-card');
    if (studioCard) {
      const applyDirectBg = async (imgUrl) => {
        if (!imgUrl || !imgUrl.startsWith('http')) {
          alert('올바른 이미지 주소(http:// 또는 https://)를 입력해주세요.');
          return;
        }
        const safeUrl = imgUrl.replace(/'/g, "\\'");
        const customCss = `
body {
  background-image: url('${safeUrl}') !important;
  background-size: cover !important;
  background-attachment: fixed !important;
  background-position: center !important;
}
article, main, #content, .container, [role="main"] {
  background: rgba(255, 255, 255, 0.72) !important;
  backdrop-filter: blur(14px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(14px) saturate(180%) !important;
  border-radius: 14px !important;
}
`;
        if (activeTab) {
          const res = await injectDynamicCssToTab(activeTab, customCss, '사용자 지정 배경 이미지 적용');
          if (res.success) {
            appendAssistantMessage(`✨ 선택하신 이미지를 웹페이지 배경으로 적용했습니다!\nURL: ${imgUrl}`, { generatedCss: customCss });
          }
        }
      };

      const directInput = studioCard.querySelector('.sp-img-direct-input');
      const directApplyBtn = studioCard.querySelector('.sp-img-direct-apply-btn');
      if (directApplyBtn && directInput) {
        directApplyBtn.addEventListener('click', () => {
          applyDirectBg(directInput.value.trim());
        });
        directInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            applyDirectBg(directInput.value.trim());
          }
        });
      }

      const searchInput = studioCard.querySelector('.sp-img-search-kw');
      const searchBtn = studioCard.querySelector('.sp-img-search-btn');
      const galleryGrid = studioCard.querySelector('.sp-img-gallery-grid');

      const performSearch = async (kw) => {
        if (!kw) return;
        galleryGrid.innerHTML = '<div style="grid-column:1/-1; font-size:11px; color:#A5B4FC; text-align:center; padding:12px;">🔍 실시간 이미지를 검색 중입니다...</div>';
        try {
          const res = await chrome.runtime.sendMessage({ type: 'SEARCH_IMAGES', query: kw });
          const list = res?.results || [];
          if (list.length === 0) {
            galleryGrid.innerHTML = '<div style="grid-column:1/-1; font-size:11px; color:#94A3B8; text-align:center; padding:12px;">검색 결과가 없습니다. 다른 키워드로 검색해보세요.</div>';
            return;
          }
          galleryGrid.innerHTML = list.map(img => `
            <div class="sp-gallery-item" data-url="${escapeHTML(img.url)}" title="${escapeHTML(img.title)}">
              <img class="sp-gallery-img" src="${escapeHTML(img.previewUrl || img.url)}" alt="${escapeHTML(img.title)}" loading="lazy" />
              <div class="sp-gallery-overlay">${escapeHTML(img.title)}</div>
            </div>
          `).join('');
          bindGalleryItems();
        } catch (e) {
          galleryGrid.innerHTML = `<div style="grid-column:1/-1; font-size:11px; color:#F87171; text-align:center; padding:12px;">검색 실패: ${escapeHTML(e.message)}</div>`;
        }
      };

      const bindGalleryItems = () => {
        studioCard.querySelectorAll('.sp-gallery-item').forEach(item => {
          item.addEventListener('click', () => {
            const url = item.dataset.url;
            if (url) applyDirectBg(url);
          });
        });
      };
      bindGalleryItems();

      if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => performSearch(searchInput.value.trim()));
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            performSearch(searchInput.value.trim());
          }
        });
      }

      studioCard.querySelectorAll('.sp-img-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const preset = btn.dataset.preset;
          if (searchInput) searchInput.value = btn.textContent.replace(/^[^\s]+\s*/, '');
          performSearch(preset);
        });
      });
    }
  }

  function scrollToBottom() {
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  // New Chat Button
  spBtnNewChat.addEventListener('click', () => {
    chatFeed.innerHTML = `
      <div class="chat-message assistant">
        <div class="assistant-avatar">✨</div>
        <div class="assistant-content">
          새 대화를 시작합니다. <strong>EqualiUI 5.6 Luna</strong>에게 원하시는 웹페이지 스타일을 지시해주세요!
        </div>
      </div>
    `;
    customInstructionInput.value = '';
    btnSendInstruction.disabled = true;
    btnSendInstruction.classList.remove('active');
    sidepanelConversationHistory = [];
    customInstructionInput.focus();
  });

  // Header Quick Revert
  spHeaderRevert.addEventListener('click', async () => {
    if (activeTab) {
      await revertTab(activeTab);
      await refreshActiveTab();
      appendAssistantMessage('원래 화면으로 복원되었습니다. (Alt+Z)', null);
    }
  });

  /* ==========================================================================
     E. Tab 2: User Persona Traits Memory & RLHF Preference Controller
     ========================================================================== */
  const FEATURE_CATALOG = {
    tts_reader: { name: '본문 읽어주기 (TTS)', icon: '🎙️', desc: '시각장애/저시력/집중 보조 스크린 리더' },
    live_captions: { name: '영상 AI 실시간 자막', icon: '💬', desc: '청각장애/난청 보조 고대비 자막 바' },
    plain_summary: { name: '쉬운 말 3줄 요약', icon: '🌱', desc: '어린이/어르신 이해 보조 요약 카드' },
    dyslexic_ruler: { name: '난독증 시선 룰러', icon: '📖', desc: '마우스 추적 독서 가이드 룰러' },
    high_contrast: { name: '고대비 다크 테마', icon: '🌙', desc: '눈부심 방지 및 저시력 고대비' },
    large_font: { name: '큰 글자 & 행간 확보', icon: '🔤', desc: '가독성 높은 폰트 및 여백' },
    rain_ambient: { name: '비 내리는 감성 배경', icon: '🌧️', desc: '외부 애니메이션 GIF 비 배경 효과' }
  };

  async function renderTraitsTab() {
    const {
      traitInsights = [],
      userTraits = {},
      rlhfWeights = {},
      featureUsageStats = {},
      negativeRules = []
    } = await chrome.storage.local.get(['traitInsights', 'userTraits', 'rlhfWeights', 'featureUsageStats', 'negativeRules']);

    // 1. Persona Traits list
    spTraitsFullList.innerHTML = '';
    const list = traitInsights.length > 0 ? traitInsights : Object.values(userTraits);
    if (list.length === 0) {
      spTraitsFullList.innerHTML = '<div class="empty-notice">아직 기록된 사용자 특화 성향이 없습니다. 대화를 나누면 에이전트가 자동으로 파악합니다.</div>';
    } else {
      list.forEach((trait, index) => {
        const item = document.createElement('div');
        item.className = 'sp-trait-item';
        item.innerHTML = `
          <span class="sp-trait-item-text">🧠 ${escapeHTML(trait)}</span>
          <button class="btn-delete-trait" data-index="${index}" title="삭제">✕</button>
        `;
        spTraitsFullList.appendChild(item);
      });

      spTraitsFullList.querySelectorAll('.btn-delete-trait').forEach((delBtn) => {
        delBtn.addEventListener('click', async () => {
          const idx = parseInt(delBtn.dataset.index, 10);
          list.splice(idx, 1);
          await chrome.storage.local.set({ traitInsights: list });
          await renderTraitsTab();
          await refreshTraitsDropdown();
        });
      });
    }

    // 2. RLHF Feature Weights List
    if (spRlhfWeightsList) {
      spRlhfWeightsList.innerHTML = '';
      Object.entries(FEATURE_CATALOG).forEach(([featId, meta]) => {
        const isExcluded = negativeRules.some(r => (r.featureId || r) === featId);
        const weight = isExcluded ? 0.05 : (rlhfWeights[featId] !== undefined ? rlhfWeights[featId] : 1.0);
        const usage = featureUsageStats[featId] || 0;
        const pct = isExcluded ? 5 : Math.min(100, Math.max(5, (weight / 2.0) * 100));

        const item = document.createElement('div');
        item.className = 'rlhf-item';
        item.innerHTML = `
          <div class="rlhf-item-header">
            <span class="rlhf-item-name">
              <span>${meta.icon}</span>
              <span>${meta.name}</span>
              ${isExcluded ? '<span style="font-size:10px; color:#EF4444; font-weight:700;">[영구 배제됨]</span>' : ''}
            </span>
            <span class="rlhf-item-stats">사용 ${usage}회 | 가중치 ${(weight * 100).toFixed(0)}%</span>
          </div>
          <div class="rlhf-gauge-track">
            <div class="rlhf-gauge-fill" style="width: ${pct}%; background: ${isExcluded ? '#EF4444' : 'linear-gradient(90deg, #10A37F, #38BDF8)'};"></div>
          </div>
          <div class="rlhf-actions-row">
            <span style="font-size:10.5px; color:#8E8E8E;">${meta.desc}</span>
            <div class="rlhf-btn-group">
              <button class="btn-rlhf-mini btn-like" data-id="${featId}" title="선호도 강화 (+15%)">👍</button>
              <button class="btn-rlhf-mini btn-dislike" data-id="${featId}" title="선호도 감소 (-25%)">👎</button>
              <button class="btn-rlhf-mini btn-exclude" data-id="${featId}" title="영구 배제 (Zero Tolerance)">🚫 제외</button>
            </div>
          </div>
        `;
        spRlhfWeightsList.appendChild(item);
      });

      spRlhfWeightsList.querySelectorAll('.btn-like').forEach(btn => {
        btn.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({
            type: 'RECORD_RLHF_FEEDBACK',
            featureId: btn.dataset.id,
            liked: true
          });
          await renderTraitsTab();
        });
      });

      spRlhfWeightsList.querySelectorAll('.btn-dislike').forEach(btn => {
        btn.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({
            type: 'RECORD_RLHF_FEEDBACK',
            featureId: btn.dataset.id,
            liked: false
          });
          await renderTraitsTab();
        });
      });

      spRlhfWeightsList.querySelectorAll('.btn-exclude').forEach(btn => {
        btn.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({
            type: 'DISLIKE_AND_EXCLUDE_FEATURE',
            featureId: btn.dataset.id
          });
          await renderTraitsTab();
        });
      });
    }

    // 3. Negative Rules (Zero Tolerance List)
    if (spNegativeRulesList) {
      spNegativeRulesList.innerHTML = '';
      if (negativeRules.length === 0) {
        spNegativeRulesList.innerHTML = '<div class="empty-notice">현재 영구 배제된 기능이 없습니다. 원치 않는 기능은 [🚫 제외]하여 영구 배제할 수 있습니다.</div>';
      } else {
        negativeRules.forEach(rule => {
          const ruleId = rule.featureId || rule;
          const meta = FEATURE_CATALOG[ruleId] || { name: ruleId, icon: '🚫' };
          const item = document.createElement('div');
          item.className = 'negative-rule-item';
          item.innerHTML = `
            <span class="negative-rule-name">
              <span>${meta.icon}</span>
              <span>${meta.name}</span>
            </span>
            <button class="btn-unban-rule" data-id="${ruleId}">배제 해제</button>
          `;
          spNegativeRulesList.appendChild(item);
        });

        spNegativeRulesList.querySelectorAll('.btn-unban-rule').forEach(btn => {
          btn.addEventListener('click', async () => {
            await chrome.runtime.sendMessage({
              type: 'REMOVE_NEGATIVE_RULE',
              featureId: btn.dataset.id
            });
            await renderTraitsTab();
          });
        });
      }
    }
  }

  btnAddTrait.addEventListener('click', async () => {
    const val = inputNewTrait.value.trim();
    if (!val) return;

    const { traitInsights = [] } = await chrome.storage.local.get(['traitInsights']);
    if (!traitInsights.includes(val)) {
      traitInsights.push(val);
      await chrome.storage.local.set({ traitInsights });
      inputNewTrait.value = '';
      await renderTraitsTab();
      await refreshTraitsDropdown();
    }
  });

  inputNewTrait.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnAddTrait.click();
    }
  });

  btnResetTraits.addEventListener('click', async () => {
    if (confirm('확인된 사용자 특화 성향 메모리를 초기화하시겠습니까?')) {
      await chrome.storage.local.set({ traitInsights: [], userTraits: {} });
      await renderTraitsTab();
      await refreshTraitsDropdown();
      appendAssistantMessage('🧠 사용자 특화 성향 메모리가 초기화되었습니다.', null);
    }
  });

  if (btnResetRlhf) {
    btnResetRlhf.addEventListener('click', async () => {
      if (confirm('모든 기능의 RLHF 학습 가중치와 영구 배제 목록을 초기화하시겠습니까?')) {
        await chrome.runtime.sendMessage({ type: 'RESET_RLHF_LEARNING' });
        await renderTraitsTab();
        appendAssistantMessage('🔄 RLHF 학습 가중치와 영구 배제 목록이 초기화되었습니다.', null);
      }
    });
  }

  /* ==========================================================================
     F. Tab 3: Site Patch Registry Controller (Auto-Adaptation)
     ========================================================================== */
  async function renderRegistryTab() {
    const { sitePatchRegistry = {} } = await chrome.storage.local.get(['sitePatchRegistry']);
    siteRegistryList.innerHTML = '';

    const domains = Object.keys(sitePatchRegistry);
    if (domains.length === 0) {
      siteRegistryList.innerHTML = '<div class="empty-notice">저장된 사이트별 맞춤 코드가 없습니다. 웹페이지에서 코드를 생성하면 이곳에 영구 저장됩니다.</div>';
      return;
    }

    domains.forEach((dom) => {
      const patch = sitePatchRegistry[dom];
      const card = document.createElement('div');
      card.className = 'site-patch-card';

      const dateStr = patch.generatedAt ? new Date(patch.generatedAt).toLocaleDateString() : '최근';
      const isAuto = patch.autoApply !== false;

      card.innerHTML = `
        <div class="site-patch-header">
          <span class="site-patch-domain">🌐 ${escapeHTML(dom)}</span>
          <span class="site-patch-date">${dateStr}</span>
        </div>
        <div style="font-size:11.5px; font-weight:600; margin-bottom:4px;">${escapeHTML(patch.goalTitle || '')} ${patch.approvedAt ? '<span style="color:#10A37F;">· 승인됨</span>' : '<span style="color:#D97706;">· 승인 기록 없음 (스크립트 미실행)</span>'}</div>
        <pre class="site-patch-pre">${escapeHTML(patch.generatedCss || '/* CSS 없음 */')}</pre>
        <div class="site-patch-actions">
          <label class="toggle-switch-label">
            <input type="checkbox" class="toggle-switch-input toggle-auto-apply" data-domain="${escapeHTML(dom)}" ${isAuto ? 'checked' : ''}>
            <span>방문 시 매번 자동 반영</span>
          </label>
          <button class="btn-subtle-reset btn-delete-patch" data-domain="${escapeHTML(dom)}" style="padding: 2px 6px;">삭제</button>
        </div>
      `;

      siteRegistryList.appendChild(card);
    });

    // Auto-apply toggles
    siteRegistryList.querySelectorAll('.toggle-auto-apply').forEach((chk) => {
      chk.addEventListener('change', async () => {
        const domain = chk.dataset.domain;
        await chrome.runtime.sendMessage({
          type: 'TOGGLE_SITE_AUTO_APPLY',
          domain,
          enabled: chk.checked
        });
      });
    });

    // Delete patch
    siteRegistryList.querySelectorAll('.btn-delete-patch').forEach((delBtn) => {
      delBtn.addEventListener('click', async () => {
        const domain = delBtn.dataset.domain;
        const { sitePatchRegistry: reg = {} } = await chrome.storage.local.get(['sitePatchRegistry']);
        delete reg[domain];
        await chrome.storage.local.set({ sitePatchRegistry: reg });
        await renderRegistryTab();
      });
    });
  }

  /* ==========================================================================
     G. Tab 4: Settings Controller
     ========================================================================== */
  btnToggleKeyVisibility.addEventListener('click', () => {
    if (inputApiKey.type === 'password') {
      inputApiKey.type = 'text';
      btnToggleKeyVisibility.textContent = '숨김';
    } else {
      inputApiKey.type = 'password';
      btnToggleKeyVisibility.textContent = '보기';
    }
  });

  btnSaveSettings.addEventListener('click', async () => {
    const key = inputApiKey.value.trim();
    const model = selectModel.value;

    await chrome.storage.local.set({
      openaiApiKey: key,
      openaiModel: model,
      hitlMode: document.getElementById('select-hitl-mode').value,
      proactiveAiSuggestions: document.getElementById('chk-proactive-ai').checked
    });

    btnSaveSettings.textContent = '✅ 저장 완료!';
    setTimeout(() => {
      btnSaveSettings.textContent = '설정 저장';
    }, 1800);

    appendAssistantMessage(`⚙️ 설정이 저장되었습니다. (모델: ${model}, ${key ? 'GPT API 실시간 연동 활성화' : '오프라인 내장 신디사이저 활성화'})`, null);
  });

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  // 탭을 바꾸거나 페이지가 이동하면 대상 탭 정보를 갱신한다
  chrome.tabs.onActivated.addListener(() => refreshActiveTab());
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'complete' && activeTab && tabId === activeTab.id) refreshActiveTab();
  });

  // Launch
  init();
});
