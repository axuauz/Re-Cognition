# EqualiUI 확장 페이지 UI (React + shadcn/ui)

확장 프로그램 **자체 페이지**(사이드패널 · 팝업 · 새 탭)의 소스입니다. 웹페이지 안에 띄우는 UI(검토 카드·배너 등)는
사이트 CSS 와 섞이면 안 되므로 여기로 옮기지 않고 `content/` 에 Shadow DOM 으로 둡니다.

## 빌드

```bash
cd ui-src
npm install        # 처음 한 번
npm run build      # 타입 검사 후 ../pages/ 로 빌드 (sidepanel.html, popup.html, newtab.html + 공용 assets)
npm run dev        # 저장할 때마다 다시 빌드 (chrome://extensions 에서 확장 새로고침 필요)
```

Chrome 에는 지금까지처럼 **저장소 루트 폴더**를 로드합니다. `pages/` 는 빌드 결과물이므로 직접 고치지 마세요.
이전 순수 JS 버전은 `sidepanel-legacy/`, `popup-legacy/`, `newtab-legacy/` 에 남겨 두었습니다. 되돌리려면 `manifest.json` 의
`side_panel.default_path` / `action.default_popup` / `chrome_url_overrides.newtab` 을 해당 폴더의 html 로 바꾸면 됩니다.

| 페이지 | 진입점 | 화면 |
|---|---|---|
| 사이드패널 | `sidepanel.html` → `src/main.tsx` | `src/App.tsx` |
| 팝업 | `popup.html` → `src/popup.tsx` | `src/features/Popup.tsx` (추천 + `ChatTab` 의 popup 변형) |
| 새 탭 | `newtab.html` → `src/newtab.tsx` | `src/features/NewTab.tsx` |

## 브라우저에서 단독 확인

`python3 -m http.server 8765` (저장소 루트에서) → `http://localhost:8765/test/pages-harness.html?page=sidepanel|popup|newtab`
- `?theme=contrast&size=xlarge` 보기 설정, `?traits=저시력,난독증` 특성 메모, `?restricted=1` 바꿀 수 없는 페이지, `?risk=low|medium|high` 검토 카드 위험도, `?norec=1` 팝업 추천 없음

## 접근성 기준 (shadcn 기본값에서 바꾼 것)

- 색·크기 토큰: `src/index.css` — 본문 대비 7:1, 보조 글자 4.5:1, 테두리·포커스 3:1, 고대비 테마 별도
- 누르는 대상 44px 이상: `components/ui/button.tsx`(min-h-11), `input`/`select`(h-11), `checkbox`(24px)
- 세 페이지가 같은 "보기 설정"(글자 크기·화면 색·간격)을 씀: `hooks/useViewPrefs.ts`. 직접 고른 값이 없으면 특성 메모에서 기본값을 끌어냄(`lib/viewPrefs.ts`). rem 기반이라 전체가 함께 커짐
- shadcn 컴포넌트를 CLI 로 추가하면 `import { cn } from "cn"` 으로 잘못 생성될 수 있음 → `@/lib/utils` 로 고칠 것
