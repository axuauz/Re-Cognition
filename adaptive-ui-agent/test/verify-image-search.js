const assert = require('assert');

// Simulate the image presets and searchRealImages function from background/service-worker.js
const CURATED_IMAGE_PRESETS = {
  rain: [
    {
      title: "비 내리는 유리창 (Rain on Window Glass)",
      url: "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=1600&q=80",
      previewUrl: "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=320&q=80"
    },
    {
      title: "촉촉한 빗방울 (Dark Rain Drops)",
      url: "https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=1600&q=80",
      previewUrl: "https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=320&q=80"
    },
    {
      title: "도시의 빗길 감성 (City Rain Blur)",
      url: "https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=1600&q=80",
      previewUrl: "https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=320&q=80"
    }
  ],
  night: [
    {
      title: "은하수 밤하늘 (Milky Way Galaxy)",
      url: "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1600&q=80",
      previewUrl: "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=320&q=80"
    }
  ],
  nature: [
    {
      title: "싱그러운 초록 숲 (Emerald Forest)",
      url: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1600&q=80",
      previewUrl: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=320&q=80"
    }
  ]
};

async function searchRealImages(query) {
  if (!query || typeof query !== 'string') return [];
  const cleanQ = query.trim().toLowerCase();
  const results = [];

  // 1. Check thematic presets first
  for (const [key, list] of Object.entries(CURATED_IMAGE_PRESETS)) {
    if (cleanQ.includes(key) ||
        (key === 'rain' && (cleanQ.includes('비') || cleanQ.includes('비오는') || cleanQ.includes('비내리는') || cleanQ.includes('우천'))) ||
        (key === 'night' && (cleanQ.includes('밤') || cleanQ.includes('우주') || cleanQ.includes('별') || cleanQ.includes('어두운'))) ||
        (key === 'nature' && (cleanQ.includes('자연') || cleanQ.includes('숲') || cleanQ.includes('산') || cleanQ.includes('풍경')))) {
      results.push(...list);
    }
  }

  // 2. Query Wikimedia Commons Open API for real live photos
  try {
    const wikiSearchTerm = cleanQ
      .replace(/(배경|이미지|사진|바탕|화면|바꿔줘|추가해줘|해줘|으로|을|를|설정|적용)/g, '')
      .trim() || cleanQ;
    
    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(wikiSearchTerm)}&srnamespace=6&format=json&origin=*`;
    const res = await fetch(searchUrl);
    if (res.ok) {
      const data = await res.json();
      const hits = (data?.query?.search || []).slice(0, 4);
      if (hits.length > 0) {
        const titles = hits.map(h => h.title).join('|');
        const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
        const infoRes = await fetch(infoUrl);
        if (infoRes.ok) {
          const infoData = await infoRes.json();
          const pages = infoData?.query?.pages || {};
          for (const page of Object.values(pages)) {
            const ii = page.imageinfo?.[0];
            if (ii?.url && !ii.url.match(/\.(ogg|ogv|webm|pdf|svg)$/i)) {
              results.push({
                title: page.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''),
                url: ii.url,
                previewUrl: ii.url
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[EqualiUI] Live Wikimedia image search failed:', err.message);
  }

  // Deduplicate results by URL
  const unique = [];
  const seen = new Set();
  for (const item of results) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      unique.push(item);
    }
  }

  return unique.slice(0, 8);
}

async function runTests() {
  console.log('--- Testing Image Search Skill & URL Resolution ---');

  // Test 1: Korean "비 내리는 배경" search
  console.log('Test 1: Search for "비 내리는 배경"');
  const rainImages = await searchRealImages("비 내리는 배경");
  assert(Array.isArray(rainImages), 'Result should be an array');
  assert(rainImages.length > 0, 'Should find at least 1 image for rain query');
  assert(rainImages[0].url.startsWith('http'), 'Image URL should start with http/https');
  assert(!rainImages[0].url.includes('example.com'), 'URL should never contain example.com');
  console.log('  -> Found', rainImages.length, 'images. Top title:', rainImages[0].title);
  console.log('  -> Top URL:', rainImages[0].url);

  // Test 2: Verify HTTP accessibility of the top rain image URL
  console.log('Test 2: Verify HTTP accessibility of top rain image');
  const imgRes = await fetch(rainImages[0].url, { method: 'HEAD' });
  assert(imgRes.status >= 200 && imgRes.status < 400, `Image should be reachable, got HTTP ${imgRes.status}`);
  console.log('  -> Image is HTTP', imgRes.status, 'Accessible!');

  // Test 3: Nature keyword
  console.log('Test 3: Search for "자연 숲"');
  const natureImages = await searchRealImages("자연 숲");
  assert(natureImages.length > 0, 'Should return images for nature');
  assert(!natureImages.some(i => i.url.includes('placeholder')), 'No placeholder URLs allowed');
  console.log('  -> Nature images found:', natureImages.length);

  // Test 4: Post-processing guard against hallucinated placeholder URLs
  console.log('Test 4: Post-processing guard replacing example.com');
  let mockGeneratedCss = `
    body {
      background-image: url('https://example.com/rain.gif') !important;
    }
  `;
  const bestUrl = rainImages[0].url;
  if (/https?:\/\/(example\.com|via\.placeholder\.com)/i.test(mockGeneratedCss)) {
    mockGeneratedCss = mockGeneratedCss.replace(/https?:\/\/(example\.com|via\.placeholder\.com)[^'")\s]*/gi, bestUrl);
  }
  assert(!mockGeneratedCss.includes('example.com'), 'example.com should be replaced');
  assert(mockGeneratedCss.includes(bestUrl), 'Should include verified bestUrl');
  console.log('  -> Successfully replaced hallucinated URL with real URL in CSS');

  console.log('\nAll 4 Image Search tests PASSED successfully! ✨\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
