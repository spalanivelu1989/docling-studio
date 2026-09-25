/** A verdict on a deviation, as every view that records one draws it: the
 *  standing verdict and who gave it, and the three buttons that add another.
 *  The log is append-only, so the last row is the verdict and the rest are
 *  how it got there. */
import { Button, Stack, Typography, useTheme } from "@mui/material";

import type { RolloutDecision } from "../../api";
import { RADIUS, usePremium } from "./premium";

export type Verdict = "accept" | "reject" | "defer";
export type OnDecide = (gapId: string, verdict: Verdict, comment?: string) => void;

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

export function DecisionButtons({ gapId, reviewer, deciding, onDecide, comment, decisions }: {
  gapId: string;
  reviewer: string;
  deciding: Record<string, string>;
  onDecide?: OnDecide;
  comment?: string;
  decisions?: RolloutDecision[];
}) {
  const last = latest(decisions);
  const named = !!reviewer.trim();
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
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          {(["accept", "defer", "reject"] as const).map((v) => (
            <Button key={v} size="small" variant={v === "accept" ? "contained" : "outlined"} disableElevation
                    color={v === "reject" ? "error" : "primary"}
                    disabled={!named || !!deciding[gapId]}
                    onClick={() => onDecide(gapId, v, comment)}
                    sx={{ textTransform: "none", borderRadius: RADIUS, minWidth: 76 }}>
              {deciding[gapId] === v ? "Saving…" : v[0].toUpperCase() + v.slice(1)}
            </Button>
          ))}
          {!named && <Typography sx={{ fontSize: 12, color: "error.main" }}>Name yourself in Deciding as to decide.</Typography>}
        </Stack>
      )}
    </Stack>
  );
}
