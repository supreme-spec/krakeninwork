# Smart Security Monitor - Установка и Запуск

## Системные требования
- Node.js >= 20.x
- Python >= 3.10
- npm или yarn

## Шаги установки

### 1. Установка Python-зависимостей
```bash
# Убедись, что у тебя есть Python 3.10+
python --version

# Установи Python-пакеты
pip install -r requirements.txt
```

### 2. Установка Node.js-зависимостей
```bash
npm install
```

### 3. Подготовка базы данных
```bash
npx prisma generate
npx prisma db push
```

## Запуск проекта

### Рекомендуемый способ (одной командой)
```bash
npm run dev
```

Эта команда запустит два сервиса одновременно:
- **Face Server (Python/FastAPI/InsightFace)** на http://localhost:8001
- **Главный сервер (Express/Node.js)** на http://localhost:3000

### Отдельный запуск
```bash
# Только Face Server
npm run dev:face

# Только главный сервер
npm run dev:server
```

## Что изменено?
- **Удален face-api.js** (устаревший стек)
- **Добавлен Python-сервер с InsightFace** (современные модели для детекции и распознавания)
- **Добавлено логирование** (лог-файлы в директории `logs/`)
- **Миграция на Prisma** для категорий и персон (хранение данных в БД)
- **Хранение дескрипторов в БД** (не теряются при перезагрузке)

## Архитектура
```
┌─────────────┐
│   Клиент    │ (React UI)
└──────┬──────┘
       │
       │ API calls
       ↓
┌────────────────────┐
│ Express Server     │ (:3000)
│ └─ face-engine.ts  │
└──────┬─────────────┘
       │
       │ HTTP calls
       ↓
┌─────────────────────┐
│  Python FastAPI     │ (:8001)
│  └─ InsightFace     │
└─────────────────────┘
```
