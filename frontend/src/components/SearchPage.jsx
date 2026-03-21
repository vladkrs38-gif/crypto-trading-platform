import { useState, useRef, useEffect } from 'react'
import { API } from '../config'
import CityAutocomplete from './CityAutocomplete'

const STATUS_LABELS = {
  sent: { icon: '✓', text: 'Отправлен', cls: 'text-success' },
  already_applied: { icon: '↻', text: 'Уже откликались', cls: 'text-slate-400' },
  skipped_cache: { icon: '»', text: 'Пропуск (в базе)', cls: 'text-slate-500' },
  test_required: { icon: '?', text: 'Нужен тест', cls: 'text-warn' },
  no_button: { icon: '!', text: 'Нет кнопки', cls: 'text-warn' },
  error: { icon: '✕', text: 'Ошибка', cls: 'text-danger' },
  cover_letter_filled: { icon: '✓', text: 'Письмо заполнено', cls: 'text-success' },
}

const CARD_STATUS_LABELS = {
  applied: { text: 'Откликнулись', cls: 'text-success', icon: '✓' },
  sent: { text: 'Откликнулись', cls: 'text-success', icon: '✓' },
  cover_letter_filled: { text: 'Откликнулись', cls: 'text-success', icon: '✓' },
  already_applied: { text: 'Уже откликались', cls: 'text-slate-400', icon: '↻' },
  skipped_cache: { text: 'В базе', cls: 'text-slate-500', icon: '»' },
  new: { text: 'В базе', cls: 'text-slate-500', icon: '»' },
  test_required: { text: 'Нужен тест', cls: 'text-warn', icon: '?' },
  no_button: { text: 'Нет кнопки', cls: 'text-warn', icon: '!' },
  error: { text: 'Ошибка', cls: 'text-danger', icon: '✕' },
}

const PER_PAGE = 100
const SEARCH_STORAGE_KEY = 'hh-search-state'

function loadSearchState() {
  try {
    const raw = sessionStorage.getItem(SEARCH_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data?.vacancies?.length) return null
    return {
      vacancies: data.vacancies || [], searchInfo: data.searchInfo || '',
      totalFound: data.totalFound || 0, searchMode: data.searchMode || null,
      queryStates: data.queryStates || [],
      text: data.text || '', area: data.area || '113',
      salary: data.salary || '', remote: !!data.remote,
    }
  } catch { return null }
}

function saveSearchState(s) {
  try { sessionStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify(s)) } catch {}
}

function parseResumePreview(text) {
  if (!text?.trim()) return { title: null, skills: [] }
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const title = lines[0]?.slice(0, 70) || null
  const skillPattern = /\b(React|TypeScript|JavaScript|Python|Node\.?js|Vue|Angular|Next\.?js|Git|Docker|Kubernetes|SQL|PostgreSQL|MongoDB|Redis|AWS|Linux|DevOps|Fullstack|Frontend|Backend|руководитель|разработчик|директор|менеджер|аналитик|инженер)\b/gi
  const found = text.match(skillPattern) || []
  const skills = [...new Set(found.map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()))].slice(0, 8)
  return { title, skills }
}

export default function SearchPage({ resume, setResume, onRefreshStats, extensionConnected, sendExtMessage, token, user, onUpdateCredits, onShowPayment }) {
  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {}
  const [savedInit] = useState(() => loadSearchState())
  const [vacancies, setVacancies] = useState(() => savedInit?.vacancies ?? [])
  const [loading, setLoading] = useState(false)
  const [loadMoreLoading, setLoadMoreLoading] = useState(false)
  const [searchInfo, setSearchInfo] = useState(() => savedInit?.searchInfo ?? '')
  const [totalFound, setTotalFound] = useState(() => savedInit?.totalFound ?? 0)
  const [searchMode, setSearchMode] = useState(() => savedInit?.searchMode ?? null)
  const [queryStates, setQueryStates] = useState(() => savedInit?.queryStates ?? [])
  const [text, setText] = useState(() => savedInit?.text ?? '')
  const [area, setArea] = useState(() => savedInit?.area ?? '113')
  const [salary, setSalary] = useState(() => savedInit?.salary ?? '')
  const [remote, setRemote] = useState(() => savedInit?.remote ?? false)
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [total, setTotal] = useState(0)
  const [applyDone, setApplyDone] = useState(false)
  const [skippedByDbCount, setSkippedByDbCount] = useState(0)
  const [vacancyStatuses, setVacancyStatuses] = useState({})
  const [matchScores, setMatchScores] = useState({})
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [resumeExpanded, setResumeExpanded] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(50)
  const [hhResumes, setHhResumes] = useState([])
  const [hhResumeIndex, setHhResumeIndex] = useState(null)
  const [hhResumesLoading, setHhResumesLoading] = useState(false)
  const fileInputRef = useRef(null)
  const serverSaveRef = useRef(null)
  const serverLoadedRef = useRef(false)

  useEffect(() => {
    if (vacancies.length > 0) {
      const state = { vacancies, searchInfo, totalFound, searchMode, queryStates, text, area, salary, remote }
      saveSearchState(state)

      if (serverLoadedRef.current) {
        serverLoadedRef.current = false
        return
      }
      if (!token) return
      if (serverSaveRef.current) clearTimeout(serverSaveRef.current)
      serverSaveRef.current = setTimeout(() => {
        fetch(`${API}/search-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ state }),
        }).catch(() => {})
      }, 3000)
    }
  }, [vacancies, searchInfo, totalFound, searchMode, queryStates])

  useEffect(() => {
    if (savedInit?.vacancies?.length && vacancies.length > 0 && Object.keys(vacancyStatuses).length === 0) {
      fetchVacancyStatuses(vacancies.map(v => v.id))
      fetchMatchScores(vacancies.map(v => v.id))
    }

    if (!token) return
    fetch(`${API}/search-state`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.state?.vacancies?.length) return
        const s = data.state
        serverLoadedRef.current = true
        setVacancies(s.vacancies)
        setSearchInfo(s.searchInfo || '')
        setTotalFound(s.totalFound || 0)
        setSearchMode(s.searchMode || null)
        setQueryStates(s.queryStates || [])
        if (s.text != null) setText(s.text)
        if (s.area != null) setArea(s.area)
        if (s.salary != null) setSalary(s.salary)
        if (typeof s.remote === 'boolean') setRemote(s.remote)
        saveSearchState(s)
        fetchVacancyStatuses(s.vacancies.map(v => v.id))
        fetchMatchScores(s.vacancies.map(v => v.id))
      })
      .catch(() => {})
  }, [])

  const fetchVacancyStatuses = async (ids) => {
    if (!ids?.length) return
    try {
      const r = await fetch(`${API}/db/vacancy-statuses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ids }),
      })
      if (r.ok) {
        const data = await r.json()
        setVacancyStatuses(prev => ({ ...prev, ...data }))
      }
    } catch {}
  }

  const MATCH_BATCH = 25
  const fetchMatchScores = async (ids) => {
    if (!ids?.length || !resume?.trim()) return
    for (let i = 0; i < ids.length; i += MATCH_BATCH) {
      const batch = ids.slice(i, i + MATCH_BATCH)
      try {
        const r = await fetch(`${API}/match-scores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ resume_text: resume, vacancy_ids: batch }),
        })
        if (r.ok) {
          const data = await r.json()
          setMatchScores(prev => ({ ...prev, ...data }))
        }
      } catch {}
    }
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size >= vacancies.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(vacancies.map(v => v.id)))
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = (file.name || '').toLowerCase().split('.').pop()
    if (ext === 'txt') {
      const reader = new FileReader()
      reader.onload = () => setResume(reader.result || '')
      reader.readAsText(file, 'UTF-8')
      return
    }
    if (ext === 'pdf') {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const r = await fetch(`${API}/extract-resume`, { method: 'POST', body: fd })
        const data = await r.json()
        if (r.ok) setResume(data.text || '')
        else alert(data.detail || 'Ошибка загрузки PDF')
      } catch (err) { alert('Ошибка: ' + err.message) }
      return
    }
    alert('Поддерживаются только .txt и .pdf')
  }

  const buildParams = (page = 0) => {
    const params = new URLSearchParams()
    if (text.trim()) params.set('text', text.trim())
    if (area) params.set('area', area)
    if (salary) params.set('salary', salary)
    if (remote) params.set('schedule', 'remote')
    params.set('per_page', String(PER_PAGE))
    params.set('page', String(page))
    return params
  }

  const searchManual = async (e) => {
    e?.preventDefault()
    setLoading(true)
    setVacancies([])
    setVacancyStatuses({})
    setMatchScores({})
    setSelectedIds(new Set())
    setVisibleLimit(50)
    setSearchInfo('')
    setSearchMode('manual')
    setQueryStates([])
    try {
      const r = await fetch(`${API}/vacancies?${buildParams(0)}`)
      const data = await r.json()
      const items = data.items || []
      setVacancies(items)
      const found = data.found ?? items.length
      setTotalFound(found)
      setSearchInfo(found > PER_PAGE ? `Показано ${items.length} из ${found}` : `Найдено: ${found} вакансий`)
      fetchVacancyStatuses(items.map(i => i.id))
      fetchMatchScores(items.map(i => i.id))
    } catch {
      setVacancies([])
      setTotalFound(0)
    } finally {
      setLoading(false)
    }
  }

  const loadMoreManual = async () => {
    const nextPage = Math.floor(vacancies.length / PER_PAGE)
    setLoadMoreLoading(true)
    try {
      const r = await fetch(`${API}/vacancies?${buildParams(nextPage)}`)
      const data = await r.json()
      const items = data.items || []
      const newTotal = vacancies.length + items.length
      setVacancies(prev => [...prev, ...items])
      const total = data.found ?? totalFound
      setTotalFound(total)
      setSearchInfo(`Показано ${newTotal} из ${total}`)
      fetchVacancyStatuses(items.map(i => i.id))
      fetchMatchScores(items.map(i => i.id))
    } finally {
      setLoadMoreLoading(false)
    }
  }

  const searchByResume = async () => {
    if (!resume?.trim()) return
    setLoading(true)
    setVacancies([])
    setVacancyStatuses({})
    setMatchScores({})
    setSelectedIds(new Set())
    setVisibleLimit(50)
    setSearchInfo('')
    setSearchMode('ai')
    try {
      const r = await fetch(`${API}/analyze-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ resume_text: resume }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка')
      const queries = data.search_queries || [data.search_query || ''].filter(Boolean)
      const allItems = []
      const seenIds = new Set()
      const states = []
      for (const q of queries) {
        const params = new URLSearchParams({ text: q, area, per_page: PER_PAGE, page: 0 })
        if (salary) params.set('salary', salary)
        if (remote) params.set('schedule', 'remote')
        const vr = await fetch(`${API}/vacancies?${params}`)
        const vd = await vr.json()
        const items = vd.items || []
        const found = vd.found ?? items.length
        states.push({ query: q, page: 0, total: found })
        for (const item of items) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id)
            allItems.push(item)
          }
        }
      }
      setVacancies(allItems)
      setQueryStates(states)
      setTotalFound(allItems.length)
      const totalAll = states.reduce((s, st) => s + st.total, 0)
      setSearchInfo(totalAll > allItems.length ? `AI: ${queries.join(' | ')} — показано ${allItems.length} из ${totalAll}` : `AI: ${queries.join(' | ')} — ${allItems.length} вакансий`)
      fetchVacancyStatuses(allItems.map(i => i.id))
      fetchMatchScores(allItems.map(i => i.id))
    } catch (e) {
      setVacancies([])
      setQueryStates([])
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadMoreByResume = async () => {
    setLoadMoreLoading(true)
    try {
      const seenIds = new Set(vacancies.map(v => v.id))
      const newItems = []
      const newStates = queryStates.map((st, i) => {
        if ((st.page + 1) * PER_PAGE >= st.total) return st
        return { ...st, page: st.page + 1 }
      })
      for (let i = 0; i < queryStates.length; i++) {
        const st = queryStates[i]
        if ((st.page + 1) * PER_PAGE >= st.total) continue
        const params = new URLSearchParams({ text: st.query, area, per_page: PER_PAGE, page: st.page + 1 })
        if (salary) params.set('salary', salary)
        if (remote) params.set('schedule', 'remote')
        const vr = await fetch(`${API}/vacancies?${params}`)
        const vd = await vr.json()
        for (const item of (vd.items || [])) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id)
            newItems.push(item)
          }
        }
      }
      setVacancies(prev => [...prev, ...newItems])
      setQueryStates(newStates)
      const newTotal = vacancies.length + newItems.length
      const totalAll = queryStates.reduce((s, st) => s + st.total, 0)
      setSearchInfo(`AI — показано ${newTotal} из ${totalAll}`)
      fetchVacancyStatuses(newItems.map(i => i.id))
      fetchMatchScores(newItems.map(i => i.id))
    } finally {
      setLoadMoreLoading(false)
    }
  }

  const handleLoadMore = () => {
    if (searchMode === 'manual') loadMoreManual()
    else if (searchMode === 'ai') loadMoreByResume()
  }

  const canLoadMore = searchMode === 'manual'
    ? vacancies.length < totalFound && vacancies.length > 0
    : searchMode === 'ai' && queryStates.some(st => (st.page + 1) * PER_PAGE < st.total)

  const remainingCount = searchMode === 'manual'
    ? totalFound - vacancies.length
    : searchMode === 'ai'
      ? Math.max(0, queryStates.reduce((s, st) => s + Math.max(0, st.total - (st.page + 1) * PER_PAGE), 0))
      : 0

  const [loadAllLoading, setLoadAllLoading] = useState(false)
  const [loadAllProgress, setLoadAllProgress] = useState('')
  const loadAllRef = useRef(false)

  const loadAllVacancies = async () => {
    loadAllRef.current = true
    setLoadAllLoading(true)

    if (searchMode === 'manual') {
      let currentVacancies = [...vacancies]
      let currentPage = Math.floor(currentVacancies.length / PER_PAGE)
      const seenIds = new Set(currentVacancies.map(v => v.id))

      while (currentVacancies.length < totalFound && loadAllRef.current) {
        if (currentPage * PER_PAGE >= 2000) break
        setLoadAllProgress(`${currentVacancies.length} из ${totalFound}`)
        try {
          const r = await fetch(`${API}/vacancies?${buildParams(currentPage)}`)
          const data = await r.json()
          const items = (data.items || []).filter(i => !seenIds.has(i.id))
          if (items.length === 0) break
          items.forEach(i => seenIds.add(i.id))
          currentVacancies = [...currentVacancies, ...items]
          currentPage++
          setVacancies(currentVacancies)
          setSearchInfo(`Показано ${currentVacancies.length} из ${totalFound}`)
          fetchVacancyStatuses(items.map(i => i.id))
        } catch { break }
      }
    } else if (searchMode === 'ai') {
      let currentStates = queryStates.map(s => ({ ...s }))
      let currentVacancies = [...vacancies]
      const seenIds = new Set(currentVacancies.map(v => v.id))
      let hasMore = true

      while (hasMore && loadAllRef.current) {
        hasMore = false
        for (let i = 0; i < currentStates.length; i++) {
          if (!loadAllRef.current) break
          const st = currentStates[i]
          const nextPage = st.page + 1
          if (nextPage * PER_PAGE >= st.total || nextPage * PER_PAGE >= 2000) continue
          hasMore = true
          const totalAll = currentStates.reduce((s, st) => s + st.total, 0)
          setLoadAllProgress(`${currentVacancies.length} из ~${totalAll} — «${st.query}»`)
          try {
            const params = new URLSearchParams({ text: st.query, area, per_page: PER_PAGE, page: nextPage })
            if (salary) params.set('salary', salary)
            if (remote) params.set('schedule', 'remote')
            const vr = await fetch(`${API}/vacancies?${params}`)
            const vd = await vr.json()
            for (const item of (vd.items || [])) {
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id)
                currentVacancies.push(item)
              }
            }
            currentStates[i] = { ...st, page: nextPage }
          } catch {}
        }
        setVacancies([...currentVacancies])
        setQueryStates([...currentStates])
        const totalAll = currentStates.reduce((s, st) => s + st.total, 0)
        setSearchInfo(`AI — показано ${currentVacancies.length} из ${totalAll}`)
        fetchVacancyStatuses(currentVacancies.slice(-PER_PAGE * currentStates.length).map(i => i.id))
      }
    }

    setLoadAllLoading(false)
    setLoadAllProgress('')
    loadAllRef.current = false
  }

  const stopLoadAll = () => { loadAllRef.current = false }

  const [stopped, setStopped] = useState(false)
  const [progressCollapsed, setProgressCollapsed] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [applyMethod, setApplyMethod] = useState(null)
  const stopExtRef = useRef(false)

  const stopMassApply = async () => {
    setStopping(true)
    if (applyMethod === 'extension') {
      stopExtRef.current = true
    } else {
      try {
        await fetch(`${API}/browser/mass-apply/stop`, { method: 'POST', headers: authHeaders })
      } catch {}
    }
  }

  const startMassApplyViaExtension = async () => {
    if (user?.credits <= 0) {
      onShowPayment?.()
      return
    }
    const skipStatuses = ['applied', 'sent', 'cover_letter_filled', 'already_applied', 'test_required', 'no_button']
    let idsToApply = selectedIds.size > 0 ? [...selectedIds] : vacancies.map(v => v.id)
    const skippedByDb = idsToApply.filter(id => skipStatuses.includes(vacancyStatuses[id]))
    idsToApply = idsToApply.filter(id => !skipStatuses.includes(vacancyStatuses[id]))
    if (!resume?.trim() || !idsToApply.length) {
      if (skippedByDb.length > 0) alert(`Все выбранные вакансии (${skippedByDb.length}) уже обработаны`)
      else alert('Нет вакансий для отклика')
      return
    }
    setApplyMethod('extension')
    setApplying(true)
    setProgress([])
    setCurrentIndex(-1)
    setApplyDone(false)
    setStopped(false)
    setStopping(false)
    setSkippedByDbCount(skippedByDb.length)
    setTotal(idsToApply.length)
    setProgressCollapsed(false)
    stopExtRef.current = false

    for (let i = 0; i < idsToApply.length; i++) {
      if (stopExtRef.current) { setStopped(true); break }

      const vid = idsToApply[i]
      const vacancy = vacancies.find(v => String(v.id) === String(vid))
      const title = vacancy?.name || String(vid)

      setCurrentIndex(i)
      setProgress(prev => [...prev, { vacancy_id: vid, title, step: 'checking' }])

      const checkResult = await sendExtMessage({ type: 'check_vacancy', vacancyId: String(vid) })
      const pageTitle = checkResult?.title || title

      if (checkResult?.alreadyApplied) {
        setProgress(prev => prev.map(p =>
          p.vacancy_id === vid ? { ...p, status: 'already_applied', title: pageTitle } : p
        ))
        setVacancyStatuses(prev => ({ ...prev, [vid]: 'already_applied' }))
        try {
          await fetch(`${API}/db/track-apply`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ vacancy_id: String(vid), title: pageTitle, company: vacancy?.employer?.name || '', status: 'already_applied', location: vacancy?.area?.name || '' }),
          })
        } catch (e) { console.warn('track-apply error:', e) }
        continue
      }

      if (!checkResult?.hasApplyButton) {
        const skipStatus = checkResult?.hasTest ? 'test_required' : 'no_button'
        setProgress(prev => prev.map(p =>
          p.vacancy_id === vid ? { ...p, status: skipStatus, title: pageTitle } : p
        ))
        setVacancyStatuses(prev => ({ ...prev, [vid]: skipStatus }))
        try {
          await fetch(`${API}/db/track-apply`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ vacancy_id: String(vid), title: pageTitle, company: vacancy?.employer?.name || '', status: skipStatus, location: vacancy?.area?.name || '' }),
          })
        } catch (e) { console.warn('track-apply error:', e) }
        continue
      }

      if (stopExtRef.current) { setStopped(true); break }

      setProgress(prev => prev.map(p =>
        p.vacancy_id === vid ? { ...p, step: 'generating_letter', title: pageTitle } : p
      ))

      let coverLetter = ''
      try {
        const r = await fetch(`${API}/generate-letter`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ vacancy, resume_text: resume }),
        })
        const d = await r.json()
        coverLetter = d.letter || d.cover_letter || ''
      } catch {}

      if (stopExtRef.current) { setStopped(true); break }

      setProgress(prev => prev.map(p =>
        p.vacancy_id === vid ? { ...p, step: 'applying' } : p
      ))

      const result = await sendExtMessage({ type: 'apply_vacancy', coverLetter, resumeIndex: hhResumeIndex })

      const status = result?.status || 'error'
      const error = result?.error || ''

      setProgress(prev => prev.map(p =>
        p.vacancy_id === vid ? { ...p, status, error, title: result?.title || pageTitle } : p
      ))
      setVacancyStatuses(prev => ({ ...prev, [vid]: status }))
      try {
          const trackResp = await fetch(`${API}/db/track-apply`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ vacancy_id: String(vid), title: result?.title || pageTitle, company: vacancy?.employer?.name || '', status, cover_letter: coverLetter?.slice(0, 200), error, location: vacancy?.area?.name || '' }),
          })
          if (trackResp.status === 403) {
            onUpdateCredits?.(0)
            onShowPayment?.()
            break
          }
          if (trackResp.ok) {
            const trackData = await trackResp.json()
            if (typeof trackData.credits === 'number') onUpdateCredits?.(trackData.credits)
          }
      } catch (e) { console.warn('track-apply error:', e) }

      if (!stopExtRef.current && i < idsToApply.length - 1) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    await sendExtMessage({ type: 'close_work_tab' })
    setApplying(false)
    setStopping(false)
    setSelectedIds(new Set())
    if (!stopExtRef.current) setApplyDone(true)
    onRefreshStats()
  }

  const startMassApply = async () => {
    if (user?.credits <= 0) {
      onShowPayment?.()
      return
    }
    const skipStatuses = ['applied', 'sent', 'cover_letter_filled', 'already_applied', 'test_required', 'no_button']
    let idsToApply = selectedIds.size > 0 ? [...selectedIds] : vacancies.map(v => v.id)
    const skippedByDb = idsToApply.filter(id => skipStatuses.includes(vacancyStatuses[id]))
    idsToApply = idsToApply.filter(id => !skipStatuses.includes(vacancyStatuses[id]))
    if (!resume?.trim() || !idsToApply.length) {
      if (skippedByDb.length > 0) alert(`Все выбранные вакансии (${skippedByDb.length}) уже обработаны`)
      else alert('Нет вакансий для отклика')
      return
    }
    setApplyMethod('server')
    setApplying(true)
    setProgress([])
    setCurrentIndex(-1)
    setApplyDone(false)
    setStopped(false)
    setStopping(false)
    setSkippedByDbCount(skippedByDb.length)
    setTotal(idsToApply.length)
    setProgressCollapsed(false)

    try {
      const r = await fetch(`${API}/browser/mass-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ vacancy_ids: idsToApply, resume_text: resume }),
      })
      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'start') setTotal(data.total)
            else if (data.type === 'progress') {
              setCurrentIndex(data.index)
              setProgress(prev => {
                const exists = prev.find(p => p.vacancy_id === data.vacancy_id)
                if (exists) return prev.map(p => p.vacancy_id === data.vacancy_id ? { ...p, ...data } : p)
                return [...prev, data]
              })
            } else if (data.type === 'result') {
              setCurrentIndex(data.index)
              setProgress(prev => [...prev.filter(p => p.vacancy_id !== data.vacancy_id), data])
              setVacancyStatuses(prev => ({ ...prev, [data.vacancy_id]: data.status }))
            } else if (data.type === 'done') {
              setApplyDone(true)
            } else if (data.type === 'stopped') {
              setStopped(true)
            }
          } catch {}
        }
      }
    } catch (e) { alert(e.message) }
    finally {
      setApplying(false)
      setStopping(false)
      setSelectedIds(new Set())
      setStopped(prev => {
        if (!prev) setApplyDone(true)
        return prev
      })
      onRefreshStats()
    }
  }

  const formatSalary = (s) => {
    if (!s) return null
    const parts = []
    if (s.from) parts.push(s.from.toLocaleString('ru-RU'))
    if (s.to) parts.push(s.to.toLocaleString('ru-RU'))
    if (!parts.length) return null
    return parts.join(' – ') + ' ₽'
  }

  const formatPublishedAt = (iso) => {
    if (!iso) return null
    const d = new Date(iso)
    const now = new Date()
    const diff = Math.floor((now - d) / 864e5)
    if (diff === 0) return 'сегодня'
    if (diff === 1) return 'вчера'
    if (diff < 7) return `${diff} дн. назад`
    if (diff < 30) return `${Math.floor(diff / 7)} нед. назад`
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
  }

  const sentCount = progress.filter(p => ['sent', 'cover_letter_filled'].includes(p.status)).length
  const errorCount = progress.filter(p => p.status === 'error').length
  const skipCount = progress.filter(p => ['test_required', 'no_button', 'already_applied', 'skipped_cache'].includes(p.status)).length
  const pct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0

  const canApply = extensionConnected

  const SKIP_STATUSES = ['applied', 'sent', 'cover_letter_filled', 'already_applied', 'test_required', 'no_button']
  const unappliedCount = selectedIds.size > 0
    ? [...selectedIds].filter(id => !SKIP_STATUSES.includes(vacancyStatuses[id])).length
    : vacancies.filter(v => !SKIP_STATUSES.includes(vacancyStatuses[v.id])).length

  const allUnappliedCount = vacancies.filter(v => !SKIP_STATUSES.includes(vacancyStatuses[v.id])).length

  const handleStartApply = () => {
    if (extensionConnected) startMassApplyViaExtension()
    else startMassApply()
  }

  const loadNextAndApply = async () => {
    setApplyDone(false)
    setStopped(false)
    setProgress([])
    setCurrentIndex(-1)
    setSkippedByDbCount(0)
    setSelectedIds(new Set())
    setProgressCollapsed(false)

    if (searchMode === 'manual') await loadMoreManual()
    else if (searchMode === 'ai') await loadMoreByResume()

    await new Promise(r => setTimeout(r, 300))
    handleStartApply()
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-5">
      <h2 className="text-xl sm:text-2xl font-bold text-white">Поиск и отклик</h2>

      {/* Status banner */}
      {extensionConnected ? (
        <div className="bg-success/10 border border-success/20 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="w-2.5 h-2.5 bg-success rounded-full animate-pulse" />
          <span className="text-success text-sm font-medium">Расширение подключено</span>
          <span className="text-xs text-slate-500 ml-1">Убедитесь, что вы вошли в hh.ru в этом браузере. Найдите вакансии и нажмите «Откликнуться»</span>
        </div>
      ) : (
        <div className="bg-warn/10 border border-warn/20 rounded-xl px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-warn font-medium text-sm">Расширение не подключено</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Без расширения доступен только поиск вакансий. Скачайте и установите расширение для Chrome или Яндекс Браузера.
            </div>
          </div>
        </div>
      )}

      {/* Top row: Search + Resume — 50/50 */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Search form — left 50% */}
        <form onSubmit={searchManual} className="flex-1 min-w-0 lg:min-w-0 bg-dark-700 rounded-xl border border-dark-300 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 sm:gap-3 sm:items-end">
          <div className="flex-1 min-w-0 sm:min-w-[200px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Поиск</label>
            <input
              type="text" value={text} onChange={e => setText(e.target.value)}
              placeholder="python, devops, аналитик..."
              className="w-full px-3 py-2 bg-dark-600 border border-dark-300 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-accent/40 focus:border-accent/50 outline-none transition"
            />
          </div>
          <div className="w-full sm:w-52">
            <label className="block text-xs font-medium text-slate-500 mb-1">Город</label>
            <CityAutocomplete value={area} onChange={setArea} />
          </div>
          <div className="w-full sm:w-28">
            <label className="block text-xs font-medium text-slate-500 mb-1">Зарплата от</label>
            <input type="number" value={salary} onChange={e => setSalary(e.target.value)}
              placeholder="100000" min={0}
              className="w-full px-3 py-2 bg-dark-600 border border-dark-300 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-accent/40 focus:border-accent/50 outline-none transition" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none pb-0.5 group">
            <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors ${remote ? 'bg-accent' : 'bg-dark-400'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${remote ? 'translate-x-4' : 'translate-x-0'}`} />
              <input type="checkbox" checked={remote} onChange={e => setRemote(e.target.checked)} className="sr-only" />
            </span>
            <span className={`transition-colors ${remote ? 'text-slate-200' : 'text-slate-500'}`}>Удалёнка</span>
          </label>
          <button type="submit" disabled={loading}
            className="px-5 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 transition">
            {loading ? 'Ищем...' : 'Найти'}
          </button>
          <button type="button" onClick={searchByResume} disabled={loading || !resume.trim()}
            className="px-4 py-2 bg-dark-400 text-slate-300 text-sm font-medium rounded-lg hover:bg-dark-300 disabled:opacity-50 transition">
            AI-подбор
          </button>
        </div>
      </form>

        {/* Resume card — right 50% */}
        <div className="w-full lg:flex-1 lg:min-w-0">
          <div className={`bg-dark-700 rounded-xl overflow-hidden h-full border transition-colors ${resume?.trim() ? 'border-dark-300' : 'border-red-900/60'}`}>
            <div className={`px-4 py-3 border-b flex items-center gap-2 transition-colors ${resume?.trim() ? 'border-dark-300' : 'border-red-900/40 bg-red-950/20'}`}>
              <span className={resume?.trim() ? 'text-slate-400' : 'text-red-400'}>💼</span>
              <h3 className={`text-sm font-semibold ${resume?.trim() ? 'text-white' : 'text-red-300'}`}>Активное резюме</h3>
              {!resume?.trim() && <span className="ml-auto text-xs text-red-400/80 animate-pulse">Требуется</span>}
            </div>
            <div className="p-4">
              {resumeExpanded ? (
                <div className="space-y-3">
                  <textarea
                    value={resume}
                    onChange={(e) => setResume(e.target.value)}
                    placeholder="Вставьте текст резюме или загрузите файл..."
                    rows={6}
                    className="w-full px-3 py-2.5 border border-dark-300 rounded-lg text-sm resize-none focus:ring-2 bg-dark-600 text-slate-200"
                  />
                  <div className="flex gap-2">
                    <input ref={fileInputRef} type="file" accept=".txt,.pdf" onChange={handleFileChange} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 text-xs bg-dark-400 text-slate-300 rounded-lg hover:bg-dark-300 transition">
                      Загрузить файл
                    </button>
                    <button onClick={() => setResumeExpanded(false)} className="px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition">
                      Готово
                    </button>
                  </div>
                </div>
              ) : resume?.trim() ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 bg-success rounded-full" />
                    <span className="text-xs font-medium text-success">Готово к поиску</span>
                  </div>
                  <div className="text-sm font-medium text-slate-200 mb-3 line-clamp-2">
                    {parseResumePreview(resume).title || 'Резюме загружено'}
                  </div>
                  {((queryStates.length > 0 ? queryStates.map(s => s.query) : parseResumePreview(resume).skills) || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {(queryStates.length > 0 ? queryStates.map(s => s.query) : parseResumePreview(resume).skills).map((skill, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md bg-dark-500 text-slate-300 text-xs">
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => setResumeExpanded(true)} className="text-xs text-accent hover:text-accent-hover transition">
                      Редактировать
                    </button>
                    {extensionConnected && (
                      hhResumes.length === 0 ? (
                        <button
                          onClick={async () => {
                            setHhResumesLoading(true)
                            try {
                              const res = await sendExtMessage({ type: 'get_resumes_list' })
                              if (res?.ok && res.resumes?.length) {
                                setHhResumes(res.resumes)
                                setHhResumeIndex(prev => prev ?? 0)
                              } else {
                                setHhResumes([{ index: 0, title: 'Не удалось определить' }])
                              }
                            } catch { setHhResumes([{ index: 0, title: 'Ошибка' }]) }
                            finally { setHhResumesLoading(false) }
                          }}
                          disabled={hhResumesLoading}
                          className="text-xs text-slate-500 hover:text-slate-300 transition disabled:opacity-50"
                        >
                          {hhResumesLoading ? 'Определяем...' : 'Резюме на HH →'}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-slate-500">HH резюме:</span>
                          <select
                            value={hhResumeIndex ?? 0}
                            onChange={e => setHhResumeIndex(Number(e.target.value))}
                            className="text-xs bg-dark-500 text-slate-300 border border-dark-300 rounded-lg px-2 py-1 max-w-[200px] truncate"
                          >
                            {hhResumes.map(r => (
                              <option key={r.index} value={r.index}>{r.index + 1}. {r.title}</option>
                            ))}
                          </select>
                          <button
                            onClick={async () => {
                              const v = vacancies[0]
                              if (!v) return alert('Нет вакансий для теста')
                              const vid = String(v.id)
                              await sendExtMessage({ type: 'check_vacancy', vacancyId: vid })
                              await new Promise(r => setTimeout(r, 1000))
                              await sendExtMessage({ type: 'apply_vacancy', coverLetter: '', resumeIndex: hhResumeIndex })
                              await new Promise(r => setTimeout(r, 3000))
                              const dbg = await sendExtMessage({ type: 'debug_resume_modal' })
                              console.log('DEBUG MODAL:', JSON.stringify(dbg, null, 2))
                              alert('radios: ' + (dbg?.radios ?? '?') + '\ndata-qa: ' + (dbg?.dataQas?.map(d => d.qa).join(', ') || 'none') + '\nhtml (console)')
                              await sendExtMessage({ type: 'close_work_tab' })
                            }}
                            className="text-xs text-warn hover:text-yellow-300 transition"
                          >
                            Тест
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-4">
                  <div className="w-10 h-10 rounded-full bg-red-950/40 border border-red-900/30 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm text-red-300 font-medium mb-1">Резюме не загружено</p>
                  <p className="text-xs text-red-400/70 mb-4">Загрузите резюме, чтобы AI мог подобрать вакансии и составить письма</p>
                  <input ref={fileInputRef} type="file" accept=".txt,.pdf" onChange={handleFileChange} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 text-sm bg-red-900/30 text-red-200 border border-red-900/40 rounded-lg hover:bg-red-900/50 transition">
                    Загрузить файл
                  </button>
                  <button onClick={() => setResumeExpanded(true)} className="block w-full mt-2 text-xs text-red-400/80 hover:text-red-300">
                    или вставить текст
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {searchInfo && (
        <div className="bg-accent/10 text-accent-hover text-sm rounded-lg px-4 py-2.5 border border-accent/20">
          {searchInfo}
        </div>
      )}

      {/* Apply progress */}
      {(applying || applyDone || stopped) && (
        <div className="bg-dark-700 rounded-xl border border-dark-300 p-5 space-y-4">
          <div>
            <div className="flex justify-between text-sm text-slate-400 mb-1.5">
              <span>{applying ? (stopping ? 'Останавливаем...' : 'Отправка откликов...') : stopped ? 'Остановлено' : 'Завершено'}</span>
              <span>{Math.min(currentIndex + 1, total)} / {total} ({pct}%)</span>
            </div>
            <div className="w-full bg-dark-300 rounded-full h-2">
              <div className={`h-2 rounded-full transition-all duration-300 ${stopped ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex flex-wrap gap-5 text-xs">
            {skippedByDbCount > 0 && (
              <span className="text-slate-500">Пропущено по базе: {skippedByDbCount}</span>
            )}
            <span className="text-success">Отправлено: {sentCount}</span>
            <span className="text-warn">Пропущено: {skipCount}</span>
            <span className="text-danger">Ошибок: {errorCount}</span>
          </div>
          {applying && !stopping && (
            <button onClick={stopMassApply}
              className="px-5 py-2 bg-danger text-white text-sm font-semibold rounded-lg hover:bg-red-600 transition">
              Стоп
            </button>
          )}
          {applying && stopping && (
            <span className="text-warn text-sm animate-pulse">Останавливаем после текущей вакансии...</span>
          )}
          {(applyDone || stopped) && !applying && progress.length > 0 && (
            <button onClick={() => setProgressCollapsed(prev => !prev)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition">
              <span className={`inline-block transition-transform ${progressCollapsed ? '' : 'rotate-90'}`}>▶</span>
              {progressCollapsed ? 'Показать детали' : 'Скрыть детали'} ({progress.length})
            </button>
          )}
          {progress.length > 0 && !(progressCollapsed && (applyDone || stopped) && !applying) && (
            <div className="divide-y divide-dark-300 max-h-[300px] overflow-y-auto border border-dark-300 rounded-lg">
              {progress.map((p, i) => {
                const st = STATUS_LABELS[p.status] || null
                return (
                  <div key={p.vacancy_id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    <span className="shrink-0 w-5 text-slate-600 text-xs">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-200 truncate">{p.title || p.vacancy_id}</div>
                      {st ? (
                        <div className={`text-xs mt-0.5 ${st.cls}`}>{st.icon} {st.text}{p.error ? ` — ${p.error}` : ''}</div>
                      ) : (
                        <div className="text-xs text-accent-hover mt-0.5 animate-pulse">
                          {p.step === 'checking' && 'Проверка...'}
                          {p.step === 'generating_letter' && 'Генерация письма...'}
                          {p.step === 'applying' && 'Отправка...'}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {(applyDone || stopped) && !applying && (
            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-dark-300">
              {allUnappliedCount > 0 && canApply && resume?.trim() && (
                <button onClick={() => {
                  setApplyDone(false); setStopped(false); setProgress([]); setCurrentIndex(-1);
                  setSkippedByDbCount(0); setSelectedIds(new Set()); setProgressCollapsed(false);
                  setTimeout(handleStartApply, 100)
                }}
                  className="px-5 py-2.5 bg-success text-white font-semibold rounded-lg hover:bg-green-600 transition text-sm">
                  Откликнуться на остальные ({allUnappliedCount})
                </button>
              )}
              {canLoadMore && canApply && resume?.trim() && (
                <button onClick={loadNextAndApply}
                  className="px-4 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition text-sm">
                  Загрузить ещё и откликнуться
                </button>
              )}
              <button onClick={() => {
                setApplyDone(false); setStopped(false); setProgress([]); setCurrentIndex(-1);
                setSkippedByDbCount(0); setSelectedIds(new Set()); setProgressCollapsed(false);
              }}
                className="px-4 py-2 bg-dark-400 text-slate-300 text-sm rounded-lg hover:bg-dark-300 transition">
                Сбросить
              </button>
              {allUnappliedCount === 0 && !canLoadMore && (
                <span className="text-xs text-slate-500 italic">Все вакансии из списка обработаны</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Vacancy list — full width */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-300 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-slate-400">
              {vacancies.length > 0 ? (
                <>
                  Найдено вакансий = {searchMode === 'ai' && queryStates.length > 0
                    ? queryStates.reduce((s, st) => s + st.total, 0)
                    : totalFound}. Показано = {vacancies.length}
                </>
              ) : (
                'Результаты поиска'
              )}
            </div>
            {vacancies.length > 0 && (
              <div className="text-xs text-slate-500 mt-0.5">Выберите вакансии для отклика</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {vacancies.length > 0 && canApply && !applying && !applyDone && !stopped && unappliedCount > 0 && (
              <button onClick={handleStartApply} disabled={!resume?.trim()}
                className="px-5 py-2.5 bg-success text-white font-semibold rounded-lg hover:bg-green-600 disabled:opacity-50 transition text-sm">
                Откликнуться ({unappliedCount})
              </button>
            )}
            {vacancies.length > 0 && (
              <button
                onClick={toggleSelectAll}
                className="px-3 py-1.5 text-xs bg-dark-500 text-slate-400 rounded-lg hover:bg-dark-400 hover:text-slate-200 transition"
              >
                {selectedIds.size >= vacancies.length ? 'Снять выбор' : 'Выбрать все'}
              </button>
            )}
          </div>
        </div>
        {/* Load more / Load all bar — always visible above the list */}
        {canLoadMore && !loading && vacancies.length > 0 && (
          <div className="px-4 py-2.5 border-b border-dark-300 bg-dark-600/50 flex flex-wrap items-center gap-3">
            {loadAllLoading ? (
              <>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm text-accent">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12"/></svg>
                    <span>Загрузка: {loadAllProgress}</span>
                  </div>
                  <div className="w-full bg-dark-300 rounded-full h-1.5 mt-1.5">
                    <div className="h-1.5 rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.round((vacancies.length / Math.max(1, totalFound)) * 100))}%` }} />
                  </div>
                </div>
                <button onClick={stopLoadAll}
                  className="px-3 py-1.5 text-xs bg-danger/20 text-danger rounded-lg hover:bg-danger/30 transition shrink-0">
                  Стоп
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-slate-500">
                  Загружено {vacancies.length} — осталось ~{remainingCount}
                </span>
                <button onClick={handleLoadMore} disabled={loadMoreLoading}
                  className="px-3 py-1.5 text-xs bg-dark-500 text-slate-300 rounded-lg hover:bg-dark-400 disabled:opacity-50 transition">
                  {loadMoreLoading ? 'Загружаем…' : 'Загрузить ещё'}
                </button>
                <button onClick={loadAllVacancies}
                  className="px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition">
                  Загрузить все (~{remainingCount})
                </button>
              </>
            )}
          </div>
        )}
        {loading ? (
          <div className="p-4 space-y-2">
            {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-dark-500 rounded animate-pulse" />)}
          </div>
        ) : vacancies.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">Введите запрос или используйте AI-подбор</div>
        ) : (
          <div className="max-h-[60vh] sm:max-h-[500px] overflow-y-auto flex flex-col">
            <ul className="divide-y divide-dark-300 flex-1">
              {vacancies.slice(0, visibleLimit).map(v => {
                const score = matchScores[v.id]
                const scoreCls = score >= 80 ? 'text-success' : score >= 50 ? 'text-warn' : 'text-slate-500'
                const isSelected = selectedIds.has(v.id)
                return (
                  <li key={v.id} className={`hover:bg-dark-600 transition ${isSelected ? 'bg-accent/5 border-l-2 border-accent' : ''}`}>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(v.id)}
                        onClick={e => e.stopPropagation()}
                        className="mt-1 w-4 h-4 accent-accent rounded"
                      />
                      <a
                        href={`https://hh.ru/vacancy/${v.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-200 line-clamp-2">{v.name}</div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                              {v.employer?.logo_urls?.['90'] && (
                                <img src={v.employer.logo_urls['90']} alt="" className="w-6 h-6 rounded object-contain" />
                              )}
                              <span>{v.employer?.name}</span>
                              {v.area?.name && (
                                <span className="flex items-center gap-0.5">
                                  <span>•</span> {v.area.name}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {vacancyStatuses[v.id] && CARD_STATUS_LABELS[vacancyStatuses[v.id]] && (
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${CARD_STATUS_LABELS[vacancyStatuses[v.id]].cls}`}>
                                  {CARD_STATUS_LABELS[vacancyStatuses[v.id]].icon} {CARD_STATUS_LABELS[vacancyStatuses[v.id]].text}
                                </span>
                              )}
                              {v.experience?.name && (
                                <span className="px-2 py-0.5 rounded bg-dark-500 text-slate-400 text-xs">{v.experience.name}</span>
                              )}
                              {v.schedule?.name && v.schedule.id === 'remote' && (
                                <span className="px-2 py-0.5 rounded bg-accent/15 text-accent text-xs">{v.schedule.name}</span>
                              )}
                              {v.employment?.name && (
                                <span className="px-2 py-0.5 rounded bg-dark-500 text-slate-400 text-xs">{v.employment.name}</span>
                              )}
                              {v.has_test && (
                                <span className="px-2 py-0.5 rounded bg-warn/20 text-warn text-xs">Тест</span>
                              )}
                              {formatSalary(v.salary) && (
                                <span className="px-2 py-0.5 rounded bg-success/10 text-success text-xs">{formatSalary(v.salary)}</span>
                              )}
                              {formatPublishedAt(v.published_at) && (
                                <span className="px-2 py-0.5 rounded bg-dark-500 text-slate-500 text-xs">{formatPublishedAt(v.published_at)}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {score != null && (
                              <span className={`text-sm font-semibold ${scoreCls}`}>★ {score}%</span>
                            )}
                            <span className="text-slate-500 hover:text-accent-hover">↗</span>
                          </div>
                        </div>
                        {score != null && (
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                              <span>Соответствие резюме</span>
                              <span className={scoreCls}>{score}%</span>
                            </div>
                            <div className="w-full bg-dark-300 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all ${score >= 80 ? 'bg-success' : score >= 50 ? 'bg-warn' : 'bg-slate-500'}`}
                                style={{ width: `${score}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </a>
                    </div>
                  </li>
                )
              })}
            </ul>
            {vacancies.length > visibleLimit && (
              <div className="p-2 border-t border-dark-300 shrink-0 text-center">
                <button
                  onClick={() => setVisibleLimit(l => l + 100)}
                  className="py-2 px-4 text-xs text-accent hover:text-accent-hover transition"
                >
                  Показать ещё {Math.min(100, vacancies.length - visibleLimit)} из {vacancies.length - visibleLimit} скрытых
                </button>
              </div>
            )}
            {canLoadMore && !loadAllLoading && (
              <div className="p-3 border-t border-dark-300 shrink-0 flex gap-2">
                <button
                  onClick={handleLoadMore}
                  disabled={loadMoreLoading}
                  className="flex-1 py-2.5 bg-dark-500 text-slate-300 text-sm font-medium rounded-lg hover:bg-dark-400 disabled:opacity-50 transition"
                >
                  {loadMoreLoading ? 'Загружаем…' : `Ещё ${Math.min(remainingCount, PER_PAGE * (searchMode === 'ai' ? queryStates.length : 1))}`}
                </button>
                <button
                  onClick={loadAllVacancies}
                  className="flex-1 py-2.5 bg-accent/20 text-accent text-sm font-medium rounded-lg hover:bg-accent/30 transition"
                >
                  Загрузить все (~{remainingCount})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
