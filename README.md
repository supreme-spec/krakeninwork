# Smart Security Monitor 🔐

Система видеонаблюдения с распознаванием лиц в реальном времени.

**Стек:** React 19 · TypeScript · Express · Prisma (SQLite) · FastAPI · InsightFace (buffalo\_l) · FFmpeg · WebSocket

---

## Быстрый старт

### 1. Зависимости Node.js

```bash
npm install
```

### 2. Python-окружение (Face Engine)

```bash
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

### 3. Настройка базы данных

```bash
npm run db:migrate
```

### 4. Запуск в режиме разработки

Одна команда запускает всё (Node-сервер + Python Face Engine + Vite HMR):

```bash
npm run dev
```

Открыть: [http://localhost:3000](http://localhost:3000)

---

## Переменные окружения

Скопируйте `.env.example` в `.env` и проверьте значения:

| Переменная        | По умолчанию              | Описание                        |
|-------------------|---------------------------|---------------------------------|
| `PORT`            | `3000`                    | Порт Node.js сервера            |
| `FACE_SERVER_URL` | `http://localhost:8001`   | URL Python Face Engine          |
| `DATABASE_URL`    | `file:./dev.db`           | Путь к SQLite базе              |
| `NODE_ENV`        | `development`             | Режим запуска                   |

---

## Скрипты

| Команда             | Описание                                  |
|---------------------|-------------------------------------------|
| `npm run dev`       | Dev-режим: Node + Python + Vite           |
| `npm run build`     | Production сборка                         |
| `npm start`         | Запуск production сборки                  |
| `npm run db:migrate`| Применить миграции Prisma                 |
| `npm run db:studio` | Открыть Prisma Studio (UI для БД)         |
| `npm run lint`      | TypeScript проверка                       |

---

## Архитектура

```
Browser (React 19 + Vite)
  ↕ HTTP /api/* + WebSocket /ws/*
Node.js Express (server.ts, port 3000)
  ↕ HTTP REST (multipart)
Python FastAPI (face_server.py, port 8001)
  ↕ InsightFace buffalo_l (ONNX)
Prisma ORM ← SQLite (prisma/dev.db)
```

### Поддерживаемые типы камер

- **USB** — Windows DirectShow (`video=USB Video Device`)
- **RTSP** — IP-камеры через FFmpeg
- **ONVIF** — автообнаружение по сети
- **Hikvision** — ISAPI интеграция
- **UNV** — LAPI HTTP Push webhook

### GPU-ускорение (автоматически)

Python Face Engine выбирает лучший доступный провайдер:

`CUDA (NVIDIA)` → `DirectML (AMD/Intel, Windows)` → `OpenVINO` → `ROCm` → `CPU`

---

## FFmpeg

Для стриминга USB и RTSP камер требуется FFmpeg.

Скачайте и поместите `ffmpeg.exe` в папку `bin/`:

```
bin/ffmpeg.exe
```

Или установите системно и добавьте в `PATH`.

---

## Структура базы данных

| Таблица          | Описание                          |
|------------------|-----------------------------------|
| `Camera`         | Камеры (USB, RTSP, ONVIF, UNV)   |
| `Person`         | База персон с фото                |
| `FaceDescriptor` | Эмбеддинги лиц (binary base64)   |
| `PersonPhoto`    | Фотографии персон                 |
| `Event`          | События распознавания             |
| `Recording`      | Записи видео                      |
| `Category`       | Категории (VIP, BLACKLIST, etc.)  |
| `Incident`       | Инциденты персон                  |
| `Tag`            | Теги персон                       |
| `Settings`       | Персистентные настройки           |
