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
      `${REMOTE_ANNOUNCEMENTS_TABLE}?select=payload&order=id.asc`,
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
      if (row && row.payload) {
        items.push(row.payload)
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
  const local = loadDatabase()
  const { enabled } = getRemoteConfig()

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

  dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  return dbCache
}

async function saveRemoteDatabase(db) {
  const items = Array.isArray(db.items) ? db.items : []
  const syncToken = formatDateTime()
  const batchSize = 250

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    await requestRemote(`${REMOTE_ANNOUNCEMENTS_TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(
        batch.map((item) => ({
          id: item.id,
          source: item.source || '',
          title: item.title || '',
          category: item.category || '',
          region: item.region || '',
          posted_at: item.postedAt || '',
          apply_start: item.applyStart || '',
          apply_end: item.applyEnd || '',
          status_key: item.statusKey || '',
          sync_token: syncToken,
          payload: item,
          updated_at: formatDateTime()
        }))
      )
    })
  }

  await requestRemote(`${REMOTE_ANNOUNCEMENTS_TABLE}?sync_token=neq.${encodeURIComponent(syncToken)}`, {
    method: 'DELETE'
  })

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

async function saveDatabase(db) {
  ensureStorage()
  writeDatabaseFile(db)

  if (getRemoteConfig().enabled) {
    await saveRemoteDatabase(db)
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
