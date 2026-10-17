import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test"))
  throw new Error("Banco descartável obrigatório.");
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
try {
  const result = [];
  for (const table of ["Product", "Customer"]) {
    const count = Number((await db.$queryRawUnsafe(`SELECT count(*) FROM "${table}"`))[0].count);
    const [after] = await db.$queryRawUnsafe(
      `SELECT id,"syncVersion" FROM "${table}" ORDER BY "syncVersion",id OFFSET $1 LIMIT 1`,
      Math.floor(count * 0.9),
    );
    for (const mode of ["or", "tuple"]) {
      const predicate =
        mode === "or"
          ? '("syncVersion">$1 OR ("syncVersion"=$1 AND id>$2))'
          : '("syncVersion",id)>($1,$2)';
      const plan = await db.$queryRawUnsafe(
        `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,"syncVersion" FROM "${table}" WHERE ${predicate} ORDER BY "syncVersion",id LIMIT 501`,
        after.syncVersion,
        after.id,
      );
      result.push({ table, mode, plan: plan[0]["QUERY PLAN"] });
    }
  }
  await writeFile(
    process.env.PERFORMANCE_OUTPUT ?? "cursor-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      result.map(({ table, mode, plan }) => ({
        table,
        mode,
        executionMs: plan[0]["Execution Time"],
        plan: plan[0].Plan,
      })),
    ),
  );
} finally {
  await db.$disconnect();
}
