// @ts-nocheck
// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Search, Edit2, Trash2, Upload, X, Camera, RefreshCw, ImagePlus, Star, Phone, Mail, MapPin, Building2, Calendar, Eye, AlertTriangle, ThumbsUp, ScanFace, ArrowUpDown, FolderOpen, CheckSquare, Square, Layers, Settings, ChevronDown } from 'lucide-react'
import type { Person, Category, Camera as CameraType } from '../types'
import { apiFetch, apiUpload, wsUrl, PHOTO_BASE } from '../api/client'
import CategoryBadge from '../components/CategoryBadge'
import { useCategories } from '../hooks/useCategories'
import ConfirmModal, { AlertModal } from '../components/ConfirmModal'

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU')
}
function fmtDT(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

export default function People() {
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState<string>('')
  const [sortBy, setSortBy] = useState<string>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showAdd, setShowAdd] = useState(false)
  const [editPerson, setEditPerson] = useState<Person | null>(null)
  const [profilePerson, setProfilePerson] = useState<Person | null>(null)
  const [addPhotoPerson, setAddPhotoPerson] = useState<Person | null>(null)
  const [showPhotoSearch, setShowPhotoSearch] = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)

  // Вкладки: База лиц (database) и Ошибки эмбеддингов (failed_embeddings)
  const [activeTab, setActiveTab] = useState<'database' | 'failed_embeddings'>('database')
  const [failedList, setFailedList] = useState<any[]>([])
  const [loadingFailed, setLoadingFailed] = useState(false)
  const [selectedFailed, setSelectedFailed] = useState<Set<number>>(new Set())

  const fetchFailedEmbeddings = useCallback(async () => {
    setLoadingFailed(true)
    try {
      const data = await apiFetch<any[]>('/failed_embeddings')
      setFailedList(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingFailed(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'failed_embeddings') {
      fetchFailedEmbeddings()
    }
  }, [activeTab, fetchFailedEmbeddings])
  const { categories } = useCategories()
  // Выделение строк
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showDeleteCategory, setShowDeleteCategory] = useState(false)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDamage?: boolean;
  } | null>(null)
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  } | null>(null)

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      
      if (filterCat === 'UNKNOWN') {
        params.set('name_contains', 'Неизвестный')
      } else if (filterCat) {
        params.set('category', filterCat)
      }
      
      params.set('sort_by', sortBy)
      params.set('sort_dir', sortDir)
      params.set('limit', '500')  // достаточно для большинства баз
      const data = await apiFetch<Person[]>(`/persons/?${params}`)
      setPeople(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search, filterCat, sortBy, sortDir])

  useEffect(() => { 
    fetchPeople(); 
    fetchFailedEmbeddings();
  }, [fetchPeople, fetchFailedEmbeddings])

  const handleDelete = (id: number) => {
    setConfirmState({
      isOpen: true,
      title: 'Удалить человека',
      message: 'Удалить этого человека?',
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        try {
          await apiFetch(`/persons/${id}`, { method: 'DELETE' })
          setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
          fetchPeople()
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка удаления: ' + e.message })
        }
      }
    })
  }

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === people.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(people.map(p => p.id)))
    }
  }

  const handleBulkDelete = () => {
    if (!selected.size) return
    setConfirmState({
      isOpen: true,
      title: 'Массовое удаление',
      message: `Удалить ${selected.size} выбранных человек? Это действие необратимо.`,
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setBulkDeleting(true)
        try {
          const res = await fetch('/api/persons/bulk_delete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(localStorage.getItem('kraken_token') ? { Authorization: `Bearer ${localStorage.getItem('kraken_token')}` } : {}),
            },
            body: JSON.stringify([...selected]),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }))
            throw new Error(err.detail || `Ошибка ${res.status}`)
          }
          setSelected(new Set())
          fetchPeople()
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка: ' + e.message })
        } finally {
          setBulkDeleting(false)
        }
      }
    })
  }

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const SortBtn = ({ col, label }: { col: string; label: string }) => (
    <button onClick={() => toggleSort(col)}
      className={`flex items-center gap-1 hover:text-kraken-text transition-colors ${sortBy === col ? 'text-kraken-purple' : ''}`}>
      {label}
      <ArrowUpDown size={10} className={sortBy === col ? 'text-kraken-purple' : 'opacity-40'} />
      {sortBy === col && <span className="text-[9px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  )

  return (
    <div className="h-full flex gap-4 overflow-hidden">
      {/* ── Список ── */}
      <div className={`flex flex-col gap-3 overflow-hidden transition-all ${profilePerson ? 'w-[55%]' : 'flex-1'}`}>
        
        {/* Tab Switcher */}
        <div className="flex gap-4 border-b border-kraken-border pb-1 flex-shrink-0">
          <button
            onClick={() => setActiveTab('database')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'database'
                ? 'border-kraken-purple text-kraken-purple bg-kraken-purple/5'
                : 'border-transparent text-kraken-muted hover:text-kraken-text'
            }`}
          >
            <ScanFace size={13} />
            <span>База лиц</span>
          </button>
          <button
            onClick={() => setActiveTab('failed_embeddings')}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 relative ${
              activeTab === 'failed_embeddings'
                ? 'border-kraken-purple text-kraken-purple bg-kraken-purple/5'
                : 'border-transparent text-kraken-muted hover:text-kraken-text'
            }`}
          >
            <AlertTriangle size={13} className="text-amber-500" />
            <span>Ошибки эмбеддингов (Failed Embeddings)</span>
            {failedList.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] bg-kraken-red/20 text-kraken-red border border-kraken-red/30 rounded-full font-black">
                {failedList.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'database' ? (
          <>
            <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-kraken-muted" />
            <input type="text" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-kraken-panel border border-kraken-border text-kraken-text text-sm pl-8 pr-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple" />
          </div>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            className="bg-kraken-panel border border-kraken-border text-kraken-text text-sm px-2 py-2 rounded-lg focus:outline-none focus:border-kraken-purple">
            <option value="">Все</option>
            <option value="UNKNOWN">🕵️ Неизвестные</option>
            {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <button onClick={() => { setEditPerson(null); setShowAdd(true) }} className="btn-primary flex items-center gap-1.5 text-sm py-2 px-3 flex-shrink-0">
            <Plus size={14} /> Добавить
          </button>
          <button onClick={() => setShowBulkImport(true)} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 flex-shrink-0 text-kraken-green hover:text-kraken-green border border-kraken-green/30 hover:border-kraken-green/60" title="Массовый импорт по фото">
            <FolderOpen size={14} /> Импорт
          </button>
          <button onClick={() => setShowDeleteCategory(true)} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 flex-shrink-0 text-kraken-red hover:text-kraken-red border border-kraken-red/30 hover:border-kraken-red/60" title="Удалить всю категорию">
            <Layers size={14} /> Категория
          </button>
          <button onClick={() => setShowPhotoSearch(true)} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 flex-shrink-0 text-kraken-purple hover:text-kraken-purple border border-kraken-purple/30 hover:border-kraken-purple/60">
            <ScanFace size={14} /> Поиск по фото
          </button>
        </div>

        {/* ── Панель массовых действий ── */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 px-3 py-2 bg-kraken-purple/10 border border-kraken-purple/30 rounded-xl flex-shrink-0">
            <span className="text-kraken-purple text-sm font-semibold">
              Выбрано: {selected.size}
            </span>
            <button onClick={toggleSelectAll} className="text-kraken-muted text-xs hover:text-kraken-text">
              {selected.size === people.length ? 'Снять всё' : 'Выбрать всё'}
            </button>
            <div className="flex-1" />
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-kraken-red/20 text-kraken-red hover:bg-kraken-red/30 font-semibold disabled:opacity-50"
            >
              {bulkDeleting
                ? <><RefreshCw size={12} className="animate-spin" /> Удаление...</>
                : <><Trash2 size={12} /> Удалить выбранных ({selected.size})</>}
            </button>
            <button onClick={() => setSelected(new Set())} className="text-kraken-muted hover:text-kraken-text">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="panel flex-1 overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1">
            <table className="w-full">
              <thead className="sticky top-0 bg-kraken-panel z-10">
                <tr className="text-kraken-disabled text-[10px] uppercase tracking-wider border-b border-kraken-border">
                  <th className="px-3 py-2 text-left w-8">
                    <button onClick={toggleSelectAll} className="text-kraken-muted hover:text-kraken-purple transition-colors">
                      {selected.size > 0 && selected.size === people.length
                        ? <CheckSquare size={14} className="text-kraken-purple" />
                        : selected.size > 0
                          ? <CheckSquare size={14} className="text-kraken-purple/50" />
                          : <Square size={14} />}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">Фото</th>
                  <th className="px-3 py-2 text-left"><SortBtn col="name" label="Имя / Должность" /></th>
                  <th className="px-3 py-2 text-left">Категория</th>
                  <th className="px-3 py-2 text-left"><SortBtn col="last_seen_at" label="Последний визит" /></th>
                  <th className="px-3 py-2 text-left"><SortBtn col="visit_count" label="Визитов" /></th>
                  <th className="px-3 py-2 text-left">Эмб.</th>
                  <th className="px-3 py-2 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="text-center py-8 text-kraken-disabled text-sm">Загрузка...</td></tr>}
                {!loading && people.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-kraken-disabled text-sm">Люди не найдены</td></tr>}
                {people.map(p => (
                  <tr key={p.id} onClick={() => setProfilePerson(p)}
                    className={`border-b border-kraken-border hover:bg-kraken-hover transition-colors cursor-pointer ${profilePerson?.id === p.id ? 'bg-kraken-purple/10' : ''} ${selected.has(p.id) ? 'bg-kraken-purple/5' : ''}`}>
                    <td className="px-3 py-2 w-8" onClick={e => { e.stopPropagation(); toggleSelect(p.id) }}>
                      <button className="text-kraken-muted hover:text-kraken-purple transition-colors">
                        {selected.has(p.id)
                          ? <CheckSquare size={14} className="text-kraken-purple" />
                          : <Square size={14} />}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="w-24 h-24 rounded-xl overflow-hidden bg-kraken-hover border border-kraken-border shadow-sm">
                        {p.photo_path ? <img src={`${PHOTO_BASE}/${p.photo_path}`} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-3xl">👤</div>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-kraken-text text-sm font-medium">{p.name}</div>
                      {(p.position || p.organization) && <div className="text-kraken-disabled text-xs truncate max-w-[140px]">{p.position || p.organization}</div>}
                    </td>
                    <td className="px-3 py-2"><CategoryBadge category={p.category} /></td>
                    <td className="px-3 py-2 text-kraken-muted text-sm">{fmtDate(p.last_seen_at)}</td>
                    <td className="px-3 py-2 text-kraken-text text-base font-bold">{p.visit_count ?? 0}</td>
                    <td className="px-3 py-2">
                      <span className={`text-base font-bold ${p.embedding_count > 0 ? 'text-kraken-green' : 'text-kraken-red'}`}>{p.embedding_count}</span>
                    </td>
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setAddPhotoPerson(p)} className="p-1.5 rounded hover:bg-kraken-hover text-kraken-muted hover:text-kraken-green" title="Добавить фото"><ImagePlus size={16} /></button>
                        <button onClick={() => { setEditPerson(p); setShowAdd(true) }} className="p-1.5 rounded hover:bg-kraken-hover text-kraken-muted hover:text-kraken-purple" title="Редактировать"><Edit2 size={16} /></button>
                        <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-kraken-hover text-kraken-muted hover:text-kraken-red" title="Удалить"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-1.5 border-t border-kraken-border flex-shrink-0">
            <span className="text-kraken-disabled text-[10px]">Всего: {people.length}</span>
          </div>
        </div>
        </>
        ) : (
          <div className="panel flex-1 overflow-hidden flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-kraken-text font-bold text-xs flex items-center gap-1.5">
                  <AlertTriangle size={15} className="text-amber-500 animate-pulse" />
                  Мусорные кадры и ошибки извлечения векторов
                </h3>
                <p className="text-kraken-muted text-[11px] mt-1">
                  Сюда попадают снимки, на которых не удалось построить качественный дескриптор лица из-за расфокуса, плохого освещения или сильного поворота головы.
                </p>
              </div>
              <button
                onClick={fetchFailedEmbeddings}
                disabled={loadingFailed}
                className="btn-ghost flex items-center gap-1 text-xs py-1.5 px-3 rounded-lg border border-kraken-border"
              >
                <RefreshCw size={12} className={loadingFailed ? "animate-spin" : ""} />
                Обновить
              </button>
            </div>

            {/* Mass actions */}
            {selectedFailed.size > 0 && (
              <div className="flex items-center justify-between p-3 bg-kraken-red/10 border border-kraken-red/30 rounded-xl flex-shrink-0 animate-fade-in">
                <span className="text-kraken-red text-xs font-semibold">
                  Выбрано битых кадров: {selectedFailed.size}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setConfirmState({
                        isOpen: true,
                        title: 'Очистка ошибок',
                        message: `Удалить выбранные ${selectedFailed.size} снимков без векторов?`,
                        isDamage: true,
                        onConfirm: async () => {
                          setConfirmState(null)
                          try {
                            const res = await fetch('/api/failed_embeddings/bulk_delete', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                ...(localStorage.getItem('kraken_token') ? { Authorization: `Bearer ${localStorage.getItem('kraken_token')}` } : {}),
                              },
                              body: JSON.stringify([...selectedFailed])
                            })
                            if (!res.ok) throw new Error('Ошибка удаления')
                            setSelectedFailed(new Set())
                            fetchFailedEmbeddings()
                          } catch (e: any) {
                            setAlertState({ isOpen: true, title: 'Ошибка', message: e.message })
                          }
                        }
                      })
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1"
                  >
                    <Trash2 size={12} />
                    Удалить выделенные
                  </button>
                  <button onClick={() => setSelectedFailed(new Set())} className="text-kraken-muted hover:text-kraken-text text-xs px-2">
                    Отмена
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto pr-1">
              {loadingFailed ? (
                <div className="text-center py-12 text-kraken-disabled text-sm">
                  <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-kraken-purple" />
                  Анализ и загрузка ошибок...
                </div>
              ) : failedList.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-kraken-border rounded-xl">
                  <ThumbsUp size={36} className="mx-auto text-kraken-green mb-3 opacity-60" />
                  <div className="text-kraken-text font-bold text-sm">Ошибок эмбеддингов не найдено!</div>
                  <div className="text-kraken-disabled text-xs mt-1">Все лица успешно проиндексированы и распознаются в штатном режиме.</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-4">
                  {failedList.map((f) => {
                    const isSel = selectedFailed.has(f.id)
                    return (
                      <div
                        key={f.id}
                        onClick={() => {
                          setSelectedFailed(prev => {
                            const next = new Set(prev)
                            if (next.has(f.id)) next.delete(f.id)
                            else next.add(f.id)
                            return next
                          })
                        }}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex gap-3 ${
                          isSel
                            ? "bg-kraken-red/5 border-kraken-red/40 shadow-sm shadow-kraken-red/10"
                            : "bg-kraken-panel border-kraken-border hover:border-kraken-border-hover"
                        }`}
                      >
                        <div className="relative w-20 h-20 bg-kraken-hover border border-kraken-border rounded-lg overflow-hidden flex-shrink-0">
                          {/* Image placeholders matching fail types */}
                          <div className="w-full h-full flex flex-col items-center justify-center text-[10px] font-mono text-kraken-disabled text-center p-1 bg-gradient-to-br from-kraken-panel to-kraken-hover">
                            <span className="text-lg">🖼️</span>
                            <span className="text-[8px] truncate max-w-full opacity-60 mt-1">{f.filename}</span>
                          </div>
                          {isSel && (
                            <div className="absolute inset-0 bg-kraken-red/20 flex items-center justify-center">
                              <CheckSquare size={18} className="text-kraken-red bg-kraken-panel rounded" />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div>
                            <div className="text-kraken-red font-bold text-xs flex items-center gap-1">
                              <AlertTriangle size={12} />
                              {f.reason}
                            </div>
                            <div className="text-kraken-text font-mono text-[10px] mt-1 truncate">
                              Файл: {f.filename}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[10px] text-kraken-disabled">
                              <span>Разрешение: {f.resolution}</span>
                              <span>•</span>
                              <span>Лиц: {f.detected_faces}</span>
                              <span>•</span>
                              <span>Качество: <span className={f.quality_score > 0.2 ? "text-amber-500 font-semibold" : "text-kraken-red font-semibold"}>{(f.quality_score * 100).toFixed(0)}%</span></span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-kraken-disabled mt-2">
                            <span>{new Date(f.created_at).toLocaleString('ru-RU')}</span>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation()
                                setConfirmState({
                                  isOpen: true,
                                  title: 'Удалить кадр с ошибкой',
                                  message: 'Вы действительно хотите физически удалить этот мусорный снимок?',
                                  isDamage: true,
                                  onConfirm: async () => {
                                    setConfirmState(null)
                                    try {
                                      const res = await fetch(`/api/failed_embeddings/${f.id}`, {
                                        method: 'DELETE',
                                        headers: {
                                          ...(localStorage.getItem('kraken_token') ? { Authorization: `Bearer ${localStorage.getItem('kraken_token')}` } : {}),
                                        }
                                      })
                                      if (!res.ok) throw new Error('Ошибка при удалении')
                                      setSelectedFailed(prev => { const n = new Set(prev); n.delete(f.id); return n })
                                      fetchFailedEmbeddings()
                                    } catch (err: any) {
                                      setAlertState({ isOpen: true, title: 'Ошибка', message: err.message })
                                    }
                                  }
                                })
                              }}
                              className="p-1 rounded hover:bg-kraken-hover text-kraken-muted hover:text-kraken-red transition-colors"
                              title="Удалить файл"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-kraken-border pt-2 flex-shrink-0 flex items-center justify-between text-[10px] text-kraken-disabled">
              <span>Всего битых снимков в буфере: {failedList.length}</span>
              <span>Рекомендуется очищать буфер при снижении точности извлечения векторов</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Профиль ── */}
      {profilePerson && (
        <div className="w-[45%] flex-shrink-0 overflow-hidden">
          <PersonProfile person={profilePerson} onClose={() => setProfilePerson(null)}
            onEdit={() => { setEditPerson(profilePerson); setShowAdd(true) }}
            onDelete={() => handleDelete(profilePerson.id)} />
        </div>
      )}

      {showAdd && (
        <PersonModal person={editPerson}
          onClose={() => { setShowAdd(false); setEditPerson(null) }}
          onSaved={() => { setShowAdd(false); setEditPerson(null); fetchPeople() }} />
      )}
      {addPhotoPerson && (
        <AddExtraPhotoModal person={addPhotoPerson}
          onClose={() => setAddPhotoPerson(null)}
          onSaved={() => { setAddPhotoPerson(null); fetchPeople() }} />
      )}
      {showPhotoSearch && (
        <PhotoSearchModal
          onClose={() => setShowPhotoSearch(false)}
          onSelectPerson={(p) => { setShowPhotoSearch(false); setProfilePerson(p) }}
        />
      )}
      {showBulkImport && (
        <BulkImportModal
          onClose={() => setShowBulkImport(false)}
          onDone={() => { setShowBulkImport(false); fetchPeople() }}
          categories={categories}
        />
      )}
      {showDeleteCategory && (
        <DeleteCategoryModal
          categories={categories}
          onClose={() => setShowDeleteCategory(false)}
          onDone={() => { setShowDeleteCategory(false); fetchPeople() }}
        />
      )}

      {confirmState && (
        <ConfirmModal
          isOpen={confirmState.isOpen}
          title={confirmState.title}
          message={confirmState.message}
          isDamage={confirmState.isDamage}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {alertState && (
        <AlertModal
          isOpen={alertState.isOpen}
          title={alertState.title}
          message={alertState.message}
          onClose={() => setAlertState(null)}
        />
      )}
    </div>
  )
}

// ── Галерея фото с кнопкой +N ─────────────────────────────────────────────────

const PHOTO_THUMB = 'w-16 h-16'
const PHOTOS_COLLAPSED_MAX = 5

function PersonPhotosGallery({
  photos,
  showAll,
  onToggleAll,
}: {
  photos: Array<{ id: number; photo_path: string; is_primary: boolean }>
  showAll: boolean
  onToggleAll: (open: boolean) => void
}) {
  const extra = Math.max(0, photos.length - (PHOTOS_COLLAPSED_MAX - 1))
  const visible = showAll
    ? photos
    : photos.slice(0, extra > 0 ? PHOTOS_COLLAPSED_MAX - 1 : PHOTOS_COLLAPSED_MAX)

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {visible.map(ph => (
          <div
            key={ph.id}
            className={`${PHOTO_THUMB} rounded-lg overflow-hidden border border-kraken-border relative flex-shrink-0`}
          >
            <img src={`${PHOTO_BASE}/${ph.photo_path}`} alt="" className="w-full h-full object-cover" />
            {ph.is_primary && (
              <div className="absolute bottom-0 left-0 right-0 bg-kraken-green/80 text-black text-[8px] text-center font-bold leading-tight py-px">
                ★
              </div>
            )}
          </div>
        ))}
        {!showAll && extra > 0 && (
          <button
            type="button"
            onClick={() => onToggleAll(true)}
            title={`Показать ещё ${extra} фото`}
            className={`${PHOTO_THUMB} flex-shrink-0 rounded-lg border border-dashed border-kraken-purple/50 bg-kraken-hover hover:bg-kraken-purple/15 text-kraken-purple text-xs font-bold transition-colors flex items-center justify-center`}
          >
            +{extra}
          </button>
        )}
      </div>
      {showAll && photos.length > PHOTOS_COLLAPSED_MAX && (
        <button
          type="button"
          onClick={() => onToggleAll(false)}
          className="mt-2 text-[10px] text-kraken-muted hover:text-kraken-text w-full text-center"
        >
          Свернуть
        </button>
      )}
    </>
  )
}

// ── Профиль человека ──────────────────────────────────────────────────────────

function PersonProfile({ person, onClose, onEdit }: {
  person: Person; onClose: () => void; onEdit: () => void; onDelete?: () => void
}) {
  const [full, setFull] = useState<Person | null>(null)
  const [loyalty, setLoyalty] = useState<any>(null)
  const [incidents, setIncidents] = useState<any[]>([])
  const [tags, setTags] = useState<any[]>([])
  const [incidentTypes, setIncidentTypes] = useState<Record<string,string>>({})
  const [tagTypes, setTagTypes] = useState<Record<string,string>>({})
  const [addingInc, setAddingInc] = useState(false)
  const [newIncType, setNewIncType] = useState('verbal_conflict')
  const [newIncSev, setNewIncSev] = useState('low')
  const [newIncComment, setNewIncComment] = useState('')
  const [visits, setVisits] = useState<any[]>([])
  const [showVisits, setShowVisits] = useState(false)
  const [showContacts, setShowContacts] = useState(true)
  const [showAllPhotos, setShowAllPhotos] = useState(false)

  const load = useCallback(() => {
    apiFetch<Person>(`/persons/${person.id}`).then(setFull).catch(() => setFull(person))
    apiFetch<any>(`/loyalty/${person.id}`)
      .then(r => { setLoyalty(r.loyalty); setIncidents(r.incidents||[]); setTags(r.tags||[]); setIncidentTypes(r.incident_types||{}); setTagTypes(r.tag_types||{}) })
      .catch(() => {})
    apiFetch<any>(`/loyalty/${person.id}/visits`)
      .then(r => setVisits(r.months || []))
      .catch(() => {})
  }, [person.id])

  useEffect(() => { load() }, [load])
  const d = full ?? person

  const addTag = async (tag: string) => { await apiFetch(`/loyalty/${person.id}/tags`, { method:'POST', body: JSON.stringify({ tag }) }); load() }
  const removeTag = async (id: number) => { await apiFetch(`/loyalty/${person.id}/tags/${id}`, { method:'DELETE' }); load() }
  const addIncident = async () => {
    await apiFetch(`/loyalty/${person.id}/incidents`, { method:'POST', body: JSON.stringify({ incident_type: newIncType, severity: newIncSev, comment: newIncComment }) })
    setAddingInc(false); setNewIncComment(''); load()
  }
  const resolveInc = async (id: number) => { await apiFetch(`/loyalty/${person.id}/incidents/${id}`, { method:'PUT', body: JSON.stringify({ status:'resolved' }) }); load() }
  const deleteInc = async (id: number) => { await apiFetch(`/loyalty/${person.id}/incidents/${id}`, { method:'DELETE' }); load() }

  return (
    <div className="panel h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-kraken-border flex items-center gap-3 flex-shrink-0">
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-kraken-hover border border-kraken-border flex-shrink-0">
          {d.photo_path ? <img src={`${PHOTO_BASE}/${d.photo_path}`} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-2xl">👤</div>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-kraken-text font-bold text-base truncate">{d.name}</span>
            <CategoryBadge category={d.category} />
          </div>
          {(d as any).position && <div className="text-kraken-purple text-xs font-medium truncate">💼 {(d as any).position}</div>}
          {d.organization && !((d as any).position) && <div className="text-kraken-muted text-xs truncate">{d.organization}</div>}
        </div>
        <button onClick={onEdit} className="p-1.5 rounded hover:bg-kraken-hover text-kraken-muted hover:text-kraken-purple" title="Редактировать"><Edit2 size={14} /></button>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-kraken-hover text-kraken-muted hover:text-kraken-text"><X size={14} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {d.photos && d.photos.length > 0 && (
          <div className="px-4 py-3 border-b border-kraken-border">
            <div className="flex items-center gap-1.5 mb-2">
              <Camera size={11} className="text-kraken-muted" />
              <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Фотографии ({d.photos.length})</span>
            </div>
            <PersonPhotosGallery
              photos={d.photos}
              showAll={showAllPhotos}
              onToggleAll={setShowAllPhotos}
            />
          </div>
        )}

        {loyalty && (
          <div className="px-4 py-3 border-b border-kraken-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Star size={12} className="text-amber-400" />
                <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Индекс лояльности</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black" style={{ color: loyalty.label_color }}>{loyalty.score}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: loyalty.label_color, backgroundColor: loyalty.label_color + '20' }}>{loyalty.label}</span>
              </div>
            </div>
            <div className="h-2 bg-kraken-hover rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full transition-all" style={{ width: `${loyalty.score}%`, backgroundColor: loyalty.label_color }} />
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-[11px]">
              {[
                { l:'Активность', v:`+${loyalty.activity}/${loyalty.activity_max}`, c:'text-kraken-green' },
                { l:'Репутация', v:`+${loyalty.reputation}/${loyalty.reputation_max}`, c:'text-kraken-blue' },
                { l:'Риски', v: loyalty.risk > 0 ? `−${loyalty.risk}` : '0', c: loyalty.risk > 0 ? 'text-kraken-red' : 'text-kraken-disabled' },
                { l:'Восст.', v:`+${loyalty.recovery}`, c:'text-amber-400' },
              ].map(item => (
                <div key={item.l} className="bg-kraken-hover rounded-lg px-2 py-1.5 text-center">
                  <div className="text-kraken-disabled text-[9px] mb-0.5">{item.l}</div>
                  <div className={`font-bold ${item.c}`}>{item.v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-4 py-3 border-b border-kraken-border bg-kraken-hover/20">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><div className="text-kraken-disabled text-[10px] uppercase tracking-wider">Визитов</div><div className="text-kraken-text text-lg font-black">{d.visit_count ?? 0}</div></div>
            <div><div className="text-kraken-disabled text-[10px] uppercase tracking-wider">Эмбеддингов</div><div className={`text-lg font-black ${(d.embedding_count ?? 0) > 0 ? 'text-kraken-green' : 'text-kraken-red'}`}>{d.embedding_count ?? 0}</div></div>
            <div><div className="text-kraken-disabled text-[10px] uppercase tracking-wider">Добавлен</div><div className="text-kraken-text text-xs font-medium mt-1">{fmtDate(d.created_at)}</div></div>
          </div>
          <div className="mt-2 pt-2 border-t border-kraken-border/50 flex items-center gap-2">
            <Eye size={11} className="text-kraken-purple flex-shrink-0" />
            <span className="text-kraken-disabled text-[10px]">Последний визит:</span>
            <span className="text-kraken-text text-xs font-medium">{fmtDT(d.last_seen_at)}</span>
          </div>
        </div>

        <div className="border-b border-kraken-border">
          {/* Заголовок секции — кликабельный */}
          <button
            onClick={() => setShowContacts(v => !v)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-kraken-hover/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Контакты и информация</span>
              {/* Счётчик заполненных полей */}
              {(() => {
                const count = [d.phone, d.email, d.birth_date, d.organization, d.address, d.comment, d.extra_info, (d as any).position].filter(Boolean).length
                return count > 0 ? (
                  <span className="bg-kraken-hover text-kraken-muted text-[9px] px-1.5 py-0.5 rounded-full">{count}</span>
                ) : null
              })()}
            </div>
            <span className="text-kraken-disabled text-[10px]">{showContacts ? '▲' : '▼'}</span>
          </button>

          {showContacts && (
            <div className="px-4 pb-3 flex flex-col gap-1.5">
              {(d as any).position && <IR icon={<span className="text-[11px]">💼</span>} label="Должность"><span className="text-kraken-text text-xs font-medium">{(d as any).position}</span></IR>}
              {d.phone && <IR icon={<Phone size={11}/>} label="Телефон"><a href={`tel:${d.phone}`} className="text-kraken-blue text-xs hover:underline">{d.phone}</a></IR>}
              {d.email && <IR icon={<Mail size={11}/>} label="Email"><a href={`mailto:${d.email}`} className="text-kraken-blue text-xs hover:underline truncate block">{d.email}</a></IR>}
              {d.birth_date && <IR icon={<Calendar size={11}/>} label="Дата рожд."><span className="text-kraken-text text-xs">{d.birth_date}</span></IR>}
              {d.organization && <IR icon={<Building2 size={11}/>} label="Организация"><span className="text-kraken-text text-xs">{d.organization}</span></IR>}
              {d.address && <IR icon={<MapPin size={11}/>} label="Адрес"><span className="text-kraken-text text-xs">{d.address}</span></IR>}
              {d.comment && <IR icon={<span className="text-[11px]">📝</span>} label="Заметка"><span className="text-kraken-muted text-xs italic">{d.comment}</span></IR>}
              {d.extra_info && <IR icon={<span className="text-[11px]">ℹ️</span>} label="Доп. инфо"><span className="text-kraken-text text-xs">{d.extra_info}</span></IR>}
              {!(d as any).position && !d.phone && !d.email && !d.birth_date && !d.organization && !d.address && !d.comment && !d.extra_info && (
                <div className="text-kraken-disabled text-xs text-center py-1">Нет дополнительной информации</div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-b border-kraken-border">
          <div className="flex items-center gap-1.5 mb-2">
            <ThumbsUp size={11} className="text-kraken-green" />
            <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Позитивные отметки</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t: any) => (
              <span key={t.id} className="flex items-center gap-1 bg-kraken-green/10 text-kraken-green text-[11px] px-2 py-0.5 rounded-full">
                {tagTypes[t.tag] || t.tag}
                <button onClick={() => removeTag(t.id)} className="hover:text-kraken-red"><X size={9}/></button>
              </span>
            ))}
            {Object.entries(tagTypes).filter(([k]) => !tags.find((t: any) => t.tag === k)).map(([k, v]) => (
              <button key={k} onClick={() => addTag(k)}
                className="flex items-center gap-1 border border-dashed border-kraken-border text-kraken-disabled text-[11px] px-2 py-0.5 rounded-full hover:border-kraken-green hover:text-kraken-green transition-colors">
                + {v as string}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={11} className="text-kraken-red" />
              <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Инциденты</span>
            </div>
            <button onClick={() => setAddingInc(p => !p)} className="text-[11px] text-kraken-red hover:text-kraken-red/80">+ Добавить</button>
          </div>
          {addingInc && (
            <div className="bg-kraken-hover rounded-lg p-3 mb-3 flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <select value={newIncType} onChange={e => setNewIncType(e.target.value)}
                  className="bg-kraken-base border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none">
                  {Object.entries(incidentTypes).map(([k,v]) => <option key={k} value={k}>{v as string}</option>)}
                </select>
                <select value={newIncSev} onChange={e => setNewIncSev(e.target.value)}
                  className="bg-kraken-base border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none">
                  <option value="low">Низкая (−5)</option>
                  <option value="medium">Средняя (−10)</option>
                  <option value="high">Высокая (−20)</option>
                </select>
              </div>
              <input type="text" value={newIncComment} onChange={e => setNewIncComment(e.target.value)} placeholder="Комментарий..."
                className="bg-kraken-base border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none w-full" />
              <div className="flex gap-2">
                <button onClick={() => setAddingInc(false)} className="flex-1 text-xs py-1.5 rounded-lg border border-kraken-border text-kraken-muted hover:text-kraken-text">Отмена</button>
                <button onClick={addIncident} className="flex-1 text-xs py-1.5 rounded-lg bg-kraken-red/20 text-kraken-red hover:bg-kraken-red/30 font-semibold">Записать</button>
              </div>
            </div>
          )}
          {incidents.length === 0 && !addingInc && <div className="text-kraken-disabled text-xs text-center py-2">Инцидентов нет</div>}
          {incidents.map((inc: any) => (
            <div key={inc.id} className="flex items-start gap-2 py-2 border-b border-kraken-border/50 last:border-0">
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${inc.severity==='high'?'bg-kraken-red':inc.severity==='medium'?'bg-amber-400':'bg-yellow-600'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-kraken-text text-xs font-medium">{incidentTypes[inc.incident_type]||inc.incident_type}</div>
                {inc.comment && <div className="text-kraken-muted text-[11px]">{inc.comment}</div>}
                <div className="text-kraken-disabled text-[10px] mt-0.5">
                  {inc.status==='resolved'?'✓ Решён':inc.status==='recurring'?'⚠ Повторяется':'● Открыт'} · {new Date(inc.created_at).toLocaleDateString('ru-RU')}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {inc.status !== 'resolved' && <button onClick={() => resolveInc(inc.id)} className="text-kraken-green text-[10px] px-1.5 py-0.5 rounded border border-kraken-green/30 hover:bg-kraken-green/10">✓</button>}
                <button onClick={() => deleteInc(inc.id)} className="text-kraken-disabled hover:text-kraken-red p-0.5"><Trash2 size={11}/></button>
              </div>
            </div>
          ))}
        </div>

        {/* ── История визитов ── */}
        <div className="px-4 py-3 border-t border-kraken-border">
          <button onClick={() => setShowVisits(p => !p)}
            className="w-full flex items-center justify-between group">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]">📅</span>
              <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">История визитов</span>
              {visits.length > 0 && (
                <span className="bg-kraken-hover text-kraken-muted text-[10px] px-1.5 py-0.5 rounded-full">
                  {visits.reduce((s: number, m: any) => s + m.count, 0)} всего
                </span>
              )}
            </div>
            <span className="text-kraken-disabled text-[10px]">{showVisits ? '▲' : '▼'}</span>
          </button>

          {showVisits && (
            <div className="mt-3 flex flex-col gap-3">
              {visits.length === 0 && (
                <div className="text-kraken-disabled text-xs text-center py-2">Визитов не зафиксировано</div>
              )}
              {visits.map((month: any) => (
                <div key={month.month}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-kraken-text text-xs font-semibold">{month.label}</span>
                    <span className="text-kraken-disabled text-[10px] bg-kraken-hover px-1.5 py-0.5 rounded-full">{month.count} визит{month.count === 1 ? '' : month.count < 5 ? 'а' : 'ов'}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {month.visits.slice(0, 5).map((v: any) => {
                      const pct = v.confidence != null
                        ? Math.round(((Math.max(0.28, Math.min(0.85, v.confidence)) - 0.28) / (0.85 - 0.28)) * 100)
                        : null
                      return (
                        <div key={v.id} className="flex items-center gap-2 py-1.5 border-b border-kraken-border/30 last:border-0">
                          {v.snapshot_path ? (
                            <img src={`/${v.snapshot_path}`} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-kraken-border" />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-kraken-hover flex-shrink-0 flex items-center justify-center text-lg">
                              {v.shift === 'evening' ? '🌙' : v.shift === 'morning' ? '🌅' : '☀️'}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-kraken-text text-[11px] font-medium">
                              {v.shift_label || (v.shift === 'night' ? '🌙 Ночная' : '☀️ Дневная')}
                            </div>
                            <div className="text-kraken-disabled text-[10px] flex items-center gap-1.5">
                              <span>{v.time}</span>
                              <span>·</span>
                              <span>{v.camera_name}</span>
                            </div>
                          </div>
                          {pct != null && (
                            <span className="text-[10px] font-bold text-kraken-green flex-shrink-0">{pct}%</span>
                          )}
                        </div>
                      )
                    })}
                    {month.visits.length > 5 && (
                      <div className="text-kraken-disabled text-[10px] text-center py-0.5">
                        + ещё {month.visits.length - 5} визит{month.visits.length - 5 < 5 ? 'а' : 'ов'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function IR({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-kraken-muted flex-shrink-0 mt-0.5">{icon}</span>
      <span className="text-kraken-disabled text-[11px] w-20 flex-shrink-0 pt-0.5">{label}:</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// ── Live Camera Preview ───────────────────────────────────────────────────────

function CameraPreview({ cameraId }: { cameraId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const decodingRef = useRef(false)

  useEffect(() => {
    if (!cameraId) return
    const ws = new WebSocket(wsUrl(`/ws/camera/${cameraId}`))
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    let lastFrameTime = 0

    ws.onmessage = (e) => {
      if (decodingRef.current) return
      const now = Date.now()
      if (now - lastFrameTime < 80) return  // ~12fps is enough for preview
      lastFrameTime = now

      try {
        const msg = JSON.parse(e.data as string)
        if (msg.type !== 'FRAME' || !msg.frame) return

        // Decode base64 → Blob → ImageBitmap (off main thread)
        const binStr = atob(msg.frame as string)
        const arr = new Uint8Array(binStr.length)
        for (let i = 0; i < binStr.length; i++) arr[i] = binStr.charCodeAt(i)
        const blob = new Blob([arr.buffer as ArrayBuffer], { type: 'image/jpeg' })

        decodingRef.current = true
        createImageBitmap(blob).then(bitmap => {
          const canvas = canvasRef.current
          if (canvas) {
            const ctx = canvas.getContext('2d', { alpha: false })
            if (ctx) {
              if (canvas.width !== bitmap.width) canvas.width = bitmap.width
              if (canvas.height !== bitmap.height) canvas.height = bitmap.height
              ctx.drawImage(bitmap, 0, 0)
            }
          }
          bitmap.close()
        }).catch(() => {}).finally(() => {
          decodingRef.current = false
        })
      } catch {}
    }

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 5000)

    return () => {
      clearInterval(ping)
      ws.close()
      decodingRef.current = false
    }
  }, [cameraId])

  return (
    <div className="relative w-full rounded-lg overflow-hidden bg-kraken-base border border-kraken-border" style={{ aspectRatio: '4/3' }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full object-cover"
        style={{ display: connected ? 'block' : 'none' }}
      />
      {!connected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Camera size={32} className="text-kraken-disabled opacity-40" />
          <span className="text-kraken-disabled text-xs">Подключение к камере...</span>
        </div>
      )}
      {connected && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/50 px-2 py-0.5 rounded text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-kraken-green animate-pulse" />
          <span className="text-kraken-green font-bold">LIVE</span>
        </div>
      )}
    </div>
  )
}


// ── Person Modal ──────────────────────────────────────────────────────────────

interface ModalProps {
  person: Person | null
  onClose: () => void
  onSaved: () => void
}

type PhotoTab = 'upload' | 'camera'

interface PhotoEntry {
  file: File
  preview: string
}

// ── Существующие фото с возможностью удаления ────────────────────────────────

function ExistingPhotos({ person, onDeleted }: { person: Person; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState<number | null>(null)
  const [settingPrimary, setSettingPrimary] = useState<number | null>(null)
  const [localPhotos, setLocalPhotos] = useState(person.photos ?? [])
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDamage?: boolean;
  } | null>(null)
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  } | null>(null)

  const handleDelete = (photoId: number) => {
    setConfirmState({
      isOpen: true,
      title: 'Удалить фото',
      message: 'Удалить это фото? Эмбеддинги будут пересозданы из оставшихся фото.',
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setDeleting(photoId)
        try {
          await apiFetch(`/persons/${person.id}/photos/${photoId}`, { method: 'DELETE' })
          setLocalPhotos(prev => prev.filter(p => p.id !== photoId))
          onDeleted()
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка удаления: ' + e.message })
        } finally {
          setDeleting(null)
        }
      }
    })
  }

  const handleSetPrimary = async (photoId: number) => {
    setSettingPrimary(photoId)
    try {
      await apiFetch(`/persons/${person.id}/photos/${photoId}/set_primary`, { method: 'POST' })
      setLocalPhotos(prev => prev.map(p => ({ ...p, is_primary: p.id === photoId })))
    } catch (e: any) {
      setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка: ' + e.message })
    } finally {
      setSettingPrimary(null)
    }
  }

  if (localPhotos.length === 0) return null

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-kraken-muted text-xs font-semibold uppercase tracking-widest">
          Текущие фото ({localPhotos.length})
        </span>
        <span className="text-kraken-disabled text-[10px]">Нажми на фото — сделать главным</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {localPhotos.map(ph => (
          <div key={ph.id} className="relative group">
            <div
              className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-colors ${
                ph.is_primary ? 'border-kraken-green' : 'border-kraken-border hover:border-kraken-purple'
              }`}
              onClick={() => !ph.is_primary && handleSetPrimary(ph.id)}
            >
              <img
                src={`${PHOTO_BASE}/${ph.photo_path}`}
                alt=""
                className="w-full aspect-square object-cover"
                onError={e => { (e.target as HTMLImageElement).src = '' }}
              />
              {ph.is_primary && (
                <div className="absolute bottom-0 left-0 right-0 bg-kraken-green/80 text-black text-[9px] text-center font-bold py-0.5">
                  ГЛАВНОЕ
                </div>
              )}
              {settingPrimary === ph.id && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <RefreshCw size={14} className="text-white animate-spin" />
                </div>
              )}
            </div>
            {/* Кнопка удаления */}
            <button
              onClick={() => handleDelete(ph.id)}
              disabled={deleting === ph.id}
              className="absolute top-1 right-1 bg-black/70 hover:bg-kraken-red rounded-full p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              title="Удалить фото"
            >
              {deleting === ph.id
                ? <RefreshCw size={10} className="animate-spin" />
                : <X size={10} />}
            </button>
          </div>
        ))}
      </div>
      <div className="border-t border-kraken-border mt-3 mb-1" />
      <div className="text-kraken-muted text-xs mb-1">Добавить новые фото:</div>

      {confirmState && (
        <ConfirmModal
          isOpen={confirmState.isOpen}
          title={confirmState.title}
          message={confirmState.message}
          isDamage={confirmState.isDamage}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {alertState && (
        <AlertModal
          isOpen={alertState.isOpen}
          title={alertState.title}
          message={alertState.message}
          onClose={() => setAlertState(null)}
        />
      )}
    </div>
  )
}

function PersonModal({ person, onClose, onSaved }: ModalProps) {
  const [name, setName] = useState(person?.name ?? '')
  const [category, setCategory] = useState<Category>(person?.category ?? 'CLIENT')
  const [position, setPosition] = useState(person?.position ?? '')
  const [comment, setComment] = useState(person?.comment ?? '')
  const [phone, setPhone] = useState(person?.phone ?? '')
  const [email, setEmail] = useState(person?.email ?? '')
  const [birthDate, setBirthDate] = useState(person?.birth_date ?? '')
  const [organization, setOrganization] = useState(person?.organization ?? '')
  const [address, setAddress] = useState(person?.address ?? '')
  const [extraInfo, setExtraInfo] = useState(person?.extra_info ?? '')
  const { categories } = useCategories()
  // Контактная секция — свёрнута по умолчанию если нет данных
  const hasContacts = !!(person?.phone || person?.email || person?.birth_date || person?.organization || person?.address || person?.extra_info)
  const [showContacts, setShowContacts] = useState(hasContacts)
  // Multiple photos queue
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [photoTab, setPhotoTab] = useState<PhotoTab>('upload')

  // Duplicate check state
  const [duplicateCheck, setDuplicateCheck] = useState<{ duplicate: boolean; matches: any[]; message?: string } | null>(null)

  // Camera snapshot state
  const [cameras, setCameras] = useState<CameraType[]>([])
  const [selectedCamId, setSelectedCamId] = useState<number | null>(null)
  const [snapping, setSnapping] = useState(false)
  const [snapError, setSnapError] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (photoTab === 'camera') {
      apiFetch<CameraType[]>('/cameras/').then(data => {
        const online = data.filter(c => c.status === 'online' || c.is_active)
        setCameras(online)
        if (online.length > 0) setSelectedCamId(online[0].id)
      }).catch(() => {})
    }
  }, [photoTab])

  const addFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = e => {
        setPhotos(prev => [...prev, { file, preview: e.target?.result as string }])
      }
      reader.readAsDataURL(file)
      // Если имя ещё не введено — парсим имя файла
      if (!name.trim()) {
        const stem = file.name
          .replace(/\.[^/.]+$/, '')   // убираем расширение
          // Убираем Windows-суффиксы копий: " — копия", " — копия (2)", " (2)", " - Copy (2)"
          .replace(/\s*[—\-]\s*[Кк]опия(\s*\(\d+\))?$/u, '')
          .replace(/\s*-\s*[Cc]opy(\s*\(\d+\))?$/, '')
          .replace(/\s*\(\d+\)$/, '')
          .replace(/_/g, ' ')          // подчёркивания → пробелы
          .trim()

        // Ищем " - " как разделитель
        const dashMatch = stem.match(/^(.+?)\s+-\s+(.+)$/)
        if (dashMatch) {
          const parsedName = dashMatch[1].trim()
          const afterDash = dashMatch[2].trim()

          // Всё что после тире → в поле должности (и охранник, и БОСС, и Директор)
          if (parsedName) setName(parsedName)
          setPosition(afterDash)
        } else {
          if (stem) setName(stem)
        }
      }
    })
  }

  const removePhoto = (idx: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSnapshot = async () => {
    if (!selectedCamId) return
    setSnapping(true); setSnapError('')
    try {
      const res = await apiFetch<{ image: string; content_type: string }>(`/cameras/${selectedCamId}/snapshot`)
      const byteStr = atob(res.image)
      const arr = new Uint8Array(byteStr.length)
      for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
      const file = new File([arr], `snapshot_${Date.now()}.jpg`, { type: 'image/jpeg' })
      setPhotos(prev => [...prev, { file, preview: `data:${res.content_type};base64,${res.image}` }])
      // Подставляем имя камеры если поле пустое
      if (!name.trim()) {
        const cam = cameras.find(c => c.id === selectedCamId)
        if (cam) setName(cam.name)
      }
    } catch (e: any) {
      setSnapError(e.message)
    } finally {
      setSnapping(false)
    }
  }

  const handleSave = async () => {
    const finalName = name.trim() || (photos.length > 0
      ? photos[0].file.name.replace(/\.[^/.]+$/, '').replace(/[_\-]+/g, ' ').trim() : '')
    if (!finalName) { setError('Введите имя или добавьте фото с именем файла'); return }
    setSaving(true); setError('')

    // For NEW person: check if name already exists → ask user what to do
    if (!person && duplicateCheck === null) {
      try {
        const res = await apiFetch<{ duplicate: boolean; matches: any[]; message?: string }>(`/persons/check_duplicate?name=${encodeURIComponent(finalName)}`)
        if (res.duplicate && res.matches.length > 0) {
          // Show duplicate dialog — don't save yet
          setDuplicateCheck(res)
          setSaving(false)
          return
        }
        // No duplicate — proceed to create
        setDuplicateCheck({ duplicate: false, matches: [] })
      } catch (e: any) {
        // Check failed — proceed anyway (best effort)
        setDuplicateCheck({ duplicate: false, matches: [] })
      }
    }

    const extraData = {
      name: finalName, category,
      position: position || null,
      comment: comment || null, phone: phone || null, email: email || null,
      birth_date: birthDate || null, organization: organization || null,
      address: address || null, extra_info: extraInfo || null,
    }
    try {
      if (person) {
        await apiFetch(`/persons/${person.id}`, { method: 'PUT', body: JSON.stringify(extraData) })
        if (photos.length > 0) {
          const fd = new FormData()
          photos.forEach(p => fd.append('photos', p.file))
          await apiUpload(`/persons/${person.id}/photos`, fd)
        }
      } else {
        const fd = new FormData()
        Object.entries(extraData).forEach(([k, v]) => { if (v != null) fd.append(k, String(v)) })
        photos.forEach(p => fd.append('photos', p.file))
        await apiUpload('/persons/', fd)
      }
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleMergeWithExisting = async (existingPersonId: number) => {
    // Create new person first, then merge into existing
    setSaving(true); setError('')
    const finalName = name.trim() || (photos.length > 0
      ? photos[0].file.name.replace(/\.[^/.]+$/, '').replace(/[_\-]+/g, ' ').trim() : '')
    try {
      // Add photos to existing person directly
      const fd = new FormData()
      photos.forEach(p => fd.append('photos', p.file))
      await apiUpload(`/persons/${existingPersonId}/photos`, fd)
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false); setDuplicateCheck(null) }
  }

  const handleForceCreate = () => {
    // User chose to create a new person despite duplicate
    setDuplicateCheck({ duplicate: false, matches: [] })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel p-6 w-full max-w-lg mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Duplicate confirmation dialog */}
        {duplicateCheck?.duplicate && duplicateCheck.matches.length > 0 && (
          <div className="mb-4 p-4 rounded-lg bg-kraken-hover border border-kraken-purple">
            <div className="text-kraken-purple font-bold text-sm mb-2">⚠️ Найден человек с таким ФИО</div>
            <div className="text-kraken-muted text-xs mb-3">
              {duplicateCheck.message || `В базе уже есть «${duplicateCheck.matches[0].name}». Что вы хотите сделать?`}
            </div>
            {duplicateCheck.matches.map((m: any) => (
              <div key={m.id} className="flex items-center gap-3 p-2 rounded bg-kraken-bg mb-2">
                {m.photo_path && <img src={`${PHOTO_BASE}/${m.photo_path}`} alt="" className="w-10 h-10 rounded object-cover" />}
                <div>
                  <div className="text-kraken-text text-sm font-semibold">{m.name}</div>
                  <div className="text-kraken-muted text-xs">
                    Категория: {m.category} | Фото: {m.embedding_count || 0} эмбеддингов
                    {m.position && ` | ${m.position}`}
                  </div>
                </div>
                <button
                  onClick={() => handleMergeWithExisting(m.id)}
                  className="ml-auto px-3 py-1.5 text-xs rounded bg-kraken-purple text-white hover:bg-kraken-purple-dark"
                >
                  Добавить фото сюда
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleForceCreate}
                className="px-3 py-1.5 text-xs rounded bg-kraken-bg text-kraken-text hover:bg-kraken-hover border border-kraken-border"
              >
                Создать нового
              </button>
              <button
                onClick={() => setDuplicateCheck(null)}
                className="px-3 py-1.5 text-xs rounded text-kraken-muted hover:text-kraken-text"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-kraken-text font-bold text-lg">
            {person ? 'Редактировать' : 'Добавить человека'}
          </h2>
          <button onClick={onClose} className="text-kraken-muted hover:text-kraken-text">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Имя <span className="text-kraken-disabled">(можно оставить пустым — возьмётся из имени файла)</span></label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Подставится из имени файла автоматически"
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Категория</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as Category)}
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
            >
              {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>

          {/* Position */}
          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Должность</label>
            <input
              type="text"
              value={position}
              onChange={e => setPosition(e.target.value)}
              placeholder="Директор, Менеджер, Охранник..."
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
            />
          </div>

          {/* Comment */}
          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Комментарий (только для охраны)</label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Заметки видны только охране..."
              rows={2}
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple resize-none"
            />
          </div>

          {/* Доп. поля — сворачиваемые */}
          <div className="border-t border-kraken-border pt-1">
            <button
              type="button"
              onClick={() => setShowContacts(v => !v)}
              className="w-full flex items-center justify-between py-2 hover:text-kraken-text transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Контактная информация</span>
                {/* Счётчик заполненных полей */}
                {[phone, email, birthDate, organization, address, extraInfo].filter(Boolean).length > 0 && (
                  <span className="bg-kraken-purple/20 text-kraken-purple text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                    {[phone, email, birthDate, organization, address, extraInfo].filter(Boolean).length}
                  </span>
                )}
              </div>
              <span className="text-kraken-disabled text-[10px]">{showContacts ? '▲' : '▼'}</span>
            </button>

            {showContacts && (
              <div className="flex flex-col gap-3 pb-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-kraken-muted text-xs mb-1 block">📞 Телефон</label>
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                      placeholder="+7 (999) 000-00-00"
                      className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple" />
                  </div>
                  <div>
                    <label className="text-kraken-muted text-xs mb-1 block">✉️ Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="example@mail.com"
                      className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-kraken-muted text-xs mb-1 block">🎂 Дата рождения</label>
                    <input type="text" value={birthDate} onChange={e => setBirthDate(e.target.value)}
                      placeholder="ДД.ММ.ГГГГ"
                      className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple" />
                  </div>
                  <div>
                    <label className="text-kraken-muted text-xs mb-1 block">🏢 Организация</label>
                    <input type="text" value={organization} onChange={e => setOrganization(e.target.value)}
                      placeholder="Компания / должность"
                      className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple" />
                  </div>
                </div>
                <div>
                  <label className="text-kraken-muted text-xs mb-1 block">📍 Адрес</label>
                  <input type="text" value={address} onChange={e => setAddress(e.target.value)}
                    placeholder="Город, улица, дом"
                    className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple" />
                </div>
                <div>
                  <label className="text-kraken-muted text-xs mb-1 block">📝 Доп. информация</label>
                  <textarea value={extraInfo} onChange={e => setExtraInfo(e.target.value)}
                    placeholder="Любая дополнительная информация..."
                    rows={2}
                    className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple resize-none" />
                </div>
              </div>
            )}
          </div>

          {/* Photos section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-kraken-muted text-xs">
                Фото <span className="text-kraken-disabled">(можно несколько — чем больше, тем точнее)</span>
              </label>
              <span className="text-kraken-green text-xs font-bold">{photos.length} фото</span>
            </div>

            {/* Существующие фото при редактировании */}
            {person && person.photos && person.photos.length > 0 && (
              <ExistingPhotos
                person={person}
                onDeleted={() => {
                  // Перезагружаем данные человека после удаления фото
                  // onSaved вызовет fetchPeople который обновит список
                }}
              />
            )}

            {/* Tab switcher */}
            <div className="flex gap-1 mb-3 bg-kraken-base rounded-lg p-1">
              <button
                onClick={() => setPhotoTab('upload')}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-md transition-colors ${
                  photoTab === 'upload' ? 'bg-kraken-panel text-kraken-text' : 'text-kraken-muted hover:text-kraken-text'
                }`}
              >
                <Upload size={13} /> Загрузить файлы
              </button>
              <button
                onClick={() => setPhotoTab('camera')}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-md transition-colors ${
                  photoTab === 'camera' ? 'bg-kraken-panel text-kraken-text' : 'text-kraken-muted hover:text-kraken-text'
                }`}
              >
                <Camera size={13} /> Сфотографировать
              </button>
            </div>

            {/* Upload tab */}
            {photoTab === 'upload' && (
              <>
                <label className="border border-dashed border-kraken-border rounded-lg p-3 text-center cursor-pointer hover:border-kraken-purple transition-colors mb-2 block">
                  <div className="flex items-center justify-center gap-2 text-kraken-muted text-sm">
                    <ImagePlus size={16} />
                    Нажмите для выбора (можно выбрать несколько)
                  </div>
                  <div className="text-kraken-disabled text-xs mt-0.5">JPG, PNG, WEBP</div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => addFiles(e.target.files)}
                  />
                </label>
              </>
            )}

            {/* Camera tab */}
            {photoTab === 'camera' && (
              <div className="flex flex-col gap-2 mb-2">
                {cameras.length === 0 ? (
                  <div className="text-kraken-disabled text-sm text-center py-3 border border-kraken-border rounded-lg">
                    Нет активных камер
                  </div>
                ) : (
                  <>
                    {cameras.length > 1 && (
                      <select
                        value={selectedCamId ?? ''}
                        onChange={e => setSelectedCamId(Number(e.target.value))}
                        className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
                      >
                        {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    {selectedCamId && <CameraPreview cameraId={selectedCamId} />}
                    <button
                      onClick={handleSnapshot}
                      disabled={snapping || !selectedCamId}
                      className="w-full flex items-center justify-center gap-2 bg-kraken-purple hover:bg-kraken-purple-hover text-white py-2.5 rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                    >
                      {snapping
                        ? <><RefreshCw size={15} className="animate-spin" /> Снимаем...</>
                        : <><Camera size={15} /> Сделать снимок</>}
                    </button>
                    {snapError && <div className="text-kraken-red text-xs">{snapError}</div>}
                  </>
                )}
              </div>
            )}

            {/* Photo previews grid */}
            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={p.preview}
                      alt=""
                      className={`w-full aspect-square object-cover rounded-lg border-2 ${
                        i === 0 ? 'border-kraken-green' : 'border-kraken-border'
                      }`}
                    />
                    {i === 0 && (
                      <div className="absolute bottom-0 left-0 right-0 bg-kraken-green/80 text-black text-[9px] text-center font-bold rounded-b-lg py-0.5">
                        ГЛАВНОЕ
                      </div>
                    )}
                    <button
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {photos.length === 0 && (
              <div className="text-kraken-disabled text-xs text-center py-1">
                Без фото человек не будет распознаваться
              </div>
            )}
          </div>

          {error && <div className="text-kraken-red text-sm">{error}</div>}

          <div className="flex gap-3 mt-2">
            <button onClick={onClose} className="btn-ghost flex-1">Отмена</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Сохранение...' : person ? 'Сохранить' : `Добавить${photos.length > 0 ? ` (${photos.length} фото)` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Add Extra Photo Modal ─────────────────────────────────────────────────────

interface AddExtraPhotoProps {
  person: Person
  onClose: () => void
  onSaved: () => void
}

function AddExtraPhotoModal({ person, onClose, onSaved }: AddExtraPhotoProps) {
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ added: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File | null) => {
    setPhoto(file); setResult(null); setError('')
    if (file) {
      const reader = new FileReader()
      reader.onload = e => setPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    } else { setPreview(null) }
  }

  const handleSave = async () => {
    if (!photo) { setError('Выберите фото'); return }
    setSaving(true); setError('')
    try {
      const fd = new FormData()
      fd.append('photos', photo)
      const res = await apiUpload<{ added_embeddings: number; total_embeddings: number }>(
        `/persons/${person.id}/photos`, fd
      )
      setResult({ added: res.added_embeddings, total: res.total_embeddings })
    } catch (e: any) {
      setError(e.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="panel p-5 w-full max-w-sm mx-4 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-kraken-text font-bold">Добавить фото</h2>
            <p className="text-kraken-muted text-xs mt-0.5">{person.name}</p>
          </div>
          <button onClick={result ? onSaved : onClose} className="text-kraken-muted hover:text-kraken-text">
            <X size={16} />
          </button>
        </div>
        <div className="bg-kraken-hover rounded-lg px-3 py-2 mb-4 text-kraken-muted text-xs leading-relaxed">
          Добавьте фото с другого ракурса или при другом освещении.
          Старые данные <strong className="text-kraken-text">не удаляются</strong>.
          Чем больше фоток, тем точнее распознавание.
        </div>
        <div className="flex items-center justify-between mb-3 text-xs">
          <span className="text-kraken-muted">Текущих эмбеддингов:</span>
          <span className="text-kraken-green font-bold">{person.embedding_count}</span>
        </div>
        {result ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">✅</div>
            <div className="text-kraken-green font-bold text-sm">+{result.added} эмбеддингов добавлено</div>
            <div className="text-kraken-muted text-xs mt-1">Всего теперь: {result.total}</div>
            <button onClick={onSaved} className="btn-primary w-full mt-4 text-sm">Готово</button>
          </div>
        ) : (
          <>
            {preview ? (
              <div className="relative mb-3">
                <img src={preview} alt="" className="w-full h-36 object-cover rounded-lg border border-kraken-border" />
                <button onClick={() => { setPreview(null); setPhoto(null) }}
                  className="absolute top-2 right-2 bg-black/60 rounded-full p-1 text-white">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <label className="border border-dashed border-kraken-border rounded-lg p-6 text-center cursor-pointer hover:border-kraken-green transition-colors mb-3 block">
                <ImagePlus size={24} className="mx-auto mb-2 text-kraken-muted" />
                <div className="text-kraken-muted text-sm">Нажмите для выбора фото</div>
                <div className="text-kraken-disabled text-xs mt-1">Лучше всего: другой ракурс, другое освещение</div>
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => handleFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => handleFile(e.target.files?.[0] ?? null)} />
            {error && <div className="text-kraken-red text-xs mb-3">{error}</div>}
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-ghost flex-1 text-sm">Отмена</button>
              <button onClick={handleSave} disabled={saving || !photo} className="btn-primary flex-1 text-sm">
                {saving ? 'Обработка...' : 'Добавить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Photo Search Modal ────────────────────────────────────────────────────────

interface PhotoSearchMatch {
  person: Person
  similarity: number
  raw_similarity: number
  similarity_pct: number
  category: string
  match_count: number
  ambiguous?: boolean
  gap?: number
}

interface FaceQuality {
  size: number
  blur: number
  angle: number
  total: number
}

interface PhotoSearchResult {
  matches: PhotoSearchMatch[]
  face_detected: boolean
  face_count: number
  det_score: number
  quality_scores: FaceQuality[]
  message?: string
  total_searched?: Record<string, number>
  threshold_used?: number
  mode?: string
  model?: string
  detector?: string
  cosine_distance?: number
}

function PhotoSearchModal({ onClose, onSelectPerson }: {
  onClose: () => void
  onSelectPerson: (p: Person) => void
}) {
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<PhotoSearchResult | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Search settings (DeepFace high-accuracy mode)
  const [showSettings, setShowSettings] = useState(false)
  const [searchMode, setSearchMode] = useState<'deepface' | 'default'>('deepface')
  const [model, setModel] = useState('ArcFace')
  const [detector, setDetector] = useState('retinaface')
  const [threshold, setThreshold] = useState(0.35)

  // Load saved settings on mount
  useEffect(() => {
    apiFetch<any>('/settings/').then(s => {
      if (s?.photo_search_model) setModel(s.photo_search_model)
      if (s?.photo_search_detector) setDetector(s.photo_search_detector)
      if (s?.photo_search_threshold != null) setThreshold(s.photo_search_threshold)
    }).catch(() => {})
  }, [])

  const handleFile = (file: File | null) => {
    setPhoto(file); setResult(null); setError('')
    if (file) {
      const reader = new FileReader()
      reader.onload = e => setPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setPreview(null)
    }
  }

  const handleSearch = async () => {
    if (!photo) { setError('Выберите фото'); return }
    setSearching(true); setError('')
    try {
      const fd = new FormData()
      fd.append('photo', photo)
      fd.append('top_k', '8')
      const res = await apiUpload<PhotoSearchResult>(`/persons/search_by_photo?mode=${searchMode}`, fd)
      setResult(res)
    } catch (e: any) {
      setError(e.message || 'Ошибка поиска')
    } finally {
      setSearching(false)
    }
  }

  const saveSettings = async () => {
    try {
      await apiFetch('/settings/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo_search_model: model,
          photo_search_detector: detector,
          photo_search_threshold: threshold,
        }),
      })
    } catch {}
  }

  const totalInDB = result?.total_searched
    ? Object.values(result.total_searched).reduce((a, b) => a + b, 0)
    : 0

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="panel p-5 w-full max-w-2xl mx-4 animate-fade-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <ScanFace size={18} className="text-kraken-purple" />
            <div>
              <h2 className="text-kraken-text font-bold">Поиск по фотографии</h2>
              <p className="text-kraken-muted text-xs mt-0.5">
                {searchMode === 'deepface'
                  ? `DeepFace: ${model} + ${detector} (cosine dist ≤ ${threshold.toFixed(2)})`
                  : 'Стандартный режим: SCRFD/YOLO + ArcFace (ONNX)'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                showSettings
                  ? 'bg-kraken-purple/20 text-kraken-purple border border-kraken-purple/40'
                  : 'bg-kraken-hover text-kraken-muted border border-kraken-border hover:border-kraken-purple/40 hover:text-kraken-purple'
              }`}
            >
              <Settings size={13} />
              Настройки
              <ChevronDown size={12} className={`transition-transform ${showSettings ? 'rotate-180' : ''}`} />
            </button>
            <button onClick={onClose} className="text-kraken-muted hover:text-kraken-text"><X size={18} /></button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="mb-4 p-3 bg-kraken-base border border-kraken-border rounded-xl flex-shrink-0 animate-fade-in">
            <div className="text-kraken-muted text-[10px] uppercase tracking-widest mb-2">Настройки поиска по фото</div>
            <div className="grid grid-cols-2 gap-3">
              {/* Mode */}
              <div>
                <label className="text-kraken-muted text-[10px] mb-0.5 block">Режим поиска</label>
                <select value={searchMode} onChange={e => setSearchMode(e.target.value as any)}
                  className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple">
                  <option value="deepface">DeepFace (высокая точность)</option>
                  <option value="default">Стандартный (SCRFD/YOLO)</option>
                </select>
              </div>

              {/* Threshold */}
              <div>
                <label className="text-kraken-muted text-[10px] mb-0.5 block">
                  Порог cosine distance: <span className="text-kraken-purple font-bold">{threshold.toFixed(2)}</span>
                  <span className="text-kraken-disabled ml-1">(sim ≥ {(1 - threshold).toFixed(2)})</span>
                </label>
                <input type="range" min="0.10" max="0.65" step="0.01" value={threshold}
                  onChange={e => setThreshold(parseFloat(e.target.value))}
                  className="w-full accent-kraken-purple h-1.5 mt-1" />
                <div className="flex justify-between text-[9px] text-kraken-disabled">
                  <span>0.10 (строже)</span>
                  <span>0.65 (мягче)</span>
                </div>
              </div>

              {/* Model — only for deepface mode */}
              {searchMode === 'deepface' && (
                <div>
                  <label className="text-kraken-muted text-[10px] mb-0.5 block">Модель распознавания</label>
                  <select value={model} onChange={e => setModel(e.target.value)}
                    className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple">
                    <option value="ArcFace">ArcFace (рекомендуется)</option>
                    <option value="SFace">SFace</option>
                    <option value="Facenet">FaceNet</option>
                    <option value="Facenet512">FaceNet512</option>
                    <option value="VGG-Face">VGG-Face</option>
                    <option value="OpenFace">OpenFace</option>
                    <option value="GhostFaceNet">GhostFaceNet</option>
                  </select>
                </div>
              )}

              {/* Detector — only for deepface mode */}
              {searchMode === 'deepface' && (
                <div>
                  <label className="text-kraken-muted text-[10px] mb-0.5 block">Детектор лиц</label>
                  <select value={detector} onChange={e => setDetector(e.target.value)}
                    className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple">
                    <option value="retinaface">RetinaFace (рекомендуется)</option>
                    <option value="mtcnn">MTCNN</option>
                    <option value="ssd">SSD</option>
                    <option value="yolov8">YOLOv8</option>
                    <option value="yunet">YuNet</option>
                    <option value="fastmtcnn">Fast MTCNN</option>
                    <option value="centerface">CenterFace</option>
                    <option value="mediapipe">MediaPipe</option>
                    <option value="opencv">OpenCV</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mt-3">
              <div className="text-[10px] text-kraken-disabled">
                {searchMode === 'deepface'
                  ? '✅ DeepFace + RetinaFace + ArcFace = лучшая точность на практике'
                  : 'Быстрый режим на SCRFD/YOLO + ArcFace (ONNX)'}
              </div>
              <button onClick={saveSettings}
                className="text-xs px-3 py-1 rounded-lg bg-kraken-purple/10 text-kraken-purple hover:bg-kraken-purple/20 border border-kraken-purple/30 transition-colors">
                Сохранить настройки
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Left: upload */}
          <div className="w-52 flex-shrink-0 flex flex-col gap-3">
            {preview ? (
              <div className="relative">
                <img src={preview} alt="" className="w-full rounded-xl border border-kraken-border object-cover" style={{ maxHeight: 200 }} />
                <button onClick={() => { setPreview(null); setPhoto(null); setResult(null) }}
                  className="absolute top-2 right-2 bg-black/60 rounded-full p-1 text-white hover:bg-kraken-red">
                  <X size={12} />
                </button>
                {result?.face_detected && (
                  <div className="absolute bottom-2 left-2 bg-kraken-green/80 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Лицо найдено {Math.round(result.det_score * 100)}%
                  </div>
                )}
              </div>
            ) : (
              <label className="border-2 border-dashed border-kraken-border rounded-xl p-6 text-center cursor-pointer hover:border-kraken-purple transition-colors flex flex-col items-center gap-2 block">
                <ScanFace size={32} className="text-kraken-muted opacity-50" />
                <div className="text-kraken-muted text-xs">Нажмите для выбора фото</div>
                <div className="text-kraken-disabled text-[10px]">JPG, PNG, WEBP</div>
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => handleFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => handleFile(e.target.files?.[0] ?? null)} />

            {error && <div className="text-kraken-red text-xs bg-kraken-red/10 rounded-lg px-3 py-2">{error}</div>}

            <button onClick={handleSearch} disabled={searching || !photo}
              className="btn-primary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-50">
              {searching
                ? <><RefreshCw size={14} className="animate-spin" /> Поиск...</>
                : <><ScanFace size={14} /> Найти похожих</>}
            </button>

            {result && (
              <div className="text-kraken-disabled text-[10px] text-center space-y-0.5">
                <div>Найдено: {result.matches.length} из {totalInDB} эмбеддингов</div>
                {result.mode && (
                  <div className="text-kraken-purple/70">
                    {result.mode === 'deepface'
                      ? `DeepFace: ${result.model} + ${result.detector}`
                      : 'Стандартный режим'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: results */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {!result && !searching && (
              <div className="h-full flex flex-col items-center justify-center text-kraken-disabled gap-3">
                <ScanFace size={48} className="opacity-20" />
                <p className="text-sm text-center">Загрузите фото и нажмите «Найти похожих»</p>
                <p className="text-xs text-center max-w-xs opacity-70">
                  Система сравнит лицо с базой данных и покажет наиболее похожих людей
                </p>
              </div>
            )}

            {result && result.matches.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-kraken-disabled gap-3">
                <ScanFace size={48} className="opacity-20" />
                <p className="text-sm">Совпадений не найдено</p>
                <p className="text-xs opacity-70">{result.message || 'Этого человека нет в базе данных'}</p>
                {result.quality_scores && result.quality_scores.length > 0 && (
                  <div className="text-xs opacity-60 mt-1">
                    Качество фото: {result.quality_scores[0].total >= 0.7 ? '✅ Хорошее' : result.quality_scores[0].total >= 0.4 ? '⚠️ Среднее' : '❌ Плохое'}
                    (размер: {result.quality_scores[0].size.toFixed(2)}, чёткость: {result.quality_scores[0].blur.toFixed(2)}, угол: {result.quality_scores[0].angle.toFixed(2)})
                  </div>
                )}
              </div>
            )}

            {result && result.matches.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-kraken-disabled text-[10px] uppercase tracking-widest">
                    {result.matches.length} совпадений · Лиц на фото: {result.face_count ?? 1}
                  </div>
                  {result.quality_scores && result.quality_scores.length > 0 && (
                    <div className="text-kraken-disabled text-[10px]">
                      Качество: {result.quality_scores[0].total >= 0.7 ? '✅' : result.quality_scores[0].total >= 0.4 ? '⚠️' : '❌'}
                      {result.quality_scores[0].total.toFixed(2)}
                    </div>
                  )}
                </div>
                {result.matches.map((m, i) => {
                  const confLabel = m.ambiguous ? 'Неопределённо' :
                    m.similarity_pct >= 80 ? 'Высокое' :
                    m.similarity_pct >= 50 ? 'Среднее' : 'Низкое'
                  return (
                  <button key={m.person.id}
                    onClick={() => onSelectPerson(m.person)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left group ${
                      m.ambiguous ? 'border-amber-400/40 hover:border-amber-400 bg-amber-400/5' :
                      'border-kraken-border hover:border-kraken-purple hover:bg-kraken-purple/5'
                    }`}>
                    {/* Rank */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 ${
                      i === 0 ? 'bg-amber-400/20 text-amber-400' :
                      i === 1 ? 'bg-kraken-muted/20 text-kraken-muted' :
                      'bg-kraken-hover text-kraken-disabled'
                    }`}>
                      {i + 1}
                    </div>
                    {/* Photo */}
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-kraken-hover border border-kraken-border flex-shrink-0">
                      {m.person.photo_path
                        ? <img src={`${PHOTO_BASE}/${m.person.photo_path}`} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-2xl">👤</div>}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-kraken-text font-semibold text-sm truncate">{m.person.name}</span>
                        <CategoryBadge category={m.person.category} />
                      </div>
                      {m.person.organization && (
                        <div className="text-kraken-disabled text-[10px] truncate">{m.person.organization}</div>
                      )}
                      <div className="text-kraken-disabled text-[10px] mt-0.5">
                        Визитов: {m.person.visit_count ?? 0} · Эмбеддингов: {m.person.embedding_count} · Совпадений: {m.match_count ?? 1}
                      </div>
                    </div>
                    {/* Similarity */}
                    <div className="flex flex-col items-end flex-shrink-0">
                      <span className={`text-xl font-black leading-none ${
                        m.ambiguous ? 'text-amber-400' :
                        m.similarity_pct >= 70 ? 'text-kraken-green' :
                        m.similarity_pct >= 40 ? 'text-amber-400' :
                        'text-kraken-muted'
                      }`}>
                        {m.similarity_pct}%
                      </span>
                      {m.ambiguous && (
                        <span className="text-amber-400 text-[10px] font-bold">⚠️ {confLabel}</span>
                      )}
                      {!m.ambiguous && (
                        <span className={`text-[10px] ${m.similarity_pct >= 70 ? 'text-kraken-green' : m.similarity_pct >= 40 ? 'text-amber-400' : 'text-kraken-muted'}`}>
                          {confLabel}
                        </span>
                      )}
                      {/* Bar */}
                      <div className="w-16 h-1 bg-kraken-hover rounded-full mt-1 overflow-hidden">
                        <div className={`h-full rounded-full ${
                          m.ambiguous ? 'bg-amber-400' :
                          m.similarity_pct >= 70 ? 'bg-kraken-green' :
                          m.similarity_pct >= 40 ? 'bg-amber-400' :
                          'bg-kraken-muted'
                        }`} style={{ width: `${m.similarity_pct}%` }} />
                      </div>
                    </div>
                  </button>
                  )})}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Bulk Import Modal ─────────────────────────────────────────────────────────

function BulkImportModal({ onClose, onDone, categories }: {
  onClose: () => void
  onDone: () => void
  categories: import('../types').PersonCategory[]
}) {
  const [files, setFiles] = useState<File[]>([])
  const [category, setCategory] = useState('CLIENT')
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<any | null>(null)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(Array.from(e.target.files))
  }

  // Очищаем polling при размонтировании
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleImport = async () => {
    if (!files.length) return
    setImporting(true)
    setResults(null)
    setProgress(0)
    setTotal(files.length)

    try {
      const fd = new FormData()
      files.forEach(f => fd.append('photos', f))
      fd.append('category', category)

      const res = await fetch('/api/persons/bulk_import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('kraken_token') || ''}` },
        body: fd,
      })

      if (!res.ok) {
        const text = await res.text()
        try { throw new Error(JSON.parse(text).detail || `Ошибка ${res.status}`) }
        catch { throw new Error(`Ошибка сервера ${res.status}`) }
      }

      const { job_id } = await res.json()
      if (!job_id) throw new Error('Не получен job_id')

      // Опрашиваем статус каждые 2 секунды
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/persons/bulk_import/${job_id}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('kraken_token') || ''}` },
          })
          if (!statusRes.ok) return
          const job = await statusRes.json()
          setProgress(job.progress ?? 0)

          if (job.status === 'done') {
            if (pollRef.current) clearInterval(pollRef.current)
            setResults(job)
            setImporting(false)
          }
        } catch {}
      }, 2000)

    } catch (e: any) {
      setResults({ error: e.message })
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="panel p-6 w-full max-w-lg mx-4 animate-fade-in max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-kraken-text font-bold text-base">Массовый импорт</h2>
            <p className="text-kraken-muted text-xs mt-0.5">Добавить людей по фотографиям</p>
          </div>
          <button onClick={onClose} className="text-kraken-muted hover:text-kraken-text"><X size={16} /></button>
        </div>

        {/* Правила именования */}
        <div className="bg-kraken-hover rounded-xl p-3 mb-4 text-xs text-kraken-muted space-y-1">
          <div className="text-kraken-text font-semibold mb-1.5">📋 Правила именования файлов:</div>
          <div><span className="font-mono text-kraken-purple">Иванов Иван.jpg</span> → имя: Иванов Иван</div>
          <div><span className="font-mono text-kraken-purple">Иванов Иван - Директор.jpg</span> → имя + должность</div>
          <div><span className="font-mono text-kraken-purple">ИВАНОВ ИВАН.jpg</span> → автоматически: Иванов Иван</div>
          <div><span className="font-mono text-kraken-purple">ivan_ivanov.jpg</span> → Ivan Ivanov (подчёркивания → пробелы)</div>
        </div>

        {/* Категория */}
        <div className="mb-4">
          <label className="text-kraken-disabled text-xs uppercase tracking-wider mb-1 block">Категория для всех</label>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple">
            {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>

        {/* Выбор файлов */}
        <div className="mb-4">
          <label className="w-full border-2 border-dashed border-kraken-border hover:border-kraken-purple rounded-xl py-6 flex flex-col items-center gap-2 transition-colors cursor-pointer block">
            <Upload size={24} className="text-kraken-muted" />
            <span className="text-kraken-muted text-sm">Выбрать фотографии</span>
            <span className="text-kraken-disabled text-xs">JPG, PNG, WEBP</span>
            <input type="file" multiple accept="image/*" onChange={handleFiles} className="hidden" />
          </label>
          {files.length > 0 && (
            <div className="mt-2 text-kraken-muted text-xs">
              Выбрано: <span className="text-kraken-text font-semibold">{files.length}</span> файлов
              <div className="mt-1 max-h-24 overflow-y-auto space-y-0.5">
                {files.slice(0, 10).map((f, i) => (
                  <div key={i} className="text-kraken-disabled truncate">{f.name}</div>
                ))}
                {files.length > 10 && <div className="text-kraken-disabled">...и ещё {files.length - 10}</div>}
              </div>
            </div>
          )}
        </div>

        {/* Результаты */}
        {results && !results.error && (
          <div className="mb-4 space-y-2">
            {results.warning && (
              <div className="text-amber-400 text-xs px-3 py-2 rounded-lg bg-amber-400/10 border border-amber-400/30">
                ⚠️ {results.warning}
              </div>
            )}
            <div className="flex gap-3 text-sm">
              <span className="text-kraken-green font-bold">✅ {results.created?.length ?? 0} создано</span>
              {results.failed?.length > 0 && <span className="text-kraken-red font-bold">❌ {results.failed.length} ошибок</span>}
              {results.skipped?.length > 0 && <span className="text-kraken-muted">⏭ {results.skipped.length} пропущено</span>}
            </div>
            {results.created?.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1">
                {results.created.map((r: any, i: number) => (
                  <div key={i} className="text-xs flex items-center gap-2">
                    <span className={r.embeddings > 0 ? 'text-kraken-green' : 'text-amber-400'}>
                      {r.embeddings > 0 ? '✓' : '⚠'}
                    </span>
                    <span className="text-kraken-text font-medium">{r.name}</span>
                    {r.position && <span className="text-kraken-muted">— {r.position}</span>}
                    {r.stage_name && <span className="text-kraken-purple text-[10px] px-1.5 py-0.5 rounded-full bg-kraken-purple/10">🎭 {r.stage_name}</span>}
                    <span className="text-kraken-disabled ml-auto">{r.embeddings} эмб.</span>
                  </div>
                ))}
              </div>
            )}
            {results.failed?.length > 0 && (
              <div className="max-h-20 overflow-y-auto space-y-1">
                {results.failed.map((r: any, i: number) => (
                  <div key={i} className="text-xs text-kraken-red">{r.file}: {r.error}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {results?.error && (
          <div className="mb-4 text-kraken-red text-sm">❌ {results.error}</div>
        )}

        <div className="flex gap-2">
          {results ? (
            <button onClick={onDone} className="btn-primary flex-1 text-sm py-2">Готово</button>
          ) : (
            <>
              <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Отмена</button>
              <button onClick={handleImport} disabled={!files.length || importing}
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm py-2 disabled:opacity-50">
                {importing
                  ? <><RefreshCw size={14} className="animate-spin" /> Обработка {progress}/{total}...</>
                  : <><Upload size={14} /> Импортировать</>}
              </button>
            </>
          )}
        </div>

        {/* Прогресс-бар */}
        {importing && total > 0 && (
          <div className="mt-3">
            <div className="h-1.5 bg-kraken-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-kraken-purple rounded-full transition-all duration-500"
                style={{ width: `${Math.round((progress / total) * 100)}%` }}
              />
            </div>
            <div className="text-kraken-disabled text-[10px] text-center mt-1">
              Обрабатывается {progress} из {total} фото...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Delete Category Modal ─────────────────────────────────────────────────────

function DeleteCategoryModal({ categories, onClose, onDone }: {
  categories: import('../types').PersonCategory[]
  onClose: () => void
  onDone: () => void
}) {
  const [selectedCat, setSelectedCat] = useState(categories[0]?.code ?? '')
  const [deleting, setDeleting] = useState(false)
  const [result, setResult] = useState<{ deleted: number } | null>(null)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDamage?: boolean;
  } | null>(null)
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  } | null>(null)

  const handleDelete = () => {
    if (!selectedCat) return
    const cat = categories.find(c => c.code === selectedCat)
    setConfirmState({
      isOpen: true,
      title: 'Удалить категорию',
      message: `Удалить ВСЕХ людей категории "${cat?.label ?? selectedCat}"? Это действие необратимо.`,
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setDeleting(true)
        try {
          const res = await apiFetch<{ ok: boolean; deleted: number }>(
            `/persons/by_category/${selectedCat}`,
            { method: 'DELETE' }
          )
          setResult(res)
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка: ' + e.message })
        } finally {
          setDeleting(false)
        }
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="panel p-6 w-full max-w-sm mx-4 animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-kraken-red/10 flex items-center justify-center flex-shrink-0">
            <Layers size={20} className="text-kraken-red" />
          </div>
          <div>
            <h2 className="text-kraken-text font-bold">Удалить всю категорию</h2>
            <p className="text-kraken-muted text-xs mt-0.5">Удалит всех людей выбранной категории</p>
          </div>
          <button onClick={onClose} className="ml-auto text-kraken-muted hover:text-kraken-text">
            <X size={16} />
          </button>
        </div>

        {result ? (
          <div className="text-center py-4">
            <div className="text-kraken-green text-2xl font-black mb-2">✓</div>
            <div className="text-kraken-text font-semibold">Удалено: {result.deleted} человек</div>
            <button onClick={onDone} className="btn-primary w-full mt-4 text-sm py-2">Готово</button>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label className="text-kraken-disabled text-xs uppercase tracking-wider mb-2 block">Категория</label>
              <select
                value={selectedCat}
                onChange={e => setSelectedCat(e.target.value)}
                className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
              >
                {categories.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="bg-kraken-red/10 border border-kraken-red/30 rounded-xl px-4 py-3 mb-4">
              <div className="text-kraken-red text-xs font-semibold flex items-center gap-1.5">
                <AlertTriangle size={12} /> Внимание
              </div>
              <div className="text-kraken-muted text-xs mt-1">
                Все люди категории будут удалены вместе с фотографиями и эмбеддингами. Отменить невозможно.
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost flex-1 text-sm py-2">Отмена</button>
              <button
                onClick={handleDelete}
                disabled={deleting || !selectedCat}
                className="flex-1 flex items-center justify-center gap-2 text-sm py-2 rounded-lg bg-kraken-red/20 text-kraken-red hover:bg-kraken-red/30 font-semibold disabled:opacity-50"
              >
                {deleting
                  ? <><RefreshCw size={14} className="animate-spin" /> Удаление...</>
                  : <><Trash2 size={14} /> Удалить всех</>}
              </button>
            </div>
          </>
        )}
      </div>

      {confirmState && (
        <ConfirmModal
          isOpen={confirmState.isOpen}
          title={confirmState.title}
          message={confirmState.message}
          isDamage={confirmState.isDamage}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {alertState && (
        <AlertModal
          isOpen={alertState.isOpen}
          title={alertState.title}
          message={alertState.message}
          onClose={() => setAlertState(null)}
        />
      )}
    </div>
  )
}
