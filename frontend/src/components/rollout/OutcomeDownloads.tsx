/** The workshop's outcome as a file the client keeps: Word, PDF, Excel or
 *  Markdown. Plain links to the export endpoint, so the browser handles the
 *  download and nothing is held in memory here. With a session it is what that
 *  sitting submitted; without one, the current decision on every gap. */
import { Button, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { Download } from "lucide-react";
import { useState } from "react";

import { rollout } from "../../api";
import { RADIUS } from "./premium";

export const OUTCOME_FORMATS = [
  { key: "docx", label: "Word" },
  { key: "pdf", label: "PDF" },
  { key: "xlsx", label: "Excel" },
  { key: "md", label: "Markdown" },
] as const;

export default function OutcomeDownloads({ runId, session, variant = "menu", disabled }: {
  runId: string;
  session?: string;
  variant?: "menu" | "buttons";
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const href = (f: string) => rollout.workshopExportUrl(runId, f, session);
  const sx = { textTransform: "none", borderRadius: RADIUS, whiteSpace: "nowrap" } as const;

  if (variant === "buttons") {
    return (
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 14, color: "text.secondary", mr: 0.5 }}>Download the outcome</Typography>
        {OUTCOME_FORMATS.map((f) => (
          <Button key={f.key} component="a" href={href(f.key)} download variant="outlined" size="small"
                  startIcon={<Download size={14} />} disabled={disabled} sx={sx}>
            {f.label}
          </Button>
        ))}
      </Stack>
    );
  }
  return (
    <>
      <Button variant="outlined" disabled={disabled} startIcon={<Download size={15} />}
              onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu"
              title={disabled ? "Nothing has been decided yet" : "The decisions so far, as a file"} sx={sx}>
        Download outcome
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {OUTCOME_FORMATS.map((f) => (
          <MenuItem key={f.key} component="a" href={href(f.key)} download onClick={() => setAnchor(null)}
                    sx={{ fontSize: 13.5 }}>
            {f.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
