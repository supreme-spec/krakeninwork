/**
 * usePushNotifications — браузерные Web Notifications.
 *
 * Дедупликация по СМЕНЕ (не по календарному дню):
 *   Смена = 21:00 текущего дня → 09:00 следующего дня
 *
 * Если сейчас 00:30 — смена началась вчера в 21:00, ключ = "YYYY-MM-DD_вчера"
 * Если сейчас 22:00 — смена началась сегодня в 21:00, ключ = "YYYY-MM-DD_сегодня"
 * Если сейчас 10:00 — смена закончилась, следующая ещё не началась (тихий период)
 *
 * Один человек в одной категории — одно уведомление за смену.
 * Сброс автоматически при смене ключа смены.
 */
import { useRef, useState } from 'react'
import type { AlertMessage } from '../types'

export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported'

// Начало смены: 21:00, конец: 09:00 следующего дня
const SHIFT_START_HOUR = 21
const SHIFT_END_HOUR   = 9

interface Options {
  enabled: boolean
  enabledCategories: Set<string>
}

// ── Вычислить ключ текущей смены ──────────────────────────────────────────────
// Возвращает строку вида "2026-05-03_night" — одинаковую для всего периода смены.
// В 21:00 ключ меняется → старые записи автоматически игнорируются.
export function currentShiftKey(): string {
  const now = new Date()
  const h = now.getHours()

  // Если сейчас между 00:00 и 09:00 — смена началась вчера вечером
  // Используем дату вчерашнего дня как ключ
  if (h < SHIFT_END_HOUR) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    return `kraken_shift_${yesterday.toISOString().slice(0, 10)}`
  }

  // Если сейчас между 21:00 и 23:59 — смена началась сегодня
  if (h >= SHIFT_START_HOUR) {
    return `kraken_shift_${now.toISOString().slice(0, 10)}`
  }

  // Между 09:00 и 21:00 — тихий период, смены нет
  // Используем специальный ключ чтобы не смешивать с ночной сменой
  return `kraken_shift_${now.toISOString().slice(0, 10)}_day`
}

// ── Проверить: идёт ли сейчас смена ──────────────────────────────────────────
export function isShiftActive(): boolean {
  const h = new Date().getHours()
  return h >= SHIFT_START_HOUR || h < SHIFT_END_HOUR
}

// ── Когда начнётся следующая смена ───────────────────────────────────────────
export function nextShiftStart(): string {
  const now = new Date()
  const h = now.getHours()
  if (h >= SHIFT_END_HOUR && h < SHIFT_START_HOUR) {
    // Сейчас день — следующая смена сегодня в 21:00
    const next = new Date(now)
    next.setHours(SHIFT_START_HOUR, 0, 0, 0)
    return next.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  return '' // смена уже идёт
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadShiftSet(): Set<string> {
  try {
    const raw = localStorage.getItem(currentShiftKey())
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {}
  return new Set()
}

function saveShiftSet(s: Set<string>) {
  try {
    const key = currentShiftKey()
    localStorage.setItem(key, JSON.stringify([...s]))

    // Чистим старые смены (старше 3 дней)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 3)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k?.startsWith('kraken_shift_')) continue
      // Извлекаем дату из ключа
      const datePart = k.replace('kraken_shift_', '').slice(0, 10)
      if (datePart < cutoffStr) localStorage.removeItem(k)
    }
  } catch {}
}

function entryKey(alert: AlertMessage): string {
  return `${alert.category}:${alert.person_id}`
}

// ── Хук ──────────────────────────────────────────────────────────────────────

export function usePushNotifications({ enabled, enabledCategories }: Options) {
  const [permission, setPermission] = useState<NotifyPermission>(() => {
    if (!('Notification' in window)) return 'unsupported'
    return Notification.permission as NotifyPermission
  })

  // Кэш в памяти — синхронизируется с localStorage при каждом вызове
  const seenRef = useRef<Set<string>>(loadShiftSet())
  // Запоминаем ключ смены при инициализации — если сменился, сбрасываем кэш
  const shiftKeyRef = useRef<string>(currentShiftKey())

  const requestPermission = async (): Promise<NotifyPermission> => {
    if (!('Notification' in window)) return 'unsupported'
    const result = await Notification.requestPermission()
    setPermission(result as NotifyPermission)
    return result as NotifyPermission
  }

  const notify = (alert: AlertMessage) => {
    if (!enabled) return
    if (permission !== 'granted') return
    // Фильтр по выбранным категориям
    if (!enabledCategories.has(alert.category)) return

    // Если ключ смены изменился — сбрасываем кэш в памяти
    const currentKey = currentShiftKey()
    if (currentKey !== shiftKeyRef.current) {
      shiftKeyRef.current = currentKey
      seenRef.current = new Set()
    }

    // Синхронизируем с localStorage (другая вкладка могла записать)
    seenRef.current = loadShiftSet()

    const key = entryKey(alert)

    // ── Дедупликация по смене ─────────────────────────────────────────────────
    if (seenRef.current.has(key)) return

    seenRef.current.add(key)
    saveShiftSet(seenRef.current)

    // ── Текст ─────────────────────────────────────────────────────────────────
    const titles: Record<string, string> = {
      BLACKLIST: '⚠ ЧЁРНЫЙ СПИСОК',
      RESPONSE:  '🚨 РЕАГИРОВАНИЕ',
      VIP:       '⭐ VIP прибыл',
    }
    const title = titles[alert.category] ?? 'Kraken — событие'
    const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    const body = `${alert.person_name} • Камера ${alert.camera_id} • ${timeStr}`

    try {
      const n = new Notification(title, {
        body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: `kraken-${alert.category}-${alert.person_id}`,
        requireInteraction: alert.category === 'BLACKLIST' || alert.category === 'RESPONSE',
        silent: false,
      })
      n.onclick = () => { window.focus(); n.close() }
    } catch (e) {
      console.warn('Notification error:', e)
    }
  }

  // Сброс вручную (кнопка в UI)
  const resetToday = () => {
    seenRef.current = new Set()
    try { localStorage.removeItem(currentShiftKey()) } catch {}
  }

  // Сколько уведомлений отправлено за текущую смену
  const getShiftCount = (): number => {
    try {
      const raw = localStorage.getItem(currentShiftKey())
      return raw ? JSON.parse(raw).length : 0
    } catch { return 0 }
  }

  return { permission, requestPermission, notify, resetToday, getShiftCount, isShiftActive, nextShiftStart }
}
