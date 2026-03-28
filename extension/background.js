/* background.js — service worker
   Orchestrates mass apply: opens tabs, requests AI letters from server, delegates to content script. */

const DEFAULT_API = 'https://klikbot.ru/api'

async function getApi() {
  const data = await chrome.storage.local.get('apiUrl')
  return data.apiUrl || DEFAULT_API
}

async function apiCall(path, options = {}) {
  const api = await getApi()
  const url = `${api}${path}`
  const resp = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.detail || `API error ${resp.status}`)
  }
  return resp.json()
}

async function searchVacancies(query, area, salary, onlyRemote) {
  const params = new URLSearchParams({ text: query, per_page: '100' })
  if (area) params.set('area', area)
  if (salary) params.set('salary', salary)
  if (onlyRemote) params.set('schedule', 'remote')
  return apiCall(`/vacancies?${params}`)
}

async function generateLetter(vacancy, resumeText) {
  return apiCall('/generate-letter', {
    method: 'POST',
    body: JSON.stringify({ vacancy, resume_text: resumeText }),
  })
}

async function trackApply(vacancyId, title, status, coverLetter) {
  const data = await chrome.storage.local.get('applyLog')
  const log = data.applyLog || []
  log.push({ vacancyId, title, status, coverLetter: coverLetter?.slice(0, 200), ts: Date.now() })
  if (log.length > 500) log.splice(0, log.length - 500)
  await chrome.storage.local.set({ applyLog: log })
}

let workTabId = null

async function ensureWorkTab() {
  if (workTabId) {
    try {
      await chrome.tabs.get(workTabId)
      return workTabId
    } catch { workTabId = null }
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
  workTabId = tab.id
  return workTabId
}

async function navigateWorkTab(url) {
  const tabId = await ensureWorkTab()
  await chrome.tabs.update(tabId, { url })
  return new Promise((resolve) => {
    const listener = (tid, changeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(() => resolve(tabId), 1500)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve(tabId)
    }, 15000)
  })
}

async function closeWorkTab() {
  if (workTabId) {
    try { await chrome.tabs.remove(workTabId) } catch {}
    workTabId = null
  }
}

async function sendToTab(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message)
    return response || { status: 'error', error: 'No response' }
  } catch (e) {
    return { status: 'error', error: e.message }
  }
}

async function openTabAndWaitLoad(url) {
  const tab = await chrome.tabs.create({ url, active: false })
  return new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(() => resolve(tab), 1500)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve(tab)
    }, 15000)
  })
}

async function closeTab(tabId) {
  try { await chrome.tabs.remove(tabId) } catch {}
}

let applyState = {
  running: false,
  vacancies: [],
  resumeText: '',
  currentIndex: 0,
  results: [],
  stopped: false,
}

function broadcastProgress() {
  try {
    chrome.runtime.sendMessage({
      type: 'progress',
      currentIndex: applyState.currentIndex,
      total: applyState.vacancies.length,
      results: applyState.results,
      running: applyState.running,
      stopped: applyState.stopped,
    }, () => {
      if (chrome.runtime.lastError) { /* popup closed, ignore */ }
    })
  } catch {}
}

async function runMassApply() {
  applyState.running = true
  applyState.stopped = false
  broadcastProgress()

  for (let i = applyState.currentIndex; i < applyState.vacancies.length; i++) {
    if (applyState.stopped) break
    applyState.currentIndex = i
    broadcastProgress()

    const vacancy = applyState.vacancies[i]
    const vid = String(vacancy.id || vacancy.hh_id)
    let result = { vacancy_id: vid, title: vacancy.name || vid, status: 'error', error: '' }

    try {
      let letterText = ''
      try {
        const letterResp = await generateLetter(vacancy, applyState.resumeText)
        letterText = letterResp.letter || letterResp.cover_letter || ''
      } catch (e) {
        letterText = ''
      }

      const tab = await openTabAndWaitLoad(`https://hh.ru/vacancy/${vid}`)

      await new Promise(r => setTimeout(r, 1000))

      const applyResult = await sendToTab(tab.id, {
        action: 'apply',
        coverLetter: letterText,
        resumeIndex: applyState.resumeIndex,
      })

      result.status = applyResult.status || 'error'
      result.title = applyResult.title || vacancy.name || vid
      result.error = applyResult.error || ''

      await trackApply(vid, result.title, result.status, letterText)
      await closeTab(tab.id)
    } catch (e) {
      result.error = e.message
    }

    applyState.results.push(result)
    applyState.currentIndex = i + 1
    broadcastProgress()

    if (!applyState.stopped) {
      await new Promise(r => setTimeout(r, 800))
    }
  }

  applyState.running = false
  broadcastProgress()
}

async function handleApplyOne(vacancyId, coverLetter, resumeIndex) {
  const tab = await openTabAndWaitLoad(`https://hh.ru/vacancy/${vacancyId}`)
  try {
    await new Promise(r => setTimeout(r, 1000))
    const result = await sendToTab(tab.id, { action: 'apply', coverLetter, resumeIndex })
    return result
  } finally {
    await closeTab(tab.id)
  }
}

async function handleGetNegotiationsStats() {
  try {
    const tabId = await navigateWorkTab('https://hh.ru/applicant/negotiations')
    await new Promise(r => setTimeout(r, 5000))

    let stats = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const r = { sent: 0, viewed: 0, invitations: 0, rejections: 0 }
            const checks = [
              { keys: ['все'], out: 'sent' },
              { keys: ['ожидание'], out: 'viewed' },
              { keys: ['собеседование', 'приглашение', 'приглашен'], out: 'invitations' },
              { keys: ['отказ'], out: 'rejections' },
            ]
            function extract(el) {
              const t = (el.textContent || '').trim()
              if (t.length > 80) return
              const m = t.match(/(\d+)/)
              if (!m) return
              const n = parseInt(m[1], 10)
              const lower = t.toLowerCase()
              for (const { keys, out } of checks) {
                if (keys.some(k => lower.includes(k))) {
                  if (n > r[out]) r[out] = n
                  return
                }
              }
            }
            const sels = ['[role="tab"]', '[data-qa*="tab"]', '[data-qa*="filter"]', 'nav a', '.bloko-tabs-list a', '[class*="tab"] a', '[class*="Tab"]']
            const seen = new Set()
            for (const sel of sels) {
              try {
                document.querySelectorAll(sel).forEach(el => {
                  if (seen.has(el)) return
                  seen.add(el)
                  extract(el)
                  el.querySelectorAll('*').forEach(child => {
                    if (seen.has(child)) return
                    const txt = (child.textContent || '').trim()
                    if (txt.length < 20 && txt.match(/\d+/)) {
                      seen.add(child)
                      extract(child)
                    }
                  })
                })
              } catch {}
            }
            return r
          },
        })
        stats = results?.[0]?.result
        if (stats && stats.sent > 0) break
      } catch {}
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
    }

    if (!stats) throw new Error('Не удалось получить статистику')
    return stats
  } finally {
    await closeWorkTab()
  }
}

async function handleGetResumes() {
  const tab = await chrome.tabs.create({ url: 'https://hh.ru/applicant/resumes', active: false })
  try {
    await new Promise((resolve) => {
      const listener = (tid, info) => {
        if (tid === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          setTimeout(resolve, 2000)
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve() }, 15000)
    })

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const resumes = []
        const cards = document.querySelectorAll('[data-qa="resume"]')
        cards.forEach((card, i) => {
          const titleEl = card.querySelector('[data-qa="resume-title"]') || card.querySelector('[data-qa="resume-title-link"]')
          const title = titleEl ? titleEl.textContent.trim() : `Резюме ${i + 1}`
          resumes.push({ index: i, title })
        })
        if (!resumes.length) {
          document.querySelectorAll('a[href*="/resume/"]').forEach((a, i) => {
            const text = a.textContent.trim()
            if (text && text.length > 3 && text.length < 150) {
              resumes.push({ index: i, title: text })
            }
          })
        }
        return resumes
      },
    })
    return results?.[0]?.result || []
  } finally {
    try { await chrome.tabs.remove(tab.id) } catch {}
  }
}

async function handleCheckVacancy(vacancyId) {
  const tabId = await navigateWorkTab(`https://hh.ru/vacancy/${vacancyId}`)
  await new Promise(r => setTimeout(r, 500))
  return sendToTab(tabId, { action: 'check_page' })
}

async function handleApplyVacancy(coverLetter, resumeIndex) {
  const tabId = await ensureWorkTab()
  return sendToTab(tabId, { action: 'apply', coverLetter, resumeIndex })
}

async function handleDebugResumeModal() {
  const tabId = await ensureWorkTab()
  return sendToTab(tabId, { action: 'debug_resume_modal' })
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ping') {
    sendResponse({ ok: true, version: '2.1.0' })
    return true
  }

  if (msg.type === 'set_user_code') {
    chrome.storage.local.set({ userCode: msg.code })
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === 'check_vacancy') {
    handleCheckVacancy(String(msg.vacancyId))
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ status: 'error', error: err.message }))
    return true
  }

  if (msg.type === 'apply_vacancy') {
    handleApplyVacancy(msg.coverLetter || '', msg.resumeIndex)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ status: 'error', error: err.message }))
    return true
  }

  if (msg.type === 'debug_resume_modal') {
    handleDebugResumeModal()
      .then(data => sendResponse({ ok: true, ...data }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (msg.type === 'get_resumes_list') {
    handleGetResumes()
      .then(resumes => sendResponse({ ok: true, resumes }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (msg.type === 'get_negotiations_stats') {
    handleGetNegotiationsStats()
      .then(stats => sendResponse({ ok: true, stats }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (msg.type === 'close_work_tab') {
    closeWorkTab()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true }))
    return true
  }

  if (msg.type === 'apply_one') {
    handleApplyOne(String(msg.vacancyId), msg.coverLetter || '', msg.resumeIndex)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ status: 'error', error: err.message }))
    return true
  }

  if (msg.type === 'search') {
    searchVacancies(msg.query, msg.area, msg.salary, msg.onlyRemote)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: String(err.message || err) }))
    return true
  }

  if (msg.type === 'start_apply') {
    applyState = {
      running: true,
      vacancies: msg.vacancies,
      resumeText: msg.resumeText,
      resumeIndex: msg.resumeIndex,
      currentIndex: 0,
      results: [],
      stopped: false,
    }
    runMassApply()
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === 'stop_apply') {
    applyState.stopped = true
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === 'get_state') {
    sendResponse({
      running: applyState.running,
      currentIndex: applyState.currentIndex,
      total: applyState.vacancies.length,
      results: applyState.results,
      stopped: applyState.stopped,
    })
    return true
  }
})
