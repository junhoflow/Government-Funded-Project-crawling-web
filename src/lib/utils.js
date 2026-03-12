const cheerio = require('cheerio')

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (value === undefined || value === null || value === '') {
    return []
  }

  return [value]
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function decodeHtml(value) {
  if (!value) {
    return ''
  }

  const $ = cheerio.load(`<div>${value}</div>`)
  return $.text().replace(/\s+/g, ' ').trim()
}

function stripHtml(value) {
  return decodeHtml(value)
}

function parseDate(value) {
  if (!value) {
    return null
  }

  const raw = String(value).trim()

  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }

  if (/^\d{6}$/.test(raw)) {
    const year = Number(raw.slice(0, 2))
    const normalizedYear = year >= 70 ? 1900 + year : 2000 + year
    return `${normalizedYear}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10)
  }

  if (/^\d{2}-\d{2}-\d{2}$/.test(raw)) {
    return parseDate(raw.replace(/-/g, ''))
  }

  return null
}

function parseDateRange(text) {
  if (!text) {
    return { start: null, end: null }
  }

  const matches = String(text).match(/\d{4}-\d{2}-\d{2}/g)

  if (!matches || matches.length === 0) {
    return { start: null, end: null }
  }

  return {
    start: matches[0] || null,
    end: matches[1] || matches[0] || null
  }
}

function formatDateTime(date = new Date()) {
  return new Date(date).toISOString()
}

function isOngoingFromDates(start, end) {
  const today = new Date().toISOString().slice(0, 10)

  if (end && end < today) {
    return false
  }

  if (start && start > today) {
    return true
  }

  return true
}

function getAnnouncementStatus(item, now = new Date()) {
  const today = new Date(now).toISOString().slice(0, 10)
  const applyStart = item && item.applyStart ? String(item.applyStart) : ''
  const applyEnd = item && item.applyEnd ? String(item.applyEnd) : ''

  if (applyStart && applyStart > today) {
    return {
      key: 'scheduled',
      text: '예정',
      className: 'scheduled'
    }
  }

  if (applyEnd && applyEnd < today) {
    return {
      key: 'closed',
      text: '마감/지난공고',
      className: 'closed'
    }
  }

  if (item && item.isOngoing) {
    return {
      key: 'ongoing',
      text: '모집중',
      className: 'active'
    }
  }

  return {
    key: 'closed',
    text: '마감/지난공고',
    className: 'closed'
  }
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length)
  let index = 0

  async function worker() {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'))
}

function addDays(dateString, days) {
  if (!dateString) {
    return null
  }

  const date = new Date(dateString)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  date.setDate(date.getDate() + days)
  return date.toISOString()
}

function isWithinDays(dateString, days, now = new Date()) {
  if (!dateString) {
    return false
  }

  const base = new Date(dateString)

  if (Number.isNaN(base.getTime())) {
    return false
  }

  const diff = now.getTime() - base.getTime()
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000
}

function isDateNearToday(dateString, days, now = new Date()) {
  if (!dateString) {
    return false
  }

  const base = new Date(dateString)

  if (Number.isNaN(base.getTime())) {
    return false
  }

  const startOfNow = new Date(now)
  startOfNow.setHours(0, 0, 0, 0)
  base.setHours(0, 0, 0, 0)

  const diff = Math.abs(startOfNow.getTime() - base.getTime())
  return diff <= days * 24 * 60 * 60 * 1000
}

module.exports = {
  addDays,
  compactObject,
  decodeHtml,
  ensureArray,
  formatDateTime,
  getAnnouncementStatus,
  isOngoingFromDates,
  isDateNearToday,
  isWithinDays,
  mapConcurrent,
  parseDate,
  parseDateRange,
  sleep,
  stripHtml,
  uniqueSorted
}
