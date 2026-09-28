/** The working behind an alignment score, shown on hover: the formula, then
 *  this run's own seven ratings run through it, down to the percentage on the
 *  card and the divergence that is its complement.
 *
 *  The arithmetic is backend/agents/rollout/scoring.py `_weighted`, restated
 *  on the rows the run returned. The total is recomputed here from those rows
 *  and the card's own figure is shown beside it, so a reader never has to
 *  take the sum on trust -- and if the two ever disagreed, both would show. */
import { alpha, Box, Tooltip, Typography, useTheme } from "@mui/material";
import type { ReactElement } from "react";

import type { RolloutScores } from "../../api";
import { MONO } from "./premium";

type Row = RolloutScores["dimensions"][number];

const fmt = (n: number, dp = 2) => Number(n.toFixed(dp)).toString();

function Working({ title, against, rows, value, band }: {
  title: string; against: string; rows: Row[]; value: number; band: string;
}) {
  const theme = useTheme();
  const rated = rows.filter((r) => r.rating !== null);
  const points = rated.reduce((s, r) => s + (r.rating! / 4) * r.weight, 0);
  const weights = rated.reduce((s, r) => s + r.weight, 0);
  const exact = (points / weights) * 100;
  const cell = { px: 1, py: 0.4, fontSize: 12, fontVariantNumeric: "tabular-nums" } as const;
  const head = { ...cell, fontSize: 10.5, fontWeight: 700, color: "text.secondary",
                 textTransform: "uppercase", letterSpacing: "0.05em" } as const;
  const line = { fontFamily: MONO, fontSize: 12, lineHeight: 1.7 } as const;

  return (
    <Box sx={{ p: 1.75, width: 440, maxWidth: "calc(100vw - 32px)" }}>
      <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{title}</Typography>
      <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25, mb: 1.25 }}>
        Each of seven areas is rated 0–4 against {against}, turned into a percentage and
        weighted by how much the area counts.
      </Typography>

      <Box sx={{ ...line, px: 1.25, py: 0.75, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.07), mb: 1.25 }}>
        Alignment = Σ (rating ÷ 4 × weight) ÷ Σ weight
        <br />
        Divergence = 100 − Alignment
      </Box>

      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& td, & th": { borderBottom: 1, borderColor: "divider" } }}>
        <thead>
          <tr>
            <Box component="th" sx={{ ...head, textAlign: "left" }}>Area</Box>
            <Box component="th" sx={{ ...head, textAlign: "right" }}>Rating</Box>
            <Box component="th" sx={{ ...head, textAlign: "right" }}>Weight</Box>
            <Box component="th" sx={{ ...head, textAlign: "right" }}>Points</Box>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Box component="tr" key={r.dimension} sx={{ color: r.rating === null ? "text.disabled" : "text.primary" }}>
              <Box component="td" sx={cell}>{r.label}</Box>
              <Box component="td" sx={{ ...cell, textAlign: "right" }}>{r.rating === null ? "—" : `${r.rating}/4`}</Box>
              <Box component="td" sx={{ ...cell, textAlign: "right" }}>{r.weight}</Box>
              <Box component="td" sx={{ ...cell, textAlign: "right", fontFamily: MONO }}>
                {r.rating === null ? "not rated" : `${r.rating}/4 × ${r.weight} = ${fmt((r.rating / 4) * r.weight)}`}
              </Box>
            </Box>
          ))}
          <tr>
            <Box component="td" sx={{ ...cell, fontWeight: 700 }}>Total</Box>
            <Box component="td" sx={cell} />
            <Box component="td" sx={{ ...cell, textAlign: "right", fontWeight: 700 }}>{weights}</Box>
            <Box component="td" sx={{ ...cell, textAlign: "right", fontWeight: 700, fontFamily: MONO }}>{fmt(points)}</Box>
          </tr>
        </tbody>
      </Box>

      <Box sx={{ ...line, mt: 1.25 }}>
        Alignment = {fmt(points)} ÷ {weights} × 100 ={" "}
        {/* The exact result first when the card shows it rounded, so 51.25
            becoming 51.3 reads as rounding rather than as a wrong sum. */}
        {fmt(exact) !== fmt(value, 1) && <>{fmt(exact)} ≈ </>}
        <b>{fmt(value, 1)}%</b>
        <br />
        Divergence = 100 − {fmt(value, 1)} = <b>{fmt(100 - value, 1)}%</b>
      </Box>
      {weights < 100 && (
        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.75 }}>
          Unrated areas are left out rather than counted as zero, so the total is divided by{" "}
          {weights} instead of 100.
        </Typography>
      )}
      {band && (
        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.75 }}>
          {fmt(value, 1)}% reads as “{band}”.
        </Typography>
      )}
    </Box>
  );
}

/** Wraps a score figure; hovering or focusing it opens the working. With no
 *  score (not assessable) there is no working to show, so the child is
 *  returned as it is. */
export default function FormulaTooltip({ children, title, against, rows, value, band }: {
  children: ReactElement; title: string; against: string;
  rows: Row[]; value: number | null; band: string;
}) {
  if (value === null || !rows.some((r) => r.rating !== null)) return children;
  return (
    <Tooltip
      placement="bottom-start"
      arrow
      enterDelay={150}
      title={<Working title={title} against={against} rows={rows} value={value} band={band} />}
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: "background.paper", color: "text.primary", border: 1, borderColor: "divider",
            borderRadius: "10px", boxShadow: 6, p: 0, maxWidth: "none",
          },
        },
        arrow: { sx: { color: "background.paper", "&::before": { border: 1, borderColor: "divider" } } },
      }}
    >
      {children}
    </Tooltip>
  );
}
