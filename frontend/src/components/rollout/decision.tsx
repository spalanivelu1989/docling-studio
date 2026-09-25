/** A verdict on a deviation, as every view that records one draws it: the
 *  standing verdict and who gave it, and the three buttons that add another.
 *  The log is append-only, so the last row is the verdict and the rest are
 *  how it got there. */
import { Button, Stack, TextField, Typography, useTheme } from "@mui/material";
import { useState } from "react";

import type { RolloutDecision } from "../../api";
import { RADIUS, usePremium } from "./premium";

export type Verdict = "accept" | "reject" | "defer";
/** What goes with a verdict: the option chosen, by its position in the list
 *  the room was shown, and why. Deferring or rejecting needs a reason. */
export interface DecisionExtra {
  option?: number;
  rationale?: string;
}
export type OnDecide = (gapId: string, verdict: Verdict, extra?: DecisionExtra) => void;

/** Defer and Reject say nothing useful later without a reason. */
export const needsRationale = (v: Verdict) => v !== "accept";

export const VERDICT_LABEL: Record<Verdict, string> = { accept: "Accepted", defer: "Deferred", reject: "Rejected" };

export function latest(ds?: RolloutDecision[]): RolloutDecision | undefined {
  return ds?.length ? ds[ds.length - 1] : undefined;
}

export function useVerdictColour() {
  const theme = useTheme();
  const p = usePremium();
  return (v?: string) => v === "accept" ? p.accent : v === "defer" ? theme.palette.warning.main
    : v === "reject" ? theme.palette.error.main : theme.palette.text.secondary;
}

/** "Open", or "Accepted" in the verdict's colour. */
export function StatusText({ decision, size = 12.5 }: { decision?: RolloutDecision; size?: number }) {
  const colour = useVerdictColour();
  const v = decision?.verdict as Verdict | undefined;
  return (
    <Typography component="span" title={decision ? `${VERDICT_LABEL[v!]} by ${decision.reviewer}` : "No verdict yet"}
                sx={{ fontSize: size, fontWeight: v ? 600 : 400, color: colour(v), whiteSpace: "nowrap" }}>
      {v ? VERDICT_LABEL[v] : "Open"}
    </Typography>
  );
}

export function DecisionButtons({ gapId, reviewer, deciding, onDecide, option, decisions }: {
  gapId: string;
  reviewer: string;
  deciding: Record<string, string>;
  onDecide?: OnDecide;
  /** The option picked on the card, if any. */
  option?: number;
  decisions?: RolloutDecision[];
}) {
  const last = latest(decisions);
  const named = !!reviewer.trim();
  const [rationale, setRationale] = useState("");
  const why = rationale.trim();
  return (
    <Stack spacing={1}>
      {last && (
        <Typography sx={{ fontSize: 12.5 }}>
          <b>{VERDICT_LABEL[last.verdict]}</b> by {last.reviewer}
          {last.comment ? ` — ${last.comment}` : ""}
          {decisions && decisions.length > 1 ? ` (${decisions.length} verdicts)` : ""}
        </Typography>
      )}
      {onDecide && (
        <>
          <TextField size="small" fullWidth multiline maxRows={4} value={rationale}
                     onChange={(e) => setRationale(e.target.value)}
                     label="Rationale" placeholder="Why this was decided (needed to defer or reject)"
                     slotProps={{ htmlInput: { maxLength: 2000 } }}
                     sx={{ "& .MuiInputBase-input": { fontSize: 12.5 }, "& .MuiOutlinedInput-root": { borderRadius: RADIUS } }} />
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
            {(["accept", "defer", "reject"] as const).map((v) => (
              <Button key={v} size="small" variant={v === "accept" ? "contained" : "outlined"} disableElevation
                      color={v === "reject" ? "error" : "primary"}
                      disabled={!named || !!deciding[gapId] || (needsRationale(v) && !why)}
                      title={needsRationale(v) && !why ? "Write a rationale first" : undefined}
                      onClick={() => { onDecide(gapId, v, { option, rationale: why || undefined }); setRationale(""); }}
                      sx={{ textTransform: "none", borderRadius: RADIUS, minWidth: 76 }}>
                {deciding[gapId] === v ? "Saving…" : v[0].toUpperCase() + v.slice(1)}
              </Button>
            ))}
            {!named && <Typography sx={{ fontSize: 12, color: "error.main" }}>Name yourself in Deciding as to decide.</Typography>}
          </Stack>
        </>
      )}
    </Stack>
  );
}
