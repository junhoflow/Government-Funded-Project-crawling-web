# Government Funded Project crawling web

윈도우와 맥에서 모두 실행 가능한 정부지원사업 통합 수집 웹입니다. 현재 구현된 수집 대상은 아래 채널입니다.

- `K-Startup` 지원사업 공고 오픈 API
- `기업마당` 지원사업 공고 공개 목록/상세 페이지
- `판판대로` 지원사업 목록/상세 AJAX
- `소담상회` 지원사업 목록/상세 AJAX
- `인천 비즈오케이` 지원사업 목록/상세 페이지
- `THE VC` 지원사업 공개 목록

웹에서 필터링하고, 현재 조건 그대로 CSV로 내려받을 수 있습니다.
공고별 `지원예정`, `지원완료` 저장도 가능하며, `Supabase`를 연결하면 외부 모바일에서도 같은 상태를 공유할 수 있습니다.

## 실행 방법

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 을 열면 됩니다.

## 외부 배포 구조

현재 앱은 아래 구조를 권장합니다.

- 프론트: `GitHub Pages`
- 동기화: `GitHub Actions` 스케줄
- 저장: `Supabase`

중요:
- `GitHub Pages`는 정적 파일만 배포할 수 있습니다.
- 배포 웹은 `server.js` 없이 `Supabase`를 직접 조회합니다.
- 정적 프론트는 `public/`만 배포하면 됩니다.
- 정기 동기화는 GitHub Actions가 실행해서 `Supabase`를 갱신합니다.

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
- CSV 다운로드
- 웹에서 바로 동기화 요청
- 신규 공고 상단 정렬 및 행 강조
- 공고별 `지원예정`, `지원완료` 저장
- 모바일 카드 UI

## 동기화

정기 동기화는 GitHub Actions가 수행합니다.

기본 스케줄 기준:
- `K-Startup`
- `기업마당` 진행공고
- `판판대로`
- `소담상회`
- `인천 비즈오케이`

GitHub Actions에서 실행하는 명령:

```bash
npm run sync:supabase
```

참고:
- 스케줄 동기화에서는 속도와 안정성 때문에 `기업마당 지난공고`, `THE VC`를 기본 제외했습니다.
- `THE VC`는 필요할 때 로컬 또는 별도 수동 작업으로만 돌리는 것을 권장합니다.

로컬에서 서버 기반 전체 동기화를 시험하려면:

```bash
npm run sync
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

- 통합 데이터 임시 캐시: `data/supports.json`
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
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  syncFunctionUrl: 'https://YOUR_PROJECT.supabase.co/functions/v1/trigger-sync',
  syncWorkflowUrl: 'https://github.com/YOUR_ID/YOUR_REPO/actions/workflows/daily-sync.yml',
  profileKey: 'junho'
}
```

설명:
- `supabaseUrl`: Supabase 프로젝트 URL
- `supabaseAnonKey`: Supabase anon public key
- `syncFunctionUrl`: 웹의 동기화 버튼이 호출할 Supabase Edge Function URL
- `syncWorkflowUrl`: Edge Function이 없을 때 열어둘 GitHub Actions URL
- `profileKey`: 체크 상태를 묶는 사용자 키. 개인용이면 임의 문자열 하나로 고정해도 됩니다.

중요:
- 메인 목록용 `support_announcements`, `support_state`와 워크플로용 `applied_announcements`가 모두 이 스키마에 포함되어 있습니다.
- 최신 버전으로 다시 실행해서 `support_announcements_deduped` 뷰까지 생성해야 합니다.

## GitHub Pages 배포

프론트 정적 파일은 `public/` 기준으로 배포되도록 [pages.yml](/Users/kimjunho/vscode/automatic/.github/workflows/pages.yml)을 추가해두었습니다.

필수 조건:
- 저장소 기본 브랜치가 `main`
- GitHub Pages가 Actions 배포를 허용하도록 설정
- `public/config.js` 안의 `supabaseUrl`, `supabaseAnonKey`, `syncWorkflowUrl`, `profileKey` 값 입력

## GitHub Actions 동기화 설정

[daily-sync.yml](/Users/kimjunho/vscode/automatic/.github/workflows/daily-sync.yml)은 GitHub Actions에서 수집 후 Supabase에 저장합니다.

저장소 `Settings > Secrets and variables > Actions`에 아래 secret을 추가해야 합니다.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_ANON_KEY`

## Supabase Edge Function 동기화 버튼 연결

웹에서 `지금 동기화` 버튼을 눌렀을 때 바로 GitHub Actions를 실행하려면 `trigger-sync` Edge Function도 배포해야 합니다.

파일:
- [supabase/functions/trigger-sync/index.ts](/Users/kimjunho/vscode/automatic/supabase/functions/trigger-sync/index.ts)

필요한 Supabase Edge Function secret:
- `GITHUB_TRIGGER_TOKEN`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_WORKFLOW_ID`
- `GITHUB_REF`

예시:
- `GITHUB_REPO_OWNER=junhoflow`
- `GITHUB_REPO_NAME=Government-Funded-Project-crawling-web`
- `GITHUB_WORKFLOW_ID=daily-sync.yml`
- `GITHUB_REF=main`

`GITHUB_TRIGGER_TOKEN`은 GitHub workflow dispatch 권한이 있는 토큰이어야 합니다.

배포 예시:

```bash
supabase functions deploy trigger-sync
supabase secrets set \
  GITHUB_TRIGGER_TOKEN=YOUR_GITHUB_TOKEN \
  GITHUB_REPO_OWNER=junhoflow \
  GITHUB_REPO_NAME=Government-Funded-Project-crawling-web \
  GITHUB_WORKFLOW_ID=daily-sync.yml \
  GITHUB_REF=main
```

## 구현 메모

- 네이티브 DB 의존성을 피하기 위해 JSON 저장소를 사용했습니다.
- `K-Startup`은 공식 JSON API를 사용합니다.
- `기업마당`은 공식 API 사용 시 인증키가 필요하므로 공개 웹 화면을 파싱하도록 구성했습니다.
- `THE VC`는 저장된 브라우저 세션이 있으면 내부 API 전체 페이지 수집을 시도합니다.
- 배포 프론트는 Supabase를 직접 읽고, GitHub Actions가 동기화된 결과를 갱신합니다.
