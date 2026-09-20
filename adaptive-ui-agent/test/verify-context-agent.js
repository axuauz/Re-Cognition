const assert = require('assert');

console.log('--- Testing Context-Aware Interface Agent Logic ---');

// 1. Semantic Landmarks Detection Test
function mockDetectSemanticLandmarks(doc) {
  const findBestMatch = (selectors) => {
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        return {
          selector: sel,
          tag: el.tagName.toLowerCase(),
          snippet: (el.innerText || '').trim().slice(0, 150)
        };
      }
    }
    return null;
  };

  return {
    mainArticle: findBestMatch(['article', 'main', '[role="main"]', '.article-body', '.post-content', '.news_view']),
    primaryNav: findBestMatch(['nav', 'header nav', '[role="navigation"]', '.gnb', '.navbar']),
    commentSection: findBestMatch(['#comments', '.comments', '.comment-box', '.reply-list']),
    sidebar: findBestMatch(['aside', '.sidebar', '#sidebar', '.aside']),
    mediaPlayer: findBestMatch(['video', 'iframe[src*="youtube"]', '.video-stream', '.player']),
    adBanners: findBestMatch(['[class*="ad-"]', '[id*="ad_"]', '[class*="banner"]'])
  };
}

const mockDoc = {
  querySelector(sel) {
    if (sel.includes('article') || sel.includes('.article-body')) {
      return { tagName: 'ARTICLE', innerText: 'This is the main article content about AI agents.' };
    }
    if (sel.includes('nav') || sel.includes('.gnb')) {
      return { tagName: 'NAV', innerText: 'Home News Tech About' };
    }
    if (sel.includes('#comments') || sel.includes('.comments')) {
      return { tagName: 'DIV', innerText: 'User 1: Great post! User 2: Interesting!' };
    }
    if (sel.includes('aside') || sel.includes('.sidebar')) {
      return { tagName: 'ASIDE', innerText: 'Related Articles and Trending Topics' };
    }
    if (sel.includes('[class*="banner"]')) {
      return { tagName: 'DIV', innerText: 'Special Discount Banner 50% Off' };
    }
    return null;
  }
};

const landmarks = mockDetectSemanticLandmarks(mockDoc);
assert(landmarks.mainArticle !== null, 'mainArticle must be detected');
assert.strictEqual(landmarks.mainArticle.tag, 'article');
assert(landmarks.primaryNav !== null, 'primaryNav must be detected');
assert(landmarks.commentSection !== null, 'commentSection must be detected');
assert(landmarks.sidebar !== null, 'sidebar must be detected');
assert(landmarks.adBanners !== null, 'adBanners must be detected');
console.log('✔ Test 1 (Semantic Landmark Extraction): PASSED');

// 2. Viewport & Interaction State Extraction
function mockGetViewportContext(win, doc, state) {
  const vh = win.innerHeight || 800;
  const vw = win.innerWidth || 1200;
  const scrollTop = win.scrollY || 0;
  const scrollHeight = doc.documentElement?.scrollHeight || 2000;

  return {
    scrollTop: scrollTop,
    viewportHeight: vh,
    viewportWidth: vw,
    pageScrollPercent: scrollHeight > vh ? Math.round((scrollTop / (scrollHeight - vh)) * 100) : 0,
    userSelectedText: win.getSelection ? win.getSelection().toString().trim().slice(0, 300) : null,
    lastClickedSelector: state.lastClickedSelector || null,
    activeElementSelector: doc.activeElement?.id ? `#${doc.activeElement.id}` : null
  };
}

const mockWin = {
  innerHeight: 900,
  innerWidth: 1440,
  scrollY: 450,
  getSelection: () => ({
    toString: () => '   이 텍스트의 배경을 노란색으로 강조해줘   '
  })
};

const mockDocViewport = {
  documentElement: { scrollHeight: 1800 },
  activeElement: { id: 'search-input' }
};

const mockState = {
  lastClickedSelector: '#buy-button-primary'
};

const viewportContext = mockGetViewportContext(mockWin, mockDocViewport, mockState);
assert.strictEqual(viewportContext.pageScrollPercent, 50, 'Scroll percentage should be 50%');
assert.strictEqual(viewportContext.userSelectedText, '이 텍스트의 배경을 노란색으로 강조해줘');
assert.strictEqual(viewportContext.lastClickedSelector, '#buy-button-primary');
assert.strictEqual(viewportContext.activeElementSelector, '#search-input');
console.log('✔ Test 2 (Viewport & Interaction State Context): PASSED');

// 3. Multi-turn Conversational Message Formatting
function buildChatMessages(systemPrompt, userPromptContent, conversationHistory) {
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const turn of conversationHistory.slice(-6)) {
      if (turn && turn.role && turn.content) {
        messages.push({
          role: turn.role === 'assistant' ? 'assistant' : 'user',
          content: String(turn.content)
        });
      }
    }
  }
  messages.push({ role: 'user', content: userPromptContent });
  return messages;
}

const history = [
  { role: 'user', content: '하단에 플로팅 버튼 하나 만들어줘' },
  { role: 'assistant', content: '[플로팅 버튼 생성] 화면 우측 하단에 고정된 플로팅 바로가기 버튼을 추가했습니다.' }
];
const followUpQuery = '그거 파란색으로 바꾸고 글씨는 흰색으로 해줘';

const formattedMessages = buildChatMessages(
  'You are EqualiUI...',
  JSON.stringify({ userInstruction: followUpQuery }),
  history
);

assert.strictEqual(formattedMessages.length, 4, 'Should contain system, 2 history turns, and current query');
assert.strictEqual(formattedMessages[1].content, '하단에 플로팅 버튼 하나 만들어줘');
assert.strictEqual(formattedMessages[2].role, 'assistant');
assert(formattedMessages[3].content.includes(followUpQuery));
console.log('✔ Test 3 (Multi-turn Contextual Conversation Formatting): PASSED');

// 4. Page Type Detection
function mockDetectPageType(url, ogType, domSignatures) {
  if (ogType.includes('article') || domSignatures.hasArticle) return 'article';
  if (url.includes('youtube.com') || domSignatures.hasVideo) return 'video_streaming';
  if (domSignatures.hasPrice) return 'ecommerce_shopping';
  if (url.includes('docs.') || domSignatures.hasCode) return 'documentation_tech';
  return 'general_webpage';
}

assert.strictEqual(mockDetectPageType('https://news.v.daum.net/123', 'article', { hasArticle: true }), 'article');
assert.strictEqual(mockDetectPageType('https://www.youtube.com/watch?v=abc', 'video', { hasVideo: true }), 'video_streaming');
assert.strictEqual(mockDetectPageType('https://docs.github.com/en/get-started', 'website', { hasCode: true }), 'documentation_tech');
assert.strictEqual(mockDetectPageType('https://shop.example.com/item/1', 'website', { hasPrice: true }), 'ecommerce_shopping');
console.log('✔ Test 4 (Page Type Detection Heuristics): PASSED');

// 5. Interactive Elements Map Extraction Test
function mockExtractInteractiveMap(elements) {
  return elements.map(el => ({
    selector: el.id ? `#${el.id}` : el.className ? `.${el.className}` : el.tag,
    tag: el.tag,
    text: el.text,
    rect: el.rect
  }));
}

const mockButtons = [
  { tag: 'input', id: 'search-box', text: '검색어를 입력하세요', rect: { top: 120, left: 300, width: 400, height: 40 } },
  { tag: 'button', id: 'btn-search', text: 'Google 검색', rect: { top: 180, left: 350, width: 120, height: 35 } },
  { tag: 'button', id: 'btn-lucky', text: "I'm Feeling Lucky", rect: { top: 180, left: 490, width: 140, height: 35 } }
];

const interactiveMap = mockExtractInteractiveMap(mockButtons);
assert.strictEqual(interactiveMap.length, 3, 'Must extract all 3 interactive elements');
assert.strictEqual(interactiveMap[1].text, 'Google 검색');
assert.strictEqual(interactiveMap[1].selector, '#btn-search');
assert.strictEqual(interactiveMap[2].text, "I'm Feeling Lucky");
// Verify spatial relationship: buttons are immediately below search-box (top 180 > 120)
assert(interactiveMap[1].rect.top > interactiveMap[0].rect.top, 'Buttons must be positioned below search box');
console.log('✔ Test 5 (Interactive Elements Map Extraction & Spatial Anchoring): PASSED');

// 6. Local Focus Subtree Extraction Test
function mockExtractLocalFocusSubtree(targetEl) {
  return {
    selector: `#${targetEl.id}`,
    tag: targetEl.tag,
    text: targetEl.text,
    outerHtml: targetEl.outerHtml,
    parent: targetEl.parent,
    siblings: targetEl.siblings,
    computedStyles: targetEl.styles
  };
}

const mockFocusTarget = {
  id: 'btn-search',
  tag: 'button',
  text: 'Google 검색',
  outerHtml: '<button id="btn-search" class="gNO89b">Google 검색</button>',
  parent: { tag: 'div', id: 'search-buttons-container' },
  siblings: [{ tag: 'button', text: "I'm Feeling Lucky" }],
  styles: { backgroundColor: '#f8f9fa', color: '#3c4043', fontSize: '14px' }
};

const localSubtree = mockExtractLocalFocusSubtree(mockFocusTarget);
assert.strictEqual(localSubtree.selector, '#btn-search');
assert.strictEqual(localSubtree.text, 'Google 검색');
assert.strictEqual(localSubtree.parent.id, 'search-buttons-container');
assert.strictEqual(localSubtree.siblings.length, 1);
assert.strictEqual(localSubtree.siblings[0].text, "I'm Feeling Lucky");
console.log('✔ Test 6 (Local Focus Subtree Context Extraction): PASSED');

console.log('\nAll Context-Aware Agent Unit Tests PASSED Successfully! 🎉');
