/**
 * .env → shared/env.local.js
 * 크롬 확장은 실행 중에 .env 를 읽을 수 없으므로, 키를 서비스 워커가 읽는 JS 파일로 옮겨 둔다.
 * 시연용이다: 만들어진 파일에는 키가 평문으로 들어가므로 확장 폴더를 남에게 주거나 스토어에 올리지 말 것.
 * 사용: node scripts/load-env.js  (ui-src 의 npm run build 가 먼저 실행한다)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const outPath = path.join(root, 'shared', 'env.local.js');

const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || line.trim().startsWith('#')) continue;
    env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY || env.GEMINI_API_KEY || '';
const model = env.AI_MODEL || '';
// 소리→글자: 따로 적지 않으면 AI_API_KEY 를 그대로 쓴다 (OpenRouter 키면 오디오 입력 모델로 받아쓴다)
const sttKey = env.STT_API_KEY || '';
const sttModel = env.STT_MODEL || '';

fs.writeFileSync(outPath,
  `// 자동 생성 파일 (scripts/load-env.js). 직접 고치지 말고 .env 를 고친 뒤 다시 실행할 것.\n` +
  `self.RECOGNITION_ENV = ${JSON.stringify({ apiKey, model, sttKey, sttModel })};\n`);

console.log(apiKey
  ? `[env] API 키를 shared/env.local.js 에 넣었습니다 (${apiKey.slice(0, 5)}…, ${apiKey.length}자).${model ? ' 모델: ' + model : ''}`
  : `[env] .env 에 AI_API_KEY 가 없습니다. AI 기능은 키 없이 동작하지 않습니다.`);
