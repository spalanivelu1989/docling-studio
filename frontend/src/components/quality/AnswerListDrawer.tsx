/** The answers behind a mark: a subject, a document, a failure type, a group
 *  of invented claims. Worst first, so the reason for opening the list is at
 *  the top of it. Choosing one opens its judged working beside the list.
 */
import { Box, Chip, Drawer, IconButton, Stack, Typography, useTheme } from "@mui/material";
import { X } from "lucide-react";

import type { FailureType, QualityPoint } from "../../api";
import { band } from "./charts";

export default function AnswerListDrawer({ open, title, detail, points, failures, onClose, onOpen }: {
  open: boolean;
  title: string;
  detail?: string;
  points: QualityPoint[];
  failures: FailureType[];
  onClose: () => void;
  onOpen: (p: QualityPoint) => void;
}) {
  const theme = useTheme();
  const label = Object.fromEntries(failures.map((f) => [f.key, f.label]));
  const sorted = [...points].sort((a, b) => (a.overall ?? 2) - (b.overall ?? 2));
  return (
    <Drawer
      anchor="right" open={open} onClose={onClose}
      slotProps={{
        backdrop: { sx: { backdropFilter: "blur(4px)", bgcolor: "rgba(0, 0, 0, 0.35)" } },
        paper: { sx: { width: { xs: "100%", sm: 480, md: 520 }, display: "flex", flexDirection: "column" } },
      }}
    >
      <Box sx={{ p: 2.5, borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>
              {sorted.length} answer{sorted.length === 1 ? "" : "s"}
            </Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 700, mt: 0.25 }}>{title}</Typography>
            {detail && <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 0.5 }}>{detail}</Typography>}
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close the answer list"><X size={16} /></IconButton>
        </Stack>
      </Box>
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {sorted.map((p) => {
          const colour = p.overall === null ? theme.palette.text.disabled : band(theme, p.overall);
          return (
            <Box key={p.run_id} role="button" tabIndex={0} onClick={() => onOpen(p)}
                 onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p); } }}
                 sx={{
                   display: "grid", gridTemplateColumns: "4px 1fr auto", gap: 1.5, p: 1.25, borderRadius: 1.5,
                   cursor: "pointer", "&:hover, &:focus-visible": { bgcolor: "action.hover", outline: "none" },
                 }}>
              <Box sx={{ borderRadius: 2, bgcolor: colour }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.4 }}>{p.question}</Typography>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mt: 0.5, alignItems: "center" }}>
                  {p.failure && <Chip size="small" label={label[p.failure]} sx={{ height: 20, fontSize: 10.5 }} />}
                  <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
                    {p.half} · {p.mode}{p.at ? ` · ${new Date(p.at).toLocaleDateString()}` : ""}
                    {p.review ? ` · reviewed: ${p.review}` : ""}
                  </Typography>
                </Stack>
              </Box>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: colour, fontVariantNumeric: "tabular-nums", alignSelf: "center" }}>
                {p.overall?.toFixed(2) ?? "—"}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Drawer>
  );
}
