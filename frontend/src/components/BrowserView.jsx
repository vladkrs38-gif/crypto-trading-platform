import { useState, useEffect, useRef, useCallback } from 'react'
import { API } from '../config'

const VIEWPORT_W = 1280
const VIEWPORT_H = 900

export default function BrowserView({ onLoggedIn, onClose }) {
  const [status, setStatus] = useState('connecting')
  const [error, setError] = useState(null)
  const imgRef = useRef(null)
  const wsRef = useRef(null)
  const hiddenInputRef = useRef(null)
  const containerRef = useRef(null)

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${window.location.host}${API}/browser/live`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => setStatus('waiting')

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data)
        if (msg.type === 'ready') setStatus('live')
        else if (msg.type === 'logged_in') {
          setStatus('success')
          onLoggedIn()
        }
        else if (msg.type === 'timeout') {
          setError('Время сессии истекло (5 мин). Попробуйте снова.')
          setStatus('error')
        }
        else if (msg.type === 'error') {
          setError(msg.message)
          setStatus('error')
        }
      } else if (e.data instanceof Blob) {
        const url = URL.createObjectURL(e.data)
        if (imgRef.current) {
          const old = imgRef.current.src
          imgRef.current.src = url
          if (old && old.startsWith('blob:')) URL.revokeObjectURL(old)
        }
      }
    }

    ws.onclose = () => {
      if (status !== 'success' && status !== 'error') {
        setStatus('disconnected')
      }
    }
    ws.onerror = () => {
      setError('Не удалось подключиться к серверу')
      setStatus('error')
    }
  }, [onLoggedIn])

  useEffect(() => {
    connect()
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const send = (msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  const handleClick = (e) => {
    if (status !== 'live') return
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = VIEWPORT_W / rect.width
    const scaleY = VIEWPORT_H / rect.height
    const x = Math.round((e.clientX - rect.left) * scaleX)
    const y = Math.round((e.clientY - rect.top) * scaleY)
    send({ type: 'click', x, y })
    hiddenInputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (status !== 'live') return
    e.preventDefault()
    const specialKeys = {
      Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
      Delete: 'Delete', Home: 'Home', End: 'End',
    }
    if (specialKeys[e.key]) {
      send({ type: 'key', key: specialKeys[e.key] })
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      send({ type: 'type', text: e.key })
    } else if (e.ctrlKey && e.key === 'a') {
      send({ type: 'key', key: 'Control+a' })
    } else if (e.ctrlKey && e.key === 'v') {
      navigator.clipboard.readText().then(text => {
        if (text) send({ type: 'type', text })
      }).catch(() => {})
    }
  }

  const handleWheel = (e) => {
    if (status !== 'live') return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = VIEWPORT_W / rect.width
    const scaleY = VIEWPORT_H / rect.height
    send({
      type: 'scroll',
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
      deltaX: e.deltaX,
      deltaY: e.deltaY,
    })
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-3 sm:p-6">
      <div className="bg-dark-800 rounded-2xl border border-dark-300 w-full max-w-5xl flex flex-col max-h-full overflow-hidden" ref={containerRef}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-300 shrink-0">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${
              status === 'live' ? 'bg-success animate-pulse' :
              status === 'success' ? 'bg-success' :
              status === 'error' ? 'bg-danger' :
              'bg-warn animate-pulse'
            }`} />
            <span className="text-sm font-medium text-slate-200">
              {status === 'connecting' && 'Подключение...'}
              {status === 'waiting' && 'Запуск браузера...'}
              {status === 'live' && 'Войдите в аккаунт HH.ru'}
              {status === 'success' && 'Авторизация успешна!'}
              {status === 'error' && 'Ошибка'}
              {status === 'disconnected' && 'Соединение потеряно'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-1 text-slate-500 hover:text-white rounded-lg transition"
            aria-label="Закрыть"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Browser viewport */}
        <div className="flex-1 min-h-0 relative bg-dark-900 overflow-hidden">
          {(status === 'connecting' || status === 'waiting') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-500">
                {status === 'connecting' ? 'Подключение к серверу...' : 'Запускаем браузер — подождите...'}
              </span>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
              <div className="text-danger text-4xl">!</div>
              <div className="text-sm text-slate-300 text-center max-w-md">{error}</div>
              <button onClick={() => { setStatus('connecting'); setError(null); connect() }}
                className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition mt-2">
                Попробовать снова
              </button>
            </div>
          )}

          {status === 'success' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="text-success text-5xl">&#10003;</div>
              <div className="text-lg font-medium text-success">Вы успешно вошли в HH.ru!</div>
              <div className="text-sm text-slate-400">Окно закроется автоматически...</div>
            </div>
          )}

          {status === 'disconnected' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="text-sm text-slate-400">Соединение потеряно</div>
              <button onClick={() => { setStatus('connecting'); connect() }}
                className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition">
                Переподключиться
              </button>
            </div>
          )}

          <img
            ref={imgRef}
            alt=""
            className={`w-full h-auto cursor-pointer select-none ${status === 'live' ? '' : 'hidden'}`}
            style={{ imageRendering: 'auto' }}
            onClick={handleClick}
            onWheel={handleWheel}
            draggable={false}
          />
          <input
            ref={hiddenInputRef}
            className="absolute top-0 left-0 w-0 h-0 opacity-0"
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>

        {/* Footer hint */}
        {status === 'live' && (
          <div className="px-4 py-2 border-t border-dark-300 text-xs text-slate-500 text-center shrink-0">
            Кликайте и печатайте прямо в этом окне. После входа в HH.ru окно закроется автоматически.
          </div>
        )}
      </div>
    </div>
  )
}
