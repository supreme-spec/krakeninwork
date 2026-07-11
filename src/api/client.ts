// Архитектура портов:
// Фронтенд (FRONTEND_PORT) → прокси в launcher.py → Бэкенд (BACKEND_PORT)
// Все запросы /api/* проксируются автоматически.
// WS тоже идёт через тот же хост/порт что и фронтенд — прокси пробрасывает.

import clientLogger from '../lib/client-logger'

const BASE_URL = '/api'

/** Базовый URL для фото/снимков — пустой, т.к. пути в БД уже содержат photos/ или snapshots/ */
export const PHOTO_BASE = ''

/** Базовый URL для прямых ссылок */
export const API_ORIGIN = ''

// WS на том же хосте/порту что фронтенд (launcher/vite проксируют /ws/*).
export const WS_BASE =
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`

/**
 * Normalize API path: add trailing slash only for simple collection endpoints.
 *
 * Rules:
 * - Add slash if path ends with a plain word (collection root like /cameras, /persons)
 * - Do NOT add slash if:
 *   - path already ends with /
 *   - last segment contains digits (item id: /cameras/2)
 *   - previous segment contains digits (action after id: /cameras/2/snapshot)
 *   - last segment is a known action word (clear, reindex_all, reindex, start, stop,
 *     snapshot, recognize, scan, usb, onvif, diagnose, setup, login, health, backup)
 *   - path has 3+ segments (nested resource — never add slash)
 */

const COLLECTION_ROOTS = new Set(['events', 'persons', 'cameras', 'categories'])

function normalizePath(path: string): string {
  const q = path.indexOf('?')
  const pathOnly = q >= 0 ? path.slice(0, q) : path
  const query = q >= 0 ? path.slice(q) : ''
  if (pathOnly.endsWith('/')) return path
  const parts = pathOnly.split('/').filter(Boolean)
  // /events?limit=50 → /events/?limit=50 (FastAPI требует слэш)
  if (parts.length === 1 && COLLECTION_ROOTS.has(parts[0])) {
    return `/${parts[0]}/${query}`
  }
  return path
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('kraken_token')
  const url = `${BASE_URL}${normalizePath(path)}`
  const method = options?.method || 'GET'

  clientLogger.debug(`API запрос: ${method} ${path}`)
  const startTime = Date.now()

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    })

    const duration = Date.now() - startTime
    clientLogger.debug(`API ответ: ${method} ${path} ${res.status}`, { duration: `${duration}ms` })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      const error = new Error(err.detail || 'Request failed')
      clientLogger.error(error, { path, method, status: res.status })
      throw error
    }
    return res.json()
  } catch (err) {
    clientLogger.error(err as Error, { path, method, context: 'API запрос' })
    throw err
  }
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = localStorage.getItem('kraken_token')
  const url = `${BASE_URL}${normalizePath(path)}`

  clientLogger.debug(`API загрузка: POST ${path}`)
  const startTime = Date.now()

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    })

    const duration = Date.now() - startTime
    clientLogger.debug(`API ответ загрузки: POST ${path} ${res.status}`, { duration: `${duration}ms` })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      const error = new Error(err.detail || 'Upload failed')
      clientLogger.error(error, { path, status: res.status })
      throw error
    }
    return res.json()
  } catch (err) {
    clientLogger.error(err as Error, { path, context: 'API загрузка' })
    throw err
  }
}
