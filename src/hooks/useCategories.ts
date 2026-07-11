/**
 * useCategories — загружает категории из API и кэширует в памяти.
 * Используется во всём приложении вместо захардкоженных CATEGORIES.
 */
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../api/client'
import type { PersonCategory } from '../types'

// Дефолтные категории пока API не ответил
export const FALLBACK_CATEGORIES: PersonCategory[] = [
  { code: 'BLACKLIST', label: 'Чёрный список', color: '#ef4444', bg_color: '#450a0a', is_alert: true,  alert_sound: 'builtin', alert_volume: 1.0, detect_enabled: true,  sort_order: 1, is_system: true  },
  { code: 'RESPONSE',  label: 'Реагирование',  color: '#f97316', bg_color: '#431407', is_alert: true,  alert_sound: 'builtin', alert_volume: 0.9, detect_enabled: true,  sort_order: 2, is_system: true  },
  { code: 'VIP',       label: 'VIP',            color: '#a855f7', bg_color: '#2e1065', is_alert: true,  alert_sound: 'builtin', alert_volume: 0.7, detect_enabled: true,  sort_order: 3, is_system: false },
  { code: 'SECURITY',  label: 'Охрана',         color: '#3b82f6', bg_color: '#172554', is_alert: false, alert_sound: 'off',     alert_volume: 0.5, detect_enabled: true,  sort_order: 4, is_system: false },
  { code: 'STAFF',     label: 'Персонал',       color: '#22c55e', bg_color: '#052e16', is_alert: false, alert_sound: 'off',     alert_volume: 0.5, detect_enabled: true,  sort_order: 5, is_system: false },
  { code: 'CLIENT',    label: 'Клиент',         color: '#6b7280', bg_color: '#111827', is_alert: false, alert_sound: 'off',     alert_volume: 0.5, detect_enabled: true,  sort_order: 6, is_system: false },
]

// Глобальный кэш — загружается один раз
let _cache: PersonCategory[] | null = null
// Подписчики — все useCategories хуки получают обновление
const _subscribers = new Set<(cats: PersonCategory[]) => void>()

function _notify(cats: PersonCategory[]) {
  _subscribers.forEach(fn => fn(cats))
}

export function invalidateCategoriesCache() {
  _cache = null
}

export async function fetchCategories(): Promise<PersonCategory[]> {
  if (_cache) return _cache
  try {
    const data = await apiFetch<PersonCategory[]>('/categories/')
    _cache = data
    _notify(data)
    return data
  } catch {
    return FALLBACK_CATEGORIES
  }
}

export function getCategoryByCode(code: string, cats: PersonCategory[]): PersonCategory | undefined {
  return cats.find(c => c.code === code)
}

export function getCategoryLabel(code: string, cats: PersonCategory[]): string {
  return cats.find(c => c.code === code)?.label ?? code
}

export function getCategoryColor(code: string, cats: PersonCategory[]): string {
  return cats.find(c => c.code === code)?.color ?? '#6b7280'
}

export function useCategories() {
  const [categories, setCategories] = useState<PersonCategory[]>(_cache ?? FALLBACK_CATEGORIES)
  const [loading, setLoading] = useState(!_cache)

  // Подписываемся на глобальные обновления кэша
  useEffect(() => {
    const handler = (cats: PersonCategory[]) => setCategories(cats)
    _subscribers.add(handler)
    return () => { _subscribers.delete(handler) }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    invalidateCategoriesCache()
    const data = await fetchCategories()
    setCategories(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (_cache) {
      setCategories(_cache)
      setLoading(false)
      return
    }
    fetchCategories().then(data => {
      setCategories(data)
      setLoading(false)
    })
  }, [])

  return { categories, loading, reload }
}
