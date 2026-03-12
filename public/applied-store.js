(function initAppliedStore(global) {
  const STORAGE_KEY = 'automatic.workflow.v2'
  const LEGACY_STORAGE_KEY = 'automatic.applied.v1'
  const config = global.APP_CONFIG || {}
  const supabaseUrl = String(config.supabaseUrl || '').replace(/\/$/, '')
  const supabaseAnonKey = String(config.supabaseAnonKey || '')
  const profileKey = String(config.profileKey || 'default')
  let mode = isSupabaseEnabled() ? 'supabase' : 'local'

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

  function normalizeWorkflowStatus(value) {
    return value === 'pending' || value === 'completed' ? value : 'completed'
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
      workflowStatus: normalizeWorkflowStatus(value.workflowStatus || value.status)
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

  function serializeItem(item, workflowStatus) {
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
      isOngoing: Boolean(item.isOngoing),
      workflowStatus
    }
  }

  async function loadRemote() {
    const url =
      `${supabaseUrl}/rest/v1/applied_announcements?` +
      [
        'select=announcement_id,announcement_title,source,detail_url,origin_url,category,region,managing_org,executing_org,apply_period_text,apply_target,apply_start,apply_end,summary,search_text,posted_at,is_ongoing,workflow_status,updated_at',
        `profile_key=eq.${encodeURIComponent(profileKey)}`
      ].join('&')

    const response = await fetch(url, {
      headers: getHeaders()
    })

    if (!response.ok) {
      throw new Error(`DB load failed: ${response.status}`)
    }

    const rows = await response.json()
    return rows.reduce((acc, row) => {
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
        workflowStatus: normalizeWorkflowStatus(row.workflow_status)
      }

      return acc
    }, {})
  }

  async function upsertRemote(item, workflowStatus) {
    const record = serializeItem(item, workflowStatus)
    const response = await fetch(
      `${supabaseUrl}/rest/v1/applied_announcements?on_conflict=profile_key,announcement_id`,
      {
        method: 'POST',
        headers: getHeaders({
          Prefer: 'resolution=merge-duplicates,return=minimal'
        }),
        body: JSON.stringify([
          {
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
            updated_at: new Date().toISOString()
          }
        ])
      }
    )

    if (!response.ok) {
      throw new Error(`DB save failed: ${response.status}`)
    }
  }

  const AppliedStore = {
    async load() {
      if (isSupabaseEnabled()) {
        try {
          mode = 'supabase'
          return await loadRemote()
        } catch (error) {
          mode = 'local'
          return loadLocal()
        }
      }

      mode = 'local'
      return loadLocal()
    },

    async setWorkflow(item, workflowStatus) {
      if (isSupabaseEnabled()) {
        try {
          mode = 'supabase'
          await upsertRemote(item, workflowStatus)
          return
        } catch (error) {
          mode = 'local'
        }
      }

      const current = loadLocal()
      current[item.id] = serializeItem(item, workflowStatus)
      saveLocal(current)
    },

    getModeLabel() {
      return mode === 'supabase' ? 'Supabase DB' : '이 기기 저장'
    }
  }

  global.AppliedStore = AppliedStore
})(window)
