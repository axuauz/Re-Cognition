# Re-Cognition

Re:Cognition은 웹 페이지를 사용자 맞춤형으로 재구성해 접근성을 개선하는 Chrome 확장 프로그램입니다.

## Chrome 확장 프로그램 추가 방법

다음 절차로 로컬 개발용 확장 프로그램을 Chrome에 추가할 수 있습니다.

1. 이 저장소를 로컬에 다운로드 또는 클론합니다.
2. Chrome 브라우저에서 `chrome://extensions` 로 이동합니다.
3. 우측 상단의 `개발자 모드` 를 켭니다.
4. `압축해제된 확장 프로그램을 로드` 버튼을 클릭합니다.
5. 프로젝트 폴더 안에서 아래 경로를 선택합니다.
   - `adaptive-ui-agent`
6. 선택 후 확장 프로그램이 Chrome에 등록됩니다.
7. 확장 프로그램 아이콘을 클릭하거나 사이드 패널을 열어 사용합니다.

## 로컬 실행 준비

확장 기능이 정상 동작하려면 환경 변수를 먼저 설정해야 합니다.

```bash
cd adaptive-ui-agent
cp .env.example .env
node scripts/load-env.js
```

그다음 Chrome에서 확장 카드의 새로고침 버튼을 눌러 수정 사항을 반영합니다.

## 개발용 실행

```bash
cd adaptive-ui-agent/ui-src
npm install
npm run build
```

개발 중에는 다음 명령으로 빌드를 반복할 수 있습니다.

```bash
cd adaptive-ui-agent/ui-src
npm run dev
```

## 참고

- 확장 프로그램의 매니페스트 파일: `adaptive-ui-agent/manifest.json`
- 메인 문서: `adaptive-ui-agent/README.md`
- 수정 후에는 Chrome 확장 프로그램 카드에서 새로고침을 눌러야 반영됩니다.
