import { alpha, createTheme } from "@mui/material/styles";

export type Mode = "light" | "dark";

// One accent (blue) plus a colour per search method, so the score bars in the
// Ask page read the same everywhere.
export const searchColors = {
  light: { combined: "#2563eb", vector: "#0f766e", keyword: "#7c3aed", mark: "#fde68a" },
  dark: { combined: "#60a5fa", vector: "#2dd4bf", keyword: "#a78bfa", mark: "#6b5310" },
};

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
