const fetch = require('node-fetch')
const { sleep } = require('./utils')

async function fetchText(url, options = {}) {
  const retries = options.retries === undefined ? 3 : options.retries
  let attempt = 0
  let lastError

  while (attempt <= retries) {
    try {
      const response = await fetch(url, {
        timeout: 30000,
        headers: {
          'user-agent': 'automatic-support-crawler/1.0',
          accept: 'text/html,application/json'
        },
        ...options
      })

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`)
      }

      return response.text()
    } catch (error) {
      lastError = error

      if (attempt === retries) {
        break
      }

      await sleep(500 * (attempt + 1))
      attempt += 1
    }
  }

  throw lastError
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options)
  return JSON.parse(text)
}

module.exports = {
  fetchJson,
  fetchText
}
