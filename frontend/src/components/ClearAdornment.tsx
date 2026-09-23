import { IconButton, InputAdornment, Tooltip } from "@mui/material";
import { X } from "lucide-react";

/** The clear button that sits at the right-hand end of a search field.
 *
 *  Returns `undefined` when the field is empty, which is what makes it appear
 *  only once there is something to clear -- an X on an empty box is a control
 *  that does nothing, and it crowds a field that is often only 140px wide.
 *
 *  `onMouseDown` preventDefault rather than onClick alone: the button would
 *  otherwise take focus from the input on the way down, and a field that loses
 *  focus when you clear it makes you click back into it to keep typing.
 */
export function clearAdornment(
  value: string,
  onClear: () => void,
  opts: { size?: number; label?: string; top?: boolean } = {},
) {
  if (!value) return undefined;
  const { size = 14, label = "Clear search", top = false } = opts;
  return (
    <InputAdornment
      position="end"
      // `top` for a box that grows as you type: a clear button that rides down
      // with the last line is a moving target, so on a multiline field it stays
      // level with the first line where the icon on the left is.
      sx={top ? { alignSelf: "flex-start", mt: 0.9 } : undefined}
    >
      <Tooltip title={label}>
        <IconButton
          size="small"
          aria-label={label}
          edge="end"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          sx={{ p: 0.35, color: "text.disabled", "&:hover": { color: "text.primary" } }}
        >
          <X size={size} />
        </IconButton>
      </Tooltip>
    </InputAdornment>
  );
}

/** Escape clears the field too, which is what a search box is expected to do
 *  and what the keyboard reaches for before the mouse does. */
export function clearOnEscape(onClear: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClear();
    }
  };
}
