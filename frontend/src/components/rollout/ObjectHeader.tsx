/** The navy band at the top of the Fit-Gap Copilot: what this analysis is,
 *  what it concluded in one number, and what can be done with it. The same
 *  band heads the New analysis screen, without the figures. */
import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

import { ALIGNMENT_BANDS, MONO, usePremium } from "./premium";

export type HeaderKpi = { label: string; value: string; sub: string };

export default function ObjectHeader({ breadcrumb, title, badge, meta, actions, score, kpis }: {
  breadcrumb: string;
  title: string;
  badge?: string;
  meta?: string;
  actions?: ReactNode;
  /** The headline score and its band, drawn on the 0–100 band scale. */
  score?: { value: number | null; band: string; label: string } | null;
  kpis?: HeaderKpi[];
}) {
  const p = usePremium();
  return (
    <Box sx={{ bgcolor: p.band, color: p.bandText, px: { xs: 2, md: 4 }, pt: 2.75, pb: score || kpis?.length ? 0 : 2.75 }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "flex-start" } }}>
        <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, color: p.bandMuted }}>{breadcrumb}</Typography>
          <Stack direction="row" spacing={1.75} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography component="h1" sx={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              {title}
            </Typography>
            {badge && (
              <Box component="span" sx={{ fontSize: 12, fontWeight: 600, px: 1.25, py: 0.35, borderRadius: "3px",
                                          border: `1px solid ${p.accentOnBand}`, color: p.accentOnBand }}>
                {badge}
              </Box>
            )}
          </Stack>
          {meta && <Typography sx={{ fontSize: 13, color: p.bandSoft }}>{meta}</Typography>}
        </Stack>
        {actions && <Stack direction="row" spacing={1.25} useFlexGap sx={{ pt: { md: 2.25 }, flexWrap: "wrap" }}>{actions}</Stack>}
      </Stack>

      {(score || !!kpis?.length) && (
        <Box sx={{ display: "grid", mt: 2.25, borderTop: `1px solid ${p.bandLine}`,
                   gridTemplateColumns: { xs: "1fr 1fr", md: `1.5fr repeat(${kpis?.length ?? 0}, minmax(0, 1fr))` } }}>
          {score && (
            <Stack spacing={1} sx={{ py: 2, pr: 3, borderRight: `1px solid ${p.bandLine}`, gridColumn: { xs: "1 / -1", md: "auto" } }}>
              <Typography sx={{ fontSize: 12, color: p.bandMuted }}>{score.label}</Typography>
              <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
                <Typography sx={{ fontFamily: MONO, fontSize: 34, fontWeight: 500, lineHeight: 1 }}>
                  {score.value === null ? "—" : score.value.toFixed(1)}
                </Typography>
                <Typography sx={{ fontSize: 13, color: p.bandMuted }}>/ 100</Typography>
                {score.band && <Typography sx={{ fontSize: 13, fontWeight: 600, color: p.amberOnBand }}>{score.band}</Typography>}
              </Stack>
              <Box sx={{ position: "relative", display: "flex", gap: "2px", height: 8 }}>
                {ALIGNMENT_BANDS.map((w, i) => (
                  <Box key={i} sx={{ flex: `${w} 1 0`, bgcolor: p.bandLine, opacity: 0.55 + i * 0.1 }} />
                ))}
                {score.value !== null && (
                  <Box sx={{ position: "absolute", left: `${Math.max(0, Math.min(100, score.value))}%`, top: -4, height: 16,
                             borderLeft: `3px solid ${p.bandText}` }} />
                )}
              </Box>
              <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                {["0", "40", "60", "75", "90", "100"].map((t) => (
                  <Typography key={t} sx={{ fontSize: 10.5, fontFamily: MONO, color: p.bandMuted }}>{t}</Typography>
                ))}
              </Stack>
            </Stack>
          )}
          {kpis?.map((k) => (
            <Stack key={k.label} spacing={0.5} sx={{ py: 2, px: 2.5, borderRight: `1px solid ${p.bandLine}`,
                                                     "&:last-of-type": { borderRight: 0 } }}>
              <Typography sx={{ fontSize: 12, color: p.bandMuted }}>{k.label}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 24, fontWeight: 500, lineHeight: 1.2 }}>{k.value}</Typography>
              <Typography sx={{ fontSize: 12, color: p.bandSoft }}>{k.sub}</Typography>
            </Stack>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** A button that reads on the navy band: outlined, or filled with the accent. */
export function BandButton({ children, onClick, href, primary, disabled, startIcon, title }: {
  children: ReactNode; onClick?: () => void; href?: string; primary?: boolean; disabled?: boolean;
  startIcon?: ReactNode; title?: string;
}) {
  const p = usePremium();
  return (
    <Box component={href && !disabled ? "a" : "button"} type={href ? undefined : "button"}
         href={href && !disabled ? href : undefined} onClick={disabled ? undefined : onClick}
         disabled={disabled} title={title}
         sx={{
           height: 36, px: 2, display: "inline-flex", alignItems: "center", gap: 0.9, borderRadius: "4px",
           fontSize: 13, fontWeight: primary ? 600 : 500, fontFamily: "inherit", textDecoration: "none",
           cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
           bgcolor: primary ? p.accentOnBand : "transparent",
           color: primary ? p.onAccent : p.bandText,
           border: `1px solid ${primary ? p.accentOnBand : p.bandLine}`,
           "&:hover": { filter: disabled ? "none" : "brightness(1.08)", borderColor: primary ? p.accentOnBand : p.bandMuted },
           "&:focus-visible": { outline: `2px solid ${p.accentOnBand}`, outlineOffset: 2 },
         }}>
      {startIcon}{children}
    </Box>
  );
}
