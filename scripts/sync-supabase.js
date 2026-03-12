const { syncSupportPrograms } = require('../src/services/sync')
const { saveRemoteState } = require('../src/lib/storage')

const SYNC_STATE_KEY = 'support_sync_status'

function createStageConfig() {
  return {
    kstartup: { label: 'K-Startup', weight: 1 },
    bizinfoOpen: { label: '기업마당 진행공고', weight: 1 },
    fanfandaero: { label: '판판대로', weight: 1 },
    sodam: { label: '소담상회', weight: 1 },
    bizok: { label: '인천 비즈오케이', weight: 1 }
  }
}

function computeProgressPercent(stages) {
  const entries = Object.values(stages)

  if (!entries.length) {
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

async function main() {
  const startedAt = new Date().toISOString()
  const syncState = {
    isRunning: true,
    startedAt,
    finishedAt: null,
    message: '동기화 시작',
    summary: null,
    progress: {
      percent: 0,
      stages: createStageConfig()
    }
  }

  let lastSavedAt = 0

  const flushState = async (force = false) => {
    const now = Date.now()

    if (!force && now - lastSavedAt < 1500) {
      return
    }

    lastSavedAt = now
    await saveRemoteState(SYNC_STATE_KEY, syncState)
  }

  await flushState(true)

  try {
    const summary = await syncSupportPrograms({
      includeBizinfoClosed: false,
      includeTheVc: false,
      onProgress: async (progress) => {
        syncState.message = progress.message || syncState.message

        if (progress && progress.stage && progress.stage !== 'sync') {
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

        if (progress.summary) {
          syncState.summary = progress.summary
        }

        await flushState()
      }
    })

    syncState.isRunning = false
    syncState.finishedAt = new Date().toISOString()
    syncState.message = '동기화 완료'
    syncState.summary = summary
    syncState.progress.percent = 100
    await flushState(true)
  } catch (error) {
    syncState.isRunning = false
    syncState.finishedAt = new Date().toISOString()
    syncState.message = `동기화 실패: ${error.message}`
    syncState.summary = { error: error.message }
    await flushState(true)
    throw error
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
