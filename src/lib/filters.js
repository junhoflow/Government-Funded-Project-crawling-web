const { getAnnouncementStatus, uniqueSorted } = require('./utils')

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).map(normalizeText).filter(Boolean)
  }

  const normalized = normalizeText(value)
  return normalized ? [normalized] : []
}

function compareDate(a, b) {
  return String(a || '').localeCompare(String(b || ''))
}

function matchIncludes(value, query) {
  if (!query) {
    return true
  }

  return normalizeText(value).includes(normalizeText(query))
}

function getDedupeKey(item) {
  return String(item && item.title ? item.title : '').trim()
}

function dedupeAnnouncements(items) {
  const seen = new Set()

  return items.filter((item) => {
    const key = getDedupeKey(item)

    if (!key) {
      return true
    }

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function filterAnnouncements(items, params = {}) {
  const keyword = normalizeText(params.keyword)
  const source = normalizeText(params.source)
  const title = normalizeText(params.title)
  const categories = normalizeTextArray(params.category)
  const region = normalizeText(params.region)
  const applyTarget = normalizeText(params.applyTarget)
  const managingOrg = normalizeText(params.managingOrg)
  const executingOrg = normalizeText(params.executingOrg)
  const period = normalizeText(params.period)
  const status = normalizeText(params.status)
  const postedFrom = params.postedFrom || ''
  const postedTo = params.postedTo || ''
  const deadlineFrom = params.deadlineFrom || ''
  const deadlineTo = params.deadlineTo || ''
  const sort = params.sort || 'latest'
  const order = params.order === 'asc' ? 'asc' : 'desc'

  let filtered = items.filter((item) => {
    const statusInfo = getAnnouncementStatus(item)

    if (source && normalizeText(item.source) !== source && normalizeText(item.sourceKey) !== source) {
      return false
    }

    if (title && !matchIncludes(item.title, title)) {
      return false
    }

    if (categories.length > 0 && !categories.includes(normalizeText(item.category))) {
      return false
    }

    if (region && normalizeText(item.region) !== region) {
      return false
    }

    if (status === 'ongoing' && statusInfo.key !== 'ongoing') {
      return false
    }

    if (status === 'closed' && statusInfo.key !== 'closed') {
      return false
    }

    if (status === 'scheduled' && statusInfo.key !== 'scheduled') {
      return false
    }

    if (applyTarget && !matchIncludes(item.applyTarget, applyTarget) && !matchIncludes(item.summary, applyTarget)) {
      return false
    }

    if (managingOrg && !matchIncludes(item.managingOrg, managingOrg)) {
      return false
    }

    if (executingOrg && !matchIncludes(item.executingOrg, executingOrg)) {
      return false
    }

    if (period && !matchIncludes(item.applyPeriodText, period)) {
      return false
    }

    if (postedFrom && (!item.postedAt || item.postedAt < postedFrom)) {
      return false
    }

    if (postedTo && (!item.postedAt || item.postedAt > postedTo)) {
      return false
    }

    if (deadlineFrom && (!item.applyEnd || item.applyEnd < deadlineFrom)) {
      return false
    }

    if (deadlineTo && (!item.applyEnd || item.applyEnd > deadlineTo)) {
      return false
    }

    if (keyword) {
      return normalizeText(item.searchText).includes(keyword)
    }

    return true
  })

  filtered.sort((left, right) => {
    if (left.isNew !== right.isNew) {
      return left.isNew ? -1 : 1
    }

    let comparison = 0

    if (sort === 'deadline') {
      comparison = compareDate(left.applyEnd, right.applyEnd)
    } else if (sort === 'source') {
      comparison = String(left.source || '').localeCompare(String(right.source || ''), 'ko')
    } else if (sort === 'title') {
      comparison = String(left.title || '').localeCompare(String(right.title || ''), 'ko')
    } else {
      comparison = compareDate(left.postedAt, right.postedAt)
    }

    if (comparison === 0) {
      comparison = compareDate(left.applyEnd, right.applyEnd)
    }

    return order === 'asc' ? comparison : comparison * -1
  })

  return dedupeAnnouncements(filtered)
}

function buildFacets(items) {
  return {
    sources: uniqueSorted(items.map((item) => item.source)),
    categories: uniqueSorted(items.map((item) => item.category)),
    regions: uniqueSorted(items.map((item) => item.region)),
    supportTypes: uniqueSorted(items.map((item) => item.supervisingInstitutionType))
  }
}

module.exports = {
  buildFacets,
  dedupeAnnouncements,
  filterAnnouncements
}
