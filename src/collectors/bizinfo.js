const cheerio = require('cheerio')
const { fetchText } = require('../lib/http')
const { compactObject, decodeHtml, formatDateTime, isOngoingFromDates, mapConcurrent, parseDateRange, stripHtml } = require('../lib/utils')

const LIST_URL = 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do'
const DETAIL_URL = 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do'
const BASE_URL = 'https://www.bizinfo.go.kr'
const PAGE_SIZE = 15

function buildListUrl(page, includeClosed) {
  const url = new URL(LIST_URL)
  url.searchParams.set('rows', String(PAGE_SIZE))
  url.searchParams.set('cpage', String(page))
  url.searchParams.set('schEndAt', includeClosed ? 'Y' : 'N')
  return url.toString()
}

function absoluteUrl(value) {
  if (!value) {
    return ''
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }

  return `${BASE_URL}${value}`
}

function deriveRegion(title) {
  const bracketMatch = String(title || '').match(/^\[([^\]]+)\]/)

  if (bracketMatch) {
    return bracketMatch[1].trim()
  }

  return ''
}

function parseCount(text) {
  const match = String(text || '').match(/분야\((\d+)\)/)
  return match ? Number(match[1]) : 0
}

function extractListItems(html, includeClosed) {
  const $ = cheerio.load(html)
  const countText = $('#hashAll span').first().text()
  const totalCount = parseCount(countText)
  const rows = []

  $('.table_Type_1 tbody tr').each((_, tr) => {
    const cells = $(tr).find('td')

    if (cells.length < 8) {
      return
    }

    const link = $(cells[2]).find('a').attr('href') || ''
    const title = decodeHtml($(cells[2]).text())
    const sourceIdMatch = link.match(/pblancId=([^&]+)/)
    const sourceId = sourceIdMatch ? sourceIdMatch[1] : ''
    const applyPeriodText = $(cells[3]).text().replace(/\s+/g, ' ').trim()
    const dateRange = parseDateRange(applyPeriodText)
    const detailUrl = absoluteUrl(link)
    const category = decodeHtml($(cells[1]).text())
    const managingOrg = decodeHtml($(cells[4]).text())
    const executingOrg = decodeHtml($(cells[5]).text())
    const postedAt = decodeHtml($(cells[6]).text())

    rows.push({
      id: `bizinfo:${sourceId}`,
      sourceKey: 'bizinfo',
      source: '기업마당',
      sourceId,
      title,
      category,
      region: deriveRegion(title),
      applyPeriodText,
      applyStart: dateRange.start,
      applyEnd: dateRange.end,
      managingOrg,
      executingOrg,
      postedAt,
      detailUrl,
      originUrl: '',
      isOngoing: !includeClosed && isOngoingFromDates(dateRange.start, dateRange.end),
      views: decodeHtml($(cells[7]).text())
    })
  })

  return { totalCount, rows }
}

function readFieldText($, title) {
  const root = $('.support_project_detail')
  const field = root.find('.s_title').filter((_, el) => $(el).text().trim() === title).first()

  if (!field.length) {
    return ''
  }

  const text = field.parent().find('.txt, .txt_view, .txt_box').first().text().replace(/\s+/g, ' ').trim()
  return decodeHtml(text)
}

function readFieldHtml($, title) {
  const root = $('.support_project_detail')
  const field = root.find('.s_title').filter((_, el) => $(el).text().trim() === title).first()

  if (!field.length) {
    return ''
  }

  const html = field.parent().find('.txt, .txt_view, .txt_box').first().html() || ''
  return stripHtml(html)
}

function readFieldLink($, title) {
  const root = $('.support_project_detail')
  const field = root.find('.s_title').filter((_, el) => $(el).text().trim() === title).first()

  if (!field.length) {
    return ''
  }

  const href = field.parent().find('a').first().attr('href') || ''
  return absoluteUrl(href)
}

function parseDetail(html, listItem) {
  const $ = cheerio.load(html)
  const summary = readFieldHtml($, '사업개요')
  const applicationMethod = readFieldText($, '사업신청 방법')
  const applicationSite = readFieldText($, '사업신청 사이트')
  const applicationLink = readFieldLink($, '사업신청 사이트')
  const contact = readFieldText($, '문의처')
  const sourceLink = $('#barogagi').attr('href') || ''
  const tags = []

  $('.tag_list td span').each((_, el) => {
    const tag = decodeHtml($(el).text()).replace(/^#/, '')
    if (tag) {
      tags.push(tag)
    }
  })

  const attachments = []
  $('.attached_file_list li').each((_, li) => {
    const name = decodeHtml($(li).find('.file_name').text())
    const url = absoluteUrl($(li).find('.icon_download').attr('href'))

    if (name || url) {
      attachments.push(compactObject({ name, url }))
    }
  })

  return compactObject({
    ...listItem,
    summary,
    content: summary,
    applicationMethod,
    applicationUrl: applicationLink || absoluteUrl(sourceLink) || listItem.detailUrl,
    applicationSite,
    contact,
    applyTarget: summary,
    supervisingInstitutionType: '',
    detailUrl: listItem.detailUrl,
    originUrl: sourceLink ? absoluteUrl(sourceLink) : listItem.detailUrl,
    attachments,
    tags,
    collectedAt: formatDateTime(),
    searchText: [
      listItem.title,
      summary,
      listItem.category,
      listItem.managingOrg,
      listItem.executingOrg,
      applicationMethod,
      contact,
      tags.join(' ')
    ]
      .filter(Boolean)
      .join(' ')
  })
}

async function collectBizInfo(options = {}) {
  const includeClosed = Boolean(options.includeClosed)
  const stage = options.stageKey || 'bizinfo'
  const previousById = options.previousById || new Map()
  const onProgress = options.onProgress || (() => {})

  onProgress({
    stage,
    phase: 'list',
    current: 0,
    total: 1,
    message: `기업마당 목록 1페이지 조회 중 (${includeClosed ? '지난공고' : '진행공고'})`
  })

  const firstHtml = await fetchText(buildListUrl(1, includeClosed))
  const first = extractListItems(firstHtml, includeClosed)
  const totalPages = Math.ceil((first.totalCount || 0) / PAGE_SIZE)
  const pages = Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 2)

  onProgress({
    stage,
    phase: 'list',
    current: 1,
    total: totalPages,
    message: `기업마당 총 ${totalPages}페이지 목록 수집`,
    totalPages
  })

  const listings = [first.rows]
  const pageListings = await mapConcurrent(pages, 10, async (page, index) => {
    const html = await fetchText(buildListUrl(page, includeClosed))
    const parsed = extractListItems(html, includeClosed)
    onProgress({
      stage,
      phase: 'list',
      current: index + 2,
      total: totalPages,
      message: `기업마당 목록 ${index + 2}/${totalPages}페이지 완료`,
      currentPage: page,
      totalPages
    })
    return parsed.rows
  })

  listings.push(...pageListings)
  const flatListings = listings.flat().filter((item) => item.sourceId)

  onProgress({
    stage,
    phase: 'detail',
    current: 0,
    total: flatListings.length,
    message: `기업마당 목록 ${flatListings.length}건 확보, 상세 수집 시작`
  })

  const detailedItems = await mapConcurrent(flatListings, 12, async (item, index) => {
    const previous = previousById.get(item.id)

    if (
      previous &&
      previous.postedAt === item.postedAt &&
      previous.applyPeriodText === item.applyPeriodText &&
      previous.summary &&
      previous.applicationUrl !== '온라인신청 바로가기'
    ) {
      onProgress({
        stage,
        phase: 'detail',
        current: index + 1,
        total: flatListings.length,
        message: `기업마당 상세 캐시 재사용 ${index + 1}/${flatListings.length}`
      })
      return {
        ...previous,
        ...item,
        searchText: previous.searchText || item.title
      }
    }

    try {
      const html = await fetchText(item.detailUrl)
      const detail = parseDetail(html, item)
      onProgress({
        stage,
        phase: 'detail',
        current: index + 1,
        total: flatListings.length,
        message: `기업마당 상세 ${index + 1}/${flatListings.length}`
      })
      return detail
    } catch (error) {
      onProgress({
        stage,
        phase: 'detail',
        current: index + 1,
        total: flatListings.length,
        message: `기업마당 상세 실패 ${index + 1}/${flatListings.length}: ${item.title}`
      })
      return {
        ...item,
        summary: previous ? previous.summary : '',
        content: previous ? previous.content : '',
        applicationMethod: previous ? previous.applicationMethod : '',
        applicationUrl: previous ? previous.applicationUrl : item.detailUrl,
        applicationSite: previous ? previous.applicationSite : '',
        contact: previous ? previous.contact : '',
        applyTarget: previous ? previous.applyTarget : '',
        supervisingInstitutionType: previous ? previous.supervisingInstitutionType : '',
        originUrl: previous ? previous.originUrl : item.detailUrl,
        attachments: previous ? previous.attachments : [],
        tags: previous ? previous.tags : [],
        collectedAt: formatDateTime(),
        searchText: [
          item.title,
          item.category,
          item.managingOrg,
          item.executingOrg,
          previous ? previous.summary : ''
        ]
          .filter(Boolean)
          .join(' ')
      }
    }
  })

  return detailedItems
}

module.exports = {
  collectBizInfo
}
