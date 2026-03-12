const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const { formatDateTime } = require('./utils')

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_FILE = path.join(DATA_DIR, 'supports.json')
const CACHE_DIR = path.join(DATA_DIR, 'cache')
const PUBLIC_CONFIG_FILE = path.join(process.cwd(), 'public', 'config.js')
const REMOTE_ANNOUNCEMENTS_TABLE = 'support_announcements'
const REMOTE_STATE_TABLE = 'support_state'
const REMOTE_META_KEY = 'support_database_meta'
const MAX_LOCAL_DB_FILE_BYTES = Number(process.env.MAX_LOCAL_DB_FILE_BYTES || 48 * 1024 * 1024)
let dbCache = null
let remoteConfigCache = null

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(CACHE_DIR, { recursive: true })

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      items: [],
      meta: {
        lastSyncAt: null,
        lastSyncSummary: null,
        createdAt: formatDateTime()
      }
    }, null, 2), 'utf8')
  }
}

function writeDatabaseFile(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8')
  dbCache = db
}

function createEmptyDatabase() {
  return {
    items: [],
    meta: {
      lastSyncAt: null,
      lastSyncSummary: null,
      createdAt: formatDateTime()
    }
  }
}

function getLocalDatabaseFileSize() {
  try {
    return fs.statSync(DB_FILE).size
  } catch (error) {
    return 0
  }
}

function shouldSkipLargeLocalDatabase() {
  const { enabled } = getRemoteConfig()
  return enabled && getLocalDatabaseFileSize() > MAX_LOCAL_DB_FILE_BYTES
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }

  return []
}

function toPersistedAnnouncement(item = {}) {
  return {
    id: item.id || '',
    sourceKey: item.sourceKey || '',
    source: item.source || '',
    sourceId: item.sourceId || '',
    title: item.title || '',
    summary: item.summary || '',
    category: item.category || '',
    region: item.region || '',
    managingOrg: item.managingOrg || '',
    executingOrg: item.executingOrg || '',
    supervisingInstitutionType: item.supervisingInstitutionType || '',
    applicationMethod: item.applicationMethod || '',
    applicationSite: item.applicationSite || '',
    applicationUrl: item.applicationUrl || '',
    detailUrl: item.detailUrl || '',
    originUrl: item.originUrl || '',
    contact: item.contact || '',
    applyTarget: item.applyTarget || '',
    applyAge: item.applyAge || '',
    experience: item.experience || '',
    preferred: item.preferred || '',
    applicantExclusion: item.applicantExclusion || '',
    applyStart: item.applyStart || '',
    applyEnd: item.applyEnd || '',
    applyPeriodText: item.applyPeriodText || '',
    postedAt: item.postedAt || '',
    isOngoing: Boolean(item.isOngoing),
    searchText: item.searchText || '',
    firstSeenAt: item.firstSeenAt || '',
    lastSeenAt: item.lastSeenAt || '',
    tags: normalizeTags(item.tags)
  }
}

function fromRemoteAnnouncement(row = {}) {
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
    applyStart: row.apply_start || '',
    applyEnd: row.apply_end || '',
    applyPeriodText: row.apply_period_text || '',
    postedAt: row.posted_at || '',
    isOngoing: Boolean(row.is_ongoing),
    searchText: row.search_text || '',
    firstSeenAt: row.first_seen_at || '',
    lastSeenAt: row.last_seen_at || '',
    tags: normalizeTags(row.tags)
  }
}

function isSamePersistedAnnouncement(left = {}, right = {}) {
  return (
    left.id === right.id &&
    left.sourceKey === right.sourceKey &&
    left.source === right.source &&
    left.sourceId === right.sourceId &&
    left.title === right.title &&
    left.summary === right.summary &&
    left.category === right.category &&
    left.region === right.region &&
    left.managingOrg === right.managingOrg &&
    left.executingOrg === right.executingOrg &&
    left.supervisingInstitutionType === right.supervisingInstitutionType &&
    left.applicationMethod === right.applicationMethod &&
    left.applicationSite === right.applicationSite &&
    left.applicationUrl === right.applicationUrl &&
    left.detailUrl === right.detailUrl &&
    left.originUrl === right.originUrl &&
    left.contact === right.contact &&
    left.applyTarget === right.applyTarget &&
    left.applyAge === right.applyAge &&
    left.experience === right.experience &&
    left.preferred === right.preferred &&
    left.applicantExclusion === right.applicantExclusion &&
    left.applyStart === right.applyStart &&
    left.applyEnd === right.applyEnd &&
    left.applyPeriodText === right.applyPeriodText &&
    left.postedAt === right.postedAt &&
    left.isOngoing === right.isOngoing &&
    left.searchText === right.searchText &&
    left.firstSeenAt === right.firstSeenAt &&
    left.lastSeenAt === right.lastSeenAt &&
    JSON.stringify(normalizeTags(left.tags)) === JSON.stringify(normalizeTags(right.tags))
  )
}

function readPublicConfig() {
  if (!fs.existsSync(PUBLIC_CONFIG_FILE)) {
    return {}
  }

  const file = fs.readFileSync(PUBLIC_CONFIG_FILE, 'utf8')
  const readValue = (key) => {
    const match = file.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`))
    return match ? match[1] : ''
  }

  return {
    supabaseUrl: readValue('supabaseUrl'),
    supabaseAnonKey: readValue('supabaseAnonKey')
  }
}

function getRemoteConfig() {
  if (remoteConfigCache) {
    return remoteConfigCache
  }

  const publicConfig = readPublicConfig()
  const supabaseUrl = String(process.env.SUPABASE_URL || publicConfig.supabaseUrl || '').replace(/\/$/, '')
  const supabaseKey = String(
    process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      publicConfig.supabaseAnonKey ||
      ''
  )

  remoteConfigCache = {
    enabled: Boolean(supabaseUrl && supabaseKey),
    supabaseUrl,
    supabaseKey
  }

  return remoteConfigCache
}

function getRemoteHeaders(extra = {}) {
  const { supabaseKey } = getRemoteConfig()
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    ...extra
  }
}

async function requestRemote(pathname, options = {}) {
  const { enabled, supabaseUrl } = getRemoteConfig()

  if (!enabled) {
    throw new Error('Remote storage is not configured.')
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: getRemoteHeaders(options.headers || {})
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Remote storage failed: ${response.status} ${message}`)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

async function deleteRemoteAnnouncements(ids) {
  const chunkSize = 200

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize)
    if (!chunk.length) {
      continue
    }

    const encodedIds = chunk.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(',')
    await requestRemote(`${REMOTE_ANNOUNCEMENTS_TABLE}?id=in.(${encodedIds})`, {
      method: 'DELETE'
    })
  }
}

async function loadRemoteMeta() {
  const rows = await requestRemote(
    `${REMOTE_STATE_TABLE}?select=state_value&state_key=eq.${encodeURIComponent(REMOTE_META_KEY)}&limit=1`
  )

  return rows[0] ? rows[0].state_value || {} : {}
}

async function loadRemoteItems() {
  const items = []
  const pageSize = 1000
  let from = 0

  while (true) {
    const to = from + pageSize - 1
    const rows = await requestRemote(
      `${REMOTE_ANNOUNCEMENTS_TABLE}?select=id,source_key,source,source_id,title,summary,category,region,managing_org,executing_org,supervising_institution_type,application_method,application_site,application_url,detail_url,origin_url,contact,apply_target,apply_age,experience,preferred,applicant_exclusion,apply_start,apply_end,apply_period_text,posted_at,is_ongoing,search_text,first_seen_at,last_seen_at,tags&order=id.asc`,
      {
        headers: {
          Range: `${from}-${to}`,
          'Range-Unit': 'items'
        }
      }
    )

    if (!Array.isArray(rows) || rows.length === 0) {
      break
    }

    rows.forEach((row) => {
      if (row && row.id) {
        items.push(fromRemoteAnnouncement(row))
      }
    })

    if (rows.length < pageSize) {
      break
    }

    from += pageSize
  }

  return items
}

async function initializeStorage() {
  ensureStorage()
  const { enabled } = getRemoteConfig()
  const skipLargeLocal = shouldSkipLargeLocalDatabase()
  const local = skipLargeLocal ? createEmptyDatabase() : loadDatabase()

  if (skipLargeLocal) {
    console.warn(`Skipping oversized local supports.json (${getLocalDatabaseFileSize()} bytes) and preferring remote restore.`)
  }

  if (!enabled || local.items.length > 0) {
    return local
  }

  try {
    const [meta, items] = await Promise.all([loadRemoteMeta(), loadRemoteItems()])

    if (!items.length && !meta.lastSyncAt && !meta.lastSyncSummary) {
      return local
    }

    const remoteDb = {
      items,
      meta: {
        ...local.meta,
        ...meta
      }
    }

    writeDatabaseFile(remoteDb)
    return remoteDb
  } catch (error) {
    console.error(`Remote storage restore failed: ${error.message}`)
    return local
  }
}

function loadDatabase() {
  ensureStorage()

  if (dbCache) {
    return dbCache
  }

  if (shouldSkipLargeLocalDatabase()) {
    dbCache = createEmptyDatabase()
    return dbCache
  }

  dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  return dbCache
}

async function saveRemoteDatabase(db, previousDb = null) {
  const items = Array.isArray(db.items) ? db.items.map(toPersistedAnnouncement) : []
  const previousItems = Array.isArray(previousDb && previousDb.items) ? previousDb.items.map(toPersistedAnnouncement) : []
  const previousById = new Map(previousItems.map((item) => [item.id, item]))
  const currentIds = new Set(items.map((item) => item.id))
  const changedItems = items.filter((item) => !isSamePersistedAnnouncement(previousById.get(item.id), item))
  const removedIds = previousItems.filter((item) => !currentIds.has(item.id)).map((item) => item.id)
  const batchSize = 250
  const syncToken = formatDateTime()

  for (let index = 0; index < changedItems.length; index += batchSize) {
    const batch = changedItems.slice(index, index + batchSize)
    await requestRemote(`${REMOTE_ANNOUNCEMENTS_TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(
        batch.map((item) => ({
          id: item.id,
          source_key: item.sourceKey || '',
          source: item.source || '',
          source_id: item.sourceId || '',
          title: item.title || '',
          summary: item.summary || '',
          category: item.category || '',
          region: item.region || '',
          managing_org: item.managingOrg || '',
          executing_org: item.executingOrg || '',
          supervising_institution_type: item.supervisingInstitutionType || '',
          application_method: item.applicationMethod || '',
          application_site: item.applicationSite || '',
          application_url: item.applicationUrl || '',
          detail_url: item.detailUrl || '',
          origin_url: item.originUrl || '',
          contact: item.contact || '',
          apply_target: item.applyTarget || '',
          apply_age: item.applyAge || '',
          experience: item.experience || '',
          preferred: item.preferred || '',
          applicant_exclusion: item.applicantExclusion || '',
          posted_at: item.postedAt || '',
          apply_start: item.applyStart || '',
          apply_end: item.applyEnd || '',
          apply_period_text: item.applyPeriodText || '',
          search_text: item.searchText || '',
          first_seen_at: item.firstSeenAt || '',
          last_seen_at: item.lastSeenAt || '',
          tags: normalizeTags(item.tags),
          payload: {},
          sync_token: syncToken,
          updated_at: formatDateTime()
        }))
      )
    })
  }

  if (removedIds.length) {
    await deleteRemoteAnnouncements(removedIds)
  }

  await requestRemote(`${REMOTE_STATE_TABLE}?on_conflict=state_key`, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify([
      {
        state_key: REMOTE_META_KEY,
        state_value: db.meta || {},
        updated_at: formatDateTime()
      }
    ])
  })
}

async function saveDatabase(db, options = {}) {
  ensureStorage()
  const previousDb = options.previousDb || null
  const persistedDb = {
    ...db,
    items: Array.isArray(db.items) ? db.items.map(toPersistedAnnouncement) : []
  }

  writeDatabaseFile(persistedDb)

  if (getRemoteConfig().enabled) {
    await saveRemoteDatabase(persistedDb, previousDb)
  }
}

function loadCache(name, fallback = {}) {
  ensureStorage()
  const file = path.join(CACHE_DIR, name)

  if (!fs.existsSync(file)) {
    return fallback
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function saveCache(name, value) {
  ensureStorage()
  const file = path.join(CACHE_DIR, name)
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

module.exports = {
  CACHE_DIR,
  DATA_DIR,
  DB_FILE,
  ensureStorage,
  initializeStorage,
  loadCache,
  loadDatabase,
  saveCache,
  saveDatabase
}
