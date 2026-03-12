# Government Funded Project crawling web

윈도우와 맥에서 모두 실행 가능한 Node.js 기반 웹 앱입니다. 현재 구현된 수집 대상은 아래 채널입니다.

- `K-Startup` 지원사업 공고 오픈 API
- `기업마당` 지원사업 공고 공개 목록/상세 페이지
- `판판대로` 지원사업 목록/상세 AJAX
- `소담상회` 지원사업 목록/상세 AJAX
- `인천 비즈오케이` 지원사업 목록/상세 페이지
- `THE VC` 지원사업 공개 목록

웹에서 필터링하고, 현재 조건 그대로 엑셀(`.xlsx`)로 내려받을 수 있습니다.
이제 공고별 `지원함` 체크도 가능하며, `Supabase`를 연결하면 외부 모바일에서도 같은 체크 상태를 공유할 수 있습니다. 메인 지원사업 목록도 같은 Supabase에 백업되어 배포 서버가 재시작되어도 다시 복원됩니다.

## 실행 방법

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 을 열면 됩니다.

## 외부 배포 구조

현재 앱은 아래 구조를 권장합니다.

- 프론트: `GitHub Pages`
- API/동기화 서버: `Render`, `Railway`, `Fly.io` 같은 Node 호스팅
- 지원 체크 DB: `Supabase`

중요:
- `GitHub Pages`는 정적 파일만 배포할 수 있습니다.
- 따라서 현재 수집/필터 API(`server.js`)는 `GitHub Pages`에 직접 올라가지 않습니다.
- 프론트는 `public/`를 배포하고, `public/config.js`의 `apiBaseUrl`을 외부 Node 서버 주소로 설정해야 합니다.

## 주요 기능

- 통합 공고 수집
- 웹 필터링
  - 키워드
  - 출처
  - 지원분야
  - 지역
  - 주관기관유형
  - 주관기관/수행기관
  - 지원대상
  - 공고일/마감일
  - 모집중 여부
- 엑셀 다운로드
- 수동 재동기화 버튼
- 신규 공고 상단 정렬 및 행 강조
- 공고별 `지원함` 체크
- 모바일 카드 UI

## 동기화

처음 실행 시 데이터가 없으면 자동으로 기본 동기화를 시작합니다.

- 기본 동기화
  - `K-Startup` 전체 공고
  - `기업마당` 진행공고 + 지난공고
  - `판판대로`
  - `소담상회`
  - `인천 비즈오케이`
  - `THE VC` 공개 목록

CLI로만 동기화하려면:

```bash
npm run sync
```

기업마당 지난공고를 제외하려면:

```bash
node server.js --sync-only --exclude-bizinfo-closed
```

## THE VC 전체 수집

`THE VC`는 AWS WAF 사람 인증이 걸려 있어서, 기본 상태에서는 공개 SSR 목록만 수집합니다.

전체 페이지 수집이 필요하면 한 번만 세션을 저장하면 됩니다.

```bash
npm run thevc:setup
```

브라우저에서 사람 인증 또는 로그인을 마친 뒤 Enter를 누르면 `data/thevc-storage.json` 이 저장됩니다.
그 다음부터 동기화는 저장된 세션으로 `THE VC` 내부 API 전체 페이지를 시도하고, 세션이 없거나 막히면 공개 목록으로 자동 폴백합니다.

## 데이터 저장 위치

- 통합 데이터: `data/supports.json` (`Supabase` 연결 시 서버 재시작 대비 백업/복원)
- 캐시: `data/cache/`
- THE VC 세션: `data/thevc-storage.json`

## Supabase 연결

`Supabase`를 연결하면 아래 두 가지가 같이 저장됩니다.

- `지원예정`, `지원완료` 워크플로 데이터
- 메인 지원사업 목록과 마지막 동기화 메타데이터

1. Supabase에서 SQL Editor를 열고 [supabase/schema.sql](/Users/kimjunho/vscode/automatic/supabase/schema.sql)을 실행합니다.
2. [public/config.js](/Users/kimjunho/vscode/automatic/public/config.js)을 열어 값을 채웁니다.

```js
window.APP_CONFIG = {
  apiBaseUrl: 'https://your-node-api.example.com',
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  profileKey: 'junho'
}
```

설명:
- `apiBaseUrl`: 외부에 배포한 현재 Node API 서버 주소
- `supabaseUrl`: Supabase 프로젝트 URL
- `supabaseAnonKey`: Supabase anon public key
- `profileKey`: 체크 상태를 묶는 사용자 키. 개인용이면 임의 문자열 하나로 고정해도 됩니다.

중요:
- 메인 목록 DB 테이블이 추가되었으니 [supabase/schema.sql](/Users/kimjunho/vscode/automatic/supabase/schema.sql)을 최신 버전으로 다시 실행해야 합니다.
- 서버는 `public/config.js`의 `supabaseUrl`, `supabaseAnonKey`를 읽어서 같은 DB를 사용합니다.

## GitHub Pages 배포

프론트 정적 파일은 `public/` 기준으로 배포되도록 [pages.yml](/Users/kimjunho/vscode/automatic/.github/workflows/pages.yml)을 추가해두었습니다.

필수 조건:
- 저장소 기본 브랜치가 `main`
- GitHub Pages가 Actions 배포를 허용하도록 설정
- `public/config.js` 안의 `apiBaseUrl`, `supabaseUrl`, `supabaseAnonKey`, `profileKey` 값 입력

## 외부 API 서버 배포

현재 `server.js`를 Render/Railway/Fly 같은 곳에 그대로 올리면 됩니다.

추천 환경변수:

```bash
PORT=3000
CORS_ORIGIN=https://YOUR_ID.github.io
```

여러 Origin을 허용하려면 쉼표로 구분할 수 있습니다.

## 구현 메모

- 네이티브 DB 의존성을 피하기 위해 JSON 저장소를 사용했습니다.
- `K-Startup`은 공식 JSON API를 사용합니다.
- `기업마당`은 공식 API 사용 시 인증키가 필요하므로 공개 웹 화면을 파싱하도록 구성했습니다.
- `THE VC`는 저장된 브라우저 세션이 있으면 내부 API 전체 페이지 수집을 시도합니다.
- 프론트는 `apiBaseUrl` 설정이 있으면 외부 API를 호출하고, 없으면 현재 호스트의 `/api`를 사용합니다.
