// EqualiUI 확장 페이지(사이드패널·팝업·새 탭)는 ui-src/ (React + shadcn/ui) 에서 빌드된 결과물이다.
// id 짝 맞추기 대신 "빌드가 있고, HTML 이 가리키는 파일이 실제로 존재하며, MV3 CSP 를 어기는 인라인 스크립트가 없는지"를 본다.
const fs = require('fs');

for (const page of ['sidepanel', 'popup', 'newtab']) {
  const html = fs.readFileSync(`pages/${page}.html`, 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map(m => m[1]);
  if (assets.length < 2) throw new Error(`pages/${page}.html 에 빌드된 JS/CSS 가 없습니다. ui-src 에서 npm run build 를 실행하세요.`);
  assets.forEach(file => { if (!fs.existsSync(`pages/${file}`)) throw new Error(`Missing build asset for ${page}: ${file}`); });
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error(`pages/${page}.html 에 인라인 스크립트가 있습니다 (MV3 CSP 위반).`);
  console.log(`✔ ${page}: ${assets.length} assets exist, no inline scripts`);
}

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.content_scripts[0].js.concat(manifest.content_scripts[0].css, [manifest.side_panel.default_path, manifest.action.default_popup, manifest.chrome_url_overrides.newtab, manifest.background.service_worker])
  .forEach(file => { if (!fs.existsSync(file)) throw new Error(`manifest 가 가리키는 파일이 없습니다: ${file}`); });
console.log('✔ Every file referenced by manifest.json exists');
