import { Box } from "@mui/material";

/** Empty space after a page's output, half a screen tall, so that scrolling to
 *  the very bottom leaves the last of the content in the middle of the screen
 *  rather than pinned to its lower edge -- the end of an answer is read where
 *  the eye already is. */
export default function ScrollRunway() {
  return <Box aria-hidden sx={{ height: "50vh", flex: "none" }} />;
}
