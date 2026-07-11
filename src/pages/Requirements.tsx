import {
  Cpu, HardDrive, Monitor, Camera, Sun, Image, Zap,
  CheckCircle, AlertTriangle, XCircle, Info, ChevronDown, ChevronUp
} from 'lucide-react'
import { useState } from 'react'

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  color = 'text-kraken-purple',
  children,
  defaultOpen = true,
}: {
  icon: React.ElementType
  title: string
  color?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="panel overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-5 text-left hover:bg-kraken-hover transition-colors"
      >
        <Icon size={18} className={color} />
        <span className="text-kraken-text font-semibold flex-1">{title}</span>
        {open ? <ChevronUp size={16} className="text-kraken-muted" /> : <ChevronDown size={16} className="text-kraken-muted" />}
      </button>
      {open && <div className="px-5 pb-5 min-w-0 overflow-hidden">{children}</div>}
    </div>
  )
}

// ── Requirement row ───────────────────────────────────────────────────────────

function Req({
  label,
  min,
  rec,
}: {
  label: string
  min: string
  rec?: string
}) {
  return (
    <div className="py-4 border-b border-kraken-border last:border-0 min-w-0">
      <h3 className="text-kraken-muted text-xs uppercase tracking-wide font-bold border-l-2 border-kraken-purple pl-2 mb-3">
        {label}
      </h3>
      <div className="kraken-req-group">
        <div className="kraken-req-line">
          <span className="kraken-req-tag kraken-req-tag--min">Минимум</span>
          <span className="kraken-req-value kraken-req-value--min">{min}</span>
        </div>
        {rec ? (
          <div className="kraken-req-line">
            <span className="kraken-req-tag kraken-req-tag--rec">Рекомендуется</span>
            <span className="kraken-req-value kraken-req-value--rec">{rec}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function Good({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <CheckCircle size={14} className="text-kraken-green flex-shrink-0 mt-0.5" />
      <span className="text-kraken-text text-sm">{children}</span>
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />
      <span className="text-kraken-muted text-sm">{children}</span>
    </div>
  )
}

function Bad({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <XCircle size={14} className="text-kraken-red flex-shrink-0 mt-0.5" />
      <span className="text-kraken-muted text-sm">{children}</span>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <Info size={14} className="text-kraken-blue flex-shrink-0 mt-0.5" />
      <span className="text-kraken-muted text-sm">{children}</span>
    </div>
  )
}

// ── Tech stack table ──────────────────────────────────────────────────────────

function TechRow({ name, version, desc }: { name: string; version: string; desc: string }) {
  return (
    <div className="py-2.5 border-b border-kraken-border last:border-0 space-y-1 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-kraken-text text-sm font-mono break-all">{name}</span>
        <span className="text-kraken-purple text-xs font-bold shrink-0">{version}</span>
      </div>
      <p className="text-kraken-muted text-xs leading-relaxed break-words">{desc}</p>
    </div>
  )
}

// ── Threshold table ───────────────────────────────────────────────────────────

function ThreshRow({
  pct, cosine, label, color, note,
}: {
  pct: string; cosine: string; label: string; color: string; note: string
}) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-kraken-hover mb-1.5 space-y-1.5 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-xs font-bold shrink-0 ${color}`}>{pct}</span>
        <span className="text-kraken-disabled text-xs font-mono shrink-0">{cosine}</span>
        <span className="text-kraken-disabled text-[10px] leading-snug break-words">{note}</span>
      </div>
      <p className="text-kraken-text text-xs leading-relaxed break-words">{label}</p>
    </div>
  )
}

function ScaleRow({ cameras, workers, note }: { cameras: string; workers: string; note: string }) {
  return (
    <div className="py-2.5 border-b border-kraken-border last:border-0 text-xs min-w-0 sm:grid sm:grid-cols-[5rem_4rem_minmax(0,1fr)] sm:gap-x-4 sm:items-start">
      <span className="text-kraken-purple font-bold block mb-0.5 sm:mb-0">{cameras}</span>
      <span className="text-kraken-text font-mono block mb-0.5 sm:mb-0">{workers}</span>
      <span className="text-kraken-muted leading-relaxed break-words block">{note}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Requirements() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto flex flex-col gap-5 pb-8 p-4">

        <div className="flex items-center gap-3">
          <h1 className="text-kraken-text text-xl font-bold">Системные требования</h1>
          <span className="text-xs text-kraken-disabled bg-kraken-hover px-2 py-0.5 rounded-full">
            Kraken Security System
          </span>
        </div>

        {/* ── Описание системы ── */}
        <Section icon={Info} title="Описание системы" color="text-kraken-blue">
          <div className="text-kraken-text text-sm leading-relaxed space-y-3">
            <p>
              <strong className="text-kraken-purple">Kraken Security System</strong> — это современная автономная система распознавания лиц,
              предназначенная для обеспечения безопасности и аналитики в режиме реального времени. Система способна обрабатывать
              множество видеопотоков одновременно, идентифицировать людей по базе лиц и мгновенно оповещать о событиях.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <div className="bg-kraken-hover p-3 rounded-lg">
                <div className="text-kraken-purple font-bold text-xs mb-1">Детектор SCRFD</div>
                <div className="text-xs text-kraken-muted">Использует передовой алгоритм SCRFD, который находит лица даже в масках, под углом или при плохом освещении.</div>
              </div>
              <div className="bg-kraken-hover p-3 rounded-lg">
                <div className="text-kraken-green font-bold text-xs mb-1">Скорость</div>
                <div className="text-xs text-kraken-muted">Использование FAISS и ONNX позволяет искать по базе из 100 000+ лиц за миллисекунды.</div>
              </div>
              <div className="bg-kraken-hover p-3 rounded-lg">
                <div className="text-kraken-blue font-bold text-xs mb-1">Масштабируемость</div>
                <div className="text-xs text-kraken-muted leading-relaxed">
                  На одном сервере комфортно 4–8 RTSP/USB камер; до 16 — при мощном CPU и GPU. AI-нагрузка масштабируется пулом воркеров (до 4 на NVIDIA, до 2 на AMD DirectML).
                </div>
              </div>
              <div className="bg-kraken-hover p-3 rounded-lg">
                <div className="text-yellow-400 font-bold text-xs mb-1">Умная запись</div>
                <div className="text-xs text-kraken-muted">Автоматическая запись коротких роликов при обнаружении конкретных лиц.</div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── Технологии ── */}
        <Section icon={Zap} title="Технологический стек и Детекция" color="text-kraken-purple">
          <div className="mb-6 bg-kraken-base rounded-lg p-4 border-l-4 border-kraken-purple">
            <div className="text-kraken-text font-bold text-sm mb-2">Uniface 2.0 (Core AI Engine)</div>
            <p className="text-xs text-kraken-muted leading-relaxed mb-3">
              Сердцем системы является проприетарный движок <strong className="text-kraken-purple">Uniface 2.0</strong>, 
              объединяющий последние достижения в области нейронных сетей для работы с лицами.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[11px]">
              <div className="space-y-2">
                <div className="text-kraken-text font-semibold uppercase tracking-wider text-[9px]">Детекция (SCRFD)</div>
                <ul className="space-y-1 text-kraken-muted">
                  <li className="flex items-center gap-2"><CheckCircle size={10} className="text-kraken-green" /> Скорость: до 2мс на кадр</li>
                  <li className="flex items-center gap-2"><CheckCircle size={10} className="text-kraken-green" /> Лица в масках и под углом</li>
                  <li className="flex items-center gap-2"><CheckCircle size={10} className="text-kraken-green" /> Контровый и сложный свет</li>
                </ul>
              </div>
              <div className="space-y-2">
                <div className="text-kraken-text font-semibold uppercase tracking-wider text-[9px]">Распознавание (ArcFace)</div>
                <ul className="space-y-1 text-kraken-muted">
                  <li className="flex items-center gap-2"><CheckCircle size={10} className="text-kraken-green" /> Точность: 99.83% на LFW</li>
                  <li className="flex items-center gap-2"><CheckCircle size={10} className="text-kraken-green" /> 512-мерные эмбеддинги</li>
                  <li className="flex items-center gap-2"><CheckCircle size={10} className="text-kraken-green" /> Устойчивость к возрасту</li>
                </ul>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-kraken-border">
              <p className="text-[10px] text-kraken-disabled italic leading-relaxed">
                Оптимальный режим: детекция SCRFD на CPU (ограничение ONNX DirectML), распознавание ArcFace — CUDA (NVIDIA), DirectML (AMD/Intel) или CPU.
              </p>
            </div>
          </div>
          <div className="mb-3">
            <div className="text-kraken-disabled text-[10px] uppercase tracking-widest mb-2">Backend</div>
            <TechRow name="Python"            version="3.13.6"    desc="Основной язык бэкенда" />
            <TechRow name="FastAPI"           version="0.136.0"   desc="REST API + WebSocket сервер" />
            <TechRow name="PostgreSQL"        version="16.6"      desc="База данных (portable, порт 5433)" />
            <TechRow name="SQLAlchemy"        version="2.0.41"    desc="ORM для работы с БД" />
            <TechRow name="uniface"           version="2.0.0"     desc="Детекция и распознавание лиц" />
            <TechRow name="onnxruntime"       version="1.21.0"    desc="Инференс AI моделей (CUDA/CPU)" />
            <TechRow name="faiss-cpu"         version="1.10.0"    desc="Векторный поиск по эмбеддингам" />
            <TechRow name="opencv-python"     version="4.11.0.86" desc="Захват видео, обработка кадров" />
            <TechRow name="numpy"             version="2.3.2"     desc="Матричные операции" />
          </div>
          <div className="mb-3">
            <div className="text-kraken-disabled text-[10px] uppercase tracking-widest mb-2">Frontend</div>
            <TechRow name="React"             version="19"        desc="UI фреймворк" />
            <TechRow name="TypeScript"        version="5.8"       desc="Типизация" />
            <TechRow name="Vite"              version="6"         desc="Сборщик" />
            <TechRow name="Tailwind CSS"      version="3"         desc="Стили" />
          </div>
          <div>
            <div className="text-kraken-disabled text-[10px] uppercase tracking-widest mb-2">AI Модели</div>
            <TechRow name="scrfd_10g.onnx"       version="16 MB"   desc="Детекция лиц в видеопотоке (95.16% WIDER FACE Hard)" />
            <TechRow name="scrfd_500m.onnx"      version="2.4 MB"  desc="Детекция лиц на фото (лёгкая модель)" />
            <TechRow name="arcface_resnet.onnx"  version="166 MB"  desc="Распознавание лиц (99.83% LFW, 97.25% IJB-C)" />
          </div>
          <div className="mt-3 bg-kraken-base rounded-lg p-3">
            <Note>Модели скачиваются автоматически при первом запуске в <span className="font-mono text-kraken-text">~/.uniface/models/</span></Note>
          </div>
        </Section>

        {/* ── Железо ── */}
        <Section icon={Cpu} title="Требования к серверу (ПК)" color="text-kraken-blue">
          <Req label="Процессор"       min="4 ядра / 8 потоков, 2.5 GHz"   rec="8 ядер / 16 потоков (Ryzen 7 / Core i7+)" />
          <Req label="Оперативная память" min="8 GB RAM"                    rec="16 GB RAM" />
          <Req label="Диск"            min="10 GB (HDD/SSD)"                rec="100 GB+ SSD (видеоархив ~1–3 GB/день)" />
          <Req label="Видеокарта"      min="Любая (CPU режим)"              rec="NVIDIA GPU (8GB+ VRAM для 10+ камер)" />
          <Req label="ОС"              min="Windows 10 / 11 (64-bit)"       rec="Windows 11, последние обновления" />
          <Req label="Сеть"            min="100 Мбит/с LAN"                 rec="1 Гбит/с (Порты: 8000, 5433, 554)" />

          <div className="mt-4 space-y-2 bg-kraken-hover/20 p-4 rounded-xl border border-kraken-border">
            <div className="flex items-center gap-2 text-kraken-purple font-bold text-xs uppercase tracking-widest mb-1">
              <Zap size={14} /> Сетевые настройки
            </div>
            <Good>Порт 8000 — Основной интерфейс и API системы.</Good>
            <Good>Порт 5433 — Внутренний порт PostgreSQL (только localhost).</Good>
            <Good>Порт 554 — Стандартный порт RTSP для получения видеопотока.</Good>
            <Note>Для удаленного доступа пробросьте порт 8000 на роутере.</Note>
          </div>

          <div className="mt-4 space-y-2 bg-kraken-hover/20 p-4 rounded-xl border border-kraken-border">
            <div className="flex items-center gap-2 text-kraken-purple font-bold text-xs uppercase tracking-widest mb-1">
              <Zap size={14} /> GPU Ускорение
            </div>
            <Good>NVIDIA GPU — Встроено. Программа сама установит необходимые библиотеки и пакеты.</Good>
            <Good>Гибридный режим — Детекция лиц на CPU, Распознавание на GPU. Это исключает задержки и экономит видеопамять.</Good>
            <Good>Автоматическая установка — При первом запуске подбирается onnxruntime-gpu, DirectML или CPU.</Good>
            <Note>Политика «stable» — только CPU (максимальная стабильность). «auto» — CUDA/DirectML при наличии.</Note>
            <Warn>AMD/Intel: до 2 параллельных AI-воркеров с DirectML (защита от сбоев драйвера).</Warn>
          </div>
        </Section>

        {/* ── Камеры ── */}
        <Section icon={Camera} title="Требования к видеокамерам" color="text-kraken-green">
          <Req label="Разрешение"       min="640×480 (VGA)"              rec="1920×1080 (Full HD) или 1280×720 (HD)" />
          <Req label="Частота кадров"   min="10 FPS"                     rec="25–30 FPS" />
          <Req label="Размер лица"      min="50×50 пикселей в кадре"     rec="100×100 пикселей и более" />
          <Req label="Тип подключения"  min="USB UVC или RTSP"           rec="RTSP H.264 (IP-камера)" />
          <Req label="Высота установки" min="1.8–3.0 м от пола"          rec="2.0–2.5 м от пола" />
          <Req label="Угол наклона"     min="0–30° вниз"                 rec="10–20° вниз" />
          <Req label="Расстояние"       min="0.5–6 м до лица"            rec="1.5–2.5 м до лица" />
          <Req label="Ночное видение"   min="Не обязательно"             rec="ИК-подсветка или WDR матрица" />

          <div className="mt-4 space-y-1">
            <Good>RTSP H.264 IP-камеры — самый стабильный поток, минимальная нагрузка</Good>
            <Good>RTSP H.265 — поддерживается, но требует больше ресурсов CPU для декодирования</Good>
            <Good>USB камеры — простое подключение, подходит для входных групп</Good>
            <Good>WDR (Wide Dynamic Range) — критически важно при работе против света</Good>
            <Warn>Широкоугольные объективы (fisheye) — лица по краям искажены, точность ниже</Warn>
            <Warn>Камера направлена против источника света — лицо в тени, детекция хуже</Warn>
            <Bad>Разрешение ниже 320×240 — лица не детектируются надёжно</Bad>
            <Bad>Менее 5 FPS — система пропускает людей при быстром движении</Bad>
          </div>

          <div className="mt-4 bg-kraken-base rounded-lg p-3">
            <div className="text-kraken-muted text-xs font-semibold mb-2">Для ночных клубов / тёмных помещений</div>
            <Good>ИК-подсветка или встроенная LED подсветка</Good>
            <Good>Чувствительность матрицы ≤ 0.01 lux (Sony Starvis и аналоги)</Good>
            <Good>WDR для работы при цветном освещении (прожекторы, лазеры)</Good>
            <Note>Рекомендуется не более 8–16 камер на один ПК. RTSP H.264 и гигабитная сеть обязательны при 4+ потоках.</Note>
          </div>
        </Section>

        {/* ── Освещение ── */}
        <Section icon={Sun} title="Требования к освещению" color="text-yellow-400">
          <Req label="Освещённость лица"  min="≥ 50 lux (тусклый свет)"    rec="200–500 lux (равномерное)" />
          <Req label="Направление света"  min="Любое (не строго сзади)"     rec="Фронтальное или 45° сбоку" />
          <Req label="Цветовая температура" min="Любая"                     rec="Нейтральная (система работает в YCrCb)" />
          <Req label="Тени на лице"        min="До 40% площади лица"        rec="Минимальные тени" />

          <div className="mt-4 space-y-1">
            <Good>Цветное освещение (RGB прожекторы) — CLAHE нормализует контраст автоматически</Good>
            <Good>Смешанное освещение — система адаптируется через YCrCb преобразование</Good>
            <Warn>Мигающий стробоскоп — снижает качество кадров, возможны пропуски</Warn>
            <Warn>Яркие пятна на лице (прожектор в упор) — пересвет снижает точность</Warn>
            <Bad>Освещение строго сзади (силуэт) — лицо не детектируется</Bad>
            <Bad>Полная темнота без ИК — детекция невозможна</Bad>
          </div>

          <div className="mt-4 bg-kraken-base rounded-lg p-3">
            <div className="text-kraken-muted text-xs font-semibold mb-2">Встроенная компенсация (CLAHE)</div>
            <Note>Видеопоток: мягкая нормализация (clipLimit=1.5) — только на кропе лица</Note>
            <Note>Фотографии: более агрессивная (clipLimit=2.0) — для архивных и тёмных фото</Note>
            <Note>Обрабатывается только область лица, не весь кадр — быстро и без артефактов</Note>
          </div>
        </Section>

        {/* ── Фотографии ── */}
        <Section icon={Image} title="Требования к фотографиям для базы лиц" color="text-kraken-purple">
          <Req label="Формат"           min="JPEG, PNG, BMP, WEBP"         rec="JPEG (качество ≥ 85%)" />
          <Req label="Разрешение"       min="100×100 пикселей (лицо)"      rec="400×400 пикселей и выше" />
          <Req label="Лицо в кадре"     min="≥ 30% площади фото"           rec="≥ 50% площади, фронтальный ракурс" />
          <Req label="Поворот головы"   min="До 45° от фронтального"       rec="До 20° (почти прямо в камеру)" />
          <Req label="Фокус"            min="Допускается лёгкое размытие"  rec="Чёткое изображение" />
          <Req label="Количество фото"  min="1 фото на человека"           rec="3–5 фото (разные ракурсы и освещение)" />

          <div className="mt-4 space-y-1">
            <Good>Фото с живой камеры — лучший вариант, условия совпадают с реальным использованием</Good>
            <Good>Несколько фото с разным освещением — значительно повышает точность</Good>
            <Good>Система автоматически накапливает снимки с камер (до 10 фото на человека)</Good>
            <Warn>Профильное фото (поворот &gt; 45°) — эмбеддинг менее точный</Warn>
            <Warn>Очень маленькое лицо (&lt; 50×50 px) — детектор может не найти</Warn>
            <Bad>Лицо перекрыто маской, рукой, волосами — эмбеддинг не извлекается</Bad>
            <Bad>Сильный пересвет или недосвет — детекция не срабатывает</Bad>
          </div>

          <div className="mt-4 bg-kraken-base rounded-lg p-3">
            <div className="text-kraken-muted text-xs font-semibold mb-2">Автоматическая обработка при загрузке</div>
            <div className="space-y-1 text-xs text-kraken-muted">
              <div className="flex items-center gap-2"><span className="text-kraken-purple font-bold">1</span> Детекция лица (SCRFD_500M)</div>
              <div className="flex items-center gap-2"><span className="text-kraken-purple font-bold">2</span> Вырезание с паддингом 40% (захват лба и подбородка)</div>
              <div className="flex items-center gap-2"><span className="text-kraken-purple font-bold">3</span> Апскейл до минимум 256×256 если лицо маленькое</div>
              <div className="flex items-center gap-2"><span className="text-kraken-purple font-bold">4</span> CLAHE нормализация освещения</div>
              <div className="flex items-center gap-2"><span className="text-kraken-purple font-bold">5</span> Face alignment по 5 ключевым точкам</div>
              <div className="flex items-center gap-2"><span className="text-kraken-purple font-bold">6</span> Генерация ~12 аугментированных эмбеддингов</div>
            </div>
          </div>
        </Section>

        {/* ── Пороги ── */}
        <Section icon={Monitor} title="Пороги распознавания" color="text-kraken-blue" defaultOpen={false}>
          <p className="text-kraken-muted text-sm mb-4">
            Минимальный процент совпадения для подтверждения личности.
            Настраивается в разделе <strong className="text-kraken-text">Система → Чувствительность</strong>.
          </p>

          <ThreshRow pct="0–20%"   cosine="0.28–0.39" label="Очень мягко — много ложных совпадений"          color="text-kraken-red"    note="Не рекомендуется" />
          <ThreshRow pct="20–30%"  cosine="0.39–0.45" label="Мягко — плохое освещение, старые фото"           color="text-yellow-400"    note="Осторожно" />
          <ThreshRow pct="30–50%"  cosine="0.45–0.57" label="Оптимально — ночной клуб, стандарт"              color="text-kraken-green"  note="✓ Рекомендуется" />
          <ThreshRow pct="50–65%"  cosine="0.57–0.65" label="Строго — хорошее освещение, качественные фото"   color="text-kraken-blue"   note="Меньше ложных" />
          <ThreshRow pct="65–100%" cosine="0.65–0.85" label="Максимальная точность — идеальные условия"        color="text-kraken-purple" note="Много пропусков" />

          <div className="mt-4 space-y-1">
            <Note>BLACKLIST категория: порог автоматически снижается на 8% для быстрого срабатывания</Note>
            <Note>Подтверждение: 3 последовательных кадра перед созданием события (защита от ложных)</Note>
            <Note>Cooldown: 30 секунд между событиями одного человека</Note>
          </div>
        </Section>

        {/* ── Производительность ── */}
        <Section icon={HardDrive} title="Производительность и масштабируемость" color="text-kraken-green" defaultOpen={false}>
          <Req label="Камеры"              min="1 камера"                   rec="4–8 на сервер; до 16 при NVIDIA GPU и 1 Гбит/с" />
          <Req label="База лиц"            min="1 человек"                  rec="До 100 000 эмбеддингов (FAISS)" />
          <Req label="AI воркеры"          min="1 воркер"                   rec="до 4 (NVIDIA) / до 2 (AMD DirectML)" />
          <Req label="Задержка AI"         min="~0.8–1.4 с на кадр (CPU)"    rec="~0.03–0.08 с (CUDA, 1 лицо)" />
          <Req label="Частота AI"          min="Каждый 20-й кадр (~2.5/с)"  rec="AI_FRAME_EVERY=20 при 30 FPS" />
          <Req label="Хранение записей"    min="Авто-удаление через 90 дней" rec="Настраивается вручную" />

          <div className="mt-4 bg-kraken-base rounded-lg p-3 border border-kraken-border">
            <div className="text-kraken-muted text-[10px] uppercase tracking-widest mb-2">
              Масштабирование AI-пула (автоматически)
            </div>
            <div className="hidden sm:grid sm:grid-cols-[5rem_4rem_minmax(0,1fr)] gap-x-3 text-[10px] text-kraken-disabled uppercase mb-1">
              <span>Камер</span>
              <span>Воркеров</span>
              <span>Примечание</span>
            </div>
            <ScaleRow cameras="1" workers="1" note="Минимальная нагрузка" />
            <ScaleRow cameras="2–4" workers="2" note="Типичный офис / вход" />
            <ScaleRow cameras="5–8" workers="3" note="Средний объект" />
            <ScaleRow cameras="9–16" workers="4*" note="* макс. 2 воркера на AMD/Intel DirectML; выше 16 камер — несколько серверов Kraken" />
          </div>

          <div className="mt-4 space-y-1">
            <Good>FAISS IndexFlatIP — точный поиск, масштабируется до 100 000+ эмбеддингов</Good>
            <Good>Thread-local ONNX — отдельная сессия на каждый AI-воркер</Good>
            <Good>RLock на FAISS — параллельное чтение из нескольких воркеров</Good>
            <Warn>Более 16 камер на один ПК — растёт очередь AI и задержка; несколько серверов или снижение разрешения / AI_FRAME_EVERY</Warn>
            <Note>Видеозаписи: ~1–3 GB в сутки на камеру (зависит от активности)</Note>
            <Note>PostgreSQL: только localhost (порт 5433)</Note>
          </div>
        </Section>

        {/* ── Что нужно знать ── */}
        <Section icon={Zap} title="Что нужно знать" color="text-kraken-purple">
          <div className="space-y-4">
            <div className="bg-kraken-base rounded-lg p-4 border-l-4 border-kraken-purple">
              <div className="text-kraken-text font-bold text-sm mb-2">Особенности ИИ</div>
              <p className="text-xs text-kraken-muted leading-relaxed">
                Система использует вероятностные модели. Это означает, что распознавание не является 100% точным и зависит от множества факторов: ракурса, освещения, качества фото и даже макияжа. Для критически важных зон всегда рекомендуется использовать подтверждение оператором.
              </p>
            </div>

            <div className="bg-kraken-base rounded-lg p-4 border-l-4 border-kraken-blue">
              <div className="text-kraken-text font-bold text-sm mb-2">Приватность и данные</div>
              <p className="text-xs text-kraken-muted leading-relaxed">
                Все биометрические данные (эмбеддинги) хранятся локально в зашифрованном виде. Оригиналы фотографий также не покидают сервер. Вы несете ответственность за соблюдение местного законодательства (например, ФЗ-152 или GDPR) при использовании систем видеонаблюдения.
              </p>
            </div>

            <div className="bg-kraken-base rounded-lg p-4 border-l-4 border-kraken-green">
              <div className="text-kraken-text font-bold text-sm mb-2">Стабильность работы</div>
              <p className="text-xs text-kraken-muted leading-relaxed">
                Система Kraken спроектирована для работы 24/7. Встроены механизмы автоматического перезапуска при падении, очистки старых логов и записей. Рекомендуется использовать ИБП (источник бесперебойного питания) для сервера и камер.
              </p>
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}
