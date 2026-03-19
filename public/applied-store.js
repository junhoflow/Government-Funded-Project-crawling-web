(function initAppliedStore(global) {
  const STORAGE_KEY = 'automatic.workflow.v2'
  const LEGACY_STORAGE_KEY = 'automatic.applied.v1'
  const config = global.APP_CONFIG || {}
  const supabaseUrl = String(config.supabaseUrl || '').replace(/\/$/, '')
  const supabaseAnonKey = String(config.supabaseAnonKey || '')
  const profileKey = String(config.profileKey || 'default')
  let mode = isSupabaseEnabled() ? 'supabase' : 'local'
  let lastError = null
  let supportsCompletionResult = true

  function isSupabaseEnabled() {
    return Boolean(supabaseUrl && supabaseAnonKey && profileKey)
  }

  function getHeaders(extra = {}) {
    return {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
      ...extra
    }
  }

  async function readErrorMessage(response) {
    const text = await response.text()

    if (!text) {
      return ''
    }

    try {
      const payload = JSON.parse(text)
      return payload && payload.message ? String(payload.message) : text
    } catch (error) {
      return text
    }
  }

  function isMissingCompletionResultMessage(message) {
    return String(message || '').includes('completion_result')
  }

  function normalizeWorkflowStatus(value) {
    return value === 'pending' || value === 'completed' ? value : 'completed'
  }

  function normalizeCompletionResult(value) {
    return value === 'selected' || value === 'rejected' ? value : ''
  }

  function normalizeRecord(value, id) {
    if (!value) {
      return null
    }

    if (value === true) {
      return {
        id,
        workflowStatus: 'completed'
      }
    }

    if (typeof value !== 'object') {
      return null
    }

    return {
      ...value,
      id: value.id || id,
      statusKey: value.statusKey || '',
      workflowStatus: normalizeWorkflowStatus(value.workflowStatus || value.status),
      completionResult: normalizeCompletionResult(value.completionResult || value.resultStatus),
      updatedAt: value.updatedAt || ''
    }
  }

  function loadLocal() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}

      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        return Object.entries(parsed).reduce((acc, [id, value]) => {
          const normalized = normalizeRecord(value, id)

          if (normalized) {
            acc[id] = normalized
          }

          return acc
        }, {})
      }

      const legacyRaw = global.localStorage.getItem(LEGACY_STORAGE_KEY)
      const legacyParsed = legacyRaw ? JSON.parse(legacyRaw) : {}

      return Object.entries(legacyParsed || {}).reduce((acc, [id, value]) => {
        const normalized = normalizeRecord(value, id)

        if (normalized) {
          acc[id] = normalized
        }

        return acc
      }, {})
    } catch (error) {
      return {}
    }
  }

  function saveLocal(value) {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  }

  function removeLocal(id) {
    const current = loadLocal()

    if (!current[id]) {
      return
    }

    delete current[id]
    saveLocal(current)
  }

  function serializeItem(item, workflowStatus) {
    const statusKey = item.statusKey || ''
    const completionResult = workflowStatus === 'completed' ? normalizeCompletionResult(item.completionResult) : ''

    return {
      id: item.id,
      title: item.title || '',
      source: item.source || '',
      detailUrl: item.detailUrl || '',
      originUrl: item.originUrl || '',
      category: item.category || '',
      region: item.region || '',
      managingOrg: item.managingOrg || '',
      executingOrg: item.executingOrg || '',
      applyPeriodText: item.applyPeriodText || '',
      applyTarget: item.applyTarget || '',
      applyStart: item.applyStart || '',
      applyEnd: item.applyEnd || '',
      summary: item.summary || '',
      searchText: item.searchText || '',
      postedAt: item.postedAt || '',
      isOngoing: Boolean(item.isOngoing || statusKey === 'ongoing'),
      statusKey,
      workflowStatus,
      completionResult,
      updatedAt: item.updatedAt || ''
    }
  }

  async function loadRemote() {
    const selectColumns = [
      'announcement_id',
      'announcement_title',
      'source',
      'detail_url',
      'origin_url',
      'category',
      'region',
      'managing_org',
      'executing_org',
      'apply_period_text',
      'apply_target',
      'apply_start',
      'apply_end',
      'summary',
      'search_text',
      'posted_at',
      'is_ongoing',
      'workflow_status',
      ...(supportsCompletionResult ? ['completion_result'] : []),
      'updated_at'
    ]
    const url =
      `${supabaseUrl}/rest/v1/applied_announcements?` +
      [
        `select=${selectColumns.join(',')}`,
        `profile_key=eq.${encodeURIComponent(profileKey)}`
      ].join('&')

    const response = await fetch(url, {
      headers: getHeaders()
    })

    if (!response.ok) {
      const message = await readErrorMessage(response)

      if (supportsCompletionResult && isMissingCompletionResultMessage(message)) {
        supportsCompletionResult = false
        return loadRemote()
      }

      throw new Error(`DB load failed: ${response.status}${message ? ` ${message}` : ''}`)
    }

    const rows = await response.json()
    const records = rows.reduce((acc, row) => {
      acc[row.announcement_id] = {
        id: row.announcement_id,
        title: row.announcement_title || '',
        source: row.source || '',
        detailUrl: row.detail_url || '',
        originUrl: row.origin_url || '',
        category: row.category || '',
        region: row.region || '',
        managingOrg: row.managing_org || '',
        executingOrg: row.executing_org || '',
        applyPeriodText: row.apply_period_text || '',
        applyTarget: row.apply_target || '',
        applyStart: row.apply_start || '',
        applyEnd: row.apply_end || '',
        summary: row.summary || '',
        searchText: row.search_text || '',
        postedAt: row.posted_at || '',
        isOngoing: Boolean(row.is_ongoing),
        workflowStatus: normalizeWorkflowStatus(row.workflow_status),
        completionResult: normalizeCompletionResult(supportsCompletionResult ? row.completion_result : ''),
        updatedAt: row.updated_at || ''
      }

      return acc
    }, {})

    saveLocal(records)
    return records
  }

  async function upsertRemote(item, workflowStatus) {
    const updatedAt = new Date().toISOString()
    const record = {
      ...serializeItem(item, workflowStatus),
      updatedAt
    }
    const payload = {
      profile_key: profileKey,
      announcement_id: record.id,
      announcement_title: record.title,
      source: record.source,
      detail_url: record.detailUrl,
      origin_url: record.originUrl,
      category: record.category,
      region: record.region,
      managing_org: record.managingOrg,
      executing_org: record.executingOrg,
      apply_period_text: record.applyPeriodText,
      apply_target: record.applyTarget,
      apply_start: record.applyStart,
      apply_end: record.applyEnd,
      summary: record.summary,
      search_text: record.searchText,
      posted_at: record.postedAt,
      is_ongoing: record.isOngoing,
      workflow_status: record.workflowStatus,
      updated_at: updatedAt
    }

    if (supportsCompletionResult) {
      payload.completion_result = record.completionResult
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/applied_announcements?on_conflict=profile_key,announcement_id`,
      {
        method: 'POST',
        headers: getHeaders({
          Prefer: 'resolution=merge-duplicates,return=minimal'
        }),
        body: JSON.stringify([payload])
      }
    )

    if (!response.ok) {
      const message = await readErrorMessage(response)

      if (supportsCompletionResult && isMissingCompletionResultMessage(message)) {
        supportsCompletionResult = false
        return upsertRemote(item, workflowStatus)
      }

      throw new Error(`DB save failed: ${response.status}${message ? ` ${message}` : ''}`)
    }

    return record
  }

  async function removeRemote(id) {
    const url =
      `${supabaseUrl}/rest/v1/applied_announcements?` +
      [
        `profile_key=eq.${encodeURIComponent(profileKey)}`,
        `announcement_id=eq.${encodeURIComponent(id)}`
      ].join('&')

    const response = await fetch(url, {
      method: 'DELETE',
      headers: getHeaders({
        Prefer: 'return=minimal'
      })
    })

    if (!response.ok) {
      throw new Error(`DB delete failed: ${response.status}`)
    }
  }

  const AppliedStore = {
    async load() {
      if (isSupabaseEnabled()) {
        try {
          mode = 'supabase'
          lastError = null
          return await loadRemote()
        } catch (error) {
          console.error('AppliedStore remote load failed:', error)
          mode = 'local'
          lastError = error
          return loadLocal()
        }
      }

      mode = 'local'
      lastError = null
      return loadLocal()
    },

    async setWorkflow(item, workflowStatus) {
      if (isSupabaseEnabled()) {
        try {
          mode = 'supabase'
          lastError = null
          const savedRecord = await upsertRemote(item, workflowStatus)
          const current = loadLocal()
          current[item.id] = savedRecord
          saveLocal(current)
          return savedRecord
        } catch (error) {
          console.error('AppliedStore remote write failed:', error)
          mode = 'local'
          lastError = error
          throw error
        }
      }

      lastError = null
      const current = loadLocal()
      current[item.id] = serializeItem(item, workflowStatus)
      saveLocal(current)
      return current[item.id]
    },

    async removeWorkflow(itemId) {
      if (isSupabaseEnabled()) {
        try {
          mode = 'supabase'
          lastError = null
          await removeRemote(itemId)
          removeLocal(itemId)
          return
        } catch (error) {
          console.error('AppliedStore remote delete failed:', error)
          mode = 'local'
          lastError = error
          throw error
        }
      }

      lastError = null
      removeLocal(itemId)
    },

    getModeLabel() {
      if (mode === 'supabase') {
        return 'Supabase DB'
      }

      return lastError ? '이 기기 저장 (DB 연결 실패)' : '이 기기 저장'
    }
  }

  global.AppliedStore = AppliedStore
})(window)
