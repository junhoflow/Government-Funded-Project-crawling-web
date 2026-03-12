const cheerio = require('cheerio')
const { fetchText } = require('../lib/http')
const { compactObject, formatDateTime, isOngoingFromDates, mapConcurrent, parseDate, stripHtml } = require('../lib/utils')

const BASE_URL = 'https://bizok.incheon.go.kr'
const LIST_URL = `${BASE_URL}/open_content/support.do`
const DEFAULT_CATEGORIES = '03,04,05'

function buildListUrl(page) {
  const url = new URL(LIST_URL)
  url.searchParams.set('act', 'list')
  url.searchParams.set('cate', DEFAULT_CATEGORIES)

  if (page > 1) {
    url.searchParams.set('pgno', String(page))
  }

  return url.toString()
}

function buildDetailUrl(policyNo) {
  const url = new URL(LIST_URL)
  url.searchParams.set('act', 'detail')
  url.searchParams.set('policyno', String(policyNo))
  url.searchParams.set('cate', DEFAULT_CATEGORIES)
  return url.toString()
}

function requestOptions(referer) {
  return {
    headers: {
      'user-agent': 'Mozilla/5.0',
      referer: referer || `${BASE_URL}/`
    }
  }
}

function parseApplyPeriod(text) {
  const matches = String(text || '').match(/\d{2}-\d{2}-\d{2}/g) || []
  const start = matches[0] ? parseDate(matches[0]) : null
  const end = matches[1] ? parseDate(matches[1]) : matches[0] ? parseDate(matches[0]) : null
  return { start, end }
}

function extractTotalPages($) {
  const lastHref = $('.paging.dp_pc a.last').attr('href') || $('.mb_paging a.last').attr('href') || ''
  const lastMatch = lastHref.match(/pgno=(\d+)/)

  if (lastMatch) {
    return Number(lastMatch[1])
  }

  const text = $.root().text().replace(/\s+/g, ' ')
  const match = text.match(/현재페이지\s+\d+\/(\d+)\s+page/i)
  return match ? Number(match[1]) : 1
}

function extractListItems(html) {
  const $ = cheerio.load(html)
  const totalPages = extractTotalPages($)
  const items = []

  $('.board_list .list01 > li').each((_, li) => {
    const root = $(li)
    const link = root.find('a').attr('href') || ''
    const sourceIdMatch = link.match(/policyno=(\d+)/)
    const sourceId = sourceIdMatch ? sourceIdMatch[1] : ''
    const title = stripHtml(root.find('dt p').first().text())
    const category = stripHtml(root.find('.cat').first().text())
    const status = stripHtml(root.find('.state').first().text())
    const applyPeriodText = root.find('dd p').first().text().replace(/\s+/g, ' ').trim().replace(/^신청기간\s*:\s*/, '')
    const managingOrg = root
      .find('dd p')
      .eq(1)
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^주관기관\s*:\s*/, '')
    const dates = parseApplyPeriod(applyPeriodText)

    items.push(
      compactObject({
        id: `bizok:${sourceId}`,
        sourceKey: 'bizok',
        source: '인천 비즈오케이',
        sourceId,
        title,
        summary: '',
        content: '',
        category,
        region: '인천',
        managingOrg,
        applyStart: dates.start,
        applyEnd: dates.end,
        applyPeriodText,
        postedAt: dates.start,
        isOngoing: status.includes('접수중') || isOngoingFromDates(dates.start, dates.end),
        detailUrl: buildDetailUrl(sourceId),
        originUrl: buildDetailUrl(sourceId),
        sourceStatus: status,
        searchText: [title, category, managingOrg, applyPeriodText, status].filter(Boolean).join(' ')
      })
    )
  })

  return { totalPages, items }
}

function findDetailField($, label) {
  const field = $('.applicationDetail dt')
    .filter((_, element) => $(element).text().replace(/\s+/g, ' ').trim() === label)
    .first()

  if (!field.length) {
    return null
  }

  const value = field.next('dd')
  const text = stripHtml(value.html() || value.text() || '')
  const links = value
    .find('a')
    .map((_, link) =>
      compactObject({
        name: stripHtml($(link).text()),
        url: new URL($(link).attr('href') || '', BASE_URL).toString()
      })
    )
    .get()

  return { text, links }
}

function readTablePairs($, heading) {
  const table = $('h4')
    .filter((_, element) => $(element).text().replace(/\s+/g, ' ').trim() === heading)
    .first()
    .nextAll('div.datatable')
    .first()
    .find('table')
    .first()

  if (!table.length) {
    return {}
  }

  const values = {}

  table.find('tr').each((_, tr) => {
    const cells = $(tr).find('th, td')

    for (let index = 0; index < cells.length - 1; index += 2) {
      const key = stripHtml($(cells[index]).text())
      const value = stripHtml($(cells[index + 1]).html() || $(cells[index + 1]).text())

      if (key) {
        values[key] = value
      }
    }
  })

  return values
}

function parseDetail(baseItem, html) {
  const $ = cheerio.load(html)
  const overview = findDetailField($, '사업개요')
  const target = findDetailField($, '지원분야및 대상') || findDetailField($, '지원분야 및 대상')
  const conditions = findDetailField($, '지원조건및 내용') || findDetailField($, '지원조건 및 내용')
  const applicationMethod = findDetailField($, '신청방법')
  const documents = findDetailField($, '신청서류')
  const contact = findDetailField($, '문의처')
  const organization = readTablePairs($, '주관기관 정보')
  const reception = readTablePairs($, '접수기관 정보')
  const attachments = []

  $('.applicationDetail dt')
    .filter((_, element) => /첨부\d+/.test($(element).text()))
    .each((_, element) => {
      const link = $(element).next('dd').find('a').first()
      const href = link.attr('href')

      if (!href) {
        return
      }

      attachments.push(
        compactObject({
          name: stripHtml(link.text()),
          url: new URL(href, BASE_URL).toString()
        })
      )
    })

  const summary = overview ? overview.text : baseItem.summary
  const content = [overview && overview.text, target && target.text, conditions && conditions.text, documents && documents.text]
    .filter(Boolean)
    .join('\n\n')

  return {
    ...baseItem,
    summary,
    content,
    managingOrg: organization['주관기관명'] || reception['접수기관명'] || baseItem.managingOrg,
    executingOrg: reception['접수기관명'] || '',
    applyTarget: target ? target.text : '',
    applicationMethod: applicationMethod ? applicationMethod.text : '',
    applicationUrl:
      (applicationMethod && applicationMethod.links && applicationMethod.links[0] && applicationMethod.links[0].url) ||
      baseItem.detailUrl,
    applicationSite: organization['홈페이지'] || reception['홈페이지'] || '',
    contact: contact ? contact.text : reception['담당자전화'] || organization['담당자전화'] || '',
    attachments,
    tags: ['인천', baseItem.category].filter(Boolean),
    collectedAt: formatDateTime(),
    searchText: [
      baseItem.title,
      summary,
      content,
      baseItem.category,
      baseItem.managingOrg,
      target ? target.text : '',
      applicationMethod ? applicationMethod.text : '',
      contact ? contact.text : ''
    ]
      .filter(Boolean)
      .join(' ')
  }
}

async function collectBizOk(onProgress = () => {}) {
  onProgress({ stage: 'bizok', phase: 'list', current: 0, total: 1, message: '인천 비즈오케이 목록 1페이지 조회 중' })
  const firstHtml = await fetchText(buildListUrl(1), requestOptions(`${BASE_URL}/`))
  const first = extractListItems(firstHtml)
  const pages = Array.from({ length: Math.max(first.totalPages - 1, 0) }, (_, index) => index + 2)

  const additionalPages = await mapConcurrent(pages, 6, async (page, index) => {
    const html = await fetchText(buildListUrl(page), requestOptions(buildListUrl(1)))
    const parsed = extractListItems(html)
    onProgress({
      stage: 'bizok',
      phase: 'list',
      current: index + 2,
      total: first.totalPages,
      message: `인천 비즈오케이 목록 ${index + 2}/${first.totalPages}페이지 완료`
    })
    return parsed.items
  })

  const items = [...first.items, ...additionalPages.flat()]

  onProgress({
    stage: 'bizok',
    phase: 'detail',
    current: 0,
    total: items.length,
    message: `인천 비즈오케이 목록 ${items.length}건 확보, 상세 수집 시작`
  })

  return mapConcurrent(items, 8, async (item, index) => {
    try {
      const html = await fetchText(item.detailUrl, requestOptions(buildListUrl(1)))
      const detail = parseDetail(item, html)
      onProgress({
        stage: 'bizok',
        phase: 'detail',
        current: index + 1,
        total: items.length,
        message: `인천 비즈오케이 상세 ${index + 1}/${items.length}`
      })
      return detail
    } catch (error) {
      onProgress({
        stage: 'bizok',
        phase: 'detail',
        current: index + 1,
        total: items.length,
        message: `인천 비즈오케이 상세 실패 ${index + 1}/${items.length}: ${item.title}`
      })
      return item
    }
  })
}

module.exports = {
  collectBizOk
}
