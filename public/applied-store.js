(function initAppliedStore(global) {
  const STORAGE_KEY = 'automatic.applied.v1'
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

  function loadLocal() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }

  function saveLocal(value) {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  }

  async function loadRemote() {
    const url =
      `${supabaseUrl}/rest/v1/applied_announcements` +
      `?select=announcement_id,applied&profile_key=eq.${encodeURIComponent(profileKey)}`

    const response = await fetch(url, {
      headers: getHeaders()
    })

    if (!response.ok) {
      throw new Error(`DB load failed: ${response.status}`)
    }

    const rows = await response.json()
    return rows.reduce((acc, row) => {
      if (row.applied) {
        acc[row.announcement_id] = true
      }

      return acc
    }, {})
  }

  async function upsertRemote(item, applied) {
    if (applied) {
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
              announcement_id: item.id,
              announcement_title: item.title || '',
              source: item.source || '',
              detail_url: item.detailUrl || item.originUrl || '',
              applied: true,
              updated_at: new Date().toISOString()
            }
          ])
        }
      )

      if (!response.ok) {
        throw new Error(`DB save failed: ${response.status}`)
      }

      return
    }

    const query =
      `profile_key=eq.${encodeURIComponent(profileKey)}` +
      `&announcement_id=eq.${encodeURIComponent(item.id)}`
    const response = await fetch(`${supabaseUrl}/rest/v1/applied_announcements?${query}`, {
      method: 'DELETE',
      headers: getHeaders()
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
          return await loadRemote()
        } catch (error) {
          mode = 'local'
          return loadLocal()
        }
      }

      mode = 'local'
      return loadLocal()
    },

    async setApplied(item, applied) {
      if (isSupabaseEnabled()) {
        try {
          mode = 'supabase'
          await upsertRemote(item, applied)
          return
        } catch (error) {
          mode = 'local'
        }
      }

      const current = loadLocal()

      if (applied) {
        current[item.id] = true
      } else {
        delete current[item.id]
      }

      saveLocal(current)
    },

    getModeLabel() {
      return mode === 'supabase' ? 'Supabase DB' : '이 기기 저장'
    }
  }

  global.AppliedStore = AppliedStore
})(window)
