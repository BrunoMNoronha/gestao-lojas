// Verifica que toda Server Action exportada em src/actions chama authorize() (issue #14) e que
// todo Route Handler do PDV offline em src/app/api/offline também (issue #36, docs/OFFLINE.md
// seção 5: o proxy não atua em /api).
// Uso: pnpm check:actions
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const missing = [];
let actions = 0;
let handlers = 0;

const actionsDir = join(root, "src", "actions");
for (const file of readdirSync(actionsDir).filter((f) => f.endsWith(".ts"))) {
  const source = readFileSync(join(actionsDir, file), "utf8");
  if (!/^["']use server["']/m.test(source)) continue;

  const chunks = source.split(/\nexport async function /).slice(1);
  for (const chunk of chunks) {
    actions += 1;
    const name = chunk.slice(0, chunk.indexOf("("));
    if (!chunk.includes("authorize(")) missing.push(`${file}: ${name}`);
  }
}

// Route Handlers: cada método HTTP exportado (GET, POST...) precisa chamar authorize()
const HTTP_METHOD = /\nexport (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
function routeFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return /^route\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

for (const file of routeFiles(join(root, "src", "app", "api", "offline"))) {
  const source = readFileSync(file, "utf8");
  const parts = ("\n" + source).split(HTTP_METHOD).slice(1);
  for (let i = 0; i < parts.length; i += 2) {
    handlers += 1;
    if (!parts[i + 1].includes("authorize(")) {
      missing.push(`${relative(root, file).replaceAll("\\", "/")}: ${parts[i]}`);
    }
  }
}

if (missing.length > 0) {
  console.error(`Sem authorize(): ${missing.length} de ${actions + handlers}`);
  for (const item of missing) console.error(`  - ${item}`);
  process.exit(1);
}
console.log(
  `OK: ${actions} Server Actions exportadas e ${handlers} Route Handlers do PDV offline chamam authorize().`,
);
