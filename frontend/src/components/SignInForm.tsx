/** A static sign-in screen, shared by Demo Mode (/demo/login) and the
 *  application (/login). Each passes where to post and where it may go next.
 *
 *  The credentials are checked by the server, never here, so the password is
 *  not in any bundle. On success the server sets an HttpOnly session cookie
 *  and the page goes on to where the reader was heading. */
import {
  Alert, Box, Button, IconButton, InputAdornment, Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { motion } from "framer-motion";
import { Eye, EyeOff, LogIn, Moon, Sun } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Mode } from "../theme";
import BrandLogo from "./BrandLogo";

export default function SignInForm({ mode, onToggleMode, endpoint, subtitle, nextTarget, idPrefix }: {
  mode: Mode;
  onToggleMode: () => void;
  /** Where the credentials are posted. */
  endpoint: string;
  subtitle: string;
  /** Where to go on success. Must only ever return a path on this site. */
  nextTarget: () => string;
  idPrefix: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Enter a username and a password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Sign-in failed (${res.status}).`);
      }
      location.replace(nextTarget());
    } catch (err) {
      setError((err as Error).message || "Sign-in failed.");
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "background.default", px: 2, position: "relative" }}>
      <Tooltip title={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}>
        <IconButton onClick={onToggleMode} aria-label="Switch theme" sx={{ position: "absolute", top: 12, right: 12 }}>
          {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
      </Tooltip>

      <Paper
        component={motion.form}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        onSubmit={submit}
        variant="outlined"
        sx={{ width: "100%", maxWidth: 400, p: { xs: 3, sm: 4 }, borderRadius: 3 }}
      >
        <Stack spacing={3}>
          <Stack spacing={1.5} sx={{ alignItems: "center", textAlign: "center" }}>
            <BrandLogo size={56} />
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 22, letterSpacing: "-.01em" }}>
                Spark AI{" "}
                <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>Spine</Box>
              </Typography>
              <Typography sx={{ fontSize: 13.5, color: "text.secondary", mt: 0.5 }}>
                {subtitle}
              </Typography>
            </Box>
          </Stack>

          {error && <Alert severity="error" variant="outlined">{error}</Alert>}

          <Stack spacing={2}>
            <TextField
              id={`${idPrefix}-username`} label="Username" value={username} autoFocus fullWidth
              autoComplete="username" onChange={(e) => setUsername(e.target.value)}
            />
            <TextField
              id={`${idPrefix}-password`} label="Password" value={password} fullWidth
              type={show ? "text" : "password"} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShow(!show)} edge="end" size="small"
                        aria-label={show ? "Hide password" : "Show password"}
                      >
                        {show ? <EyeOff size={17} /> : <Eye size={17} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Stack>

          <Button
            type="submit" variant="contained" size="large" disabled={busy}
            startIcon={<LogIn size={18} />} sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
