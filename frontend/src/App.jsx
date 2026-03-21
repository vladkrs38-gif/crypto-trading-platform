import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import Sidebar from './components/Sidebar'
import DashboardPage from './components/DashboardPage'
import LandingPage from './components/LandingPage'
import AuthPage from './components/AuthPage'
import PaymentModal from './components/PaymentModal'
import { useExtension } from './hooks/useExtension'
import { API } from './config'

const SearchPage = lazy(() => import('./components/SearchPage'))
const VacanciesPage = lazy(() => import('./components/VacanciesPage'))
const AutoPilotPage = lazy(() => import('./components/AutoPilotPage'))
const AdminPage = lazy(() => import('./components/AdminPage'))

function getAuthHeaders(token) {
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

export default function App() {
  const [authView, setAuthView] = useState('landing')
  const [token, setToken] = useState(() => localStorage.getItem('hh-token') || '')
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [showPayment, setShowPayment] = useState(false)

  const [page, setPage] = useState('dashboard')
  const [mountedPages, setMountedPages] = useState(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [resume, setResume] = useState(() => localStorage.getItem('hh-resume') || '')
  const [stats, setStats] = useState(null)
  const { extensionConnected, sendExtMessage, userCode } = useExtension()
  const resumeSaveRef = useRef(null)
  const resumeLoadedFromServer = useRef(false)

  const authHeaders = getAuthHeaders(token)

  useEffect(() => {
    if (!token) {
      setAuthChecked(true)
      setUser(null)
      return
    }
    fetch(`${API}/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error('invalid')
        return r.json()
      })
      .then(u => {
        setUser(u)
        if (u.resume_text) {
          resumeLoadedFromServer.current = true
          setResume(u.resume_text)
          localStorage.setItem('hh-resume', u.resume_text)
        } else if (!u.resume_text && resume) {
          fetch(`${API}/resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ text: resume }),
          }).catch(() => {})
        }
        setAuthChecked(true)
      })
      .catch(() => {
        setToken('')
        setUser(null)
        localStorage.removeItem('hh-token')
        setMountedPages(new Set())
        setAuthChecked(true)
      })
  }, [token])

  const handleAuth = (newToken, newUser) => {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('hh-token', newToken)
    setAuthView('landing')
  }

  const handleLogout = () => {
    setToken('')
    setUser(null)
    localStorage.removeItem('hh-token')
    setPage('dashboard')
    setMountedPages(new Set())
  }

  const refreshUser = useCallback(async () => {
    if (!token) return
    try {
      const r = await fetch(`${API}/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (r.ok) setUser(await r.json())
    } catch {}
  }, [token])

  const updateCredits = useCallback((newCredits) => {
    setUser(prev => prev ? { ...prev, credits: newCredits } : prev)
  }, [])

  const refreshStats = useCallback(async () => {
    if (!token) return
    try {
      const r = await fetch(`${API}/db/stats`, { headers: authHeaders })
      if (r.ok) setStats(await r.json())
    } catch {}
  }, [token])

  useEffect(() => {
    if (!user) return
    refreshStats()
    const interval = setInterval(refreshStats, 15000)
    return () => clearInterval(interval)
  }, [user, refreshStats])

  useEffect(() => {
    if (resume) localStorage.setItem('hh-resume', resume)
    else return

    if (resumeLoadedFromServer.current) {
      resumeLoadedFromServer.current = false
      return
    }
    if (!token) return
    if (resumeSaveRef.current) clearTimeout(resumeSaveRef.current)
    resumeSaveRef.current = setTimeout(() => {
      fetch(`${API}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
        body: JSON.stringify({ text: resume }),
      }).catch(() => {})
    }, 3000)
  }, [resume, token])

  const handleNavigate = (p) => {
    setMountedPages(prev => { const next = new Set(prev); next.add(page); return next })
    setPage(p)
    setSidebarOpen(false)
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    if (authView === 'auth') {
      return <AuthPage onAuth={handleAuth} onBack={() => setAuthView('landing')} />
    }
    return <LandingPage onGoToAuth={() => setAuthView('auth')} />
  }

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden min-h-0">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}
      <Sidebar
        currentPage={page}
        onNavigate={handleNavigate}
        stats={stats}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        extensionConnected={extensionConnected}
        userCode={userCode}
        user={user}
        onLogout={handleLogout}
        onShowPayment={() => setShowPayment(true)}
      />
      <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-dark-300 shrink-0 bg-dark-800">
        <button onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2 rounded-lg text-slate-400 hover:text-white hover:bg-dark-600 transition"
          aria-label="Меню">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-white truncate">HH AutoPilot</h1>
        {user && (
          <button onClick={() => setShowPayment(true)}
            className="ml-auto flex items-center gap-1.5 text-xs">
            <span className={`font-semibold ${user.credits > 0 ? 'text-accent' : 'text-danger'}`}>{user.credits}</span>
            <span className="text-slate-500">откл.</span>
          </button>
        )}
      </div>
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className={page === 'dashboard' ? '' : 'hidden'}>
          <DashboardPage stats={stats}
            onRefreshStats={refreshStats} extensionConnected={extensionConnected}
            sendExtMessage={sendExtMessage} token={token} />
        </div>
        <Suspense fallback={<div className="flex items-center justify-center p-12"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
          {(page === 'search' || mountedPages.has('search')) && (
            <div className={page === 'search' ? '' : 'hidden'}>
              <SearchPage resume={resume} setResume={setResume}
                onRefreshStats={() => { refreshStats(); refreshUser() }}
                extensionConnected={extensionConnected} sendExtMessage={sendExtMessage}
                token={token} user={user}
                onUpdateCredits={updateCredits}
                onShowPayment={() => setShowPayment(true)} />
            </div>
          )}
          {(page === 'vacancies' || mountedPages.has('vacancies')) && (
            <div className={page === 'vacancies' ? '' : 'hidden'}>
              <VacanciesPage onRefreshStats={refreshStats} token={token} visible={page === 'vacancies'} />
            </div>
          )}
          {(page === 'autopilot' || mountedPages.has('autopilot')) && (
            <div className={page === 'autopilot' ? '' : 'hidden'}>
              <AutoPilotPage resume={resume} setResume={setResume}
                onRefreshStats={refreshStats}
                extensionConnected={extensionConnected} token={token} />
            </div>
          )}
          {user?.is_admin && (page === 'admin' || mountedPages.has('admin')) && (
            <div className={page === 'admin' ? '' : 'hidden'}>
              <AdminPage token={token} />
            </div>
          )}
        </Suspense>
      </main>
      {showPayment && <PaymentModal onClose={() => setShowPayment(false)} />}
    </div>
  )
}
