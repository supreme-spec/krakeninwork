 /**
 * Categories — управление категориями людей.
 * Добавление, редактирование, удаление, настройка детектирования и алертов.
 */
import { useState } from 'react'
import { Plus, Edit2, Trash2, Save, X, RefreshCw, Bell, BellOff, Eye, EyeOff } from 'lucide-react'
import { apiFetch } from '../api/client'
import type { PersonCategory } from '../types'
import { useCategories, invalidateCategoriesCache } from '../hooks/useCategories'
import ConfirmModal, { AlertModal } from '../components/ConfirmModal'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e',
  '#3b82f6', '#a855f7', '#ec4899', '#6b7280',
  '#14b8a6', '#84cc16', '#06b6d4', '#8b5cf6',
]

const PRESET_BG: Record<string, string> = {
  '#ef4444': '#450a0a', '#f97316': '#431407', '#f59e0b': '#451a03',
  '#22c55e': '#052e16', '#3b82f6': '#172554', '#a855f7': '#2e1065',
  '#ec4899': '#500724', '#6b7280': '#111827', '#14b8a6': '#042f2e',
  '#84cc16': '#1a2e05', '#06b6d4': '#083344', '#8b5cf6': '#2e1065',
}

interface CategoryFormData {
  code: string
  label: string
  color: string
  bg_color: string
  is_alert: boolean
  alert_sound: string
  alert_volume: number
  detect_enabled: boolean
  sort_order: number
}

const emptyForm = (): CategoryFormData => ({
  code: '', label: '', color: '#6b7280', bg_color: '#1f2937',
  is_alert: false, alert_sound: 'off', alert_volume: 0.7,
  detect_enabled: true, sort_order: 100,
})

export default function Categories() {
  const { categories, reload } = useCategories()
  const [editing, setEditing] = useState<PersonCategory | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<CategoryFormData>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
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

  const openEdit = (cat: PersonCategory) => {
    setEditing(cat)
    setForm({
      code: cat.code, label: cat.label, color: cat.color, bg_color: cat.bg_color,
      is_alert: cat.is_alert, alert_sound: cat.alert_sound, alert_volume: cat.alert_volume,
      detect_enabled: cat.detect_enabled, sort_order: cat.sort_order,
    })
    setShowAdd(false)
    setMsg('')
  }

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm())
    setShowAdd(true)
    setMsg('')
  }

  const closeForm = () => {
    setEditing(null)
    setShowAdd(false)
    setMsg('')
  }

  const handleColorPick = (color: string) => {
    setForm(f => ({ ...f, color, bg_color: PRESET_BG[color] ?? '#1f2937' }))
  }

  const handleSave = async () => {
    if (!form.label.trim()) { setMsg('❌ Введите название'); return }
    if (showAdd && !form.code.trim()) { setMsg('❌ Введите код'); return }

    setSaving(true); setMsg('')
    try {
      if (editing) {
        await apiFetch(`/categories/${editing.code}`, {
          method: 'PUT',
          body: JSON.stringify({
            label: form.label, color: form.color, bg_color: form.bg_color,
            is_alert: form.is_alert, alert_sound: form.alert_sound,
            alert_volume: form.alert_volume, detect_enabled: form.detect_enabled,
            sort_order: form.sort_order,
          }),
        })
        setMsg('✅ Сохранено')
      } else {
        await apiFetch('/categories/', {
          method: 'POST',
          body: JSON.stringify({ ...form, code: form.code.toUpperCase().trim() }),
        })
        setMsg('✅ Категория создана')
      }
      invalidateCategoriesCache()
      await reload()
      closeForm()
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (code: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Удалить категорию',
      message: `Удалить категорию "${code}"? Люди с этой категорией останутся, но категория будет отображаться как неизвестная.`,
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setDeleting(code)
        try {
          await apiFetch(`/categories/${code}`, { method: 'DELETE' })
          invalidateCategoriesCache()
          await reload()
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: `Ошибка: ${e.message}` })
        } finally {
          setDeleting(null)
        }
      }
    })
  }

  const handleToggleDetect = async (cat: PersonCategory) => {
    try {
      await apiFetch(`/categories/${cat.code}`, {
        method: 'PUT',
        body: JSON.stringify({ detect_enabled: !cat.detect_enabled }),
      })
      invalidateCategoriesCache()
      await reload()
    } catch {}
  }

  const handleToggleAlert = async (cat: PersonCategory) => {
    try {
      await apiFetch(`/categories/${cat.code}`, {
        method: 'PUT',
        body: JSON.stringify({ is_alert: !cat.is_alert }),
      })
      invalidateCategoriesCache()
      await reload()
    } catch {}
  }

  return (
    <div className="h-full flex gap-4 overflow-hidden">

      {/* ── Список категорий ── */}
      <div className={`flex flex-col gap-3 overflow-hidden transition-all ${(editing || showAdd) ? 'w-[55%]' : 'flex-1'}`}>
        <div className="flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-kraken-text text-xl font-bold">Категории</h1>
            <p className="text-kraken-muted text-xs mt-0.5">Управление группами людей, детектированием и алертами</p>
          </div>
          <div className="flex gap-2">
            <button onClick={reload} className="btn-ghost flex items-center gap-1.5 text-xs py-1.5 px-3">
              <RefreshCw size={12} />
            </button>
            <button onClick={openAdd} className="btn-primary flex items-center gap-1.5 text-sm py-2 px-3">
              <Plus size={14} /> Добавить
            </button>
          </div>
        </div>

        <div className="panel flex-1 overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1">
            <table className="w-full">
              <thead className="sticky top-0 bg-kraken-panel z-10">
                <tr className="text-kraken-disabled text-[10px] uppercase tracking-wider border-b border-kraken-border">
                  <th className="px-3 py-2 text-left">Категория</th>
                  <th className="px-3 py-2 text-center">Детект.</th>
                  <th className="px-3 py-2 text-center">Алерт</th>
                  <th className="px-3 py-2 text-center">Звук</th>
                  <th className="px-3 py-2 text-center">Порядок</th>
                  <th className="px-3 py-2 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => (
                  <tr key={cat.code}
                    className={`border-b border-kraken-border hover:bg-kraken-hover transition-colors ${editing?.code === cat.code ? 'bg-kraken-purple/10' : ''}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                        <div>
                          <div className="text-kraken-text text-sm font-semibold">{cat.label}</div>
                          <div className="text-kraken-disabled text-[10px] font-mono">{cat.code}</div>
                        </div>
                        {cat.is_system && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-kraken-hover text-kraken-disabled uppercase tracking-wide">система</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => handleToggleDetect(cat)}
                        className={`p-1 rounded transition-colors ${cat.detect_enabled ? 'text-kraken-green hover:text-kraken-green/70' : 'text-kraken-disabled hover:text-kraken-muted'}`}
                        title={cat.detect_enabled ? 'Детектирование включено' : 'Детектирование выключено'}>
                        {cat.detect_enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => handleToggleAlert(cat)}
                        className={`p-1 rounded transition-colors ${cat.is_alert ? 'text-kraken-red hover:text-kraken-red/70' : 'text-kraken-disabled hover:text-kraken-muted'}`}
                        title={cat.is_alert ? 'Алерт включён' : 'Алерт выключен'}>
                        {cat.is_alert ? <Bell size={14} /> : <BellOff size={14} />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-kraken-muted text-xs">{cat.alert_sound}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-kraken-muted text-xs">{cat.sort_order}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(cat)}
                          className="p-1 rounded hover:bg-kraken-hover text-kraken-muted hover:text-kraken-purple" title="Редактировать">
                          <Edit2 size={13} />
                        </button>
                        {!cat.is_system && (
                          <button onClick={() => handleDelete(cat.code)}
                            disabled={deleting === cat.code}
                            className="p-1 rounded hover:bg-kraken-hover text-kraken-muted hover:text-kraken-red disabled:opacity-50" title="Удалить">
                            {deleting === cat.code ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-1.5 border-t border-kraken-border flex-shrink-0">
            <span className="text-kraken-disabled text-[10px]">Всего: {categories.length} категорий</span>
          </div>
        </div>
      </div>

      {/* ── Форма редактирования / добавления ── */}
      {(editing || showAdd) && (
        <div className="w-[45%] flex-shrink-0 panel overflow-y-auto">
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-kraken-text font-bold text-base">
                {editing ? `Редактировать: ${editing.label}` : 'Новая категория'}
              </h2>
              <button onClick={closeForm} className="text-kraken-muted hover:text-kraken-text">
                <X size={16} />
              </button>
            </div>

            {/* Код (только при создании) */}
            {showAdd && (
              <div>
                <label className="text-kraken-disabled text-xs uppercase tracking-wider mb-1 block">Код *</label>
                <input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                  placeholder="MY_CATEGORY"
                  className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple font-mono"
                />
                <p className="text-kraken-disabled text-[10px] mt-1">Только латиница, цифры и _. Нельзя изменить после создания.</p>
              </div>
            )}

            {/* Название */}
            <div>
              <label className="text-kraken-disabled text-xs uppercase tracking-wider mb-1 block">Название *</label>
              <input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Название категории"
                className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
              />
            </div>

            {/* Цвет */}
            <div>
              <label className="text-kraken-disabled text-xs uppercase tracking-wider mb-2 block">Цвет</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => handleColorPick(c)}
                    className={`w-10 h-10 rounded-full border-2 transition-transform hover:scale-110 ${form.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-10 h-10 rounded cursor-pointer border border-kraken-border bg-transparent" />
                <span className="text-kraken-muted text-xs font-mono">{form.color}</span>
                <span className="text-kraken-disabled text-xs mx-2">фон:</span>
                <input type="color" value={form.bg_color}
                  onChange={e => setForm(f => ({ ...f, bg_color: e.target.value }))}
                  className="w-10 h-10 rounded cursor-pointer border border-kraken-border bg-transparent" />
                <span className="text-kraken-muted text-xs font-mono">{form.bg_color}</span>
              </div>
              {/* Превью */}
              <div className="mt-2">
                <span className="text-kraken-disabled text-[10px] uppercase tracking-wider mr-2">Превью:</span>
                <span className="inline-flex items-center font-semibold rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
                  style={{ color: form.color, backgroundColor: form.bg_color, border: `1px solid ${form.color}33` }}>
                  {form.label || 'Категория'}
                </span>
              </div>
            </div>

            {/* Детектирование */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-kraken-border">
              <div>
                <div className="text-kraken-text text-sm font-medium">Детектирование</div>
                <div className="text-kraken-disabled text-xs">Распознавать людей этой категории</div>
              </div>
              <button onClick={() => setForm(f => ({ ...f, detect_enabled: !f.detect_enabled }))}
                className={`w-11 h-6 rounded-full transition-colors relative ${form.detect_enabled ? 'bg-kraken-green' : 'bg-kraken-hover'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.detect_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {/* Алерт */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-kraken-border">
              <div>
                <div className="text-kraken-text text-sm font-medium">Алерт при обнаружении</div>
                <div className="text-kraken-disabled text-xs">Показывать всплывающее уведомление</div>
              </div>
              <button onClick={() => setForm(f => ({ ...f, is_alert: !f.is_alert }))}
                className={`w-11 h-6 rounded-full transition-colors relative ${form.is_alert ? 'bg-kraken-red' : 'bg-kraken-hover'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.is_alert ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {/* Звук */}
            <div>
              <label className="text-kraken-disabled text-xs uppercase tracking-wider mb-1 block">Звук алерта</label>
              <select value={form.alert_sound}
                onChange={e => setForm(f => ({ ...f, alert_sound: e.target.value }))}
                className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple">
                <option value="off">Выключен</option>
                <option value="builtin">Встроенный</option>
                <option value="custom">Пользовательский</option>
              </select>
            </div>

            {/* Громкость */}
            {form.alert_sound !== 'off' && (
              <div>
                <label className="text-kraken-disabled text-xs uppercase tracking-wider mb-1 block">
                  Громкость: {Math.round(form.alert_volume * 100)}%
                </label>
                <input type="range" min={0} max={1} step={0.05}
                  value={form.alert_volume}
                  onChange={e => setForm(f => ({ ...f, alert_volume: parseFloat(e.target.value) }))}
                  className="w-full accent-kraken-purple" />
              </div>
            )}

            {/* Порядок */}
            <div>
              <label className="text-kraken-disabled text-xs uppercase tracking-wider mb-1 block">Порядок сортировки</label>
              <input type="number" min={1} max={999}
                value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 100 }))}
                className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple" />
            </div>

            {msg && (
              <div className={`text-sm px-3 py-2 rounded-lg ${msg.startsWith('✅') ? 'bg-kraken-green/10 text-kraken-green' : 'bg-kraken-red/10 text-kraken-red'}`}>
                {msg}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={closeForm} className="btn-ghost flex-1 text-sm py-2">Отмена</button>
              <button onClick={handleSave} disabled={saving}
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm py-2">
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
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
