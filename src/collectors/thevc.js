const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const { request } = require('playwright')
const vm = require('vm')
const { compactObject, formatDateTime, isOngoingFromDates } = require('../lib/utils')

const URL = 'https://thevc.kr/grants'
const API_URL = 'https://thevc.kr/api/information/grants/items'
const DEFAULT_STORAGE_STATE_PATH = path.join(process.cwd(), 'data', 'thevc-storage.json')

function decodeNuxtData(root) {
  const seen = new Map()

  function inner(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < root.length) {
      if (seen.has(value)) {
        return seen.get(value)
      }

      const raw = root[value]

      if (Array.isArray(raw)) {
        if (raw[0] === 'Ref' || raw[0] === 'Reactive' || raw[0] === 'ShallowReactive') {
          return inner(raw[1])
        }

        if (raw[0] === 'EmptyRef' || raw[0] === 'EmptyShallowRef') {
          return null
        }

        const array = []
        seen.set(value, array)

        raw.forEach((item) => {
          array.push(inner(item))
        })

        return array
      }

      if (raw && typeof raw === 'object') {
        const object = {}
        seen.set(value, object)

        Object.entries(raw).forEach(([key, nestedValue]) => {
          object[inner(key)] = inner(nestedValue)
        })

        return object
      }

      return raw
    }

    if (Array.isArray(value)) {
      if (value[0] === 'Ref' || value[0] === 'Reactive' || value[0] === 'ShallowReactive') {
        return inner(value[1])
      }

      if (value[0] === 'EmptyRef' || value[0] === 'EmptyShallowRef') {
        return null
      }

      return value.map(inner)
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [inner(key), inner(nestedValue)]))
    }

    return value
  }

  return inner(0)
}

function normalizeItem(item, sourceStatus = '공개목록') {
  const managingOrg = item.managingOrganization || {}
  const supportFund = item.supportFund || {}
  const careerYear = item.eligibleCareerYear || {}
  const detailUrl = `https://thevc.kr/grants/${item._id}`
  const summary = Array.isArray(item.details) ? item.details.join(' ') : ''
  const applyStart = item.startedAt ? item.startedAt.slice(0, 10) : ''
  const applyEnd = item.expiredAt ? item.expiredAt.slice(0, 10) : ''
  const postedAt = item.registeredAt ? item.registeredAt.slice(0, 10) : ''
  const attachments = (item.attachedFiles || []).map((file) =>
    compactObject({
      name: file.name,
      url: file.downloadUrl || file.url || file.previewUrl
    })
  )

  return compactObject({
    id: `thevc:${item._id}`,
    sourceKey: 'thevc',
    source: 'THE VC',
    sourceId: item._id,
    title: item.title,
    summary,
    content: [
      Array.isArray(item.eligibilities) ? item.eligibilities.join('\n') : '',
      Array.isArray(item.ineligibilities) ? item.ineligibilities.join('\n') : '',
      Array.isArray(item.details) ? item.details.join('\n') : ''
    ]
      .filter(Boolean)
      .join('\n\n'),
    category: item.business,
    region: managingOrg.district ? [managingOrg.district.parent, managingOrg.district.child].filter(Boolean).join(' ') : '',
    managingOrg: managingOrg.name,
    supervisingInstitutionType: managingOrg.type,
    applyTarget: Array.isArray(item.eligibilities) ? item.eligibilities.join(' | ') : '',
    experience:
      careerYear.min !== undefined || careerYear.max !== undefined
        ? [careerYear.min !== undefined ? `${careerYear.min}년` : '', careerYear.max !== undefined ? `${careerYear.max}년` : '']
            .filter(Boolean)
            .join(' ~ ')
        : '',
    preferred: '',
    applicantExclusion: Array.isArray(item.ineligibilities) ? item.ineligibilities.join(' | ') : '',
    applyStart,
    applyEnd,
    applyPeriodText: [applyStart, applyEnd].filter(Boolean).join(' ~ '),
    postedAt,
    isOngoing: isOngoingFromDates(applyStart, applyEnd),
    detailUrl,
    originUrl: item.noticeUrl || detailUrl,
    applicationUrl: item.noticeUrl || detailUrl,
    attachments,
    tags: [item.business, managingOrg.type].filter(Boolean),
    collectedAt: formatDateTime(),
    supportAmount:
      supportFund.min !== undefined || supportFund.max !== undefined
        ? [supportFund.min, supportFund.max].filter((value) => value !== undefined && value !== null).join(' ~ ')
        : '',
    sourceStatus,
    searchText: [
      item.title,
      summary,
      item.business,
      managingOrg.name,
      Array.isArray(item.eligibilities) ? item.eligibilities.join(' ') : '',
      Array.isArray(item.ineligibilities) ? item.ineligibilities.join(' ') : ''
    ]
      .filter(Boolean)
      .join(' ')
  })
}

function extractPublicItems(html) {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)

  if (!match) {
    throw new Error('THE VC 페이지에서 공개 데이터를 찾지 못했습니다.')
  }

  const serialized = vm.runInNewContext(match[1])
  const decoded = decodeNuxtData(serialized)
  const grantStore = (((decoded || {}).pinia || {}).grant || {})
  const rawItems = grantStore._items
  const items = Array.isArray(rawItems) && Array.isArray(rawItems[1]) ? rawItems[1] : []

  return {
    items,
    stats: grantStore._meta || null
  }
}

function buildApiBody(page, timestamp) {
  return {
    options: {
      page,
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

async function fetchApiPage(api, page, timestamp) {
  const response = await api.post(API_URL, {
    data: buildApiBody(page, timestamp),
    timeout: 30000
  })

  if (!response.ok()) {
    const wafAction = response.headers()['x-amzn-waf-action']
    throw new Error(`THE VC API 요청 실패: ${response.status()}${wafAction ? ` (${wafAction})` : ''}`)
  }

  const json = await response.json()

  if (!json || !Array.isArray(json.items)) {
    throw new Error('THE VC API 응답 형식이 예상과 다릅니다.')
  }

  return json
}

async function collectWithSession(storageStatePath, onProgress) {
  if (!fs.existsSync(storageStatePath)) {
    return null
  }

  const timestamp = new Date().toISOString()
  const api = await request.newContext({
    storageState: storageStatePath,
    extraHTTPHeaders: {
      accept: 'application/json, text/plain, */*',
      origin: 'https://thevc.kr',
      referer: URL,
      'user-agent': 'Mozilla/5.0'
    }
  })

  try {
    onProgress({
      stage: 'thevc',
      message: 'THE VC 세션 수집 시작'
    })

    const firstPage = await fetchApiPage(api, 0, timestamp)
    const totalPages = Number(firstPage.stats && firstPage.stats.pageCount) || 1
    const rawItems = [...firstPage.items]

    onProgress({
      stage: 'thevc',
      message: `THE VC 세션 목록 1/${totalPages}페이지 완료`
    })

    for (let page = 1; page < totalPages; page += 1) {
      const nextPage = await fetchApiPage(api, page, timestamp)
      rawItems.push(...nextPage.items)
      onProgress({
        stage: 'thevc',
        message: `THE VC 세션 목록 ${page + 1}/${totalPages}페이지 완료`
      })
    }

    const deduped = Array.from(new Map(rawItems.map((item) => [item._id, item])).values()).map((item) =>
      normalizeItem(item, '세션수집')
    )

    onProgress({
      stage: 'thevc',
      phase: 'done',
      current: 1,
      total: 1,
      message: `THE VC 세션 수집 ${deduped.length}건 정규화 완료`
    })

    return deduped
  } finally {
    await api.dispose()
  }
}

async function collectPublicList(onProgress) {
  onProgress({
    stage: 'thevc',
    message: 'THE VC 공개 목록 조회 중'
  })

  const response = await fetch(URL, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'text/html,application/xhtml+xml'
    },
    timeout: 30000
  })

  if (!response.ok) {
    throw new Error(`THE VC 요청 실패: ${response.status}`)
  }

  const html = await response.text()
  const { items } = extractPublicItems(html)
  const normalized = items.map((item) => normalizeItem(item, '공개목록'))

  onProgress({
    stage: 'thevc',
    phase: 'done',
    current: 1,
    total: 1,
    message: `THE VC 공개 목록 ${normalized.length}건 정규화 완료`
  })

  return normalized
}

async function collectTheVc(onProgress = () => {}) {
  const storageStatePath = process.env.THEVC_STORAGE_PATH || DEFAULT_STORAGE_STATE_PATH

  try {
    const sessionItems = await collectWithSession(storageStatePath, onProgress)

    if (sessionItems && sessionItems.length > 0) {
      return sessionItems
    }
  } catch (error) {
    onProgress({
      stage: 'thevc',
      message: `THE VC 세션 수집 실패, 공개 목록으로 전환: ${error.message}`
    })
  }

  try {
    return await collectPublicList(onProgress)
  } catch (error) {
    onProgress({
      stage: 'thevc',
      phase: 'done',
      current: 1,
      total: 1,
      message: `THE VC 수집 건너뜀: ${error.message}`
    })
    return []
  }
}

module.exports = {
  collectTheVc,
  DEFAULT_STORAGE_STATE_PATH
}
