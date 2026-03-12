const fs = require('fs')
const path = require('path')
const { formatDateTime } = require('./utils')

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_FILE = path.join(DATA_DIR, 'supports.json')
const CACHE_DIR = path.join(DATA_DIR, 'cache')
let dbCache = null

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

function loadDatabase() {
  ensureStorage()

  if (dbCache) {
    return dbCache
  }

  dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  return dbCache
}

function saveDatabase(db) {
  ensureStorage()
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8')
  dbCache = db
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
  loadCache,
  loadDatabase,
  saveCache,
  saveDatabase
}
