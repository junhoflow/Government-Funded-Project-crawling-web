const { collectBizOk } = require('../collectors/bizok')
const { collectBizInfo } = require('../collectors/bizinfo')
const { collectFanfandaero } = require('../collectors/fanfandaero')
const { collectKStartup } = require('../collectors/kstartup')
const { collectSodam } = require('../collectors/sodam')
const { collectTheVc } = require('../collectors/thevc')
const { loadDatabase, saveDatabase } = require('../lib/storage')
const { formatDateTime, getAnnouncementStatus, isDateNearToday } = require('../lib/utils')

function resolveFirstSeenAt(previous, item, db) {
  if (previous && previous.firstSeenAt) {
    return previous.firstSeenAt
  }

  if (previous && previous.postedAt) {
    return `${previous.postedAt}T00:00:00.000Z`
  }

  if (item.postedAt) {
    return `${item.postedAt}T00:00:00.000Z`
  }

  return db.meta.lastSyncAt || formatDateTime()
}

async function syncSupportPrograms(options = {}) {
  const onProgress = options.onProgress || (() => {})
  const includeBizinfoClosed = options.includeBizinfoClosed === undefined ? false : Boolean(options.includeBizinfoClosed)
  const db = loadDatabase()
  const previousById = new Map(db.items.map((item) => [item.id, item]))

  onProgress({ stage: 'sync', message: '핵심 출처 병렬 수집 시작' })
  const kstartupTask = (async () => {
    onProgress({ stage: 'sync', message: 'K-Startup 수집 시작' })
    return collectKStartup(onProgress)
  })()

  const bizinfoOpenTask = (async () => {
    onProgress({ stage: 'sync', message: '기업마당 진행공고 수집 시작' })
    return collectBizInfo({
      stageKey: 'bizinfoOpen',
      includeClosed: false,
      previousById,
      onProgress
    })
  })()

  const bizinfoClosedTask = includeBizinfoClosed
    ? (async () => {
        onProgress({ stage: 'sync', message: '기업마당 지난공고 수집 시작' })
        return collectBizInfo({
          stageKey: 'bizinfoClosed',
          includeClosed: true,
          previousById,
          onProgress
        })
      })()
    : Promise.resolve([])

  const fanfandaeroTask = (async () => {
    onProgress({ stage: 'sync', message: '판판대로 수집 시작' })
    return collectFanfandaero({ onProgress })
  })()

  const sodamTask = (async () => {
    onProgress({ stage: 'sync', message: '소담상회 수집 시작' })
    return collectSodam(onProgress)
  })()

  const bizokTask = (async () => {
    onProgress({ stage: 'sync', message: '인천 비즈오케이 수집 시작' })
    return collectBizOk(onProgress)
  })()

  const thevcTask = (async () => {
    onProgress({ stage: 'sync', message: 'THE VC 수집 시작' })
    return collectTheVc(onProgress)
  })()

  const [kstartupItems, bizinfoOpenItems, bizinfoClosedItems, fanfandaeroItems, sodamItems, bizokItems, thevcItems] =
    await Promise.all([
      kstartupTask,
      bizinfoOpenTask,
      bizinfoClosedTask,
      fanfandaeroTask,
      sodamTask,
      bizokTask,
      thevcTask
    ])

  const merged = new Map()
  const syncFinishedAt = formatDateTime()

  for (const item of [
    ...kstartupItems,
    ...bizinfoClosedItems,
    ...bizinfoOpenItems,
    ...fanfandaeroItems,
    ...sodamItems,
    ...bizokItems,
    ...thevcItems
  ]) {
    const previous = previousById.get(item.id)
    const firstSeenAt = resolveFirstSeenAt(previous, item, db)

    merged.set(item.id, {
      ...previous,
      ...item,
      firstSeenAt,
      lastSeenAt: syncFinishedAt,
      isNew: isDateNearToday(item.applyStart, 2, new Date(syncFinishedAt))
    })
  }

  const items = Array.from(merged.values()).filter((item) => getAnnouncementStatus(item).key !== 'closed')
  const summary = {
    total: items.length,
    kstartup: kstartupItems.length,
    bizinfoOpen: bizinfoOpenItems.length,
    bizinfoClosed: bizinfoClosedItems.length,
    fanfandaero: fanfandaeroItems.length,
    sodam: sodamItems.length,
    bizok: bizokItems.length,
    thevc: thevcItems.length,
    includeBizinfoClosed,
    finishedAt: syncFinishedAt
  }

  await saveDatabase({
    items,
    meta: {
      ...db.meta,
      lastSyncAt: summary.finishedAt,
      lastSyncSummary: summary
    }
  })

  onProgress({ stage: 'sync', message: '동기화 완료', summary })
  return summary
}

module.exports = {
  syncSupportPrograms
}
