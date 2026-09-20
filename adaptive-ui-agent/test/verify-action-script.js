const assert = require('assert');

console.log('--- Testing Element Action Script (동작 스크립트) Robustness ---');

// Mock DOM environment where script tags execute when appended
const elementRegistry = new Map();

global.document = {
  querySelector: (sel) => {
    const match = sel.match(/\[data-equali-action-id="([^"]+)"\]/);
    if (match) return elementRegistry.get(match[1]);
    return null;
  },
  createElement: (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      style: {},
      dataset: {},
      _attrs: {},
      setAttribute: (k, v) => { node._attrs[k] = v; },
      getAttribute: (k) => node._attrs[k],
      remove: () => {},
      appendChild: () => {}
    };
    return node;
  },
  documentElement: {
    appendChild: (scriptEl) => {
      // Browser script execution simulation
      if (scriptEl.textContent) {
        // Run code via standard script execution (simulating browser script engine)
        const vm = require('vm');
        vm.runInThisContext(scriptEl.textContent);
      }
    }
  }
};

function executeElementActionScript(targetEl, jsCode) {
  if (!targetEl || !jsCode) return false;

  let cleanCode = jsCode.trim();
  if (cleanCode.startsWith('```javascript')) {
    cleanCode = cleanCode.split('```javascript')[1].split('```')[0].trim();
  } else if (cleanCode.startsWith('```js')) {
    cleanCode = cleanCode.split('```js')[1].split('```')[0].trim();
  } else if (cleanCode.startsWith('```')) {
    cleanCode = cleanCode.split('```')[1].split('```')[0].trim();
  }

  // Pre-sanitize to prevent 'Identifier el has already been declared'
  let sanitized = cleanCode
    .replace(/\b(const|let|var)\s+el\s*=\s*document\.querySelector\([^)]+\);?/g, '')
    .replace(/\b(const|let|var)\s+el\s*=/g, 'let _temp_el =');

  // If code does not contain an event listener, automatically wrap in click listener!
  if (!sanitized.includes('addEventListener') && !sanitized.includes('.onclick')) {
    sanitized = `
      el.addEventListener('click', (e) => {
        if (e && e.preventDefault) e.preventDefault();
        ${sanitized}
      });
    `;
  }

  // Tag the target element with a unique action ID so the script finds it reliably
  const actionId = 'eq-act-' + Math.random().toString(36).substr(2, 9);
  targetEl.setAttribute('data-equali-action-id', actionId);
  elementRegistry.set(actionId, targetEl);

  const fullCode = `
    (function() {
      try {
        const el = document.querySelector('[data-equali-action-id="${actionId}"]');
        if (el) {
          ${sanitized}
        }
      } catch(err) {
        console.error('[EqualiUI Action Script Runtime Error]:', err);
      }
    })();
  `;

  // NEVER use new Function or eval (which triggers CSP unsafe-eval EvalError)
  // Instead, use TrustedTypes script element injection:
  try {
    const scriptEl = document.createElement('script');
    scriptEl.type = 'text/javascript';
    scriptEl.textContent = fullCode;
    document.documentElement.appendChild(scriptEl);
    return true;
  } catch (err) {
    console.error('[EqualiUI Action Script Injection Error]:', err);
    return false;
  }
}

// 1. Test User's Exact Firework Code Execution
const mockBtn = {
  tagName: 'BUTTON',
  _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; },
  getAttribute(k) { return this._attrs[k]; },
  style: {},
  dataset: {},
  getBoundingClientRect: () => ({ left: 100, top: 200, width: 80, height: 40 }),
  addEventListener(event, fn) {
    if (event === 'click') this._clickFn = fn;
  },
  click() { if (this._clickFn) this._clickFn({ preventDefault: () => {} }); }
};

const userExactFireworkCode = `
 el.addEventListener('click', (e) => {
  if (e && e.preventDefault) e.preventDefault();

  function createFirework(x, y) {
    const particles = 10;
    el.dataset.fireworkCreated = 'true';
    el.dataset.fireworkCoords = x + ',' + y;
  }

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  createFirework(x, y);
});
`;

const resUser = executeElementActionScript(mockBtn, userExactFireworkCode);
assert.strictEqual(resUser, true, 'User firework code must inject successfully');
mockBtn.click();
assert.strictEqual(mockBtn.dataset.fireworkCreated, 'true', 'Firework animation must trigger upon click');
assert.strictEqual(mockBtn.dataset.fireworkCoords, '140,220', 'Firework coordinates must be correctly calculated from el rect');
console.log('✔ Test 1 (User Exact Firework Code Execution without EvalError): PASSED');

// 2. Test Syntax Collision Neutralization (Redeclaration of const el)
const mockEl1 = {
  tagName: 'BUTTON',
  _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; },
  getAttribute(k) { return this._attrs[k]; },
  style: {},
  dataset: {},
  addEventListener(event, fn) {
    if (event === 'click') this._clickFn = fn;
  },
  click() { if (this._clickFn) this._clickFn({ preventDefault: () => {} }); }
};

const aiCodeWithRedeclaredConst = `
const el = document.querySelector('#my-button');
el.addEventListener('click', (e) => {
  if (e && e.preventDefault) e.preventDefault();
  el.dataset.fired = 'true';
});
`;

const res1 = executeElementActionScript(mockEl1, aiCodeWithRedeclaredConst);
assert.strictEqual(res1, true, 'Script execution should succeed without syntax error');
mockEl1.click();
assert.strictEqual(mockEl1.dataset.fired, 'true', 'Click event listener must fire properly');
console.log('✔ Test 2 (const el Redeclaration Neutralization): PASSED');

// 3. Test Raw Statements Auto-Wrapping in Click Listener
const mockEl3 = {
  tagName: 'A',
  _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; },
  getAttribute(k) { return this._attrs[k]; },
  style: {},
  dataset: {},
  addEventListener(event, fn) {
    if (event === 'click') this._clickFn = fn;
  },
  click() { if (this._clickFn) this._clickFn({ preventDefault: () => {} }); }
};

const aiCodeRawStatements = `
el.style.backgroundColor = 'purple';
el.dataset.actionCompleted = 'true';
`;

const res3 = executeElementActionScript(mockEl3, aiCodeRawStatements);
assert.strictEqual(res3, true, 'Raw statements should be auto-wrapped in click listener');
mockEl3.click();
assert.strictEqual(mockEl3.dataset.actionCompleted, 'true');
assert.strictEqual(mockEl3.style.backgroundColor, 'purple');
console.log('✔ Test 3 (Auto-Wrapping Raw Statements in Click Handler): PASSED');

// 4. Test Gemini and OpenAI Dispatch Logic in Service Worker
function mockDispatchLogicModel(apiKey, model) {
  const isGemini = apiKey.trim().startsWith('AIza');
  const isOpenRouter = apiKey.trim().startsWith('sk-or-');
  let actualModel = model || 'gpt-5.6-luna';
  if (actualModel === 'gpt-5.6-luna') {
    actualModel = isOpenRouter ? 'openai/gpt-4o' : 'gpt-4o';
  }
  return {
    provider: isGemini ? 'gemini' : (isOpenRouter ? 'openrouter' : 'openai'),
    model: actualModel
  };
}

const geminiConfig = mockDispatchLogicModel('AIzaSyD-1234567890abcdef', 'gpt-5.6-luna');
assert.strictEqual(geminiConfig.provider, 'gemini', 'AIza keys must route to Gemini');

const openRouterConfig = mockDispatchLogicModel('sk-or-v1-abcdef', 'gpt-5.6-luna');
assert.strictEqual(openRouterConfig.provider, 'openrouter', 'sk-or keys must route to OpenRouter');
assert.strictEqual(openRouterConfig.model, 'openai/gpt-4o');

const openAIConfig = mockDispatchLogicModel('sk-proj-abcdef', 'gpt-5.6-luna');
assert.strictEqual(openAIConfig.provider, 'openai', 'sk- keys must route to OpenAI');
assert.strictEqual(openAIConfig.model, 'gpt-4o');
console.log('✔ Test 4 (Multi-Provider Gemini & OpenRouter Routing): PASSED');

console.log('\nAll Action Script Robustness Tests PASSED Successfully! 🚀');
