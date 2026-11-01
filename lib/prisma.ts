import { PrismaClient as SQLitePrismaClient } from "../generated/sqlite";
import { PrismaClient as PostgresPrismaClient } from "../generated/postgres";

const globalForPrisma = globalThis as unknown as {
  sqlitePrisma?: SQLitePrismaClient;
  postgresPrisma?: PostgresPrismaClient;
};

const isVercel = process.env.VERCEL === "1";

const sqliteClient =
  globalForPrisma.sqlitePrisma ??
  new SQLitePrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

const postgresClient =
  globalForPrisma.postgresPrisma ??
  new PostgresPrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.sqlitePrisma = sqliteClient;
  globalForPrisma.postgresPrisma = postgresClient;
}

export const prisma: PostgresPrismaClient = (
  isVercel ? postgresClient : sqliteClient
) as PostgresPrismaClient;