import { useState } from 'react'
import { Video, Users, BookImage, Activity, Camera, Settings, Monitor, Grid2X2, BookOpen, Tag } from 'lucide-react'
import logoImg from '../assets/images/einfach_logo_1783510147919.jpg'

interface SidebarProps {
  currentPage: string
  onNavigate: (page: string) => void
  onProjection?: () => void
  projectionActive?: boolean
}

export default function Sidebar({ currentPage, onNavigate, onProjection, projectionActive }: SidebarProps) {
  const [logoError, setLogoError] = useState(false)

  return (
    <div className="w-56 h-screen bg-kraken-base flex flex-col border-r border-kraken-border flex-shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 flex items-center gap-3 border-b border-kraken-border">
        <div className="w-12 h-12 rounded-full bg-black flex items-center justify-center flex-shrink-0 overflow-hidden shadow-glow-purple text-xl">
          {logoError ? (
            '🐙'
          ) : (
            <img
              src={logoImg}
              alt="Einfach Jugend"
              className="w-full h-full object-cover rounded-full"
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
            />
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <div className="text-kraken-text font-bold text-base leading-none tracking-wider uppercase flex items-center gap-1.5">
            <span className="text-kraken-purple font-black">KRAKEN</span>
          </div>
          <div className="text-kraken-disabled text-[9px] tracking-wider uppercase mt-1">Security Engine</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 flex flex-col gap-0.5 overflow-y-auto">

        {/* Мониторинг */}
        <div className="text-kraken-disabled text-[10px] uppercase tracking-widest px-3 pt-2 pb-1.5">
          Мониторинг
        </div>
        <NavItem id="live"       label="Live монитор"  icon={Video}     current={currentPage} onNavigate={onNavigate} />
        <NavItem id="multicam"  label="Все камеры"    icon={Grid2X2}   current={currentPage} onNavigate={onNavigate} />

        {/* База данных */}
        <div className="text-kraken-disabled text-[10px] uppercase tracking-widest px-3 pt-4 pb-1.5">
          База данных
        </div>
        <NavItem id="people"     label="Люди"         icon={Users}      current={currentPage} onNavigate={onNavigate} />
        <NavItem id="chronicle"  label="Фотохроника"  icon={BookImage}  current={currentPage} onNavigate={onNavigate} />
        <NavItem id="recordings" label="Умная съёмка"  icon={Video}      current={currentPage} onNavigate={onNavigate} />
        <NavItem id="events"     label="События"      icon={Activity}   current={currentPage} onNavigate={onNavigate} />
        <NavItem id="categories" label="Категории"    icon={Tag}        current={currentPage} onNavigate={onNavigate} />

        {/* Настройки */}
        <div className="text-kraken-disabled text-[10px] uppercase tracking-widest px-3 pt-4 pb-1.5">
          Настройки
        </div>
        <NavItem id="cameras"       label="Камеры"        icon={Camera}    current={currentPage} onNavigate={onNavigate} />
        <NavItem id="requirements"  label="Требования"    icon={BookOpen}  current={currentPage} onNavigate={onNavigate} />
        <NavItem id="settings"      label="Система"       icon={Settings}  current={currentPage} onNavigate={onNavigate} />
      </nav>

      {/* Передать на экран */}
      <div className="p-3 border-t border-kraken-border">
        <button
          onClick={onProjection}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors ${
            projectionActive
              ? 'bg-kraken-purple/30 border-kraken-purple text-kraken-purple'
              : 'bg-kraken-purple/20 border-kraken-purple/40 text-kraken-purple hover:bg-kraken-purple/30'
          }`}
        >
          <Monitor size={15} />
          <span className="text-xs font-semibold tracking-wide uppercase">Передать на экран</span>
        </button>
      </div>
    </div>
  )
}

function NavItem({
  id, label, icon: Icon, current, onNavigate,
}: {
  id: string; label: string; icon: React.ElementType
  current: string; onNavigate: (p: string) => void
}) {
  const active = current === id
  return (
    <button
      onClick={() => onNavigate(id)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
        active
          ? 'bg-kraken-purple/15 text-kraken-text border-l-2 border-kraken-purple pl-[10px]'
          : 'text-kraken-muted hover:text-kraken-text hover:bg-kraken-hover'
      }`}
    >
      <Icon size={16} className={active ? 'text-kraken-purple' : ''} />
      <span className="text-sm">{label}</span>
    </button>
  )
}
