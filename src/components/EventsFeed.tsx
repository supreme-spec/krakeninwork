import { useState } from 'react'
import type { KrakenEvent } from '../types'
import CategoryBadge from './CategoryBadge'
import { PHOTO_BASE } from '../api/client'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  events: KrakenEvent[]
  maxItems?: number
}

const CATEGORY_DOT: Record<string, string> = {
  VIP:      'bg-kraken-green',
  BLACKLIST: 'bg-kraken-red',
  STAFF:    'bg-kraken-blue',
  CLIENT:   'bg-kraken-muted',
  RESPONSE: 'bg-kraken-orange',
  SECURITY: 'bg-kraken-gold',
  UNKNOWN:  'bg-kraken-disabled',
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function cosineToPercent(c: number) {
  return Math.round(((Math.max(0.28, Math.min(0.85, c)) - 0.28) / (0.85 - 0.28)) * 100)
}

/** Single event row — collapsible with expanded detail */
function EventRow({ ev }: { ev: KrakenEvent }) {
  const [personPhotoFailed, setPersonPhotoFailed] = useState(false)
  const [snapshotFailed, setSnapshotFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Left photo: person's registered (main) photo from DB card
  const personPhotoUrl = !personPhotoFailed && ev.person_photo_path
    ? `${PHOTO_BASE}/${ev.person_photo_path}`
    : null

  // Right thumbnail: snapshot from camera at detection moment
  const snapshotUrl = !snapshotFailed && ev.snapshot_path
    ? `${PHOTO_BASE}/${ev.snapshot_path}`
    : null

  const pct = ev.confidence != null ? cosineToPercent(ev.confidence) : null
  const confColor = ev.confidence == null ? '#9AA6B2'
    : ev.confidence >= 0.55 ? '#00FF94'
    : ev.confidence >= 0.38 ? '#FFB800'
    : '#FF3B3B'

  return (
    <div
      className={`transition-colors ${
        ev.event_type === 'BLACKLIST_ALERT'
          ? 'bg-kraken-red/5'
          : ev.event_type === 'RESPONSE_ALERT'
            ? 'bg-kraken-orange/5'
            : ''
      }`}
    >
      {/* ── Collapsed row ── */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 hover:bg-kraken-hover/60 cursor-pointer transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        {/* Category dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${CATEGORY_DOT[ev.person_category ?? 'UNKNOWN'] ?? 'bg-kraken-disabled'}`} />

        {/* Two photos side by side: card photo + snapshot */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Left: person's main card photo */}
          <div className="w-20 h-20 rounded-l-xl bg-kraken-hover border border-kraken-border overflow-hidden shadow-sm">
            {personPhotoUrl ? (
              <img
                src={personPhotoUrl}
                alt=""
                className="w-full h-full object-cover"
                onError={() => setPersonPhotoFailed(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl text-kraken-disabled">
                👤
              </div>
            )}
          </div>
          {/* Right: snapshot from camera — placed right next to card photo */}
          <div className="w-20 h-20 rounded-r-xl overflow-hidden border border-l-0 border-kraken-border bg-kraken-hover shadow-sm">
            {snapshotUrl ? (
              <img
                src={snapshotUrl}
                alt=""
                className="w-full h-full object-cover"
                onError={() => setSnapshotFailed(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-kraken-disabled text-lg">
                —
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-kraken-text text-sm font-semibold truncate">
              {ev.person_name ?? 'Неизвестен'}
            </span>
            {ev.person_category && (
              <CategoryBadge category={ev.person_category} />
            )}
          </div>
          <div className="text-kraken-disabled text-xs mt-0.5 flex items-center gap-1.5">
            <span>{ev.camera_name ?? (ev.camera_id ? `Камера ${ev.camera_id}` : '—')}</span>
            <span className="text-kraken-border">·</span>
            <span>{formatDateTime(ev.created_at)}</span>
          </div>
        </div>

        {/* Expand toggle */}
        <div className="text-kraken-disabled flex-shrink-0">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-kraken-hover/30 border-t border-kraken-border/40 animate-fade-in">
          <div className="flex gap-3">
            {/* Left: large card photo */}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div className="w-32 h-32 rounded-xl overflow-hidden border-2 border-kraken-purple/50 bg-kraken-hover shadow-sm">
                {personPhotoUrl ? (
                  <img src={personPhotoUrl} alt="" className="w-full h-full object-cover" onError={() => setPersonPhotoFailed(true)} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl text-kraken-disabled">👤</div>
                )}
              </div>
              <span className="text-kraken-disabled text-[10px] uppercase tracking-wider">Карточка</span>
            </div>

            {/* Center: info */}
            <div className="flex-1 min-w-0 flex flex-col gap-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-kraken-text font-bold text-sm">{ev.person_name ?? 'Неизвестен'}</span>
                {ev.person_category && <CategoryBadge category={ev.person_category} />}
              </div>
              <div className="flex items-center gap-1.5 text-kraken-disabled">
                <span>📷 {ev.camera_name ?? (ev.camera_id ? `Камера ${ev.camera_id}` : '—')}</span>
              </div>
              <div className="flex items-center gap-1.5 text-kraken-disabled">
                <span>🕐 {formatDateTime(ev.created_at)}</span>
              </div>
              {pct != null && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-kraken-disabled">Совпадение:</span>
                  <span className="font-bold text-sm" style={{ color: confColor }}>{pct}%</span>
                  <div className="flex-1 h-1 bg-kraken-base rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: confColor }} />
                  </div>
                </div>
              )}
              {ev.person_id && (
                <div className="text-kraken-disabled">ID: {ev.person_id}</div>
              )}
            </div>

            {/* Right: large snapshot */}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div className="w-32 h-32 rounded-xl overflow-hidden border-2 border-kraken-border bg-kraken-hover shadow-sm">
                {snapshotUrl ? (
                  <img src={snapshotUrl} alt="" className="w-full h-full object-cover" onError={() => setSnapshotFailed(true)} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-kraken-disabled text-lg text-center px-1">
                    Нет снимка
                  </div>
                )}
              </div>
              <span className="text-kraken-disabled text-[10px] uppercase tracking-wider">Снимок</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EventsFeed({ events, maxItems = 50 }: Props) {
  const items = events.slice(0, maxItems)

  if (items.length === 0) {
    return (
      <div className="text-kraken-disabled text-sm text-center py-8">
        Событий пока нет
      </div>
    )
  }

  return (
    <div className="flex flex-col divide-y divide-kraken-border">
      {items.map(ev => (
        <EventRow key={ev.id} ev={ev} />
      ))}
    </div>
  )
}
