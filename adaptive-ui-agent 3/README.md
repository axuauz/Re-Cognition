# Re:Cognition

사용자(페르소나)에 맞춰 웹페이지를 쉬운 화면·소리 중심 화면으로 다시 구성하는 Human-in-the-Loop 접근성 에이전트. Chrome 확장(Manifest V3), SDGs 10(불평등 해소) 대회 시연용.

## 이름에 대하여 — 꼭 읽어 주세요

| 어디에 | 쓰는 이름 |
|---|---|
| 사용자에게 보이는 이름 (발표 자료, 디자인 시안, 화면의 글자 로고) | **Re:Cognition** |
| 코드 안의 식별자 | **Equali\*** (이전 이름 EqualiUI 그대로) |

프로그램의 정식 이름은 **Re:Cognition** 입니다. 다만 코드 안에는 이전 이름인 EqualiUI 에서 온 식별자가 그대로 남아 있고, **의도적으로 바꾸지 않았습니다.**

- 전역 모듈: `EqualiSafety`, `EqualiPersona`, `EqualiViewPrefs`, `EqualiRecommender` …
- 페이지에 넣는 요소·클래스: `equali-ui-host`, `equali-btn-primary`, `#equali-…`
- 콘솔 로그 머리말: `[EqualiUI]`

이 이름들은 테스트(`test/verify-*.js`), 저장된 사이트별 맞춤 화면, content script 와 서비스 워커 사이의 약속에 묶여 있어서, 바꾸면 얻는 것 없이 깨질 곳만 많습니다. **코드에서 `Equali` 를 보면 "Re:Cognition 의 내부 이름"으로 읽으면 됩니다.**

> 화면에 보이는 이름(확장 이름, 사이드 패널·팝업·새 탭, 페이지 안 배지와 안내 문구)은 Re:Cognition 으로 바꿨습니다. 스토어 등록용 문서(`CHROMEWEBSTORE.md`)는 시연용이라 지웠습니다 (git 기록에 남아 있습니다).

## 빠른 시작

```bash
cp .env.example .env          # 1. .env 를 만들고 AI_API_KEY 를 넣는다
node scripts/load-env.js      # 2. 키를 확장이 읽는 파일(shared/env.local.js)로 옮긴다
```

3. Chrome 에서 `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드** → 이 폴더 선택
4. 코드나 `.env` 를 바꾼 뒤에는 확장 카드의 **새로고침(↻)** 을 꼭 누르고, 열려 있던 웹페이지도 새로고침

### API 키 (.env)

```
AI_API_KEY=sk-...        # OpenAI(sk-), OpenRouter(sk-or-), Gemini(AIza) 모두 가능
AI_MODEL=                # 선택. 비우면 설정 탭에서 고른 모델
```

- 키를 입력하는 화면은 없습니다. `.env` 가 유일한 입력처입니다.
- 크롬 확장은 실행 중에 `.env` 를 읽지 못하므로 `scripts/load-env.js` 가 `shared/env.local.js` 를 만들고, 서비스 워커가 그 파일을 읽습니다. **`.env` 를 고치면 스크립트를 다시 실행하고 확장을 새로고침**해야 반영됩니다. (`ui-src` 의 `npm run build` 는 이 스크립트를 먼저 실행합니다.)
- 소리→글자(자막)는 어떤 키로도 동작합니다. OpenAI 키는 Whisper, Gemini 키는 Gemini 로 받아쓰고, **OpenRouter 키는 받아쓰기 전용 API 가 없어서 오디오 입력을 받는 모델(기본 `google/gemini-3.5-flash-lite`)에게 받아쓰게 합니다.** 5초 구간을 16kHz WAV 로 바꿔 보내며, 조용한 구간은 보내지 않습니다. 자막용 키·모델을 따로 쓰려면 `.env` 에 `STT_API_KEY`, `STT_MODEL` 을 적습니다.

> **경고 — 시연 전용 방식입니다.** `shared/env.local.js` 에는 키가 평문으로 들어갑니다. 이 폴더를 압축해서 남에게 주거나 크롬 웹스토어에 올리면 키가 그대로 유출됩니다. `.env` 와 `shared/env.local.js` 는 `.gitignore` 에 들어 있습니다.

## 어떻게 동작하나

팀 시스템 구조도의 세 단계를 그대로 따릅니다.

1. **특징 인식** — `shared/profile.js` 가 관측(확대, 되읽기, 망설임 등)에서 숙련도·인지 스타일·필요·상황을 추론합니다. 근거와 신뢰도를 함께 보여 주고, 사용자가 언제든 고칠 수 있습니다. `shared/persona.js` 가 페르소나에 따라 방식을 정합니다: `rebuild`(쉬운 화면으로 다시 구성) · `audio`(소리 중심) · `restyle`(모양만 조정).
2. **제안** — `content/extractor.js` 가 페이지를 읽고, AI 가 전략이 다른 후보 3개를 만들면, 각각 안전 감사(`shared/safety.js`)와 실제 페이지 측정을 거쳐 `shared/selection.js`·`shared/layout.js` 가 채점해 1위를 제안합니다. 화면은 `content/rebuild.js`(전체 화면 재구성) 또는 `content/parts.js`(정해진 부품 8종)가 closed Shadow DOM 안에 그립니다.
3. **대안 제안** — 거절·이탈·망설임·빠른 복구가 보이면 `shared/alternatives.js` 가 원인을 추론해 다른 형태의 대안을 최대 2회 제안합니다.

**사람 승인이 최우선입니다.** 모든 제안은 검토 카드에서 승인하기 전까지 페이지에 적용되거나 저장되지 않습니다. 외부 전송·페이지 이동·양식 제출·쿠키 접근 코드는 차단되고, 기존 버튼의 기능이나 문구를 바꾸는 변경은 경고로 표시됩니다. `Alt+Z` 는 언제든 원래 화면으로 되돌립니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `background/service-worker.js` | AI 호출, 후보 생성·채점, 메시지 처리 |
| `content/` | 페이지 안에서 도는 코드: 추출, 검증, 검토 카드, 재구성 화면, 부품 |
| `shared/` | 서비스 워커·content script·테스트가 함께 쓰는 순수 로직 (안전 감사, 프로필, 선택, 대안, 레이아웃, 보기 설정) |
| `offscreen/` | 탭 소리를 글자로 바꾸는 offscreen 문서 |
| `ui-src/` | 사이드 패널·팝업·새 탭의 소스 (Vite + React + Tailwind v4 + shadcn) |
| `pages/` | `ui-src` 의 **빌드 결과물 — 직접 고치지 말 것** |
| `*-legacy/` | 이전 순수 JS 버전의 사이드 패널·팝업·새 탭 (참고용) |
| `test/` | 검증 스크립트와 브라우저 확인용 하네스 |
| `scripts/` | `load-env.js`(키 주입), `generate-icons.js` |

## 개발

```bash
cd ui-src && npm install
npm run build        # .env 주입 → 타입 검사 → ../pages 로 빌드
npm run dev          # 저장할 때마다 다시 빌드
```

테스트 (저장소 루트에서):

```bash
for f in test/verify-*.js test/test-runner.js; do node "$f" || break; done
```

브라우저에서 확인할 때는 `chrome.*` 를 흉내 내는 하네스를 http 서버로 띄웁니다.

- `test/hitl-harness.html` — 요청 → 검토 카드 → 승인 흐름 (`?fast=1` 로 긴 타이머 단축)
- `test/pages-harness.html?page=sidepanel|popup|newtab` — 확장 자체 페이지

## 디자인

확정된 방향은 Kiln 디자인 시스템(따뜻한 크림색 바탕, 주황 강조색 하나, IBM Plex Sans + JetBrains Mono, 모서리 16px 이하)을 따르며, 시안은 Claude Design 캔버스 "Re:Cognition 확장 화면 디자인"에 있습니다. 글자 로고는 `Re:Cognition` 이고 콜론만 주황색입니다. 코드에는 `ui-src/src/index.css`(색·모서리·글꼴 토큰, 글꼴은 `@fontsource` 로 함께 묶어 오프라인에서도 동작), `ui-src/src/components/Wordmark.tsx`, 사이드 패널·팝업·새 탭 화면, 페이지 안 UI 의 색 토큰(`content/ui-css.js`)에 반영했습니다. 검토 카드(후보 선택 칸 · 고정폭 측정값 · 거절은 글자 버튼), 특성 탭(메모 칩 · 근거 문장), 설정 탭(라디오 목록), 팝업(한 줄 추천)도 시안의 배치를 따릅니다. 사이트 탭은 시안이 없어 토큰만 적용됐습니다.

## 알려진 한계

- v2.0.0 의 전체 화면 재구성(`content/rebuild.js`)은 자동 테스트로만 확인했고, 실제 사이트에서의 확인이 더 필요합니다.
- 캔버스 에디터 경로(`SAVE_VISUAL_DESIGN`, `GENERATE_ELEMENT_LOGIC`)는 정해진 부품이 아니라 자유 HTML/JS 를 씁니다. 기본은 꺼져 있고 설정 탭에서 켜야 보입니다.
- 이용 환경은 브라우저가 알려 주는 값(다크 모드·동작 줄이기·고대비·터치 여부·확대 배율·화면 너비·언어)만 수집합니다. 기기 종류나 보조기기(스크린리더) 사용 여부는 알 수 없습니다.
- 재구성 화면의 암묵 신호(이탈·망설임·조작 오류)와 다른 형태 보기(글로만 · 하나씩)는 테스트 하네스에서만 확인했습니다. 망설임 기준(30초)과 이탈 기준(12초)은 실제 사용자로 맞춰 본 값이 아닙니다.
- 구조도의 "학습 반영"은 인지 스타일(내용의 양 · 안내 방식 · 선호 형태)까지만 바꾸고, 숙련도 추론은 바꾸지 않습니다.
