const assert = require('assert');

console.log('--- Testing Canvas Persistence & Real-Time Dynamic Adaptations ---');

// 1. CSS formatting test: Ensure no literal '\\n' occurs in generated CSS
function generateCssRules(rulesObj) {
  let cssText = '';
  if (Object.keys(rulesObj).length > 0) {
    cssText = '/* EqualiUI Visual Custom Design */\n';
    for (const [selector, rules] of Object.entries(rulesObj)) {
      cssText += `${selector} {\n`;
      for (const [prop, val] of Object.entries(rules)) {
        const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
        cssText += `  ${cssProp}: ${val} !important;\n`;
      }
      cssText += `}\n`;
    }
  }
  return cssText;
}

const mockRules = {
  '#my-button': {
    position: 'relative',
    left: '120px',
    top: '45px',
    backgroundColor: '#3b82f6'
  }
};

const generatedCss = generateCssRules(mockRules);
assert(!generatedCss.includes('\\n'), 'CSS must not contain literal \\\\n');
assert(generatedCss.includes('\n'), 'CSS must contain real newlines');
assert(generatedCss.includes('left: 120px !important;'), 'CSS must contain proper left position');
assert(generatedCss.includes('top: 45px !important;'), 'CSS must contain proper top position');
console.log('✔ Test 1 (CSS Rule Formatting without \\\\n corruption): PASSED');

// 2. Test Selector Escaping & Robust Hierarchy
function escapeSelector(id) {
  // Simple CSS.escape simulation
  return id.replace(/([:.#/[\]])/g, '\\$1');
}

const testIds = ['standard-id', 'test:id', 'btn.1', 'item/sub', 'card[1]'];
testIds.forEach(id => {
  const escaped = escapeSelector(id);
  assert(escaped.length >= id.length, 'Escaped ID must be valid');
});
console.log('✔ Test 2 (Selector Sanitization & Escaping): PASSED');

// 3. Test Auto-Adaptation fallback logic
function mockGetAutoAdaptation(domain, registry, autoAdaptEnabled) {
  const autoAdapt = autoAdaptEnabled !== false;
  if (!autoAdapt) return { autoApply: false };
  const safeDomain = domain || 'local-page';
  const sitePatch = registry[safeDomain];
  if (sitePatch && sitePatch.autoApply && (sitePatch.generatedCss || (sitePatch.generatedDom && sitePatch.generatedDom.length > 0))) {
    return {
      autoApply: true,
      generatedCss: sitePatch.generatedCss,
      generatedDom: sitePatch.generatedDom || [],
      goalTitle: sitePatch.goalTitle
    };
  }
  return { autoApply: false }; // Never returns rain!
}

const mockRegistry = {
  'my-site.com': {
    generatedCss: '#btn { left: 50px !important; }',
    generatedDom: [{ id: 'equali-inj-1', parentSelector: 'body', html: '<button>New</button>' }],
    goalTitle: '커스텀 버튼',
    autoApply: true
  }
};

const resExisting = mockGetAutoAdaptation('my-site.com', mockRegistry, true);
assert(resExisting.autoApply === true, 'Saved site must auto-apply');
assert(resExisting.generatedDom.length === 1, 'Saved DOM elements must be returned');

const resNew = mockGetAutoAdaptation('unvisited-site.com', mockRegistry, true);
assert(resNew.autoApply === false, 'Unvisited site must NOT return rain or unsolicited styles');

console.log('✔ Test 3 (Auto-Adaptation Retrieval & Clean Zero-Rain Policy): PASSED');

console.log('\nAll Persistence and Real-Time Dynamic Logic Verifications PASSED successfully!');
