-- CreateTable
CREATE TABLE "Camera" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "camera_type" TEXT NOT NULL DEFAULT 'USB',
    "zone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "roi_zones" TEXT,
    "fps" INTEGER NOT NULL DEFAULT 25,
    "ping_ms" INTEGER NOT NULL DEFAULT 0,
    "is_smart_recording" BOOLEAN NOT NULL DEFAULT false,
    "is_chronicle" BOOLEAN NOT NULL DEFAULT true,
    "driver_type" TEXT,
    "ip_address" TEXT,
    "ip_port" INTEGER,
    "username" TEXT,
    "password" TEXT,
    "use_camera_analytics" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "bg_color" TEXT NOT NULL,
    "is_alert" BOOLEAN NOT NULL DEFAULT false,
    "alert_sound" TEXT NOT NULL DEFAULT 'off',
    "alert_volume" REAL NOT NULL DEFAULT 0.5,
    "detect_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "is_system" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Person" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "position" TEXT,
    "comment" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "birth_date" TEXT,
    "address" TEXT,
    "organization" TEXT,
    "extra_info" TEXT,
    "photo_path" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME,
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "embedding_count" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "FaceDescriptor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "person_id" INTEGER NOT NULL,
    "photo_path" TEXT NOT NULL,
    "descriptor" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FaceDescriptor_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PersonPhoto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "person_id" INTEGER NOT NULL,
    "photo_path" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "has_embedding" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonPhoto_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "camera_id" INTEGER NOT NULL,
    "camera_name" TEXT NOT NULL,
    "person_id" INTEGER,
    "event_type" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "snapshot_path" TEXT,
    "person_name" TEXT,
    "person_category" TEXT,
    "person_photo_path" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "needs_operator_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "confirmation_status" TEXT,
    CONSTRAINT "Event_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "Camera" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "camera_id" INTEGER NOT NULL,
    "camera_name" TEXT NOT NULL,
    "start_time" DATETIME NOT NULL,
    "end_time" DATETIME NOT NULL,
    "duration" INTEGER NOT NULL,
    "size_mb" REAL NOT NULL,
    "video_path" TEXT NOT NULL,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Recording_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "Camera" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "person_id" INTEGER NOT NULL,
    "incident_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Incident_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "person_id" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,
    CONSTRAINT "Tag_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "FaissUpdateLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE INDEX "FaceDescriptor_person_id_idx" ON "FaceDescriptor"("person_id");
