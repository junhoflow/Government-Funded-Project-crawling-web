const REPO_WORKFLOW_URL =
  'https://github.com/junhoflow/Government-Funded-Project-crawling-web/actions/workflows/daily-sync.yml'
const META_STATE_KEY = 'support_database_meta'
const SYNC_STATE_KEY = 'support_sync_status'
const OPEN_VIEW_NAME = 'support_announcements_deduped'
const PAGE_SIZE = 50
const OPEN_SELECT_COLUMNS = [
  'id',
  'source_key',
  'source',
  'source_id',
  'title',
  'summary',
  'category',
  'region',
  'managing_org',
  'executing_org',
  'supervising_institution_type',
  'application_method',
  'application_site',
  'application_url',
  'detail_url',
  'origin_url',
  'contact',
  'apply_target',
  'apply_age',
  'experience',
  'preferred',
  'applicant_exclusion',
  'posted_at',
  'apply_start',
  'apply_end',
  'apply_period_text',
  'status_key',
  'is_new',
  'search_text',
  'first_seen_at',
  'last_seen_at',
  'tags',
  'updated_at'
].join(',')

const state = {
  page: 1,
  totalPages: 1,
  syncRunning: false,
  filtersOpen: false,
  initialFiltersApplied: false,
  lastKnownSyncRunning: false,
  lastSyncAt: '',
  currentItems: [],
  workflowMap: {},
  activeTab: 'open',
  totalAnnouncements: 0,
  togglingIds: new Set()
}

const appConfig = window.APP_CONFIG || {}
const supabaseUrl = String(appConfig.supabaseUrl || '').replace(/\/$/, '')
const supabaseAnonKey = String(appConfig.supabaseAnonKey || '')
const workflowUrl = String(appConfig.syncWorkflowUrl || REPO_WORKFLOW_URL)
const syncFunctionUrl = String(appConfig.syncFunctionUrl || (supabaseUrl ? `${supabaseUrl}/functions/v1/trigger-sync` : ''))
const supabaseRestBase = supabaseUrl ? `${supabaseUrl}/rest/v1` : ''
const accessGateEnabled = Boolean(appConfig.accessGateEnabled)
const accessPassword = String(appConfig.accessPassword || '')
const accessSessionKey = String(appConfig.accessSessionKey || 'government-funded-project.access.v1')
let accessGranted = !accessGateEnabled || !accessPassword

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

function denyAccess() {
  document.body.innerHTML =
    '<main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f8f4ec;color:#1c1b18;font-family:IBM Plex Sans KR, Noto Sans KR, sans-serif;">' +
    '<div style="max-width:420px;padding:28px 24px;border:1px solid rgba(28,27,24,0.12);border-radius:20px;background:#fffaf2;text-align:center;box-shadow:0 18px 45px rgba(24,20,14,0.08);">' +
    '<strong style="display:block;font-size:1.1rem;">접근이 취소되었습니다.</strong>' +
    '<p style="margin:12px 0 0;color:#6d665c;line-height:1.6;">다시 접속해서 비밀번호를 입력하세요.</p>' +
    '</div>' +
    '</main>'
}

async function ensureAccess() {
  if (!accessGateEnabled || !accessPassword) {
    accessGranted = true
    return true
  }

  if (window.sessionStorage.getItem(accessSessionKey) === 'granted') {
    accessGranted = true
    return true
  }

  const appRoot = document.querySelector('.page-shell')

  if (appRoot) {
    appRoot.style.visibility = 'hidden'
  }

  while (true) {
    const entered = window.prompt('비밀번호를 입력하세요.')

    if (entered === null) {
      denyAccess()
      return false
    }

    if (entered === accessPassword) {
      window.sessionStorage.setItem(accessSessionKey, 'granted')
      accessGranted = true

      if (appRoot) {
        appRoot.style.visibility = ''
      }

      return true
    }

    window.alert('비밀번호가 올바르지 않습니다.')
  }
}

function isSupabaseReady() {
  return Boolean(supabaseRestBase && supabaseAnonKey)
}

function supabaseHeaders(extra = {}, includeCount = false) {
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    Accept: 'application/json',
    ...(includeCount ? { Prefer: 'count=exact' } : {}),
    ...extra
  }
}

async function fetchSupabase(path, options = {}) {
  const response = await fetch(`${supabaseRestBase}/${path}`, {
    ...options,
    headers: supabaseHeaders(options.headers || {}, options.includeCount)
  })

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status}`)
  }

  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  return {
    data,
    headers: response.headers
  }
}

function parseContentRange(headers) {
  const contentRange = headers.get('content-range') || ''
  const match = contentRange.match(/\/(\d+|\*)$/)
  return match && match[1] !== '*' ? Number(match[1]) : 0
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

function getDerivedStatusKey(item, now = new Date()) {
  const today = new Date(now).toISOString().slice(0, 10)
  const applyStart = String(item && item.applyStart ? item.applyStart : '')
  const applyEnd = String(item && item.applyEnd ? item.applyEnd : '')

  if (applyStart && applyStart > today) {
    return 'scheduled'
  }

  if (applyEnd && applyEnd < today) {
    return 'closed'
  }

  return 'ongoing'
}

function getStatusInfo(item) {
  const statusKey = item && item.statusKey ? item.statusKey : getDerivedStatusKey(item)

  if (statusKey === 'scheduled') {
    return { text: '예정', className: 'scheduled', key: 'scheduled' }
  }

  if (statusKey === 'ongoing') {
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

function updateFilterPanelState() {
  const panel = byId('advanced-filters')
  const button = byId('toggle-filters')
  panel.classList.toggle('hidden', !state.filtersOpen)
  button.textContent = state.filtersOpen ? '필터 닫기' : '필터 열기'
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function getWorkflowRecord(itemId) {
  return state.workflowMap[itemId] || null
}

function getSelectedCategories() {
  return Array.from(byId('category').querySelectorAll('input[type="checkbox"]:checked')).map((checkbox) => checkbox.value)
}

function matchesCurrentFilters(item) {
  const keyword = normalizeText(byId('keyword').value)
  const source = normalizeText(byId('source').value)
  const title = normalizeText(byId('title').value)
  const categories = getSelectedCategories().map(normalizeText)
  const allCategories = Array.from(byId('category').querySelectorAll('input[type="checkbox"]')).map((checkbox) =>
    normalizeText(checkbox.value)
  )
  const region = normalizeText(byId('region').value)
  const applyTarget = normalizeText(byId('applyTarget').value)
  const managingOrg = normalizeText(byId('managingOrg').value)
  const executingOrg = normalizeText(byId('executingOrg').value)
  const period = normalizeText(byId('period').value)
  const status = normalizeText(byId('status').value)
  const statusInfo = getStatusInfo(item)

  if (source && normalizeText(item.source) !== source) {
    return false
  }

  if (title && !normalizeText(item.title).includes(title)) {
    return false
  }

  if (categories.length > 0 && categories.length < allCategories.length && !categories.includes(normalizeText(item.category))) {
    return false
  }

  if (region && normalizeText(item.region) !== region) {
    return false
  }

  if (applyTarget && !normalizeText(item.applyTarget).includes(applyTarget) && !normalizeText(item.summary).includes(applyTarget)) {
    return false
  }

  if (managingOrg && !normalizeText(item.managingOrg).includes(managingOrg)) {
    return false
  }

  if (executingOrg && !normalizeText(item.executingOrg).includes(executingOrg)) {
    return false
  }

  if (period && !normalizeText(item.applyPeriodText).includes(period)) {
    return false
  }

  if (status && statusInfo.key !== status) {
    return false
  }

  if (keyword) {
    const searchText = normalizeText(
      [item.title, item.source, item.category, item.region, item.managingOrg, item.executingOrg, item.summary, item.searchText].join(
        ' '
      )
    )

    if (!searchText.includes(keyword)) {
      return false
    }
  }

  return true
}

function mapRowToItem(row) {
  return {
    id: row.id || '',
    sourceKey: row.source_key || '',
    source: row.source || '',
    sourceId: row.source_id || '',
    title: row.title || '',
    summary: row.summary || '',
    category: row.category || '',
    region: row.region || '',
    managingOrg: row.managing_org || '',
    executingOrg: row.executing_org || '',
    supervisingInstitutionType: row.supervising_institution_type || '',
    applicationMethod: row.application_method || '',
    applicationSite: row.application_site || '',
    applicationUrl: row.application_url || '',
    detailUrl: row.detail_url || '',
    originUrl: row.origin_url || '',
    contact: row.contact || '',
    applyTarget: row.apply_target || '',
    applyAge: row.apply_age || '',
    experience: row.experience || '',
    preferred: row.preferred || '',
    applicantExclusion: row.applicant_exclusion || '',
    postedAt: row.posted_at || '',
    applyStart: row.apply_start || '',
    applyEnd: row.apply_end || '',
    applyPeriodText: row.apply_period_text || '',
    statusKey: row.status_key || '',
    isNew: Boolean(row.is_new),
    searchText: row.search_text || '',
    firstSeenAt: row.first_seen_at || '',
    lastSeenAt: row.last_seen_at || '',
    tags: Array.isArray(row.tags) ? row.tags : []
  }
}

function populateSelect(id, values, placeholder) {
  const select = byId(id)

  if (!select) {
    return
  }

  const previous = [select.value]
  select.innerHTML = ''

  const defaultOption = document.createElement('option')
  defaultOption.value = ''
  defaultOption.textContent = placeholder
  select.appendChild(defaultOption)

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

function clearAllCategories() {
  Array.from(byId('category').querySelectorAll('input[type="checkbox"]')).forEach((checkbox) => {
    checkbox.checked = false
  })
}

function applyInitialFilterDefaults() {
  if (state.initialFiltersApplied) {
    return
  }

  byId('category').querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = true
  })
  byId('applyTarget').value = '예비'
  byId('status').value = 'ongoing'
  state.initialFiltersApplied = true
}

function getTabActions() {
  if (state.activeTab === 'open') {
    return [
      {
        key: 'pending',
        label: '예정',
        confirmMessage: '이 공고를 지원예정 탭으로 이동할까요?'
      }
    ]
  }

  if (state.activeTab === 'pending') {
    return [
      {
        key: 'completed',
        label: '완료',
        confirmMessage: '이 공고를 지원완료 탭으로 이동할까요?'
      },
      {
        key: 'open',
        label: '목록',
        confirmMessage: '이 공고를 지원사업 목록으로 되돌릴까요?'
      }
    ]
  }

  if (state.activeTab === 'completed') {
    return [
      {
        key: 'pending',
        label: '예정',
        confirmMessage: '이 공고를 다시 지원예정 탭으로 이동할까요?'
      }
    ]
  }

  return []
}

function createActionControls(item) {
  const actions = getTabActions()

  if (!actions.length) {
    const span = document.createElement('span')
    span.className = 'action-complete'
    span.textContent = '완료'
    return span
  }

  const isBusy = state.togglingIds.has(item.id)
  const wrapper = document.createElement('div')
  wrapper.className = 'workflow-actions'

  actions.forEach((action) => {
    const button = document.createElement('button')

    button.type = 'button'
    button.className = `workflow-action workflow-${action.key}`
    button.dataset.workflowAction = action.key
    button.dataset.announcementId = item.id
    button.disabled = isBusy
    button.textContent = action.label
    button.title = action.label
    wrapper.appendChild(button)
  })

  return wrapper
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
    const sourceCell = fragment.querySelector('.source-cell')
    const titleCell = fragment.querySelector('.title-cell')
    const categoryCell = fragment.querySelector('.category-cell')
    const regionCell = fragment.querySelector('.region-cell')
    const managingCell = fragment.querySelector('.managing-cell')
    const executingCell = fragment.querySelector('.executing-cell')
    const periodCell = fragment.querySelector('.period-cell')
    const statusCell = fragment.querySelector('.status-cell')
    const actionCell = fragment.querySelector('.action-cell')

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
    actionCell.appendChild(createActionControls(item))

    body.appendChild(fragment)

    mobileFragment.querySelector('.mobile-card-badges').innerHTML =
      `<span class="mobile-pill">${escapeHtml(sourceText)}</span>` +
      `<span class="mobile-pill">${escapeHtml(categoryText)}</span>`
    mobileFragment.querySelector('.mobile-card-applied').appendChild(createStatusBadge(statusInfo))
    mobileFragment.querySelector('.mobile-card-title').replaceWith(createTitleLink(item, 'mobile-card-title'))
    mobileFragment.querySelector('.mobile-card-meta').textContent = `${sourceText} · ${categoryText}`
    mobileFragment.querySelector('.mobile-region').textContent = regionText
    mobileFragment.querySelector('.mobile-period').textContent = periodText
    mobileFragment.querySelector('.mobile-managing').textContent = managingText
    mobileFragment.querySelector('.mobile-executing').textContent = executingText
    mobileFragment.querySelector('.mobile-card-action').appendChild(createActionControls(item))

    mobileBody.appendChild(mobileFragment)
  })
}

function quoteCsv(value) {
  return `"${String(value || '').replaceAll('"', '""')}"`
}

function toCsv(rows) {
  return rows.map((row) => row.map(quoteCsv).join(',')).join('\n')
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function updateExportLink() {
  const link = byId('export-link')

  if (state.activeTab !== 'open') {
    link.href = '#'
    link.classList.add('is-disabled')
    link.title = '지원사업 목록 탭에서만 다운로드할 수 있습니다.'
    return
  }

  link.href = '#'
  link.classList.remove('is-disabled')
  link.title = ''
}

function buildOrderClause() {
  const sort = byId('sort').value || 'latest'

  if (sort === 'deadline') {
    return 'is_new.desc,apply_end.asc.nullslast,posted_at.desc.nullslast'
  }

  if (sort === 'source') {
    return 'is_new.desc,source.asc,title.asc'
  }

  if (sort === 'title') {
    return 'is_new.desc,title.asc'
  }

  return 'is_new.desc,posted_at.desc.nullslast,apply_end.asc.nullslast'
}

function buildOpenQuery(page, pageSize) {
  const params = new URLSearchParams()
  const keyword = byId('keyword').value.trim()
  const source = byId('source').value.trim()
  const title = byId('title').value.trim()
  const categories = getSelectedCategories()
  const allCategories = Array.from(byId('category').querySelectorAll('input[type="checkbox"]')).map((checkbox) => checkbox.value)
  const region = byId('region').value.trim()
  const applyTarget = byId('applyTarget').value.trim()
  const managingOrg = byId('managingOrg').value.trim()
  const executingOrg = byId('executingOrg').value.trim()
  const period = byId('period').value.trim()
  const status = byId('status').value.trim()

  params.set('select', OPEN_SELECT_COLUMNS)
  params.set('order', buildOrderClause())
  params.set('limit', String(pageSize))
  params.set('offset', String((page - 1) * pageSize))

  if (source) {
    params.set('source', `eq.${source}`)
  }

  if (title) {
    params.set('title', `ilike.*${title}*`)
  }

  if (categories.length > 0 && categories.length < allCategories.length) {
    params.set('category', `in.(${categories.map((value) => `"${value.replaceAll('"', '\\"')}"`).join(',')})`)
  }

  if (region) {
    params.set('region', `eq.${region}`)
  }

  if (applyTarget) {
    params.set('or', `(apply_target.ilike.*${applyTarget}*,summary.ilike.*${applyTarget}*)`)
  }

  if (managingOrg) {
    params.set('managing_org', `ilike.*${managingOrg}*`)
  }

  if (executingOrg) {
    params.set('executing_org', `ilike.*${executingOrg}*`)
  }

  if (period) {
    params.set('apply_period_text', `ilike.*${period}*`)
  }

  if (status) {
    params.set('status_key', `eq.${status}`)
  }

  if (keyword) {
    params.set('search_text', `ilike.*${keyword}*`)
  }

  return `${OPEN_VIEW_NAME}?${params.toString()}`
}

async function fetchOpenAnnouncementsPage(page, pageSize, includeCount = false) {
  const result = await fetchSupabase(buildOpenQuery(page, pageSize), {
    includeCount
  })

  return {
    items: Array.isArray(result.data) ? result.data.map(mapRowToItem) : [],
    total: includeCount ? parseContentRange(result.headers) : 0
  }
}

async function loadMeta() {
  const result = await fetchSupabase(
    `support_state?select=state_value&state_key=eq.${encodeURIComponent(META_STATE_KEY)}&limit=1`
  )
  const meta = Array.isArray(result.data) && result.data[0] ? result.data[0].state_value || {} : {}

  state.totalAnnouncements = Number(meta.total || 0)
  byId('total-count').textContent = state.totalAnnouncements.toLocaleString('ko-KR')
  state.lastSyncAt = meta.lastSyncAt || state.lastSyncAt
  byId('last-sync').textContent = formatDateTime(state.lastSyncAt)

  const facets = meta.facets || {}
  populateSelect('source', facets.sources || [], '전체 출처')
  populateCategoryChips(facets.categories || [])
  populateSelect('region', facets.regions || [], '전체 지역')
}

function paginateClient(items, page, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1)
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const start = (safePage - 1) * pageSize

  return {
    page: safePage,
    totalPages,
    total: items.length,
    items: items.slice(start, start + pageSize)
  }
}

function getWorkflowItemsByStatus(workflowStatus) {
  return Object.values(state.workflowMap).filter((item) => item.workflowStatus === workflowStatus)
}

function updateTabCounts(openCount) {
  const hiddenCount = Object.keys(state.workflowMap).length
  const defaultOpenCount = Math.max(state.totalAnnouncements - hiddenCount, 0)
  byId('tab-open-count').textContent = `(${(openCount === undefined ? defaultOpenCount : openCount).toLocaleString('ko-KR')})`
  byId('tab-pending-count').textContent = `(${getWorkflowItemsByStatus('pending').length.toLocaleString('ko-KR')})`
  byId('tab-completed-count').textContent = `(${getWorkflowItemsByStatus('completed').length.toLocaleString('ko-KR')})`
}

function updateTabButtons() {
  byId('tab-open').classList.toggle('is-active', state.activeTab === 'open')
  byId('tab-pending').classList.toggle('is-active', state.activeTab === 'pending')
  byId('tab-completed').classList.toggle('is-active', state.activeTab === 'completed')
}

function renderSyncStages(progress) {
  const container = byId('sync-stage-list')

  if (!container) {
    return
  }

  const stages = progress && progress.stages ? Object.values(progress.stages) : []
  container.innerHTML = ''

  if (!stages.length) {
    const empty = document.createElement('li')
    empty.className = 'sync-stage-empty'
    empty.textContent = 'GitHub Actions 대기 중'
    container.appendChild(empty)
    return
  }

  stages.forEach((stage) => {
    const item = document.createElement('li')
    const total = Number(stage.total || 0)
    const current = Number(stage.current || 0)
    const percent = total > 0 ? Math.min(Math.round((current / total) * 100), 100) : stage.done ? 100 : 0

    item.className = 'sync-stage-item'
    item.innerHTML =
      `<span class="sync-stage-label">${escapeHtml(stage.label || stage.stage || '-')}</span>` +
      `<span class="sync-stage-meta">${escapeHtml(stage.phase || '')} ${percent}%</span>`
    item.title = stage.message || stage.label || stage.stage || ''
    container.appendChild(item)
  })
}

function getSyncStatusText(status) {
  if (status && status.isRunning) {
    return '동기화 중'
  }

  if ((status && status.summary && status.summary.error) || String(status && status.message ? status.message : '').includes('실패')) {
    return '동기화 실패'
  }

  if ((status && status.summary && status.summary.finishedAt) || status.finishedAt) {
    return '동기화 완료'
  }

  return '대기 중'
}

async function loadOpenAnnouncements() {
  const hiddenIds = new Set(Object.keys(state.workflowMap))
  const firstPage = await fetchOpenAnnouncementsPage(state.page, PAGE_SIZE * 2, true)
  const visibleItems = []
  let scannedItems = firstPage.items
  let extraPage = state.page + 1

  while (visibleItems.length < PAGE_SIZE && scannedItems.length > 0) {
    scannedItems.forEach((item) => {
      if (!hiddenIds.has(item.id) && visibleItems.length < PAGE_SIZE) {
        visibleItems.push(item)
      }
    })

    if (visibleItems.length >= PAGE_SIZE) {
      break
    }

    const extraChunk = await fetchOpenAnnouncementsPage(extraPage, PAGE_SIZE * 2, false)

    if (!extraChunk.items.length) {
      break
    }

    scannedItems = extraChunk.items
    extraPage += 1
  }

  state.totalPages = Math.max(Math.ceil(Math.max(firstPage.total - hiddenIds.size, 0) / PAGE_SIZE), 1)
  state.currentItems = visibleItems
  renderRows(visibleItems)
  updateTabCounts(Math.max(firstPage.total - hiddenIds.size, 0))

  byId('filtered-count').textContent = Math.max(firstPage.total - hiddenIds.size, 0).toLocaleString('ko-KR')
  byId('page-indicator').textContent = `${state.page} / ${state.totalPages}`
  byId('result-summary').textContent =
    `Supabase 검색 ${Math.max(firstPage.total - hiddenIds.size, 0).toLocaleString('ko-KR')}건 중 현재 페이지 ${visibleItems.length.toLocaleString('ko-KR')}건 표시`
}

async function loadAnnouncements() {
  updateExportLink()
  updateTabButtons()

  if (state.activeTab === 'open') {
    await loadOpenAnnouncements()
    return
  }

  const workflowStatus = state.activeTab === 'pending' ? 'pending' : 'completed'
  const workflowItems = getWorkflowItemsByStatus(workflowStatus)
  const paginated = paginateClient(workflowItems, state.page, PAGE_SIZE)

  state.page = paginated.page
  state.totalPages = paginated.totalPages
  state.currentItems = paginated.items
  renderRows(paginated.items)
  updateTabCounts()

  byId('filtered-count').textContent = paginated.total.toLocaleString('ko-KR')
  byId('page-indicator').textContent = `${paginated.page} / ${paginated.totalPages}`
  byId('result-summary').textContent =
    `${state.activeTab === 'pending' ? '지원예정' : '지원완료'} ${paginated.total.toLocaleString('ko-KR')}건 중 ${paginated.items.length.toLocaleString('ko-KR')}건 표시`
}

async function loadSyncStatus() {
  const result = await fetchSupabase(
    `support_state?select=state_value&state_key=eq.${encodeURIComponent(SYNC_STATE_KEY)}&limit=1`
  )
  const status = Array.isArray(result.data) && result.data[0] ? result.data[0].state_value || {} : {}

  state.lastKnownSyncRunning = state.syncRunning
  state.syncRunning = Boolean(status.isRunning)

  byId('sync-status').textContent = getSyncStatusText(status)
  byId('sync-button').disabled = false
  byId('sync-progress-fill').style.width = `${(status.progress && status.progress.percent) || 0}%`
  byId('sync-progress-text').textContent = `${(status.progress && status.progress.percent) || 0}%`
  renderSyncStages(status.progress)

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
  const button = byId('sync-button')

  if (!syncFunctionUrl) {
    window.open(workflowUrl, '_blank', 'noopener,noreferrer')
    return
  }

  try {
    button.disabled = true

    const response = await fetch(syncFunctionUrl, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })

    const text = await response.text()
    let payload = {}

    if (text) {
      try {
        payload = JSON.parse(text)
      } catch (error) {
        payload = { error: text }
      }
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('trigger-sync Edge Function이 아직 배포되지 않았습니다.')
      }
      throw new Error(payload.error || `동기화 호출 실패 (${response.status})`)
    }

    byId('sync-status').textContent = '동기화 중'
    byId('sync-progress-text').textContent = '0%'
    byId('sync-progress-fill').style.width = '0%'

    setTimeout(async () => {
      try {
        await loadSyncStatus()
      } catch (error) {
        console.error(error)
      }
    }, 1500)
  } catch (error) {
    console.error(error)
    alert(error.message || '동기화 요청에 실패했습니다.')
  } finally {
    button.disabled = false
  }
}

async function exportCurrentRows() {
  if (state.activeTab !== 'open') {
    return
  }

  const hiddenIds = new Set(Object.keys(state.workflowMap))
  const rows = []
  let page = 1

  while (true) {
    const chunk = await fetchOpenAnnouncementsPage(page, 1000, false)

    if (!chunk.items.length) {
      break
    }

    chunk.items.forEach((item) => {
      if (!hiddenIds.has(item.id)) {
        rows.push(item)
      }
    })

    if (chunk.items.length < 1000) {
      break
    }

    page += 1
  }

  const csvRows = [
    ['상태', '출처', '공고명', '분야', '지역', '주관기관', '수행기관', '신청기간', '상세URL'],
    ...rows.map((item) => [
      getStatusInfo(item).text,
      item.source,
      item.title,
      item.category,
      item.region,
      item.managingOrg,
      item.executingOrg,
      item.applyPeriodText,
      item.detailUrl || item.originUrl || ''
    ])
  ]

  downloadBlob(
    `support-programs-${new Date().toISOString().slice(0, 10)}.csv`,
    `\uFEFF${toCsv(csvRows)}`,
    'text/csv;charset=utf-8'
  )
}

async function applyFilters() {
  state.page = 1
  await loadAnnouncements()
}

async function loadAppliedState() {
  try {
    state.workflowMap = await window.AppliedStore.load()
  } catch (error) {
    console.error(error)
    state.workflowMap = {}
  }

  const storageMode = byId('storage-mode')

  if (storageMode) {
    storageMode.textContent = window.AppliedStore.getModeLabel()
  }
}

function updateWorkflowButtons(itemId) {
  document.querySelectorAll('[data-workflow-action]').forEach((button) => {
    if (button.dataset.announcementId !== itemId) {
      return
    }

    const isBusy = state.togglingIds.has(itemId)

    button.disabled = isBusy
  })
}

async function moveWorkflow(itemId, workflowStatus) {
  const item = state.currentItems.find((entry) => entry.id === itemId) || getWorkflowRecord(itemId)

  if (!item || state.togglingIds.has(itemId)) {
    return
  }

  const action =
    workflowStatus === 'pending'
      ? { confirmMessage: '이 공고를 지원예정 탭으로 이동할까요?' }
      : workflowStatus === 'completed'
        ? { confirmMessage: '이 공고를 지원완료 탭으로 이동할까요?' }
        : { confirmMessage: '이 공고를 지원사업 목록으로 되돌릴까요?' }

  if (!window.confirm(action.confirmMessage)) {
    return
  }

  state.togglingIds.add(itemId)
  updateWorkflowButtons(itemId)

  try {
    if (workflowStatus === 'open') {
      await window.AppliedStore.removeWorkflow(itemId)
      delete state.workflowMap[itemId]
    } else {
      await window.AppliedStore.setWorkflow(item, workflowStatus)
      state.workflowMap[itemId] = {
        ...item,
        workflowStatus
      }
    }

    await loadAnnouncements()
  } catch (error) {
    console.error(error)
    alert('지원 상태 저장에 실패했습니다.')
  } finally {
    state.togglingIds.delete(itemId)
    updateWorkflowButtons(itemId)
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
      element.selectedIndex = 0
    } else {
      element.value = ''
    }
  })

  byId('applyTarget').value = '예비'
  byId('status').value = 'ongoing'
}

async function refreshAll() {
  try {
    if (!isSupabaseReady()) {
      throw new Error('Supabase config missing')
    }

    await Promise.all([loadAppliedState(), loadMeta(), loadSyncStatus()])
    applyInitialFilterDefaults()
    await loadAnnouncements()
  } catch (error) {
    console.error(error)
    byId('result-summary').textContent = 'Supabase 연결에 실패했습니다. config.js 설정을 확인하세요.'
    byId('sync-status').textContent = 'Supabase 연결 실패'
  }
}

async function setActiveTab(tab) {
  state.activeTab = tab
  state.page = 1
  await loadAnnouncements()
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
byId('export-link').addEventListener('click', async (event) => {
  event.preventDefault()
  if (byId('export-link').classList.contains('is-disabled')) {
    return
  }
  await exportCurrentRows()
})
byId('apply-filters').addEventListener('click', applyFilters)
byId('reset-filters').addEventListener('click', async () => {
  resetFilters()
  await applyFilters()
})
byId('toggle-filters').addEventListener('click', () => {
  state.filtersOpen = !state.filtersOpen
  updateFilterPanelState()
})
byId('clear-categories').addEventListener('click', () => {
  clearAllCategories()
})
byId('tab-open').addEventListener('click', async () => {
  await setActiveTab('open')
})
byId('tab-pending').addEventListener('click', async () => {
  await setActiveTab('pending')
})
byId('tab-completed').addEventListener('click', async () => {
  await setActiveTab('completed')
})
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-workflow-action]')

  if (!button) {
    return
  }

  await moveWorkflow(button.dataset.announcementId, button.dataset.workflowAction)
})

setInterval(async () => {
  if (!accessGranted) {
    return
  }

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

async function boot() {
  updateFilterPanelState()
  updateExportLink()

  const allowed = await ensureAccess()

  if (!allowed) {
    return
  }

  await refreshAll()
}

boot()
