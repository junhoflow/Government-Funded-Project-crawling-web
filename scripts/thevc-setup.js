const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { chromium, request } = require('playwright')
const { DEFAULT_STORAGE_STATE_PATH } = require('../src/collectors/thevc')

const STORAGE_STATE_PATH = process.env.THEVC_STORAGE_PATH || DEFAULT_STORAGE_STATE_PATH
const GRANTS_URL = 'https://thevc.kr/grants'
const API_URL = 'https://thevc.kr/api/information/grants/items'

function waitForEnter(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close()
      resolve()
    })
  })
}

function buildApiBody() {
  const timestamp = new Date().toISOString()

  return {
    options: {
      page: 0,
      sort: {
        by: 'registeredAt',
        direction: -1
      }
    },
    search: {
      keyword: null,
      onlyNotExpired: true,
      onlyNotViewedFrom: null,
      onlyNotUninterestedFrom: timestamp,
      onlyNotAppliedFrom: timestamp
    },
    queries: {}
  }
}

async function main() {
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true })

  const browser = await chromium.launch({
    headless: false
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 }
  })
  const page = await context.newPage()

  console.log(`THE VC 세션 설정을 시작합니다.`)
  console.log(`브라우저에서 사람 인증 또는 로그인을 완료한 뒤 Enter를 누르세요.`)
  console.log(`저장 경로: ${STORAGE_STATE_PATH}`)

  await page.goto(GRANTS_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })

  await waitForEnter('완료되면 Enter: ')
  await context.storageState({ path: STORAGE_STATE_PATH })
  await browser.close()

  const api = await request.newContext({
    storageState: STORAGE_STATE_PATH,
    extraHTTPHeaders: {
      accept: 'application/json, text/plain, */*',
      origin: 'https://thevc.kr',
      referer: GRANTS_URL,
      'user-agent': 'Mozilla/5.0'
    }
  })

  try {
    const response = await api.post(API_URL, {
      data: buildApiBody(),
      timeout: 30000
    })

    if (!response.ok()) {
      const wafAction = response.headers()['x-amzn-waf-action']
      throw new Error(`검증 실패: ${response.status()}${wafAction ? ` (${wafAction})` : ''}`)
    }

    const json = await response.json()
    console.log(`THE VC 세션 저장 완료: ${Array.isArray(json.items) ? json.items.length : 0}건 확인`)
  } finally {
    await api.dispose()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
