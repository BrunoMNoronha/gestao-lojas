// Gera todos os ícones da marca a partir de uma fonte única: o ícone `Store` do lucide (o mesmo da
// landing, do login e da sidebar) em traço branco sobre o teal do tema. Rode `pnpm icons` depois de
// mudar a marca e faça commit das saídas; nada aqui roda no build.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

const BRAND_COLOR = "#126a70"; // mesmo theme_color de src/app/manifest.ts e src/app/layout.tsx
const GLYPH_COLOR = "#ffffff";

// Paths do ícone `store` do lucide-react (viewBox 24, ISC), copiados de
// lucide-react/dist/esm/icons/store.mjs
const STORE_PATHS = [
  "M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5",
  "M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244",
  "M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05",
];

/**
 * Monta o SVG da marca num quadro de 24 unidades.
 * @param {object} o
 * @param {number} o.glyph   fração do quadro ocupada pelo ícone
 * @param {number} o.radius  raio do fundo em fração do quadro (0 = fundo cheio, para maskable/iOS)
 * @param {number} [o.stroke] espessura do traço em unidades do lucide (padrão 2)
 * @param {number} [o.size]  largura/altura em px; omitido no SVG vetorial
 */
function brandSvg({ glyph, radius, stroke = 2, size }) {
  const offset = (24 - 24 * glyph) / 2;
  // o desenho do Store ocupa y 2..21: desce meia unidade para ficar centrado na caixa
  const dy = 0.5 * glyph;
  const dimensions = size ? ` width="${size}" height="${size}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"${dimensions}>`,
    `<rect width="24" height="24" rx="${24 * radius}" fill="${BRAND_COLOR}"/>`,
    `<g transform="translate(${offset} ${offset + dy}) scale(${glyph})" fill="none" stroke="${GLYPH_COLOR}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">`,
    ...STORE_PATHS.map((d) => `<path d="${d}"/>`),
    "</g></svg>",
  ].join("");
}

const png = (options) =>
  sharp(Buffer.from(brandSvg(options)))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

// ICO com PNGs embutidos (aceito por todos os navegadores atuais): cabeçalho + diretório + imagens
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

const ROOT = process.cwd();
function write(relativePath, data) {
  const target = join(ROOT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  console.log(`[generate-icons] ${relativePath} (${data.length} B)`);
}

// Caixa arredondada como a da interface (rounded-xl); ícone maior nos tamanhos de favicon
const ROUNDED = { glyph: 0.6, radius: 0.22 };
const FAVICON = { glyph: 0.74, radius: 0.2, stroke: 2.4 };
// Fundo cheio: o sistema recorta (maskable) ou arredonda (iOS). Maskable mantém o ícone na zona
// segura central de 80%.
const MASKABLE = { glyph: 0.55, radius: 0 };
const APPLE = { glyph: 0.6, radius: 0 };

write("src/app/icon.svg", `${brandSvg(FAVICON)}\n`);
write(
  "src/app/favicon.ico",
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        data: await png({ ...FAVICON, stroke: size <= 32 ? 2.6 : 2.4, size }),
      })),
    ),
  ),
);
write("public/icons/icon-192.png", await png({ ...ROUNDED, size: 192 }));
write("public/icons/icon-512.png", await png({ ...ROUNDED, size: 512 }));
write("public/icons/icon-maskable-512.png", await png({ ...MASKABLE, size: 512 }));
write("public/icons/apple-touch-icon.png", await png({ ...APPLE, size: 180 }));
