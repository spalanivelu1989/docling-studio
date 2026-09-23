import {
  Box, Button, Chip, Drawer, IconButton, Stack, Tooltip, Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { FileText, Lightbulb, SendHorizontal, X } from "lucide-react";

/** A question that is known to retrieve well against the indexed corpus.
 *
 *  These are not decoration: every one of them was run through the same
 *  hybrid search the Ask box uses, and `grounding` names the document the
 *  top excerpts actually came from. If the corpus is re-indexed with a
 *  different set of files these stop being true, so keep them honest by
 *  re-running them rather than editing them from memory.
 */
export interface SampleQuestion {
  question: string;
  /** The document(s) the top excerpts come back from. */
  grounding: string;
  /** What kind of document that is, in the reader's words. */
  kind: string;
  category: "PKG" | "DR" | "PKG+DR";
}

export const SAMPLE_QUESTIONS: SampleQuestion[] = [
  {
    question:
      "What is the end-to-end message flow for the signed PDF invoice sent to SOVOS, and which systems does it pass through?",
    grounding: "SPARK-22234 — FS Interface, SOVOS",
    kind: "Interface spec",
    category: "PKG",
  },
  {
    question:
      "How does the ATP and TRS check work on a sales order, and what happens when the TRS check fails?",
    grounding: "SPARK-51136 — ATP and TRS check",
    kind: "Enhancement spec",
    category: "PKG",
  },
  {
    question: "What triggers a billing split, and which fields drive the split?",
    grounding: "SPARK-49618 — Billing Split Enhancement",
    kind: "Enhancement spec",
    category: "PKG",
  },
  {
    question: "Which fields are mapped on the Order Confirmation PDF form?",
    grounding: "SPARK-21157 — Form, Order Confirmation PDF",
    kind: "Form spec",
    category: "PKG",
  },
  {
    question: "What are the delivery block rules at item line level?",
    grounding: "SPARK-21930 — Item Line Delivery Block",
    kind: "Enhancement spec",
    category: "PKG",
  },
  {
    question:
      "What data does the Salesforce complaints interface exchange with S/4HANA?",
    grounding: "SPARK-22877 + L2C-WS004 Salesforce",
    kind: "Interface spec & workshop",
    category: "PKG+DR",
  },
  {
    question: "How is returnable packaging handled in the L2C process?",
    grounding: "L2C-WS022 — deck, transcript and minutes",
    kind: "Workshop",
    category: "DR",
  },
  {
    question: "How does the eCommerce (SAP Commerce) integration create orders in S/4?",
    grounding: "eCommerce Requirement & SAP Commerce demo",
    kind: "Workshop",
    category: "DR",
  },
];

const CATEGORY_LABEL: Record<SampleQuestion["category"], string> = {
  PKG: "Package documents",
  DR: "Design records",
  "PKG+DR": "Both halves of the corpus",
};

export default function SampleQuestionsDrawer({
  open,
  onClose,
  onPick,
  onAsk,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  /** Put the question in the box and let the reader edit it before asking. */
  onPick: (question: string) => void;
  /** Ask it straight away. */
  onAsk: (question: string) => void;
  busy: boolean;
}) {
  const theme = useTheme();

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: { sx: { backdropFilter: "blur(4px)", bgcolor: "rgba(0, 0, 0, 0.35)" } },
        paper: {
          sx: {
            width: { xs: "100%", sm: 460, md: 520 },
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.paper",
            backgroundImage: "none",
            boxShadow:
              theme.palette.mode === "dark"
                ? "-8px 0 32px rgba(0, 0, 0, 0.7)"
                : "-8px 0 32px rgba(0, 0, 0, 0.12)",
          },
        },
      }}
    >
      {/* ---------- header ---------- */}
      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? alpha(t.palette.background.default, 0.7)
              : alpha(t.palette.background.paper, 0.95),
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: 2,
              bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
              color: "primary.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Lightbulb size={18} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
              Sample questions
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Eight questions the indexed corpus can actually answer
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close sample questions">
            <X size={16} />
          </IconButton>
        </Stack>
      </Box>

      {/* ---------- list ---------- */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.75, fontSize: 12.5 }}>
          Click a question to put it in the box, or use the arrow to ask it straight away.
          Each one names the document its excerpts come back from.
        </Typography>

        <Stack spacing={1.25}>
          {SAMPLE_QUESTIONS.map((q) => (
            <Box
              key={q.question}
              role="button"
              tabIndex={0}
              onClick={() => onPick(q.question)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(q.question);
                }
              }}
              sx={{
                p: 1.5,
                borderRadius: 2,
                border: 1,
                borderColor: "divider",
                cursor: "pointer",
                transition: "border-color .15s ease, background-color .15s ease",
                "&:hover, &:focus-visible": {
                  borderColor: (t) => alpha(t.palette.primary.main, 0.5),
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
                },
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 600, lineHeight: 1.45 }}>
                  {q.question}
                </Typography>
                <Tooltip title={busy ? "A question is already running" : "Ask this now"}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={busy}
                      aria-label="Ask this question now"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAsk(q.question);
                      }}
                      sx={{ mt: -0.25 }}
                    >
                      <SendHorizontal size={14} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              <Stack
                direction="row"
                spacing={0.75}
                useFlexGap
                sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }}
              >
                <Tooltip title={CATEGORY_LABEL[q.category]}>
                  <Chip
                    size="small"
                    label={q.category}
                    sx={{
                      height: 19,
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 1,
                      bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                      color: "primary.main",
                    }}
                  />
                </Tooltip>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontSize: 11, fontWeight: 600 }}
                >
                  {q.kind}
                </Typography>
                <Box sx={{ color: "text.disabled", display: "flex", alignItems: "center" }}>
                  <FileText size={11} />
                </Box>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontSize: 11, minWidth: 0 }}
                >
                  {q.grounding}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>

      {/* ---------- footer ---------- */}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        <Button
          fullWidth
          color="inherit"
          variant="outlined"
          onClick={onClose}
          sx={{ borderRadius: 1.75, textTransform: "none", fontWeight: 650, fontSize: 13 }}
        >
          Close
        </Button>
      </Box>
    </Drawer>
  );
}
