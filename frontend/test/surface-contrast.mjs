/** Tinted surfaces must stay readable, and must not be built with alpha().
 *
 *  Run: node test/surface-contrast.mjs
 *
 *  The bug this exists for: `alpha(theme.palette.action.hover, 0.5)` reads as
 *  "half of a subtle tint" and is the opposite. `action.hover` is ALREADY
 *  transparent -- rgba(0,0,0,0.04) in light mode -- and MUI's alpha() REPLACES
 *  the alpha channel instead of multiplying it, so that expression is a 50%
 *  black wash. The Ask page's citation hover card rendered secondary text on a
 *  mid-grey box at 1.45:1, against a 4.5:1 floor, and sixteen call sites across
 *  eight files had the same mistake. The larger the number looked, the darker
 *  the box got.
 *
 *  Two checks: nobody reintroduces the expression, and the helper that replaced
 *  it stays readable at every strength the call sites ask for.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}: ${detail}`); }
};

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });
}

// --- 1. the expression must not come back ------------------------------------

const offenders = [];
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    // theme.ts documents the mistake in a comment; that is the one place it may appear.
    if (file.endsWith("theme.ts")) return;
    if (/alpha\(\s*\w+\.palette\.action\.(hover|selected|focus|disabledBackground)/.test(line)) {
      offenders.push(`${file.replace(root, "src")}:${i + 1}`);
    }
  });
}
check(
  "no alpha() applied to an already-transparent action token",
  offenders.length === 0,
  `alpha() replaces the alpha channel, so these are heavy washes: ${offenders.join(", ")}`,
);

// --- 2. the replacement stays readable ---------------------------------------

const theme = readFileSync(join(root, "theme.ts"), "utf8");
const m = theme.match(/alpha\(dark \? "#ffffff" : "#000000",\s*\(dark \? ([\d.]+) : ([\d.]+)\)\s*\* strength\)/);
check("surface() is defined the way this test understands it", Boolean(m),
      "surface() changed shape -- update this check rather than deleting it");

if (m) {
  const [darkBase, lightBase] = [parseFloat(m[1]), parseFloat(m[2])];
  const PAPER = { light: [255, 255, 255], dark: [0x15, 0x1a, 0x21] };
  const SECONDARY = { light: [0x5f, 0x67, 0x73], dark: [0x9a, 0xa3, 0xae] };
  const TINT = { light: [0, 0, 0], dark: [255, 255, 255] };

  const srgb = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const over = (fg, fa, bg) => fg.map((c, i) => Math.round(c * fa + bg[i] * (1 - fa)));

  // Every strength any call site actually passes.
  const strengths = new Set([1]);
  for (const file of walk(root)) {
    for (const s of readFileSync(file, "utf8").matchAll(/surface\(\s*\w+\s*,\s*([\d.]+)\s*\)/g)) {
      strengths.add(parseFloat(s[1]));
    }
  }

  const AA = 4.5;
  let worst = { ratio: Infinity };
  for (const mode of ["light", "dark"]) {
    const base = mode === "dark" ? darkBase : lightBase;
    for (const strength of strengths) {
      const box = over(TINT[mode], base * strength, PAPER[mode]);
      const r = ratio(SECONDARY[mode], box);
      if (r < worst.ratio) worst = { ratio: r, mode, strength };
    }
  }
  check(
    `secondary text clears AA on every tinted surface (worst ${worst.ratio.toFixed(2)}:1 at strength ${worst.strength} in ${worst.mode})`,
    worst.ratio >= AA,
    `${worst.ratio.toFixed(2)}:1 is below the ${AA}:1 floor`,
  );
  console.log(`       ${strengths.size} distinct strengths in use: ${[...strengths].sort((a, b) => a - b).join(", ")}`);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
