import { NextResponse } from "next/server";
import { env } from "@/env/server";
import { db } from "@/infra/db";
import { redis } from "@/infra/redis";

export const dynamic = "force-dynamic";

async function check(fn: () => Promise<unknown>): Promise<"ok" | "error"> {
  try {
    await fn();
    return "ok";
  } catch {
    return "error"; // sem detalhes na resposta pública
  }
}

export async function GET() {
  const [database, cache] = await Promise.all([
    check(() => db.$queryRaw`SELECT 1`),
    check(() => redis().ping()),
  ]);
  const healthy = database === "ok" && cache === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", appEnv: env().APP_ENV, database, cache },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
