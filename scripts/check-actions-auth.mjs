// Verifica que toda Server Action exportada em src/actions chama authorize() (issue #14).
// Uso: pnpm check:actions
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "src", "actions");
const missing = [];
let total = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
  const source = readFileSync(join(dir, file), "utf8");
  if (!/^["']use server["']/m.test(source)) continue;

  const chunks = source.split(/\nexport async function /).slice(1);
  for (const chunk of chunks) {
    total += 1;
    const name = chunk.slice(0, chunk.indexOf("("));
    if (!chunk.includes("authorize(")) missing.push(`${file}: ${name}`);
  }
}

if (missing.length > 0) {
  console.error(`Server Actions sem authorize(): ${missing.length} de ${total}`);
  for (const item of missing) console.error(`  - ${item}`);
  process.exit(1);
}
console.log(`OK: ${total} Server Actions exportadas chamam authorize().`);
