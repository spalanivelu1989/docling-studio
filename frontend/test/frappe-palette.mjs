/** The dark theme is Catppuccin Frappé, and stays Frappé.
 *
 *  Run: node test/frappe-palette.mjs
 *
 *  Two things go wrong with a palette, and neither raises an error:
 *
 *  1. A value gets mistyped. #8caaee and #8caeee are the same colour to look
 *     at, and nothing downstream knows which one Catppuccin publishes. The
 *     26 values below are transcribed from https://catppuccin.com/palette/
 *     and this file is the only place they are allowed to be written twice.
 *
 *  2. A raw hex gets added on a dark branch. The app draws two canvases and a
 *     mermaid diagram by hand, so `isDark ? "#38bdf8" : "#0284c7"` is an
 *     ordinary-looking line to write -- and that sky-blue is not in the
 *     palette, so one link on one canvas quietly stops matching everything
 *     around it. Naming it `frappe.sky` is what keeps the set closed.
 *
 *  Light mode is not Catppuccin and is not checked: Frappé is a dark flavour,
 *  and the light branches are the palette this app already had.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}: ${detail}`); }
};

// Catppuccin Frappé, from https://catppuccin.com/palette/
const OFFICIAL = {
  rosewater: "#f2d5cf", flamingo: "#eebebe", pink: "#f4b8e4", mauve: "#ca9ee6",
  red: "#e78284", maroon: "#ea999c", peach: "#ef9f76", yellow: "#e5c890",
  green: "#a6d189", teal: "#81c8be", sky: "#99d1db", sapphire: "#85c1dc",
  blue: "#8caaee", lavender: "#babbf1", text: "#c6d0f5", subtext1: "#b5bfe2",
  subtext0: "#a5adce", overlay2: "#949cbb", overlay1: "#838ba7", overlay0: "#737994",
  surface2: "#626880", surface1: "#51576d", surface0: "#414559", base: "#303446",
  mantle: "#292c3c", crust: "#232634",
};

const themeSrc = readFileSync(join(SRC, "theme.ts"), "utf8");
const body = themeSrc.slice(themeSrc.indexOf("export const frappe"), themeSrc.indexOf("} as const;"));
const declared = Object.fromEntries(
  [...body.matchAll(/^\s{2}(\w+): "(#[0-9a-f]{6})",$/gm)].map((m) => [m[1], m[2]]),
);

const wrong = Object.entries(OFFICIAL)
  .filter(([k, v]) => declared[k] !== v)
  .map(([k, v]) => `${k}: expected ${v}, theme.ts has ${declared[k] ?? "nothing"}`);
check(`all ${Object.keys(OFFICIAL).length} Frappé colours match the published palette`,
      wrong.length === 0, wrong.join("; "));

const extra = Object.keys(declared).filter((k) => !(k in OFFICIAL));
check("the palette holds nothing Catppuccin does not publish", extra.length === 0,
      `not Frappé colours: ${extra.join(", ")}`);

// --- no raw hex on a dark branch ---------------------------------------------

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

const PALETTE = new Set(Object.values(OFFICIAL));
// Neutral white and black are not palette colours and never were: they are the
// LIGHT side of a `dark ? x : y`, and the rendered page of a source document,
// which is white paper whichever theme is on.
const NEUTRAL = new Set(["#ffffff", "#fff", "#000000", "#000"]);
// The dark side of a ternary: `isDark ? "#xxxxxx"`, across a line break too.
const DARK_BRANCH = /\b(?:isDark|isDarkMode|dark)\s*(?:\n\s*)?\?\s*"(#[0-9a-fA-F]{3,8})"/g;
const MODE_BRANCH = /mode\s*===\s*"dark"\s*(?:\n\s*)?\?\s*"(#[0-9a-fA-F]{3,8})"/g;

const strays = [];
for (const file of walk(SRC)) {
  if (file.endsWith("theme.ts")) continue;   // where the palette lives
  const src = readFileSync(file, "utf8");
  for (const re of [DARK_BRANCH, MODE_BRANCH]) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      const hex = m[1].toLowerCase();
      if (PALETTE.has(hex) || NEUTRAL.has(hex)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      strays.push(`${file.replace(SRC, "src")}:${line} ${m[1]}`);
    }
  }
}
check("no dark branch draws a colour from outside the palette", strays.length === 0,
      `write these as frappe.<name>: ${strays.join(", ")}`);

// A hex that IS a Frappé value but written out rather than named passes the
// check above and still drifts, so say so.
const literal = [];
for (const file of walk(SRC)) {
  if (file.endsWith("theme.ts")) continue;
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/"(#[0-9a-fA-F]{6})"/g)) {
      if (PALETTE.has(m[1].toLowerCase())) literal.push(`${file.replace(SRC, "src")}:${i + 1} ${m[1]}`);
    }
  });
}
check("no Frappé colour is written as a hex instead of its name", literal.length === 0,
      `use frappe.<name>: ${literal.join(", ")}`);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
