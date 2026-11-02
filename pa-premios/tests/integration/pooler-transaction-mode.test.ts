import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDirectUrl, testPooledUrl } from "./env";

/**
 * Validação exigida pela SPEC 2: o padrão do motor de números funciona através do
 * pooler em MODO TRANSAÇÃO (pgbouncer local = paridade com o pooler do Supabase).
 *
 * Usa uma tabela de prova com o mesmo formato de `tickets` (SPEC 6.2). Não é o motor da F1:
 * só prova que as primitivas (transação interativa do Prisma, FOR UPDATE SKIP LOCKED,
 * pg_advisory_xact_lock, SET LOCAL) se comportam corretamente atrás do pooler.
 */
const POOL_SIZE = 100_000;
const CONCURRENT = 200;
const PER_TX = 50;
const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 } as const;

describe("pooler em modo transação", () => {
  const owner = new PrismaClient({ datasourceUrl: testDirectUrl() });
  const app = new PrismaClient({ datasourceUrl: testPooledUrl() });

  beforeAll(async () => {
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS pooler_probe`);
    await owner.$executeRawUnsafe(`
      CREATE TABLE pooler_probe (
        number        integer PRIMARY KEY,
        shuffle_rank  integer NOT NULL,
        status        text    NOT NULL DEFAULT 'available',
        holder        integer
      )`);
    await owner.$executeRawUnsafe(`
      INSERT INTO pooler_probe (number, shuffle_rank)
      SELECT n, (random() * 2147483646)::int FROM generate_series(0, ${POOL_SIZE - 1}) AS n`);
    await owner.$executeRawUnsafe(
      `CREATE INDEX pooler_probe_avail ON pooler_probe (shuffle_rank) WHERE status = 'available'`,
    );
    await owner.$executeRawUnsafe(`ANALYZE pooler_probe`);
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS pooler_probe`);
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  async function allocate(holder: number, qty: number): Promise<number[]> {
    return app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '10s'`);
      // Trava presa à transação (liberada no COMMIT/ROLLBACK), segura atrás do pooler.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242, ${holder}::int)`;
      const rows = await tx.$queryRaw<{ number: number }[]>`
        WITH picked AS (
          SELECT number FROM pooler_probe
           WHERE status = 'available'
           ORDER BY shuffle_rank
           LIMIT ${qty}
           FOR UPDATE SKIP LOCKED
        )
        UPDATE pooler_probe p
           SET status = 'reserved', holder = ${holder}
          FROM picked
         WHERE p.number = picked.number
        RETURNING p.number`;
      return rows.map((r) => r.number);
    }, TX_OPTIONS);
  }

  it(`${CONCURRENT} transações concorrentes não alocam nenhum número duplicado`, async () => {
    const results = await Promise.all(Array.from({ length: CONCURRENT }, (_, i) => allocate(i, PER_TX)));

    const all = results.flat();
    expect(results.every((r) => r.length === PER_TX)).toBe(true);
    expect(all).toHaveLength(CONCURRENT * PER_TX);
    expect(new Set(all).size).toBe(all.length);

    const rows = await owner.$queryRaw<{ reserved: bigint }[]>`
      SELECT count(*) AS reserved FROM pooler_probe WHERE status = 'reserved'`;
    expect(Number(rows[0]?.reserved)).toBe(CONCURRENT * PER_TX);
  });

  it("pg_advisory_xact_lock serializa a mesma chave entre conexões diferentes do pooler", async () => {
    const events: string[] = [];
    const holderTx = app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4243, 1)`;
      events.push("A:lock");
      await tx.$executeRaw`SELECT pg_sleep(0.4)`;
      events.push("A:commit");
    }, TX_OPTIONS);
    await new Promise((r) => setTimeout(r, 100));
    const waiterTx = app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4243, 1)`;
      events.push("B:lock");
    }, TX_OPTIONS);
    await Promise.all([holderTx, waiterTx]);
    expect(events).toEqual(["A:lock", "A:commit", "B:lock"]);
  });

  it("rollback devolve os números (nada fica preso)", async () => {
    const before = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pooler_probe WHERE status = 'available'`;
    await expect(
      app.$transaction(async (tx) => {
        await tx.$queryRaw`
          UPDATE pooler_probe SET status = 'reserved'
           WHERE number IN (SELECT number FROM pooler_probe WHERE status = 'available'
                            ORDER BY shuffle_rank LIMIT 100 FOR UPDATE SKIP LOCKED)`;
        throw new Error("falha simulada");
      }, TX_OPTIONS),
    ).rejects.toThrow("falha simulada");
    const after = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pooler_probe WHERE status = 'available'`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("aloca 20.000 números em uma transação em menos de 2s (meta da SPEC 6.4)", async () => {
    const started = performance.now();
    const numbers = await allocate(99_999, 20_000);
    const elapsed = performance.now() - started;
    expect(numbers).toHaveLength(20_000);
    expect(new Set(numbers).size).toBe(20_000);
    expect(elapsed).toBeLessThan(2_000);
  });
});
