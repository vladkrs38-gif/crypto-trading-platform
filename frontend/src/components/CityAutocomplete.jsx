import { useState, useRef, useEffect, useCallback } from 'react'

const POPULAR_CITIES = [
  { id: '113', name: 'Вся Россия' },
  { id: '1', name: 'Москва' },
  { id: '2', name: 'Санкт-Петербург' },
  { id: '3', name: 'Екатеринбург' },
  { id: '4', name: 'Новосибирск' },
  { id: '88', name: 'Казань' },
  { id: '66', name: 'Нижний Новгород' },
  { id: '54', name: 'Красноярск' },
  { id: '104', name: 'Челябинск' },
  { id: '72', name: 'Омск' },
  { id: '76', name: 'Ростов-на-Дону' },
  { id: '78', name: 'Самара' },
  { id: '99', name: 'Уфа' },
  { id: '26', name: 'Воронеж' },
  { id: '53', name: 'Краснодар' },
  { id: '68', name: 'Новокузнецк' },
  { id: '50', name: 'Кемерово' },
  { id: '1438', name: 'Краснодарский край' },
  { id: '1202', name: 'Московская область' },
]

export default function CityAutocomplete({ value, onChange }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  const selectedName = POPULAR_CITIES.find(c => c.id === value)?.name
    || (value === '113' ? 'Вся Россия' : '')

  const [displayName, setDisplayName] = useState(selectedName)

  useEffect(() => {
    const name = POPULAR_CITIES.find(c => c.id === value)?.name
      || (value === '113' ? 'Вся Россия' : '')
    setDisplayName(name)
  }, [value])

  const fetchSuggestions = useCallback(async (text) => {
    if (!text || text.length < 1) {
      setSuggestions(POPULAR_CITIES)
      return
    }
    const lower = text.toLowerCase()
    const localMatches = POPULAR_CITIES.filter(c =>
      c.name.toLowerCase().startsWith(lower) || c.name.toLowerCase().includes(lower)
    )
    if (localMatches.length >= 5) {
      setSuggestions(localMatches)
      return
    }
    setLoading(true)
    try {
      const r = await fetch(`https://api.hh.ru/suggests/areas?text=${encodeURIComponent(text)}`)
      if (r.ok) {
        const data = await r.json()
        const apiItems = (data.items || []).map(item => ({ id: String(item.id), name: item.text }))
        const merged = [...localMatches]
        const ids = new Set(merged.map(c => c.id))
        for (const item of apiItems) {
          if (!ids.has(item.id)) {
            merged.push(item)
            ids.add(item.id)
          }
        }
        setSuggestions(merged.slice(0, 15))
      }
    } catch {
      setSuggestions(localMatches)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (e) => {
    const val = e.target.value
    setQuery(val)
    setHighlightIdx(-1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 200)
  }

  const handleFocus = () => {
    setIsOpen(true)
    setQuery('')
    fetchSuggestions('')
  }

  const handleSelect = (city) => {
    onChange(city.id)
    setDisplayName(city.name)
    setQuery('')
    setIsOpen(false)
    setHighlightIdx(-1)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e) => {
    if (!isOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
        handleSelect(suggestions[highlightIdx])
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setQuery('')
    }
  }

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const highlightMatch = (text, q) => {
    if (!q) return text
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <span className="text-accent font-medium">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    )
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={isOpen ? query : displayName}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="Начните вводить город..."
        className="w-full px-3 py-2 bg-dark-600 border border-dark-300 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-accent/40 focus:border-accent/50 outline-none transition"
      />
      {isOpen && displayName && !query && (
        <div className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">
          {displayName}
        </div>
      )}
      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto bg-dark-600 border border-dark-300 rounded-lg shadow-xl shadow-black/30">
          {loading && (
            <div className="px-3 py-2 text-xs text-slate-500 flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              Поиск...
            </div>
          )}
          {!query && !loading && (
            <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-slate-600 uppercase tracking-wider">
              Популярные
            </div>
          )}
          {suggestions.map((city, i) => (
            <button
              key={city.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(city)}
              onMouseEnter={() => setHighlightIdx(i)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                i === highlightIdx
                  ? 'bg-accent/15 text-white'
                  : city.id === value
                    ? 'bg-dark-500 text-accent'
                    : 'text-slate-300 hover:bg-dark-500'
              }`}
            >
              <span className="flex items-center gap-2">
                {city.id === value && (
                  <svg className="w-3 h-3 text-accent flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                <span>{query ? highlightMatch(city.name, query) : city.name}</span>
              </span>
            </button>
          ))}
          {!loading && suggestions.length === 0 && query && (
            <div className="px-3 py-4 text-center text-xs text-slate-500">
              Ничего не найдено
            </div>
          )}
        </div>
      )}
    </div>
  )
}
