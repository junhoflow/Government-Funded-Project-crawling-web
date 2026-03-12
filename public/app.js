const state = {
  page: 1,
  totalPages: 1,
  syncRunning: false,
  filtersOpen: true,
  lastKnownSyncRunning: false,
  lastSyncAt: '',
  currentItems: [],
  appliedMap: {},
  togglingIds: new Set()
}

const appConfig = window.APP_CONFIG || {}
const apiBaseUrl = String(appConfig.apiBaseUrl || '').replace(/\/$/, '')

const filterIds = [
  'keyword',
  'sort',
  'source',
  'title',
  'category',
  'region',
  'applyTarget',
  'managingOrg',
  'executingOrg',
  'period',
  'status'
]

function byId(id) {
  return document.getElementById(id)
}

function apiUrl(path) {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path
}

async function fetchJson(path, options) {
  const response = await fetch(apiUrl(path), options)

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.json()
}

function formatDateTime(value) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString('ko-KR')
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getStatusInfo(item) {
  const today = new Date().toISOString().slice(0, 10)

  if (item.applyStart && item.applyStart > today) {
    return { text: '예정', className: 'scheduled', key: 'scheduled' }
  }

  if (item.applyEnd && item.applyEnd < today) {
    return { text: '마감/지난공고', className: 'closed', key: 'closed' }
  }

  if (item.isOngoing) {
    return { text: '모집중', className: 'active', key: 'ongoing' }
  }

  return { text: '마감/지난공고', className: 'closed', key: 'closed' }
}

function isDeadlineSoon(item, now = new Date()) {
  if (!item.applyEnd) {
    return false
  }

  const statusInfo = getStatusInfo(item)

  if (statusInfo.key !== 'ongoing') {
    return false
  }

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const deadline = new Date(item.applyEnd)

  if (Number.isNaN(deadline.getTime())) {
    return false
  }

  deadline.setHours(0, 0, 0, 0)

  const diff = deadline.getTime() - today.getTime()
  return diff >= 0 && diff <= 3 * 24 * 60 * 60 * 1000
}

function buildQuery() {
  const params = new URLSearchParams()

  filterIds.forEach((id) => {
    const element = byId(id)
    if (!element) {
      return
    }

    if (id === 'category') {
      const checkboxes = Array.from(element.querySelectorAll('input[type="checkbox"]'))
      const checked = checkboxes.filter((checkbox) => checkbox.checked)

      if (checked.length > 0 && checked.length < checkboxes.length) {
        checked.forEach((checkbox) => {
          params.append(id, checkbox.value)
        })
      }

      return
    }

    if (element.multiple) {
      Array.from(element.selectedOptions)
        .map((option) => option.value)
        .filter(Boolean)
        .forEach((value) => {
          params.append(id, value)
        })
      return
    }

    const value = element.value

    if (value) {
      params.set(id, value)
    }
  })

  params.set('page', String(state.page))
  params.set('pageSize', '50')
  return params
}

function populateSelect(id, values, placeholder) {
  const select = byId(id)

  if (!select) {
    return
  }

  const previous = select.multiple
    ? Array.from(select.selectedOptions).map((option) => option.value)
    : [select.value]
  select.innerHTML = ''

  if (!select.multiple) {
    const defaultOption = document.createElement('option')
    defaultOption.value = ''
    defaultOption.textContent = placeholder
    select.appendChild(defaultOption)
  }

  values.forEach((value) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    option.selected = previous.includes(value)
    select.appendChild(option)
  })
}

function populateCategoryChips(values) {
  const container = byId('category')

  if (!container) {
    return
  }

  const previous = new Set(
    Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((checkbox) => checkbox.value)
  )
  const shouldCheckAllByDefault = container.querySelectorAll('input[type="checkbox"]').length === 0

  container.innerHTML = ''

  values.forEach((value, index) => {
    const label = document.createElement('label')
    label.className = 'chip-option'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = value
    input.checked = shouldCheckAllByDefault || previous.has(value)
    input.id = `category-chip-${index}`

    const text = document.createElement('span')
    text.textContent = value

    label.appendChild(input)
    label.appendChild(text)
    container.appendChild(label)
  })
}

function updateExportLink() {
  const params = buildQuery()
  params.delete('page')
  byId('export-link').href = apiUrl(`/api/announcements/export.xlsx?${params.toString()}`)
}

function updateFilterPanelState() {
  const panel = byId('advanced-filters')
  const button = byId('toggle-filters')
  panel.classList.toggle('hidden', !state.filtersOpen)
  button.textContent = state.filtersOpen ? '필터 닫기' : '필터 열기'
}

function isApplied(itemId) {
  return Boolean(state.appliedMap[itemId])
}

function createAppliedButton(item) {
  const button = document.createElement('button')
  const applied = isApplied(item.id)
  const isBusy = state.togglingIds.has(item.id)

  button.type = 'button'
  button.className = `applied-toggle${applied ? ' is-applied' : ''}`
  button.dataset.appliedToggle = 'true'
  button.dataset.announcementId = item.id
  button.disabled = isBusy
  button.textContent = applied ? '지원함' : '미지원'
  button.title = applied ? '지원 완료로 표시됨' : '지원 전'
  return button
}

function createStatusBadge(statusInfo) {
  const span = document.createElement('span')
  span.className = `status-badge ${statusInfo.className}`
  span.textContent = statusInfo.text
  return span
}

function createTitleLink(item, className) {
  const link = document.createElement('a')
  link.className = className
  link.href = item.detailUrl || item.originUrl || '#'
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.title = item.title || '-'
  link.textContent = item.title || '-'
  return link
}

function renderRows(items) {
  const body = byId('results-body')
  const mobileBody = byId('mobile-results')
  const template = byId('row-template')
  const mobileTemplate = byId('mobile-card-template')
  body.innerHTML = ''
  mobileBody.innerHTML = ''

  if (!items.length) {
    const row = document.createElement('tr')
    row.innerHTML = '<td colspan="9">조건에 맞는 공고가 없습니다.</td>'
    body.appendChild(row)

    const empty = document.createElement('div')
    empty.className = 'mobile-empty'
    empty.textContent = '조건에 맞는 공고가 없습니다.'
    mobileBody.appendChild(empty)
    return
  }

  items.forEach((item) => {
    const fragment = template.content.cloneNode(true)
    const mobileFragment = mobileTemplate.content.cloneNode(true)
    const row = fragment.querySelector('tr')
    const mobileCard = mobileFragment.querySelector('.mobile-card')
    const statusInfo = getStatusInfo(item)

    if (isDeadlineSoon(item)) {
      row.classList.add('urgent-row')
      mobileCard.classList.add('urgent-row')
    } else if (item.isNew) {
      row.classList.add('new-row')
      mobileCard.classList.add('new-row')
    }

    const sourceText = item.source || '-'
    const titleText = item.title || '-'
    const categoryText = item.category || '-'
    const regionText = item.region || '-'
    const managingText = item.managingOrg || '-'
    const executingText = item.executingOrg || '-'
    const periodText = item.applyPeriodText || '-'
    const appliedCell = fragment.querySelector('.applied-cell')
    const sourceCell = fragment.querySelector('.source-cell')
    const titleCell = fragment.querySelector('.title-cell')
    const categoryCell = fragment.querySelector('.category-cell')
    const regionCell = fragment.querySelector('.region-cell')
    const managingCell = fragment.querySelector('.managing-cell')
    const executingCell = fragment.querySelector('.executing-cell')
    const periodCell = fragment.querySelector('.period-cell')
    const statusCell = fragment.querySelector('.status-cell')

    appliedCell.appendChild(createAppliedButton(item))
    appliedCell.title = isApplied(item.id) ? '지원함' : '미지원'
    sourceCell.textContent = sourceText
    sourceCell.title = sourceText
    titleCell.appendChild(createTitleLink(item, 'title-link'))
    titleCell.title = titleText
    categoryCell.textContent = categoryText
    categoryCell.title = categoryText
    regionCell.textContent = regionText
    regionCell.title = regionText
    managingCell.textContent = managingText
    managingCell.title = managingText
    executingCell.textContent = executingText
    executingCell.title = executingText
    periodCell.textContent = periodText
    periodCell.title = periodText
    statusCell.appendChild(createStatusBadge(statusInfo))
    statusCell.title = statusInfo.text

    body.appendChild(fragment)

    mobileFragment.querySelector('.mobile-card-badges').innerHTML =
      `<span class="mobile-pill">${escapeHtml(sourceText)}</span>` +
      `<span class="mobile-pill">${escapeHtml(categoryText)}</span>`
    mobileFragment.querySelector('.mobile-card-applied').appendChild(createAppliedButton(item))
    mobileFragment.querySelector('.mobile-card-title').replaceWith(createTitleLink(item, 'mobile-card-title'))
    mobileFragment.querySelector('.mobile-card-meta').appendChild(createStatusBadge(statusInfo))
    mobileFragment.querySelector('.mobile-region').textContent = regionText
    mobileFragment.querySelector('.mobile-period').textContent = periodText
    mobileFragment.querySelector('.mobile-managing').textContent = managingText
    mobileFragment.querySelector('.mobile-executing').textContent = executingText

    mobileBody.appendChild(mobileFragment)
  })
}

async function loadMeta() {
  const meta = await fetchJson('/api/meta')

  byId('total-count').textContent = meta.total.toLocaleString('ko-KR')
  state.lastSyncAt = meta.lastSyncAt || state.lastSyncAt
  byId('last-sync').textContent = formatDateTime(state.lastSyncAt)

  populateSelect('source', meta.facets.sources, '전체 출처')
  populateCategoryChips(meta.facets.categories)
  populateSelect('region', meta.facets.regions, '전체 지역')
}

async function loadAnnouncements() {
  updateExportLink()
  const data = await fetchJson(`/api/announcements?${buildQuery().toString()}`)

  state.totalPages = data.totalPages
  state.currentItems = data.items
  renderRows(data.items)

  byId('filtered-count').textContent = data.total.toLocaleString('ko-KR')
  byId('page-indicator').textContent = `${data.page} / ${data.totalPages}`
  byId('result-summary').textContent = `총 ${data.total.toLocaleString('ko-KR')}건 중 ${data.items.length.toLocaleString('ko-KR')}건 표시`
}

async function loadSyncStatus() {
  const status = await fetchJson('/api/sync-status')
  state.lastKnownSyncRunning = state.syncRunning
  state.syncRunning = status.isRunning

  byId('sync-status').textContent = status.message || '대기 중'
  byId('sync-button').disabled = status.isRunning
  byId('sync-progress-fill').style.width = `${(status.progress && status.progress.percent) || 0}%`
  byId('sync-progress-text').textContent = `${(status.progress && status.progress.percent) || 0}%`

  if (status.summary && status.summary.finishedAt) {
    state.lastSyncAt = status.summary.finishedAt
  } else if (status.finishedAt) {
    state.lastSyncAt = status.finishedAt
  }

  if (!state.lastSyncAt && status.startedAt) {
    state.lastSyncAt = status.startedAt
  }

  byId('last-sync').textContent = formatDateTime(state.lastSyncAt)
}

async function startSync() {
  const response = await fetch(apiUrl('/api/sync'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({})
  })

  if (!response.ok) {
    const result = await response.json()
    alert(result.message || '동기화를 시작하지 못했습니다.')
    return
  }

  await loadSyncStatus()
}

async function applyFilters() {
  state.page = 1
  await loadAnnouncements()
}

async function loadAppliedState() {
  try {
    state.appliedMap = await window.AppliedStore.load()
  } catch (error) {
    console.error(error)
    state.appliedMap = {}
  }

  byId('storage-mode').textContent = window.AppliedStore.getModeLabel()
}

function updateAppliedButtons(itemId) {
  document.querySelectorAll('[data-applied-toggle]').forEach((button) => {
    if (button.dataset.announcementId !== itemId) {
      return
    }

    const applied = isApplied(itemId)
    const isBusy = state.togglingIds.has(itemId)

    button.classList.toggle('is-applied', applied)
    button.disabled = isBusy
    button.textContent = applied ? '지원함' : '미지원'
    button.title = applied ? '지원 완료로 표시됨' : '미지원'
  })
}

async function toggleApplied(itemId) {
  const item = state.currentItems.find((entry) => entry.id === itemId)

  if (!item || state.togglingIds.has(itemId)) {
    return
  }

  const nextValue = !isApplied(itemId)
  state.togglingIds.add(itemId)
  updateAppliedButtons(itemId)

  try {
    await window.AppliedStore.setApplied(item, nextValue)

    if (nextValue) {
      state.appliedMap[itemId] = true
    } else {
      delete state.appliedMap[itemId]
    }
  } catch (error) {
    console.error(error)
    alert('지원 체크 저장에 실패했습니다.')
  } finally {
    state.togglingIds.delete(itemId)
    updateAppliedButtons(itemId)
  }
}

function resetFilters() {
  filterIds.forEach((id) => {
    const element = byId(id)

    if (!element) {
      return
    }

    if (id === 'category') {
      element.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.checked = true
      })
      return
    }

    if (element.tagName === 'SELECT') {
      if (element.multiple) {
        Array.from(element.options).forEach((option) => {
          option.selected = false
        })
      } else {
        element.selectedIndex = 0
      }
    } else {
      element.value = ''
    }
  })

  byId('applyTarget').value = '예비'
  byId('status').value = 'ongoing'
}

async function refreshAll() {
  try {
    await loadAppliedState()
    await loadMeta()
    await loadAnnouncements()
    await loadSyncStatus()
  } catch (error) {
    console.error(error)
    byId('result-summary').textContent = 'API 연결에 실패했습니다. config.js의 apiBaseUrl 설정을 확인하세요.'
    byId('sync-status').textContent = 'API 연결 실패'
  }
}

byId('prev-page').addEventListener('click', async () => {
  if (state.page <= 1) {
    return
  }

  state.page -= 1
  await loadAnnouncements()
})

byId('next-page').addEventListener('click', async () => {
  if (state.page >= state.totalPages) {
    return
  }

  state.page += 1
  await loadAnnouncements()
})

byId('sync-button').addEventListener('click', startSync)
byId('apply-filters').addEventListener('click', applyFilters)
byId('reset-filters').addEventListener('click', async () => {
  resetFilters()
  await applyFilters()
})
byId('toggle-filters').addEventListener('click', () => {
  state.filtersOpen = !state.filtersOpen
  updateFilterPanelState()
})
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-applied-toggle]')

  if (!button) {
    return
  }

  await toggleApplied(button.dataset.announcementId)
})

setInterval(async () => {
  try {
    await loadSyncStatus()

    if (state.lastKnownSyncRunning && !state.syncRunning) {
      await loadMeta()
      await loadAnnouncements()
    }
  } catch (error) {
    console.error(error)
  }
}, 10000)

updateFilterPanelState()
refreshAll()
