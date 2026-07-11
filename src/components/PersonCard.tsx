import { useEffect, useState } from 'react'
import { X, Phone, Mail, MapPin, Building2, Calendar, Clock, Eye, Star, AlertTriangle, ThumbsUp, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Person } from '../types'
import CategoryBadge from './CategoryBadge'
import { PHOTO_BASE, apiFetch } from '../api/client'

interface Props {
  person: Person | null
  confidence?: number
  onClose?: () => void
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function cosineToPercent(cosine: number): number {
  const clamped = Math.max(0.28, Math.min(0.85, cosine))
  return Math.round(((clamped - 0.28) / (0.85 - 0.28)) * 100)
}

function confidenceColor(c: number) {
  if (c >= 0.55) return 'text-kraken-green'
  if (c >= 0.38) return 'text-yellow-400'
  return 'text-kraken-red'
}

function barColor(c: number) {
  if (c >= 0.55) return 'bg-kraken-green'
  if (c >= 0.38) return 'bg-yellow-400'
  return 'bg-kraken-red'
}

export default function PersonCard({ person, confidence, onClose }: Props) {
  const [full, setFull] = useState<Person | null>(null)
  const [loyalty, setLoyalty] = useState<any>(null)
  const [incidents, setIncidents] = useState<any[]>([])
  const [tags, setTags] = useState<any[]>([])
  const [incidentTypes, setIncidentTypes] = useState<Record<string,string>>({})
  const [tagTypes, setTagTypes] = useState<Record<string,string>>({})
  const [showLoyalty, setShowLoyalty] = useState(true)  // раскрыто по умолчанию
  const [addingIncident, setAddingIncident] = useState(false)
  const [newIncType, setNewIncType] = useState('verbal_conflict')
  const [newIncSev, setNewIncSev] = useState<string>('low')
  const [newIncScore, setNewIncScore] = useState<string>('')
  const [newIncComment, setNewIncComment] = useState('')
  const [visits, setVisits] = useState<any[]>([])
  const [showVisits, setShowVisits] = useState(false)

  useEffect(() => {
    if (!person?.id) { setFull(null); setLoyalty(null); setVisits([]); return }
    apiFetch<Person>(`/persons/${person.id}`).then(setFull).catch(() => setFull(person))
    apiFetch<any>(`/loyalty/${person.id}`)
      .then(r => { setLoyalty(r.loyalty); setIncidents(r.incidents||[]); setTags(r.tags||[]); setIncidentTypes(r.incident_types||{}); setTagTypes(r.tag_types||{}) })
      .catch(() => {})
    apiFetch<any>(`/loyalty/${person.id}/visits`)
      .then(r => setVisits(r.months || []))
      .catch(() => {})
  }, [person?.id])

  const refreshLoyalty = () => {
    if (!person?.id) return
    apiFetch<any>(`/loyalty/${person.id}`)
      .then(r => { setLoyalty(r.loyalty); setIncidents(r.incidents||[]); setTags(r.tags||[]) })
      .catch(() => {})
  }

  const addTag = async (tag: string) => {
    if (!person?.id) return
    await apiFetch(`/loyalty/${person.id}/tags`, { method: 'POST', body: JSON.stringify({ tag }) })
    refreshLoyalty()
  }

  const removeTag = async (tagId: number) => {
    if (!person?.id) return
    await apiFetch(`/loyalty/${person.id}/tags/${tagId}`, { method: 'DELETE' })
    refreshLoyalty()
  }

  const addIncident = async () => {
    if (!person?.id) return
    const score = newIncType === 'other' ? parseInt(newIncScore) || 0 : null
    await apiFetch(`/loyalty/${person.id}/incidents`, {
      method: 'POST',
      body: JSON.stringify({ 
        incident_type: newIncType, 
        severity: newIncSev, 
        score_override: score,
        comment: newIncComment 
      }),
    })
    setAddingIncident(false); setNewIncComment(''); setNewIncScore('')
    refreshLoyalty()
  }

  const resolveIncident = async (incId: number) => {
    if (!person?.id) return
    await apiFetch(`/loyalty/${person.id}/incidents/${incId}`, { method: 'PUT', body: JSON.stringify({ status: 'resolved' }) })
    refreshLoyalty()
  }

  const deleteIncident = async (incId: number) => {
    if (!person?.id) return
    await apiFetch(`/loyalty/${person.id}/incidents/${incId}`, { method: 'DELETE' })
    refreshLoyalty()
  }

  const d = full ?? person

  return (
    <div className="panel flex flex-col overflow-hidden animate-fade-in h-full">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-kraken-border flex items-center justify-between flex-shrink-0">
        <span className="text-kraken-muted text-[10px] font-semibold uppercase tracking-widest">
          Распознанный человек
        </span>
        {onClose && (
          <button onClick={onClose} className="text-kraken-disabled hover:text-kraken-muted">
            <X size={14} />
          </button>
        )}
      </div>

      {!d ? (
        <div className="flex-1 flex items-center justify-center py-10 text-kraken-disabled text-sm">
          Ожидание распознавания...
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* ── Фото + имя + уверенность ── */}
          <div className="p-4 flex items-start gap-3">
            <div className="w-32 h-32 rounded-xl overflow-hidden bg-kraken-hover flex-shrink-0 border border-kraken-border">
              {d.photo_path
                ? <img src={`${PHOTO_BASE}/${d.photo_path}`} alt={d.name} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-3xl text-kraken-disabled">👤</div>
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-kraken-text font-bold text-base leading-tight truncate">{d.name}</span>
                <CategoryBadge category={d.category} />
              </div>
              {d.organization && (
                <div className="text-kraken-muted text-xs mt-0.5 truncate">{d.organization}</div>
              )}
              <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-kraken-disabled">
                <span>ID: {d.id} · Эмб: {d.embedding_count ?? '—'}</span>
                <span>Добавлен: {formatDate(d.created_at)}</span>
              </div>
            </div>
            {confidence != null && (
              <div className="flex flex-col items-end flex-shrink-0">
                <span className={`text-2xl font-black leading-none ${confidenceColor(confidence)}`}>
                  {cosineToPercent(confidence)}%
                </span>
                <span className="text-kraken-disabled text-[10px] mt-0.5">совпадение</span>
              </div>
            )}
          </div>

          {/* Confidence bar */}
          {confidence != null && (
            <div className="px-4 pb-3 -mt-1">
              <div className="h-1 bg-kraken-hover rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor(confidence)}`}
                  style={{ width: `${cosineToPercent(confidence)}%` }} />
              </div>
            </div>
          )}

          {/* ── Фотографии из карточки (до 5 штук) ── */}
          {full?.photos && full.photos.length > 0 && (
            <PhotoStrip photos={full.photos} />
          )}

          <div className="border-t border-kraken-border" />

          {/* ── Последнее посещение ── */}
          <div className="px-4 py-3 bg-kraken-hover/30">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Clock size={12} className="text-kraken-purple flex-shrink-0" />
                <div>
                  <div className="text-[10px] text-kraken-disabled uppercase tracking-wider">Последнее посещение</div>
                  <div className="text-kraken-text text-xs font-medium">{formatDateTime(d.last_seen_at)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <Eye size={12} className="text-kraken-blue flex-shrink-0" />
                <div>
                  <div className="text-[10px] text-kraken-disabled uppercase tracking-wider">Визитов</div>
                  <div className="text-kraken-text text-xs font-bold">{d.visit_count ?? 0}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-kraken-border" />

          {/* ── Контактная информация ── */}
          <div className="px-4 py-3">
            <div className="text-kraken-disabled text-[10px] uppercase tracking-widest mb-2">Информация</div>
            <div className="flex flex-col gap-1.5">
              <InfoRow label="Категория"><CategoryBadge category={d.category} /></InfoRow>
              {d.phone && (
                <InfoRow label={<><Phone size={10} className="inline mr-1" />Телефон</>}>
                  <a href={`tel:${d.phone}`} className="text-kraken-blue text-xs hover:underline">{d.phone}</a>
                </InfoRow>
              )}
              {d.email && (
                <InfoRow label={<><Mail size={10} className="inline mr-1" />Email</>}>
                  <a href={`mailto:${d.email}`} className="text-kraken-blue text-xs hover:underline truncate block">{d.email}</a>
                </InfoRow>
              )}
              {d.birth_date && (
                <InfoRow label={<><Calendar size={10} className="inline mr-1" />Дата рожд.</>}>
                  <span className="text-kraken-text text-xs">{d.birth_date}</span>
                </InfoRow>
              )}
              {d.organization && (
                <InfoRow label={<><Building2 size={10} className="inline mr-1" />Организация</>}>
                  <span className="text-kraken-text text-xs">{d.organization}</span>
                </InfoRow>
              )}
              {d.address && (
                <InfoRow label={<><MapPin size={10} className="inline mr-1" />Адрес</>}>
                  <span className="text-kraken-text text-xs leading-relaxed">{d.address}</span>
                </InfoRow>
              )}
              {d.comment && (
                <InfoRow label="Заметка">
                  <span className="text-kraken-muted text-xs leading-relaxed italic">{d.comment}</span>
                </InfoRow>
              )}
              {d.extra_info && (
                <InfoRow label="Доп. инфо">
                  <span className="text-kraken-text text-xs leading-relaxed">{d.extra_info}</span>
                </InfoRow>
              )}
            </div>
          </div>

          {/* ── Индекс лояльности ── */}
          {loyalty && (
            <>
              <div className="border-t border-kraken-border" />
              <div className="px-4 py-3">
                {/* Заголовок + кнопка раскрытия */}
                <button
                  onClick={() => setShowLoyalty(p => !p)}
                  className="w-full flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    <Star size={12} className="text-amber-400" />
                    <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Индекс лояльности</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black" style={{ color: loyalty.label_color }}>
                      {loyalty.score}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: loyalty.label_color, backgroundColor: loyalty.label_color + '20' }}>
                      {loyalty.label}
                    </span>
                    <span className="text-kraken-disabled text-[10px]">{showLoyalty ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Прогресс-бар */}
                <div className="mt-2 h-1.5 bg-kraken-hover rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${loyalty.score}%`, backgroundColor: loyalty.label_color }}
                  />
                </div>

                {showLoyalty && (
                  <div className="mt-3 flex flex-col gap-3">
                    {/* Разбивка баллов */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-kraken-hover rounded-lg px-2.5 py-2">
                        <div className="text-kraken-disabled mb-0.5">Активность</div>
                        <div className="text-kraken-green font-bold">+{loyalty.activity} <span className="text-kraken-disabled font-normal">/ {loyalty.activity_max}</span></div>
                      </div>
                      <div className="bg-kraken-hover rounded-lg px-2.5 py-2">
                        <div className="text-kraken-disabled mb-0.5">Репутация</div>
                        <div className="text-kraken-blue font-bold">+{loyalty.reputation} <span className="text-kraken-disabled font-normal">/ {loyalty.reputation_max}</span></div>
                      </div>
                      <div className="bg-kraken-hover rounded-lg px-2.5 py-2">
                        <div className="text-kraken-disabled mb-0.5">Риски</div>
                        <div className={loyalty.risk > 0 ? 'text-kraken-red font-bold' : 'text-kraken-disabled font-bold'}>
                          {loyalty.risk > 0 ? `−${loyalty.risk}` : '0'}
                        </div>
                      </div>
                      <div className="bg-kraken-hover rounded-lg px-2.5 py-2">
                        <div className="text-kraken-disabled mb-0.5">Восстановление</div>
                        <div className="text-amber-400 font-bold">+{loyalty.recovery}</div>
                      </div>
                    </div>

                    {/* Позитивные теги */}
                    <div>
                      <div className="text-kraken-disabled text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <ThumbsUp size={10} /> Отметки
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((t: any) => (
                          <span key={t.id} className="flex items-center gap-1 bg-kraken-green/10 text-kraken-green text-[11px] px-2 py-0.5 rounded-full">
                            {tagTypes[t.tag] || t.tag}
                            <button onClick={() => removeTag(t.id)} className="hover:text-kraken-red ml-0.5">
                              <X size={9} />
                            </button>
                          </span>
                        ))}
                        {/* Добавить тег */}
                        {Object.entries(tagTypes).filter(([k]) => !tags.find((t: any) => t.tag === k)).map(([k, v]) => (
                          <button key={k} onClick={() => addTag(k)}
                            className="flex items-center gap-1 border border-dashed border-kraken-border text-kraken-disabled text-[11px] px-2 py-0.5 rounded-full hover:border-kraken-green hover:text-kraken-green transition-colors">
                            <Plus size={9} /> {v}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Инциденты */}
                    <div>
                      <div className="text-kraken-disabled text-[10px] uppercase tracking-wider mb-1.5 flex items-center justify-between">
                        <span className="flex items-center gap-1"><AlertTriangle size={10} /> Инциденты</span>
                        <button onClick={() => setAddingIncident(p => !p)}
                          className="text-kraken-red hover:text-kraken-red/80 flex items-center gap-0.5">
                          <Plus size={10} /> Добавить
                        </button>
                      </div>

                      {addingIncident && (
                        <div className="bg-kraken-hover rounded-lg p-2.5 mb-2 flex flex-col gap-2">
                          <div className="grid grid-cols-2 gap-2">
                            <select value={newIncType} onChange={e => setNewIncType(e.target.value)}
                              className="bg-kraken-base border border-kraken-border text-kraken-text text-[11px] px-2 py-1 rounded-lg focus:outline-none">
                              {Object.entries(incidentTypes).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
                            </select>
                            {newIncType === 'other' ? (
                              <input type="number" value={newIncScore} onChange={e => setNewIncScore(e.target.value)}
                                placeholder="Баллы (напр. 15)..."
                                className="bg-kraken-base border border-kraken-border text-kraken-text text-[11px] px-2 py-1 rounded-lg focus:outline-none w-full" />
                            ) : (
                              <select value={newIncSev} onChange={e => setNewIncSev(e.target.value)}
                                className="bg-kraken-base border border-kraken-border text-kraken-text text-[11px] px-2 py-1 rounded-lg focus:outline-none">
                                <option value="low">Низкая (−5)</option>
                                <option value="medium">Средняя (−10)</option>
                                <option value="high">Высокая (−20)</option>
                              </select>
                            )}
                          </div>
                          <input type="text" value={newIncComment} onChange={e => setNewIncComment(e.target.value)}
                            placeholder="Комментарий..."
                            className="bg-kraken-base border border-kraken-border text-kraken-text text-[11px] px-2 py-1 rounded-lg focus:outline-none w-full" />
                          <div className="flex gap-2">
                            <button onClick={() => setAddingIncident(false)} className="flex-1 text-[11px] py-1 rounded-lg border border-kraken-border text-kraken-muted hover:text-kraken-text">Отмена</button>
                            <button onClick={addIncident} className="flex-1 text-[11px] py-1 rounded-lg bg-kraken-red/20 text-kraken-red hover:bg-kraken-red/30">Записать</button>
                          </div>
                        </div>
                      )}

                      {incidents.length === 0 && (
                        <div className="text-kraken-disabled text-[11px] text-center py-1">Инцидентов нет</div>
                      )}
                      {incidents.map((inc: any) => (
                        <div key={inc.id} className="flex items-start gap-2 py-1.5 border-b border-kraken-border/50 last:border-0">
                          <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                            inc.incident_type === 'other' ? 'bg-purple-500' :
                            inc.severity === 'high' ? 'bg-kraken-red' : inc.severity === 'medium' ? 'bg-amber-400' : 'bg-yellow-600'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-kraken-text text-[11px] font-medium">
                              {incidentTypes[inc.incident_type] || inc.incident_type}
                              {inc.incident_type === 'other' && inc.score_override !== null && (
                                <span className="ml-1 text-kraken-red">({inc.score_override > 0 ? `−${inc.score_override}` : inc.score_override})</span>
                              )}
                            </div>
                            {inc.comment && <div className="text-kraken-muted text-[10px]">{inc.comment}</div>}
                            <div className="text-kraken-disabled text-[10px] mt-0.5">
                              {inc.status === 'resolved' ? '✓ Решён' : inc.status === 'recurring' ? '⚠ Повторяется' : '● Открыт'}
                              {' · '}{new Date(inc.created_at).toLocaleDateString('ru-RU')}
                            </div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            {inc.status !== 'resolved' && (
                              <button onClick={() => resolveIncident(inc.id)} title="Отметить решённым"
                                className="text-kraken-green hover:text-kraken-green/80 text-[10px] px-1.5 py-0.5 rounded border border-kraken-green/30 hover:bg-kraken-green/10">
                                ✓
                              </button>
                            )}
                            <button onClick={() => deleteIncident(inc.id)} title="Удалить"
                              className="text-kraken-disabled hover:text-kraken-red">
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── История визитов ── */}
              <div className="border-t border-kraken-border mt-1">
                <button onClick={() => setShowVisits(p => !p)}
                  className="w-full flex items-center justify-between px-4 py-2.5 group">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]">📅</span>
                    <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">История визитов</span>
                    {visits.length > 0 && (
                      <span className="bg-kraken-hover text-kraken-muted text-[10px] px-1.5 py-0.5 rounded-full">
                        {visits.reduce((s: number, m: any) => s + m.count, 0)}
                      </span>
                    )}
                  </div>
                  <span className="text-kraken-disabled text-[10px]">{showVisits ? '▲' : '▼'}</span>
                </button>

                {showVisits && (
                  <div className="px-4 pb-3 flex flex-col gap-3">
                    {visits.length === 0 && (
                      <div className="text-kraken-disabled text-xs text-center py-2">Визитов не зафиксировано</div>
                    )}
                    {visits.map((month: any) => (
                      <div key={month.month}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-kraken-text text-xs font-semibold">{month.label}</span>
                          <span className="text-kraken-disabled text-[10px] bg-kraken-hover px-1.5 py-0.5 rounded-full">{month.count}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          {month.visits.slice(0, 4).map((v: any) => {
                            const dt = new Date(v.created_at)
                            const dateStr = isNaN(dt.getTime()) ? '—' : dt.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
                            const pct = v.confidence != null
                              ? Math.round(((Math.max(0.28, Math.min(0.85, v.confidence)) - 0.28) / (0.85 - 0.28)) * 100)
                              : null
                            return (
                              <div key={v.id} className="flex items-center gap-2 py-1 border-b border-kraken-border/30 last:border-0">
                                {v.snapshot_path ? (
                                  <img src={`/${v.snapshot_path}`} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-kraken-border" />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-kraken-hover flex-shrink-0 flex items-center justify-center text-sm">📷</div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-kraken-text text-[10px] font-medium">{dateStr}</div>
                                  <div className="text-kraken-disabled text-[9px]">{v.camera_name}</div>
                                </div>
                                {pct != null && <span className="text-[10px] font-bold text-kraken-green flex-shrink-0">{pct}%</span>}
                              </div>
                            )
                          })}
                          {month.visits.length > 4 && (
                            <div className="text-kraken-disabled text-[10px] text-center">+ ещё {month.visits.length - 4}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-kraken-muted text-[11px] w-24 flex-shrink-0 pt-0.5">{label}:</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// ── PhotoStrip — до 5 фото из карточки (ярлыки) ─────────────────────────────

interface PhotoStripProps {
  photos: Array<{ id: number; photo_path: string; is_primary: boolean; created_at: string }>
}

function PhotoStrip({ photos }: PhotoStripProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [showAllPhotos, setShowAllPhotos] = useState(false)

  // Сортируем: главное фото первым, остальные по дате
  const sorted = [...photos].sort((a, b) => {
    if (a.is_primary && !b.is_primary) return -1
    if (!a.is_primary && b.is_primary) return 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const PREVIEW_MAX = 5
  const extra = Math.max(0, sorted.length - (PREVIEW_MAX - 1))
  const visible = showAllPhotos
    ? sorted
    : sorted.slice(0, extra > 0 ? PREVIEW_MAX - 1 : PREVIEW_MAX)

  if (visible.length === 0) return null

  const openLightbox = (photoId: number) => {
    const idx = visible.findIndex(p => p.id === photoId)
    if (idx >= 0) setLightboxIdx(idx)
  }

  return (
    <>
      {/* ── Ряд ярлыков ── */}
      <div className="px-4 pb-3 border-b border-kraken-border">
        <div className="text-kraken-disabled text-[10px] uppercase tracking-widest mb-1.5 flex items-center justify-between">
          <span>Фотографии ({photos.length})</span>
          {!showAllPhotos && extra > 0 && (
            <span className="text-kraken-muted text-[10px]">ещё {extra}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => openLightbox(p.id)}
              title={p.is_primary ? 'Главное фото' : `Фото`}
              className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all hover:border-kraken-purple hover:scale-105 active:scale-95"
              style={{ borderColor: p.is_primary ? 'var(--color-kraken-green, #00FF94)' : 'var(--color-kraken-border, #2a2d3a)' }}
            >
              <img
                src={`${PHOTO_BASE}/${p.photo_path}`}
                alt=""
                className="w-full h-full object-cover"
              />
              {p.is_primary && (
                <div className="absolute bottom-0 left-0 right-0 bg-kraken-green/80 text-black text-[7px] font-bold text-center leading-tight py-px">
                  ★
                </div>
              )}
            </button>
          ))}
          {!showAllPhotos && extra > 0 && (
            <button
              type="button"
              onClick={() => setShowAllPhotos(true)}
              title={`Показать ещё ${extra} фото`}
              className="flex-shrink-0 w-16 h-16 rounded-lg border border-dashed border-kraken-purple/50 bg-kraken-hover hover:bg-kraken-purple/15 text-kraken-purple text-xs font-bold transition-colors flex items-center justify-center"
            >
              +{extra}
            </button>
          )}
        </div>
        {showAllPhotos && extra > 0 && (
          <button
            type="button"
            onClick={() => setShowAllPhotos(false)}
            className="mt-2 text-[10px] text-kraken-muted hover:text-kraken-text w-full text-center"
          >
            Свернуть
          </button>
        )}
      </div>

      {/* ── Lightbox ── */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-[99999] bg-black/80 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          <div className="relative max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <img
              src={`${PHOTO_BASE}/${visible[lightboxIdx].photo_path}`}
              alt=""
              className="w-full rounded-xl border border-kraken-border shadow-2xl"
            />
            {visible[lightboxIdx].is_primary && (
              <div className="absolute top-2 left-2 bg-kraken-green/90 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
                ГЛАВНОЕ
              </div>
            )}
            <button
              onClick={() => setLightboxIdx(null)}
              className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors"
            >
              <X size={14} />
            </button>
            {/* Навигация */}
            {visible.length > 1 && (
              <>
                <button
                  onClick={() => setLightboxIdx(i => ((i ?? 0) - 1 + visible.length) % visible.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setLightboxIdx(i => ((i ?? 0) + 1) % visible.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                  {visible.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setLightboxIdx(i)}
                      className={`w-1.5 h-1.5 rounded-full transition-all ${i === lightboxIdx ? 'bg-white' : 'bg-white/40'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}