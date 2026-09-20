/**
 * EqualiUI Popup Controller - Dynamic Code Injection & User Traits Edition
 * Enhanced with Self-Healing Tab Connection & Safe Scripting Fallbacks
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Header Elements
  const btnModelPicker = document.getElementById('btn-model-picker');
  const modelDropdown = document.getElementById('model-dropdown');
  const popupTraitsList = document.getElementById('popup-traits-list');
  const btnNewChat = document.getElementById('btn-new-chat');
  const btnOpenSidepanel = document.getElementById('btn-open-sidepanel');

  // Views
  const homeView = document.getElementById('home-view');
  const chatView = document.getElementById('chat-view');
  const messagesList = document.getElementById('messages-list');
  const suggestionGrid = document.getElementById('suggestion-grid');
  const suggestionCards = document.querySelectorAll('.suggestion-card');

  // Input & Buttons
  const promptInput = document.getElementById('prompt-input');
  const btnSend = document.getElementById('btn-send');
  const btnRevertQuick = document.getElementById('btn-revert-quick');

  let activeTab = null;
  let popupConversationHistory = [];

  // 1. Get active tab
  async function refreshActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;
    return tab;
  }
  await refreshActiveTab();

  // Helper: Check if tab is standard webpage (not chrome://, about:, etc.)
  function isInjectableTab(tab) {
    if (!tab || !tab.url) return false;
    const u = tab.url.toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('file://');
  }

  // Helper: Robust CSS Injection with Self-Healing Fallbacks

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

    // Attempt 1: Standard message passing
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
      console.log('[EqualiUI] sendMessage failed, attempting self-healing script injection:', e.message);
    }

    // Attempt 2: Self-healing via chrome.scripting.executeScript
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
      console.log('[EqualiUI] executeScript re-message failed, attempting direct DOM injection:', e2.message);
    }

    // Attempt 3: Direct DOM style element injection fallback
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
      console.error('[EqualiUI] All injection attempts failed:', e3);
      return { success: false, reason: e3.message };
    }
  }

  // Helper: Robust Revert
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

  // 2. Load User Traits into Dropdown Inspector
  async function refreshUserTraitsUI() {
    const { traitInsights = [], userTraits = {} } = await chrome.storage.local.get(['traitInsights', 'userTraits']);
    popupTraitsList.innerHTML = '';

    const list = traitInsights.length > 0 ? traitInsights : Object.values(userTraits);
    if (list.length === 0) {
      popupTraitsList.innerHTML = '<div style="color:#8E8E8E; font-size:10px;">아직 기록된 특화 정보가 없습니다. 대화를 시작해보세요!</div>';
      return;
    }

    list.slice(0, 6).forEach((trait) => {
      const item = document.createElement('div');
      item.className = 'trait-tag-item';
      item.textContent = trait;
      popupTraitsList.appendChild(item);
    });
  }

  await refreshUserTraitsUI();

  // 3. Dropdown Toggle
  btnModelPicker.addEventListener('click', async (e) => {
    e.stopPropagation();
    await refreshUserTraitsUI();
    modelDropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!modelDropdown.contains(e.target) && e.target !== btnModelPicker) {
      modelDropdown.classList.remove('open');
    }
  });

  // 4. Input Active State (Iconic ChatGPT Button)
  promptInput.addEventListener('input', () => {
    const hasText = promptInput.value.trim().length > 0;
    btnSend.disabled = !hasText;
    if (hasText) {
      btnSend.classList.add('active');
    } else {
      btnSend.classList.remove('active');
    }
  });

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!btnSend.disabled) {
        sendMessage(promptInput.value);
      }
    }
  });

  btnSend.addEventListener('click', () => {
    if (!btnSend.disabled) {
      sendMessage(promptInput.value);
    }
  });

  // 5. Suggestion Cards Click
  suggestionCards.forEach((card) => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      sendMessage(prompt);
    });
  });

  // 6. Reset / New Chat Button
  btnNewChat.addEventListener('click', () => {
    messagesList.innerHTML = '';
    chatView.style.display = 'none';
    homeView.style.display = 'flex';
    promptInput.value = '';
    btnSend.disabled = true;
    btnSend.classList.remove('active');
    popupConversationHistory = [];
    promptInput.focus();
  });

  // 7. Send Message & Inject Dynamic Code
  async function sendMessage(text) {
    const query = text.trim();
    if (!query) return;

    await refreshActiveTab();

    homeView.style.display = 'none';
    chatView.style.display = 'flex';

    appendUserMessage(query);
    promptInput.value = '';
    btnSend.disabled = true;
    btnSend.classList.remove('active');

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
        conversationHistory: popupConversationHistory || []
      });

      thinkingNode.remove();

      if (!res || !res.success || !res.proposal) {
        if (res?.needsApiKey) {
          appendAssistantMessage(`🔑 ${res.error}\n(사이드 패널 또는 팝업 설정에서 API 키를 입력해주세요.)`, null);
          return;
        }
        throw new Error(res?.error || '요청 처리에 실패했습니다.');
      }

      const proposal = res.proposal;

      // Handle Revert
      if (proposal.isRevert) {
        if (activeTab) {
          await revertTab(activeTab);
        }
        popupConversationHistory = [];
        appendAssistantMessage('모든 맞춤 코드를 제거하고 원래 웹페이지 스타일로 복원했습니다. ↩', null);
        return;
      }

      // Human-in-the-Loop: 제안은 아직 적용되지 않았다. 웹페이지에 뜬 검토 카드에서 승인해야 적용된다.
      const audit = res.audit || {};
      const riskText = { low: '위험 낮음', medium: '확인 필요', high: '주의 필요' }[audit.riskLevel] || '확인 필요';
      if (audit.isEmpty) {
        appendAssistantMessage(`🛡️ 안전 검사를 통과한 변경 내용이 없어 적용하지 않았습니다.\n${(audit.findings || []).map(f => '· ' + f.message).join('\n')}`, null);
      } else if (res.autoApprovable) {
        appendAssistantMessage(`저위험 변경이라 바로 적용했습니다: ${proposal.goalTitle}`, null);
      } else if (res.reviewShown) {
        appendAssistantMessage(`🔍 '${proposal.goalTitle}' 제안을 만들었습니다 (${riskText}).\n웹페이지에 뜬 검토 카드에서 미리보기 후 승인하면 적용됩니다. 승인 전에는 페이지가 바뀌지 않습니다.`, null);
      } else {
        appendAssistantMessage('⚠️ 웹페이지에 검토 카드를 띄우지 못했습니다. 페이지를 새로고침한 뒤 다시 요청해주세요.', null);
      }

      popupConversationHistory.push({ role: 'user', content: query });
      popupConversationHistory.push({ role: 'assistant', content: `[제안: ${proposal.goalTitle}] ${proposal.summary || ''}` });
      popupConversationHistory = popupConversationHistory.slice(-6);
      await refreshUserTraitsUI();
    } catch (err) {
      thinkingNode.remove();
      appendAssistantMessage(`⚠️ 오류가 발생했습니다: ${escapeHTML(err.message)}`, null);
    }
  }

  function appendUserMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'chat-message user';
    msg.innerHTML = `
      <div class="user-bubble">${escapeHTML(text)}</div>
    `;
    messagesList.appendChild(msg);
    scrollToBottom();
  }

  function appendThinkingMessage() {
    const msg = document.createElement('div');
    msg.className = 'chat-message assistant';
    msg.innerHTML = `
      <div class="assistant-avatar">✨</div>
      <div class="assistant-content" style="color: var(--chatgpt-muted); font-style: italic;">
        GPT-5.6-luna가 사용자 특화 성향과 DOM을 분석하여 삽입용 코드를 제작 중입니다...
      </div>
    `;
    messagesList.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function appendAssistantMessage(text, proposal) {
    const msg = document.createElement('div');
    msg.className = 'chat-message assistant';

    let codeBlockHtml = '';
    if (proposal && proposal.generatedCss) {
      const traitsBadges = (proposal.identifiedTraits || proposal.discoveredTraits || [])
        .map(t => `<span style="background: rgba(16, 163, 127, 0.15); color: #10A37F; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-right: 4px;">✔ ${escapeHTML(t)}</span>`)
        .join('');

      codeBlockHtml = `
        <div class="chatgpt-code-box">
          <div class="code-box-header">
            <span>✨ 주입된 맞춤 CSS</span>
            <span>${proposal.source === 'openai_gpt56' ? 'GPT-5.6 Luna' : 'EqualiUI Synthesizer'}</span>
          </div>
          <pre class="code-box-pre">${escapeHTML(proposal.generatedCss.trim())}</pre>
          <div class="code-box-footer">
            <div>${traitsBadges}</div>
            <button class="btn-revert-flat" title="이 코드 제거">↩ 복원</button>
          </div>
        </div>
      `;
    }

    msg.innerHTML = `
      <div class="assistant-avatar">✨</div>
      <div class="assistant-content">
        <div>${escapeHTML(text)}</div>
        ${codeBlockHtml}
      </div>
    `;

    messagesList.appendChild(msg);
    scrollToBottom();

    // Revert button binding
    const revBtn = msg.querySelector('.btn-revert-flat');
    if (revBtn) {
      revBtn.addEventListener('click', async () => {
        if (activeTab) {
          await revertTab(activeTab);
          revBtn.textContent = '복원됨';
          revBtn.disabled = true;
        }
      });
    }
  }

  function scrollToBottom() {
    const mainEl = document.getElementById('chatgpt-main');
    if (mainEl) mainEl.scrollTop = mainEl.scrollHeight;
  }

  // 8. Quick Revert Bottom Addon Button
  btnRevertQuick.addEventListener('click', async () => {
    if (activeTab) {
      await revertTab(activeTab);
      sendMessage('원래대로 되돌려줘');
    }
  });

  // 9. Open Sidepanel Button
  btnOpenSidepanel.addEventListener('click', async () => {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      window.close();
    }
  });

  // 10. Quick Accessibility Assist Chips
  const popupQuickAssistBar = document.getElementById('popup-quick-assist-bar');
  const quickAssistChips = document.querySelectorAll('.quick-chip-btn');
  quickAssistChips.forEach((chip) => {
    chip.addEventListener('click', async () => {
      const feat = chip.dataset.feature;
      await refreshActiveTab();
      if (!activeTab || !activeTab.id || !isInjectableTab(activeTab)) return;

      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['shared/safety.js', 'content/ui-css.js', 'content/parts.js', 'content/content.js']
        });
      } catch (e) {}

      if (feat === 'tts_reader') {
        chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_TTS_READER' });
      } else if (feat === 'live_captions') {
        chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_LIVE_CAPTIONS' });
      } else if (feat === 'plain_summary') {
        chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_PLAIN_SUMMARY' });
      }
    });
  });

  // 11. Smart Recommendation Pill with RLHF Feedback
  const popupRecPill = document.getElementById('popup-rec-pill');
  const recPillIcon = document.getElementById('rec-pill-icon');
  const recPillText = document.getElementById('rec-pill-text');
  const btnRecPillRun = document.getElementById('btn-rec-pill-run');
  const btnRecPillLike = document.getElementById('btn-rec-pill-like');
  const btnRecPillDislike = document.getElementById('btn-rec-pill-dislike');
  const btnRecPillExclude = document.getElementById('btn-rec-pill-exclude');

  let currentRecFeature = null;

  async function checkPopupRecommendations() {
    if (!activeTab || !activeTab.id || !isInjectableTab(activeTab)) return;

    let pageContext = {
      domain: 'current-page',
      hasVideo: false,
      textLength: 1000
    };

    try {
      const urlObj = new URL(activeTab.url);
      pageContext.domain = urlObj.hostname;
    } catch (e) {}

    try {
      const snapRes = await chrome.tabs.sendMessage(activeTab.id, { type: 'ANALYZE_PAGE' });
      if (snapRes && snapRes.data) {
        pageContext.hasVideo = snapRes.data.hasVideo;
        pageContext.textLength = snapRes.data.totalTextLength;
      }
    } catch (e) {}

    try {
      const recRes = await chrome.runtime.sendMessage({
        type: 'GET_FEATURE_RECOMMENDATIONS',
        pageContext
      });

      if (recRes && recRes.success && recRes.recommendations && recRes.recommendations.length > 0) {
        const top = recRes.recommendations[0];
        currentRecFeature = top;
        recPillIcon.textContent = top.icon || '💡';
        recPillText.textContent = `추천: ${top.title}`;
        popupRecPill.style.display = 'flex';
      }
    } catch (e) {}
  }

  if (btnRecPillRun) {
    btnRecPillRun.addEventListener('click', async () => {
      if (!currentRecFeature || !activeTab) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['shared/safety.js', 'content/ui-css.js', 'content/parts.js', 'content/content.js']
        });
      } catch (e) {}

      chrome.tabs.sendMessage(activeTab.id, {
        type: 'TRIGGER_FEATURE',
        featureId: currentRecFeature.id
      });

      chrome.runtime.sendMessage({
        type: 'RECORD_RLHF_FEEDBACK',
        featureId: currentRecFeature.id,
        liked: true
      });

      popupRecPill.style.display = 'none';
    });
  }

  if (btnRecPillLike) {
    btnRecPillLike.addEventListener('click', () => {
      if (!currentRecFeature) return;
      chrome.runtime.sendMessage({
        type: 'RECORD_RLHF_FEEDBACK',
        featureId: currentRecFeature.id,
        liked: true
      });
      popupRecPill.style.display = 'none';
    });
  }

  if (btnRecPillDislike) {
    btnRecPillDislike.addEventListener('click', () => {
      if (!currentRecFeature) return;
      chrome.runtime.sendMessage({
        type: 'RECORD_RLHF_FEEDBACK',
        featureId: currentRecFeature.id,
        liked: false
      });
      popupRecPill.style.display = 'none';
    });
  }

  if (btnRecPillExclude) {
    btnRecPillExclude.addEventListener('click', () => {
      if (!currentRecFeature) return;
      chrome.runtime.sendMessage({
        type: 'DISLIKE_AND_EXCLUDE_FEATURE',
        featureId: currentRecFeature.id
      });
      popupRecPill.style.display = 'none';
    });
  }

  setTimeout(checkPopupRecommendations, 120);

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
});

