const { fetchJson } = require('../lib/http')
const { compactObject, formatDateTime, isOngoingFromDates, mapConcurrent, parseDate, stripHtml } = require('../lib/utils')

const DEFAULT_LIST_URL = 'https://fanfandaero.kr/portal/v2/selectSprtBizPbancList.do'
const DETAIL_SUMMARY_URL = 'https://fanfandaero.kr/portal/v2/selectSprtBizPbancDetailSummaryList.do'
const DETAIL_INFO_URL = 'https://fanfandaero.kr/portal/selectSprtBizPbancDetailInfoList.do'
const PAGE_UNIT = 50

function buildFormBody(params) {
  const body = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return
    }

    body.append(key, String(value))
  })

  return body.toString()
}

function buildRequestOptions(body, referer) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
      referer,
      'user-agent': 'Mozilla/5.0'
    },
    body
  }
}

function buildDetailUrl(item) {
  const url = new URL('https://fanfandaero.kr/portal/v2/preSprtBizPbancDetail.do')
  url.searchParams.set('sprtBizCd', item.sprtBizCd)
  url.searchParams.set('sprtBizTrgtYn', item.sprtBizTrgtCd === '10003211' ? 'Y' : 'N')
  url.searchParams.set('groupNo', item.groupNo || '')
  return url.toString()
}

function normalizeListItem(item, sourceKey, sourceName) {
  const applyStart = parseDate(item.rcritBgngYmd)
  const applyEnd = item.rcritEndChk === 'Y' ? null : parseDate(item.rcritEndYmd)
  const postedAt = parseDate(item.pbancRlsBgngYmd)
  const region = item.sprtBizCtpvNm || ''
  const detailUrl = buildDetailUrl(item)
  const summary = stripHtml(item.txtDc || '')
  const searchText = [
    item.sprtBizNm,
    summary,
    item.sprtBizTyNm,
    item.sprtBizTrgtNm,
    region
  ]
    .filter(Boolean)
    .join(' ')

  return compactObject({
    id: `${sourceKey}:${item.sprtBizCd}`,
    sourceKey,
    source: sourceName,
    sourceId: String(item.sprtBizCd),
    title: stripHtml(item.sprtBizNm || ''),
    summary,
    content: summary,
    category: item.sprtBizTyNm,
    region,
    applyTarget: item.sprtBizTrgtNm,
    applyStart,
    applyEnd,
    applyPeriodText: applyEnd ? `${applyStart} ~ ${applyEnd}` : applyStart ? `${applyStart} ~ 예산소진시까지` : '',
    postedAt,
    isOngoing:
      item.aplyPsblYn === 'Y' ||
      item.aplyDdlnYn !== 'Y' ||
      isOngoingFromDates(applyStart, applyEnd),
    detailUrl,
    originUrl: detailUrl,
    applicationUrl: detailUrl,
    attachments: [],
    tags: [],
    collectedAt: formatDateTime(),
    sourceStatus: item.aplyPsblYn,
    searchText
  })
}

function itemText(item) {
  if (!item) {
    return ''
  }

  if (item.itemSe === '1' || item.itemSe === '2') {
    return stripHtml(item.txtDc || '')
  }

  if (item.itemSe === '4') {
    const start = parseDate(item.itemBgngYmd)
    const end = parseDate(item.itemEndYmd)
    return [start, end].filter(Boolean).join(' ~ ')
  }

  if (item.itemSe === '5' && Array.isArray(item.spinPbPdDList)) {
    return item.spinPbPdDList
      .map((step) => [step.itemBgngYmd, step.itemEndYmd, step.txtDc].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' | ')
  }

  return ''
}

function readFirstMatchingText(sections, patterns) {
  for (const section of sections) {
    for (const item of section.items) {
      const key = `${section.name} ${item.name}`.replace(/\s+/g, ' ').trim()

      if (patterns.some((pattern) => pattern.test(key))) {
        const text = itemText(item)

        if (text) {
          return text
        }
      }
    }
  }

  return ''
}

function buildContent(sections) {
  return sections
    .map((section) => {
      const parts = section.items
        .map((item) => {
          const text = itemText(item)
          return text ? `${item.name}: ${text}` : ''
        })
        .filter(Boolean)

      return parts.length > 0 ? `${section.name}\n${parts.join('\n')}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function extractAttachments(spinPb) {
  const attachments = []

  for (const section of spinPb.spinPbScDList || []) {
    for (const item of section.spinPbImDList || []) {
      if (item.itemSe !== '7' || !item.fileStreCoursOrg) {
        continue
      }

      attachments.push(
        compactObject({
          name: stripHtml(item.itemWonFileNm || item.itemNm || ''),
          url: `https://fanfandaero.kr${item.fileStreCoursOrg}`
        })
      )
    }
  }

  return attachments
}

function normalizeDetail(baseItem, summaryResponse, infoResponse) {
  const summaryData = (summaryResponse && summaryResponse.resultSummaryList) || {}
  const spinPb = (infoResponse && infoResponse.spinPb) || {}
  const sections = (spinPb.spinPbScDList || []).map((section) => ({
    name: stripHtml(section.seNm || ''),
    items: (section.spinPbImDList || []).map((item) => ({
      ...item,
      name: stripHtml(item.itemNm || '')
    }))
  }))
  const content = buildContent(sections)
  const summary =
    readFirstMatchingText(sections, [/사업목적/, /사업개요/, /지원내용/, /지원규모/]) ||
    stripHtml(summaryData.txtDc || '') ||
    baseItem.summary
  const applicationMethod = readFirstMatchingText(sections, [/신청방법/, /신청 절차/, /접수방법/, /신청 및 접수/])
  const applyTarget = readFirstMatchingText(sections, [/지원대상/]) || baseItem.applyTarget
  const contact = readFirstMatchingText(sections, [/문의처/, /문의/])
  const attachments = extractAttachments(spinPb)
  const managingOrg =
    readFirstMatchingText(sections, [/수행기관/, /주관기관/, /운영기관/, /전담기관/]) || baseItem.managingOrg
  const tags = [summaryData.sprtBizCg1Nm, summaryData.sprtBizTyNm, summaryData.sprtBizTrgtNm]
    .filter(Boolean)
    .map((value) => stripHtml(value))

  return {
    ...baseItem,
    summary,
    content: content || summary,
    category: summaryData.sprtBizTyNm || baseItem.category,
    region: summaryData.sprtBizCtpvNm || baseItem.region,
    managingOrg,
    applyTarget,
    applicationMethod,
    contact,
    attachments,
    tags,
    searchText: [
      baseItem.title,
      summary,
      content,
      managingOrg,
      applyTarget,
      applicationMethod,
      contact,
      tags.join(' ')
    ]
      .filter(Boolean)
      .join(' ')
  }
}

async function fetchListPage(pageIndex, listUrl, extraParams = {}, referer) {
  return fetchJson(
    listUrl,
    buildRequestOptions(
      buildFormBody({
        brno: '',
        pageIndex,
        pageUnit: PAGE_UNIT,
        searchTypeStr: '',
        searchTargetStr: '',
        searchAreaStr: '',
        searchText: '',
        noSearchSprt: '',
        searchOrder: '1',
        sortOrder: '',
        testLoginId: '',
        notSearchSprtBizCd: '',
        ...extraParams
      }),
      referer
    )
  )
}

async function fetchDetail(sourcePageUrl, item) {
  const [summaryResponse, infoResponse] = await Promise.all([
    fetchJson(
      DETAIL_SUMMARY_URL,
      buildRequestOptions(buildFormBody({ sprtBizCd: item.sourceId }), sourcePageUrl)
    ),
    fetchJson(
      DETAIL_INFO_URL,
      buildRequestOptions(buildFormBody({ sprtBizCd: item.sourceId }), sourcePageUrl)
    )
  ])

  return normalizeDetail(item, summaryResponse, infoResponse)
}

function canReusePreviousDetail(previous, item) {
  return Boolean(
    previous &&
      previous.postedAt === item.postedAt &&
      previous.applyPeriodText === item.applyPeriodText &&
      previous.category === item.category &&
      (previous.summary || previous.content)
  )
}

async function collectFanfandaero(options = {}) {
  const sourceKey = options.sourceKey || 'fanfandaero'
  const sourceName = options.sourceName || '판판대로'
  const listUrl = options.listUrl || DEFAULT_LIST_URL
  const listKey = options.listKey || 'sprtBizApplList'
  const totalKey = options.totalKey || 'sprtBizApplListTotCnt'
  const extraParams = options.extraParams || {}
  const pageUrl = options.pageUrl || 'https://fanfandaero.kr/portal/v2/preSprtBizPbanc.do'
  const onProgress = options.onProgress || (() => {})
  const previousById = options.previousById || new Map()

  onProgress({ stage: sourceKey, phase: 'list', current: 0, total: 1, message: `${sourceName} 목록 1페이지 조회 중` })
  const firstPage = await fetchListPage(1, listUrl, extraParams, pageUrl)
  const totalCount = Number(firstPage[totalKey] || 0)
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_UNIT), 1)
  const listItems = (firstPage[listKey] || []).map((item) => normalizeListItem(item, sourceKey, sourceName))
  const pages = Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 2)

  const additionalPages = await mapConcurrent(pages, 10, async (page, index) => {
    const json = await fetchListPage(page, listUrl, extraParams, pageUrl)
    onProgress({
      stage: sourceKey,
      phase: 'list',
      current: index + 2,
      total: totalPages,
      message: `${sourceName} 목록 ${index + 2}/${totalPages}페이지 완료`
    })
    return (json[listKey] || []).map((item) => normalizeListItem(item, sourceKey, sourceName))
  })

  const flatItems = [...listItems, ...additionalPages.flat()].filter((item) => item.sourceId)

  onProgress({
    stage: sourceKey,
    phase: 'detail',
    current: 0,
    total: flatItems.length,
    message: `${sourceName} 목록 ${flatItems.length}건 확보, 상세 수집 시작`
  })

  return mapConcurrent(flatItems, 12, async (item, index) => {
    const previous = previousById.get(item.id)

    if (canReusePreviousDetail(previous, item)) {
      onProgress({
        stage: sourceKey,
        phase: 'detail',
        current: index + 1,
        total: flatItems.length,
        message: `${sourceName} 상세 캐시 재사용 ${index + 1}/${flatItems.length}`
      })
      return {
        ...previous,
        ...item,
        searchText: previous.searchText || item.searchText || item.title
      }
    }

    try {
      const detail = await fetchDetail(pageUrl, item)
      onProgress({
        stage: sourceKey,
        phase: 'detail',
        current: index + 1,
        total: flatItems.length,
        message: `${sourceName} 상세 ${index + 1}/${flatItems.length}`
      })
      return detail
    } catch (error) {
      onProgress({
        stage: sourceKey,
        phase: 'detail',
        current: index + 1,
        total: flatItems.length,
        message: `${sourceName} 상세 실패 ${index + 1}/${flatItems.length}: ${item.title}`
      })
      return previous
        ? {
            ...previous,
            ...item,
            searchText: previous.searchText || item.searchText || item.title
          }
        : item
    }
  })
}

module.exports = {
  collectFanfandaero
}
