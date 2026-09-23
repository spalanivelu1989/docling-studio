import { alpha, createTheme } from "@mui/material/styles";

export type Mode = "light" | "dark";

// One accent (blue) plus a colour per search method, so the score bars in the
// Ask page read the same everywhere.
export const searchColors = {
  light: { combined: "#2563eb", vector: "#0f766e", keyword: "#7c3aed", mark: "#fde68a" },
  dark: { combined: "#60a5fa", vector: "#2dd4bf", keyword: "#a78bfa", mark: "#6b5310" },
};

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
 *  1 matches MUI's own hover tint, which is the most a panel should need. */
export function surface(theme: { palette: { mode: string } }, strength = 1) {
  const dark = theme.palette.mode === "dark";
  return alpha(dark ? "#ffffff" : "#000000", (dark ? 0.08 : 0.045) * strength);
}

export function makeTheme(mode: Mode) {
  const dark = mode === "dark";
  const primary = dark ? "#60a5fa" : "#2563eb";
  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      success: { main: dark ? "#4ade80" : "#15803d" },
      warning: { main: dark ? "#fbbf24" : "#b45309" },
      error: { main: dark ? "#f87171" : "#b91c1c" },
      background: { default: dark ? "#0d1014" : "#f4f6f9", paper: dark ? "#151a21" : "#ffffff" },
      divider: dark ? "#262c35" : "#e3e6ea",
      text: { primary: dark ? "#e7eaee" : "#16191d", secondary: dark ? "#9aa3ae" : "#5f6773" },
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
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: "none", fontWeight: 600 } } },
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          "::selection": { background: alpha(theme.palette.primary.main, 0.25) },
          mark: { background: searchColors[mode].mark, color: "inherit", borderRadius: 3, padding: "0 2px" },
        }),
      },
    },
  });
}
