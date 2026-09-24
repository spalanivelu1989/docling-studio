import { alpha, createTheme } from "@mui/material/styles";

export type Mode = "light" | "dark";

/** Catppuccin Frappé, transcribed from https://catppuccin.com/palette/.
 *
 *  These 26 values are the whole dark theme. Nothing below invents a colour:
 *  every dark-mode hex in this app resolves to one of these names, or to an
 *  `alpha()` of one, and the `frappe-palette.mjs` test fails if a raw hex
 *  appears on a dark branch that is not in this table.
 *
 *  Keep the names. `frappe.surface0` says which step of the palette a border
 *  sits on and stays right if the hex is ever corrected upstream; `#414559`
 *  says nothing and drifts silently. */
export const frappe = {
  rosewater: "#f2d5cf",
  flamingo: "#eebebe",
  pink: "#f4b8e4",
  mauve: "#ca9ee6",
  red: "#e78284",
  maroon: "#ea999c",
  peach: "#ef9f76",
  yellow: "#e5c890",
  green: "#a6d189",
  teal: "#81c8be",
  sky: "#99d1db",
  sapphire: "#85c1dc",
  blue: "#8caaee",
  lavender: "#babbf1",
  text: "#c6d0f5",
  subtext1: "#b5bfe2",
  subtext0: "#a5adce",
  overlay2: "#949cbb",
  overlay1: "#838ba7",
  overlay0: "#737994",
  surface2: "#626880",
  surface1: "#51576d",
  surface0: "#414559",
  base: "#303446",
  mantle: "#292c3c",
  crust: "#232634",
} as const;

// One accent (blue) plus a colour per search method, so the score bars in the
// Ask page read the same everywhere.
//
// `mark` is the search highlight, and it carries its own text colour rather
// than inheriting one. Light mode already works that way in effect -- pale
// yellow under near-black text -- and dark mode cannot: a wash of Yellow dim
// enough to keep Frappé's light Text legible on top of it lands at 4.5:1 in
// the best case and 4.0:1 inside a tinted snippet box, which is a highlight
// you have to hunt for. Flipping to Crust on the full Yellow gives 9.3:1 and
// looks like what it is.
export const searchColors = {
  light: { combined: "#2563eb", vector: "#0f766e", keyword: "#7c3aed", mark: { bg: "#fde68a", fg: "#16191d" } },
  dark: {
    combined: frappe.blue,
    vector: frappe.teal,
    keyword: frappe.mauve,
    mark: { bg: frappe.yellow, fg: frappe.crust },
  },
};

/** The hue for each kind of node in the knowledge graph, per theme.
 *
 *  One map, because there used to be two: TYPE_CONFIG in KnowledgeGraphPage
 *  and NODE_HUE in AgentTraceDrawer held the same five hexes written out
 *  twice, and a legend that disagrees with the graph beside it is the kind of
 *  wrong nobody files a bug about. They are categorical colours, so they must
 *  stay far apart in hue -- Frappé's accents are tuned to equal weight, which
 *  is exactly what a legend wants. */
export const nodeHues: Record<Mode, Record<string, string>> = {
  light: {
    stream: "#8b5cf6",
    system: "#0284c7",
    process: "#10b981",
    document: "#64748b",
    spec: "#f97316",
  },
  dark: {
    stream: frappe.mauve,
    system: frappe.sapphire,
    process: frappe.green,
    document: frappe.overlay2,
    spec: frappe.peach,
  },
};

/** The fallback when a node has a type nothing knows about. */
export const unknownHue = (mode: Mode) => (mode === "dark" ? frappe.overlay1 : "#64748b");

/** A well: the surface a viewer looks INTO rather than at -- a code block, the
 *  graph canvas, a document pane. It sits below `background.default`, which is
 *  what makes it read as recessed rather than as another card. */
export const well = (mode: Mode) => (mode === "dark" ? frappe.crust : "#f1f3f7");

/** A faintly tinted surface: the inset panels, snippet boxes and striped rows
 *  that need to sit a step away from the paper behind them.
 *
 *  Use this instead of `alpha(theme.palette.action.hover, x)`. That looks like
 *  it dims a subtle tint and does the opposite: `action.hover` is ALREADY
 *  transparent -- rgba(0,0,0,0.04) light, rgba(255,255,255,0.08) dark -- and
 *  MUI's `alpha()` REPLACES the alpha channel rather than multiplying it. So
 *  `alpha(action.hover, 0.5)` is a 50% black wash in light mode, not a 2% one:
 *  a mid-grey box that took secondary text down to 1.45:1 against a 4.5:1
 *  floor. The higher the number looked, the worse it got.
 *
 *  `strength` keeps the relative weighting those numbers were reaching for.
 *  1 matches MUI's own hover tint, which is the most a panel should need.
 *
 *  It stays a translucent wash rather than a flat `frappe.surface0` because a
 *  panel does not know what is behind it -- some sit on `paper`, some on
 *  `default`, some on a well -- and a flat fill would erase that difference.
 *  The arithmetic happens to land where Frappé would put it anyway: 8% white
 *  over Base is #404455, which is Surface0 (#414559) to within a rounding
 *  step. */
export function surface(theme: { palette: { mode: string } }, strength = 1) {
  const dark = theme.palette.mode === "dark";
  return alpha(dark ? "#ffffff" : "#000000", (dark ? 0.08 : 0.045) * strength);
}

export function makeTheme(mode: Mode) {
  const dark = mode === "dark";
  const primary = dark ? frappe.blue : "#2563eb";
  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      // Frappé's accents carry roughly equal weight, so the semantic four are
      // just the palette's own names for them -- no darkening for contrast,
      // which is the thing that pulls a palette out of tune.
      secondary: { main: dark ? frappe.mauve : "#7c3aed" },
      info: { main: dark ? frappe.sapphire : "#0284c7" },
      success: { main: dark ? frappe.green : "#15803d" },
      warning: { main: dark ? frappe.yellow : "#b45309" },
      error: { main: dark ? frappe.red : "#b91c1c" },
      // Mantle behind, Base on top: the Catppuccin convention is that cards
      // are the lighter surface and the page recedes behind them.
      background: { default: dark ? frappe.mantle : "#f4f6f9", paper: dark ? frappe.base : "#ffffff" },
      divider: dark ? frappe.surface0 : "#e3e6ea",
      // Subtext1 rather than Subtext0 for secondary text: Subtext0 lands at
      // 4.35:1 on a tinted panel, just under the 4.5:1 floor, and
      // surface-contrast.mjs fails on it.
      text: { primary: dark ? frappe.text : "#16191d", secondary: dark ? frappe.subtext1 : "#5f6773" },
      action: dark ? { disabled: frappe.overlay0, disabledBackground: alpha(frappe.surface1, 0.5) } : {},
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      button: { textTransform: "none", fontWeight: 600 },
      overline: { fontWeight: 700, letterSpacing: ".06em" },
    },
    components: {
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: ({ theme }) => ({ backgroundImage: "none", border: `1px solid ${theme.palette.divider}` }) },
      },
      MuiAppBar: { styleOverrides: { root: { borderWidth: "0 0 1px 0" } } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiTooltip: {
        defaultProps: { arrow: true },
        // MUI's default tooltip is a near-black wash that owes nothing to the
        // palette; on Frappé it reads as a hole punched in the page.
        styleOverrides: dark
          ? {
              tooltip: { backgroundColor: frappe.surface0, color: frappe.text, border: `1px solid ${frappe.surface1}` },
              arrow: { color: frappe.surface0 },
            }
          : {},
      },
      MuiToggleButton: { styleOverrides: { root: { textTransform: "none", fontWeight: 600 } } },
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          "::selection": { background: alpha(theme.palette.primary.main, 0.25) },
          mark: {
            background: searchColors[mode].mark.bg,
            color: searchColors[mode].mark.fg,
            borderRadius: 3,
            padding: "0 2px",
          },
          // The scrollbars are part of the theme too -- a stock light-grey
          // scrollbar down the side of a Frappé page is the loudest thing on it.
          ...(dark
            ? {
                "*": { scrollbarColor: `${frappe.surface2} ${frappe.mantle}` },
                "::-webkit-scrollbar": { width: 10, height: 10 },
                "::-webkit-scrollbar-track": { background: frappe.mantle },
                "::-webkit-scrollbar-thumb": {
                  background: frappe.surface1,
                  borderRadius: 8,
                  border: `2px solid ${frappe.mantle}`,
                },
                "::-webkit-scrollbar-thumb:hover": { background: frappe.surface2 },
              }
            : {}),
        }),
      },
    },
  });
}
