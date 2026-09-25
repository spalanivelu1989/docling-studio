import { Box, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";

import { materialityColour } from "./premium";

/** Materiality as a tinted tag. The word is always printed, so the colour is
 *  never the only thing carrying it. */
export default function MaterialityPill({ value }: { value: string }) {
  const theme = useTheme();
  const c = materialityColour(theme, value);
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 600, px: 1, py: 0.25,
                                borderRadius: "3px", color: c, bgcolor: alpha(c, theme.palette.mode === "dark" ? 0.18 : 0.1),
                                whiteSpace: "nowrap" }}>
      {value}
    </Box>
  );
}
