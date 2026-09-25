/** Demo Mode: the login screen or the demo shell, chosen by the path.
 *
 *  The server has already decided which one may be shown -- `/demo` without a
 *  valid session cookie is redirected to `/demo/login` before this runs -- so
 *  the path is enough here. The theme is the application's own, read from the
 *  same stored preference, so switching to the demo does not flash a
 *  different colour scheme on the presenter. */
import { CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import { MotionConfig } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { makeTheme, type Mode } from "../theme";
import DemoLogin from "./DemoLogin";
import DemoShell from "./DemoShell";

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* private mode */
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function DemoApp() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const theme = useMemo(() => makeTheme(mode), [mode]);
  const isLogin = location.pathname.startsWith("/demo/login");

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem("theme", mode);
    } catch {
      /* private mode */
    }
  }, [mode]);

  const toggleMode = () => setMode(mode === "dark" ? "light" : "dark");

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* The split-pane handle, as the application draws it: several pages
          reused here lay themselves out with it. */}
      <GlobalStyles
        styles={(t) => ({
          ".pane-separator": { width: 6, background: t.palette.divider, cursor: "col-resize", transition: "background .15s", outline: "none" },
          ".pane-separator:hover, .pane-separator:focus-visible, .pane-separator[data-separator='active'], .pane-separator[data-separator='hover']": {
            background: t.palette.primary.main,
          },
        })}
      />
      <MotionConfig reducedMotion="user">
        {isLogin ? <DemoLogin mode={mode} onToggleMode={toggleMode} />
          : <DemoShell mode={mode} onToggleMode={toggleMode} />}
      </MotionConfig>
    </ThemeProvider>
  );
}
