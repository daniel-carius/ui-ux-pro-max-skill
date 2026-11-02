import "server-only";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env/server";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: env().DATABASE_URL,
    log: env().APP_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env().APP_ENV !== "production") globalForPrisma.prisma = db;
