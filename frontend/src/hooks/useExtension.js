import { useState, useEffect, useCallback, useRef } from 'react'

const SRC_EXT = 'hh-autopilot-ext'
const SRC_PAGE = 'hh-autopilot-page'
const MSG_TIMEOUT = 90000

function getUserCode() {
  let code = localStorage.getItem('hh-user-code')
  if (!code) {
    code = Math.random().toString(36).substring(2, 8).toUpperCase()
    localStorage.setItem('hh-user-code', code)
  }
  return code
}

export function useExtension() {
  const [connected, setConnected] = useState(false)
  const pendingRef = useRef({})
  const userCode = getUserCode()

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.source !== SRC_EXT) return

      if (event.data.type === 'ready') {
        setConnected(true)
        window.postMessage({
          source: SRC_PAGE,
          payload: { type: 'set_user_code', code: userCode },
          requestId: `code_${Date.now()}`
        }, '*')
      }

      if (event.data.type === 'response' && event.data.requestId) {
        const cb = pendingRef.current[event.data.requestId]
        if (cb) {
          cb(event.data.data)
          delete pendingRef.current[event.data.requestId]
        }
      }
    }
    window.addEventListener('message', handler)

    const pingId = `ping_${Date.now()}`
    pendingRef.current[pingId] = (data) => {
      if (data?.ok) {
        setConnected(true)
        window.postMessage({
          source: SRC_PAGE,
          payload: { type: 'set_user_code', code: userCode },
          requestId: `code_${Date.now()}`
        }, '*')
      }
    }
    window.postMessage({ source: SRC_PAGE, payload: { type: 'ping' }, requestId: pingId }, '*')
    setTimeout(() => { delete pendingRef.current[pingId] }, 3000)

    return () => window.removeEventListener('message', handler)
  }, [userCode])

  const sendMessage = useCallback((payload) => {
    return new Promise((resolve) => {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      pendingRef.current[requestId] = resolve
      window.postMessage({ source: SRC_PAGE, payload, requestId }, '*')
      setTimeout(() => {
        if (pendingRef.current[requestId]) {
          delete pendingRef.current[requestId]
          resolve({ status: 'error', error: 'Extension timeout' })
        }
      }, MSG_TIMEOUT)
    })
  }, [])

  return { extensionConnected: connected, sendExtMessage: sendMessage, userCode }
}
