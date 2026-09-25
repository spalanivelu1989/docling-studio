/** The logo beside "Spark AI Spine": in the application's header, and on
 *  Demo Mode's sign-in screen and header.
 *
 *  The mark is teal and dark navy on a transparent background. The navy bars
 *  all but vanish against the dark theme's base, so in dark mode it sits on a
 *  light tile -- the logo is shown as supplied, never recoloured. */
import { Box } from "@mui/material";
import { alpha } from "@mui/material/styles";
import logo from "../assets/logo.png";

export default function BrandLogo({ size }: { size: number }) {
  return (
    <Box
      sx={(th) => ({
        width: size, height: size, flexShrink: 0, display: "grid", placeItems: "center",
        borderRadius: size >= 40 ? 2.5 : 2,
        bgcolor: th.palette.mode === "dark" ? alpha(th.palette.common.white, 0.92) : "transparent",
      })}
    >
      <Box component="img" src={logo} alt="" draggable={false}
           sx={{ height: Math.round(size * 0.82), width: "auto", maxWidth: "100%", objectFit: "contain", display: "block", userSelect: "none" }} />
    </Box>
  );
}
