/* bridge.js — Content script injected into proplatforma.ru/hh pages.
   Bridges communication between the website UI and the extension background. */

(function () {
  const SRC_EXT = 'hh-autopilot-ext'
  const SRC_PAGE = 'hh-autopilot-page'

  window.postMessage({ source: SRC_EXT, type: 'ready' }, '*')

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (!event.data || event.data.source !== SRC_PAGE) return

    const { requestId, payload } = event.data

    if (payload.type === 'ping') {
      window.postMessage({ source: SRC_EXT, type: 'response', requestId, data: { ok: true } }, '*')
      return
    }

    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({
          source: SRC_EXT,
          type: 'response',
          requestId,
          data: { status: 'error', error: chrome.runtime.lastError.message },
        }, '*')
        return
      }
      window.postMessage({ source: SRC_EXT, type: 'response', requestId, data: response }, '*')
    })
  })
})()
