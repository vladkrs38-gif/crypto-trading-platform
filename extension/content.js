/* content.js — injected on hh.ru/vacancy/* pages
   Receives "apply" messages from background, clicks buttons, fills letter, reports result. */

const sleep = ms => new Promise(r => setTimeout(r, ms))

function waitFor(fn, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      const el = fn()
      if (el) return resolve(el)
      if (Date.now() - start > timeout) return resolve(null)
      setTimeout(check, 200)
    }
    check()
  })
}

function qs(selector) { return document.querySelector(selector) }

function qsVisible(selector) {
  const el = qs(selector)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return el
}

function qsText(selector, text) {
  const els = document.querySelectorAll(selector)
  for (const el of els) {
    if (el.textContent.includes(text)) return el
  }
  return null
}

function isAlreadyApplied() {
  const texts = ['Вы откликнулись', 'Вы уже откликнулись', 'Отклик отправлен', 'Резюме доставлено']
  const body = document.body.innerText
  return texts.some(t => body.includes(t))
}

function getTitle() {
  const el = qs('[data-qa="vacancy-title"]')
  return el ? el.innerText.trim() : ''
}

function fillNatively(el, value) {
  el.focus()
  el.value = ''
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

async function selectResume(resumeIndex) {
  if (resumeIndex == null) return

  const popup = document.querySelector('[data-qa="vacancy-response-popup"]')
    || document.querySelector('[role="dialog"]')
    || document.querySelector('[class*="modal"]')

  const scope = popup || document.body

  const allRadios = [...scope.querySelectorAll('input[type="radio"]')]
  if (allRadios.length > 1 && resumeIndex < allRadios.length) {
    const r = allRadios[resumeIndex]
    r.click()
    r.dispatchEvent(new Event('change', { bubbles: true }))
    r.dispatchEvent(new Event('input', { bubbles: true }))
    const lbl = r.closest('label') || r.parentElement
    if (lbl) lbl.click()
    await sleep(800)
    return
  }

  const strategies = [
    () => scope.querySelectorAll('[data-qa*="resume-select"]'),
    () => scope.querySelectorAll('[data-qa*="resume"][data-qa*="item"]'),
    () => {
      const all = scope.querySelectorAll('[data-qa]')
      return [...all].filter(el => {
        const qa = el.getAttribute('data-qa') || ''
        return qa.includes('resume') && !qa.includes('submit') && !qa.includes('letter')
      })
    },
    () => {
      const containers = scope.querySelectorAll('div[class], label[class]')
      const groups = new Map()
      containers.forEach(el => {
        const cls = el.className
        if (typeof cls !== 'string') return
        const key = cls.split(' ').sort().join(' ')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(el)
      })
      for (const [, els] of groups) {
        if (els.length >= 2 && els.length <= 10) {
          const hasText = els.every(e => e.textContent.trim().length > 5)
          if (hasText) return els
        }
      }
      return []
    },
  ]

  for (const strategy of strategies) {
    try {
      const items = strategy()
      const arr = items instanceof Array ? items : [...items]
      if (arr.length > 1 && resumeIndex < arr.length) {
        const target = arr[resumeIndex]
        const radio = target.querySelector('input[type="radio"]')
        if (radio) {
          radio.click()
          radio.dispatchEvent(new Event('change', { bubbles: true }))
        }
        target.click()
        target.dispatchEvent(new Event('click', { bubbles: true }))
        await sleep(800)
        return
      }
    } catch {}
  }
}

async function applyToVacancy(coverLetter, resumeIndex) {
  const title = getTitle()

  if (isAlreadyApplied()) {
    return { status: 'already_applied', title }
  }

  let applyBtn = qsVisible('[data-qa="vacancy-response-link-top"]')
  if (!applyBtn) applyBtn = qsVisible('a[data-qa="vacancy-response-link-top"]')
  if (!applyBtn) {
    return { status: 'no_button', title }
  }

  applyBtn.click()
  await sleep(2500)

  await selectResume(resumeIndex)

  // --- Flow 1: pre-apply modal ---
  let submitBtn = qsVisible('[data-qa="vacancy-response-submit-popup"]')
  if (!submitBtn) submitBtn = qsText('button', 'Откликнуться')

  if (submitBtn) {
    let toggle = qsVisible('[data-qa="vacancy-response-letter-toggle"]')
    if (!toggle) toggle = qsText('button', 'Добавить сопроводительное')
    if (!toggle) toggle = qsText('a', 'Добавить сопроводительное')
    if (!toggle) toggle = qsText('span', 'Добавить сопроводительное')

    if (toggle) {
      toggle.click()
      await sleep(1200)
    }

    let letterInput = qsVisible('[data-qa="vacancy-response-popup-form-letter-input"]')
    if (!letterInput) letterInput = qs('textarea[placeholder*="сопроводительное" i]')
    if (!letterInput) letterInput = qsVisible('textarea')

    if (letterInput) {
      fillNatively(letterInput, coverLetter)
      await sleep(400)
    }

    submitBtn = qsVisible('[data-qa="vacancy-response-submit-popup"]')
    if (!submitBtn) submitBtn = qsVisible('button[data-qa="relocation-warning-confirm"]')
    if (!submitBtn) submitBtn = qsText('button', 'Откликнуться')

    if (submitBtn) {
      submitBtn.click()
      await sleep(2500)
    }
  }

  // --- Flow 2: relocation warning ---
  const relocBtn = qsVisible('button[data-qa="relocation-warning-confirm"]')
  if (relocBtn) {
    relocBtn.click()
    await sleep(1500)
  }

  // --- Flow 3: post-apply letter ("Резюме доставлено") ---
  if (document.body.innerText.includes('Резюме доставлено') ||
      document.body.innerText.includes('Отклик отправлен')) {
    const selectors = [
      'textarea[placeholder*="Сопроводительное"]',
      'textarea[placeholder*="сопроводительное"]',
      '[data-qa="vacancy-response-popup-form-letter-input"]',
      'textarea[name="text"]',
      'textarea',
    ]
    for (const sel of selectors) {
      const ta = qsVisible(sel)
      if (ta) {
        fillNatively(ta, coverLetter)
        await sleep(400)
        const sendBtn = qsText('button', 'Отправить')
        if (sendBtn) {
          sendBtn.click()
          await sleep(1500)
        }
        break
      }
    }
    return { status: 'sent', title }
  }

  if (isAlreadyApplied()) {
    return { status: 'already_applied', title }
  }

  if (location.href.includes('test')) {
    const testEl = qs('[data-qa="title-description"]')
    if (testEl && testEl.innerText.includes('ответить')) {
      return { status: 'test_required', title }
    }
  }

  return { status: 'sent', title }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'apply') {
    applyToVacancy(msg.coverLetter, msg.resumeIndex)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ status: 'error', title: '', error: err.message }))
    return true
  }

  if (msg.action === 'debug_resume_modal') {
    const popup = document.querySelector('[data-qa="vacancy-response-popup"]')
      || document.querySelector('[role="dialog"]')
      || document.querySelector('[class*="modal"]')
    if (!popup) {
      sendResponse({ html: 'NO POPUP FOUND', radios: 0, dataQas: [] })
      return true
    }
    const radios = popup.querySelectorAll('input[type="radio"]')
    const dataQas = [...popup.querySelectorAll('[data-qa]')].map(el => ({
      qa: el.getAttribute('data-qa'),
      tag: el.tagName,
      text: el.textContent.trim().slice(0, 80),
    }))
    sendResponse({
      popupQa: popup.getAttribute('data-qa'),
      html: popup.innerHTML.slice(0, 3000),
      radios: radios.length,
      dataQas,
    })
    return true
  }

  if (msg.action === 'check_page') {
    const hasBtn = !!(qsVisible('[data-qa="vacancy-response-link-top"]') || qsVisible('a[data-qa="vacancy-response-link-top"]'))
    const hasTest = !!(document.body.innerText.includes('тестовое') || document.body.innerText.includes('Тестовое'))
    sendResponse({
      title: getTitle(),
      alreadyApplied: isAlreadyApplied(),
      hasApplyButton: hasBtn,
      hasTest,
      ready: true,
    })
    return true
  }
})
