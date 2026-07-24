import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Singleton Prisma client — prevents multiple connections in dev hot-reload
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

// Принудительно устанавливаем UTF-8 для SQLite на Windows
// Без этого Prisma/better-sqlite3 может записать кириллицу как кракозябры
async function ensureUtf8() {
  await prisma.$executeRawUnsafe("PRAGMA encoding = 'UTF-8'");
}
ensureUtf8().catch(() => {
  // Если PRAGMA уже установлен или база не готова — игнорируем
});

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

// Graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
