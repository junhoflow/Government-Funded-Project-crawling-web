const express = require('express')
const path = require('path')
const XLSX = require('xlsx')
const { filterAnnouncements, buildFacets, dedupeAnnouncements } = require('./src/lib/filters')
const { ensureStorage, loadDatabase } = require('./src/lib/storage')
const { syncSupportPrograms } = require('./src/services/sync')
const { getAnnouncementStatus, isDateNearToday } = require('./src/lib/utils')

ensureStorage()

const app = express()
const PORT = process.env.PORT || 3000
const IS_SYNC_ONLY = process.argv.includes('--sync-only')
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const syncState = {
  isRunning: false,
  startedAt: null,
  finishedAt: null,
  message: '대기 중',
  summary: null,
  progress: {
    percent: 0,
    stages: {}
  },
  mode: {
    includeBizinfoClosed: true
  }
}
let facetsCache = null
let facetsCacheKey = ''
let decoratedDbCache = null
let decoratedDbCacheKey = ''

app.use(express.json())
app.use((req, res, next) => {
  const allowedOrigins = CORS_ORIGIN.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const requestOrigin = req.headers.origin
  const matchedOrigin =
    allowedOrigins.includes('*') || !requestOrigin
      ? allowedOrigins[0] || '*'
      : allowedOrigins.includes(requestOrigin)
        ? requestOrigin
        : ''

  if (matchedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', matchedOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey')
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  return next()
})
app.use(express.static(path.join(__dirname, 'public')))

function getDatabase() {
  const db = loadDatabase()
  const today = new Date().toISOString().slice(0, 10)
  const key = `${db.items.length}:${db.meta.lastSyncAt || ''}:${today}`

  if (decoratedDbCache && decoratedDbCacheKey === key) {
    return decoratedDbCache
  }

  decoratedDbCache = {
    ...db,
    items: db.items.map((item) => ({
      ...item,
      isNew: isDateNearToday(item.applyStart, 2, new Date())
    }))
  }
  decoratedDbCacheKey = key
  return decoratedDbCache
}

function getFacets(db) {
  const key = `${db.items.length}:${db.meta.lastSyncAt || ''}`

  if (facetsCache && facetsCacheKey === key) {
    return facetsCache
  }

  facetsCache = buildFacets(db.items)
  facetsCacheKey = key
  return facetsCache
}

function getFiltered(req) {
  const db = getDatabase()
  return {
    db,
    items: filterAnnouncements(db.items, req.query)
  }
}

function paginate(items, page, pageSize) {
  const safePage = Math.max(Number(page) || 1, 1)
  const safePageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 200)
  const start = (safePage - 1) * safePageSize

  return {
    page: safePage,
    pageSize: safePageSize,
    total: items.length,
    totalPages: Math.max(Math.ceil(items.length / safePageSize), 1),
    items: items.slice(start, start + safePageSize)
  }
}

function createStageConfig(includeBizinfoClosed) {
  const stages = {
    kstartup: { label: 'K-Startup', weight: 1 },
    bizinfoOpen: { label: '기업마당 진행공고', weight: 1 },
    fanfandaero: { label: '판판대로', weight: 1 },
    sodam: { label: '소담상회', weight: 1 },
    bizok: { label: '인천 비즈오케이', weight: 1 },
    thevc: { label: 'THE VC', weight: 1 }
  }

  if (includeBizinfoClosed) {
    stages.bizinfoClosed = { label: '기업마당 지난공고', weight: 1 }
  }

  return stages
}

function computeProgressPercent(stages) {
  const entries = Object.values(stages)

  if (entries.length === 0) {
    return 0
  }

  const totalWeight = entries.reduce((sum, stage) => sum + (stage.weight || 1), 0)
  const weighted = entries.reduce((sum, stage) => {
    const weight = stage.weight || 1
    const total = Number(stage.total || 0)
    const current = Number(stage.current || 0)
    const fraction = total > 0 ? Math.min(current / total, 1) : stage.done ? 1 : 0
    return sum + fraction * weight
  }, 0)

  return Math.round((weighted / totalWeight) * 100)
}

function updateSyncProgress(progress) {
  if (!progress || !progress.stage || progress.stage === 'sync') {
    return
  }

  const currentStages = syncState.progress.stages
  const currentStage = currentStages[progress.stage] || {}

  syncState.progress.stages = {
    ...currentStages,
    [progress.stage]: {
      ...currentStage,
      stage: progress.stage,
      label: currentStage.label || progress.stage,
      weight: currentStage.weight || 1,
      phase: progress.phase || currentStage.phase || '',
      current: progress.current !== undefined ? progress.current : currentStage.current || 0,
      total: progress.total !== undefined ? progress.total : currentStage.total || 0,
      done: progress.phase === 'done' || currentStage.done || false,
      message: progress.message || currentStage.message || ''
    }
  }

  syncState.progress.percent = computeProgressPercent(syncState.progress.stages)
}

function toExportRows(items) {
  return items.map((item) => ({
    상태: getAnnouncementStatus(item).text,
    출처: item.source,
    공고ID: item.sourceId,
    공고명: item.title,
    지원분야: item.category,
    지역: item.region,
    주관기관: item.managingOrg,
    수행기관: item.executingOrg,
    주관기관유형: item.supervisingInstitutionType,
    신청대상: item.applyTarget,
    신청기간: item.applyPeriodText,
    시작일: item.applyStart,
    종료일: item.applyEnd,
    공고일: item.postedAt,
    모집중여부: getAnnouncementStatus(item).key === 'ongoing' ? 'Y' : 'N',
    요약: item.summary,
    신청방법: item.applicationMethod,
    신청사이트: item.applicationSite,
    신청URL: item.applicationUrl,
    상세URL: item.detailUrl,
    원문URL: item.originUrl,
    문의처: item.contact,
    사업업력: item.experience,
    대상연령: item.applyAge,
    우대사항: item.preferred,
    제외대상: item.applicantExclusion,
    태그: (item.tags || []).join(', ')
  }))
}

async function startSync(options = {}) {
  if (syncState.isRunning) {
    return false
  }

  const includeBizinfoClosed = options.includeBizinfoClosed === undefined ? true : Boolean(options.includeBizinfoClosed)

  syncState.isRunning = true
  syncState.startedAt = new Date().toISOString()
  syncState.finishedAt = null
  syncState.summary = null
  syncState.mode = {
    includeBizinfoClosed
  }
  syncState.progress = {
    percent: 0,
    stages: createStageConfig(includeBizinfoClosed)
  }
  syncState.message = '동기화 시작'

  syncSupportPrograms({
    includeBizinfoClosed,
    onProgress: (progress) => {
      syncState.message = progress.message || syncState.message
      updateSyncProgress(progress)

      if (IS_SYNC_ONLY && progress.message) {
        console.error(`[${progress.stage || 'sync'}] ${progress.message}`)
      }

      if (progress.summary) {
        syncState.summary = progress.summary
      }
    }
  })
    .then((summary) => {
      syncState.summary = summary
      syncState.message = '동기화 완료'
      syncState.finishedAt = new Date().toISOString()
      syncState.progress.percent = 100
    })
    .catch((error) => {
      syncState.message = `동기화 실패: ${error.message}`
      syncState.finishedAt = new Date().toISOString()
      syncState.summary = { error: error.message }
      console.error(error)
    })
    .finally(() => {
      syncState.isRunning = false
    })

  return true
}

app.get('/api/meta', (req, res) => {
  const db = getDatabase()
  const facets = getFacets(db)
  const dedupedItems = dedupeAnnouncements(
    [...db.items].sort((left, right) => String(right.postedAt || '').localeCompare(String(left.postedAt || '')))
  )

  res.json({
    total: dedupedItems.length,
    lastSyncAt: db.meta.lastSyncAt,
    lastSyncSummary: db.meta.lastSyncSummary,
    facets
  })
})

app.get('/api/announcements', (req, res) => {
  const { items } = getFiltered(req)
  const result = paginate(items, req.query.page, req.query.pageSize)

  res.json(result)
})

app.get('/api/announcements/export.xlsx', (req, res) => {
  const { items } = getFiltered(req)
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(toExportRows(items))

  XLSX.utils.book_append_sheet(workbook, sheet, '지원사업')

  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx'
  })

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="support-programs-${new Date().toISOString().slice(0, 10)}.xlsx"`
  )
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.send(buffer)
})

app.get('/api/sync-status', (req, res) => {
  res.json(syncState)
})

app.post('/api/sync', async (req, res) => {
  const started = await startSync({
    includeBizinfoClosed:
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'includeBizinfoClosed')
        ? Boolean(req.body.includeBizinfoClosed)
        : undefined
  })

  if (!started) {
    return res.status(409).json({
      ok: false,
      message: '이미 동기화가 진행 중입니다.'
    })
  }

  return res.json({
    ok: true,
    message: '동기화를 시작했습니다.'
  })
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

if (IS_SYNC_ONLY) {
  startSync({
    includeBizinfoClosed: process.argv.includes('--include-bizinfo-closed')
      ? true
      : process.argv.includes('--exclude-bizinfo-closed')
        ? false
        : undefined
  }).then((started) => {
    if (!started) {
      process.exit(1)
    }

    const timer = setInterval(() => {
      if (!syncState.isRunning) {
        clearInterval(timer)

        if (syncState.summary && !syncState.summary.error) {
          console.log(JSON.stringify(syncState.summary, null, 2))
          process.exit(0)
        }

        process.exit(1)
      }
    }, 1000)
  })
} else {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)

    const db = getDatabase()
    if (db.items.length === 0) {
      startSync({ includeBizinfoClosed: true })
    }
  })
}
