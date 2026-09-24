import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider, Drawer, IconButton,
  Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { Brain, ChevronDown, Lightbulb, Search, SendHorizontal, X } from "lucide-react";
import { useState } from "react";
import { evidence, type MemoryReflection } from "../api";
import Markdown from "./Markdown";
import { surface } from "../theme";

/** Ask the memory bank a question about itself.
 *
 *  This is REFLECT, the third of Hindsight's three operations, and the only
 *  one a person drives. The other two belong to a run: `recall` searches
 *  memories and puts rows in front of the agent before its first search,
 *  `retain` writes down what the run established afterwards. Reflect reads the
 *  bank and WRITES AN ANSWER -- an agentic loop over text that was itself
 *  written by a model.
 *
 *  It is here, in front of a person, rather than in an investigation, for two
 *  reasons that are worth keeping:
 *
 *    * it answers what nothing else can. No corpus document says which
 *      interfaces have been investigated, or where two runs disagreed with
 *      each other; that only exists across the bank.
 *
 *    * it is a summary of summaries, one step further from a verified quote
 *      than a memory already is. The structural guarantee still holds -- none
 *      of this is in `session.retrieved`, so none of it can become a citation
 *      -- but prose the agent cannot check belongs where a person can check
 *      it. That is the whole reason this is a panel and not a tool.
 *
 *  So the answer is framed as a briefing, never as evidence, and every fact it
 *  leaned on is listed underneath so a reader can see what it is built from.
 */

/** The questions worth asking a bank of past investigations, as opposed to
 *  asking the corpus. Each one is a cross-run question: no single run holds
 *  the answer, and no document does either. */
const STARTERS = [
  "Which interfaces or specifications have we investigated, and what did each conclude?",
  "Where do two of our investigations disagree with each other?",
  "What questions were left open across all our investigations, and who owns them?",
  "What has the corpus turned out not to cover?",
];

const TYPE_HINT: Record<string, string> = {
  world: "A durable fact about the programme.",
  observation: "Something noticed in a run, consolidated across several.",
  experience: "Something that happened to the agent itself.",
  opinion: "A judgement, held rather than proven.",
};

export default function MemoryReflectDrawer({
  open, onClose, memories,
}: {
  open: boolean;
  onClose: () => void;
  /** How many memories the bank holds, for the header. */
  memories: number;
}) {
  const theme = useTheme();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MemoryReflection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setQuestion(text);
    setAsked(text);
    setBusy(true);
    setError(null);
    setResult(null);
    setSourcesOpen(false);
    try {
      setResult(await evidence.reflect(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const usage = result?.usage;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: { sx: { backdropFilter: "blur(4px)", bgcolor: "rgba(0, 0, 0, 0.35)" } },
        paper: {
          sx: {
            width: { xs: "100%", sm: 520, md: 620 },
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.paper",
            backgroundImage: "none",
            boxShadow: theme.palette.mode === "dark"
              ? "-8px 0 32px rgba(0, 0, 0, 0.7)"
              : "-8px 0 32px rgba(0, 0, 0, 0.12)",
          },
        },
      }}
    >
      {/* ---------- header ---------- */}
      <Box
        sx={{
          p: 2, borderBottom: 1, borderColor: "divider",
          bgcolor: (t) => t.palette.mode === "dark"
            ? alpha(t.palette.background.default, 0.7)
            : alpha(t.palette.background.paper, 0.95),
          backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 10,
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1.5 }}>
          <Box
            sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: (t) => alpha(t.palette.secondary.main, 0.12),
              color: "secondary.main",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Lightbulb size={18} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
              Ask the memory
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {memories
                ? `${memories} memor${memories === 1 ? "y" : "ies"} from past investigations`
                : "The bank is empty"}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <X size={16} />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <TextField
            fullWidth size="small" multiline maxRows={3} value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(question); }
            }}
            placeholder="Ask about what earlier investigations found…"
            slotProps={{ input: { sx: { fontSize: 13, borderRadius: 1.75 } } }}
          />
          <Tooltip title={busy ? "Reading the bank…" : "Ask"}>
            <span>
              <Button
                variant="contained" size="small" disabled={busy || !question.trim()}
                onClick={() => void ask(question)}
                sx={{ minWidth: 0, px: 1.5, height: 38 }}
              >
                {busy ? <CircularProgress size={15} color="inherit" /> : <SendHorizontal size={15} />}
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      {/* ---------- body ---------- */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!asked && !busy && (
          <Stack spacing={1.5}>
            <Typography sx={{ fontSize: 12.5, color: "text.secondary", lineHeight: 1.65 }}>
              This reads every memory the agent has kept and writes an answer from them.
              It is the question the <b>corpus</b> cannot answer — what have we looked at,
              what did we conclude, where did two runs disagree.
            </Typography>
            <Typography variant="overline" sx={{ fontSize: 10, color: "text.secondary" }}>
              Questions worth asking a memory
            </Typography>
            <Stack spacing={1}>
              {STARTERS.map((s) => (
                <Box
                  key={s}
                  role="button"
                  tabIndex={0}
                  onClick={() => void ask(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void ask(s); }
                  }}
                  sx={{
                    p: 1.4, borderRadius: 2, border: 1, borderColor: "divider", cursor: "pointer",
                    fontSize: 12.5, lineHeight: 1.5,
                    transition: "border-color .15s ease, background-color .15s ease",
                    "&:hover, &:focus-visible": {
                      borderColor: (t) => alpha(t.palette.secondary.main, 0.5),
                      bgcolor: (t) => alpha(t.palette.secondary.main, 0.05),
                    },
                  }}
                >
                  {s}
                </Box>
              ))}
            </Stack>
          </Stack>
        )}

        {busy && (
          <Stack spacing={1.25} sx={{ color: "text.secondary" }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <CircularProgress size={15} />
              <Typography sx={{ fontSize: 13 }}>Reading the bank…</Typography>
            </Stack>
            {/* Half a minute of nothing reads as a hang. Say what is happening
                and roughly how long, so waiting is a choice rather than a
                worry. */}
            <Typography sx={{ fontSize: 11.5, lineHeight: 1.6 }}>
              This is a model reading every memory and writing an answer, so it takes
              longer than a search — around 30 to 60 seconds.
            </Typography>
          </Stack>
        )}

        {error && (
          <Alert severity="warning" sx={{ borderRadius: 2, fontSize: 12.5 }}>{error}</Alert>
        )}

        {result && !busy && (
          <Stack spacing={1.75}>
            {/* The frame, before the answer, because the answer is persuasive
                and this is the thing a reader most needs to hold on to. */}
            <Alert
              severity="info"
              icon={<Brain size={16} />}
              sx={{ borderRadius: 2, fontSize: 11.5, lineHeight: 1.6, py: 0.5 }}
            >
              A briefing from memory, <b>not evidence</b>. It is written from what earlier
              runs concluded, not from the corpus, and nothing here can be cited — ask the
              Evidence Agent to prove anything you intend to act on.
            </Alert>

            <Typography sx={{ fontSize: 12.5, fontWeight: 650, color: "text.secondary" }}>
              {asked}
            </Typography>

            <Box sx={{ fontSize: 13 }}>
              <Markdown source={result.text} />
            </Box>

            {!!result.searched.length && (
              <Box>
                <Typography variant="overline" sx={{ fontSize: 10, color: "text.secondary" }}>
                  How it looked
                </Typography>
                {/* The searches it ran, in order. Worth showing because a
                    reflection that searched the wrong words explains an answer
                    that missed something, and nothing else would say so. */}
                <Stack spacing={0.4} sx={{ mt: 0.4 }}>
                  {result.searched.map((q, i) => (
                    <Stack key={i} direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
                      <Search size={11} style={{ flex: "none", marginTop: 3, opacity: 0.6 }} />
                      <Typography sx={{ fontSize: 11.5, color: "text.secondary", lineHeight: 1.55 }}>
                        {q}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}

            {!!result.based_on.length && (
              <Box>
                <Stack
                  direction="row" spacing={0.75}
                  sx={{ alignItems: "center", cursor: "pointer" }}
                  role="button" tabIndex={0} aria-expanded={sourcesOpen}
                  onClick={() => setSourcesOpen((o) => !o)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSourcesOpen((o) => !o); }
                  }}
                >
                  <Typography variant="overline" sx={{ fontSize: 10, color: "text.secondary" }}>
                    Read {result.based_on.length} memor{result.based_on.length === 1 ? "y" : "ies"}
                  </Typography>
                  <ChevronDown
                    size={14}
                    style={{ transform: sourcesOpen ? "rotate(180deg)" : undefined, transition: "transform .2s" }}
                  />
                </Stack>
                <Collapse in={sourcesOpen}>
                  <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                    {result.based_on.map((f) => (
                      <Box key={f.id} sx={{ p: 1.2, borderRadius: 1.5, bgcolor: (t) => surface(t, 0.5) }}>
                        {f.type && (
                          <Tooltip title={TYPE_HINT[f.type] ?? f.type}>
                            <Chip
                              size="small" variant="outlined" label={f.type}
                              sx={{ height: 16, fontSize: 9, mr: 0.75, verticalAlign: "middle" }}
                            />
                          </Tooltip>
                        )}
                        <Typography component="span" sx={{ fontSize: 11.5, lineHeight: 1.6 }}>
                          {f.text}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Collapse>
              </Box>
            )}
          </Stack>
        )}
      </Box>

      {/* ---------- what it cost ---------- */}
      {result && !busy && (usage?.input_tokens || usage?.output_tokens) && (
        <>
          <Divider />
          <Stack
            direction="row" spacing={1}
            sx={{ p: 1.25, alignItems: "center", bgcolor: "background.default" }}
          >
            {/* Shown because this is the one button in the app that spends real
                money per press, and the input side grows with the bank. */}
            <Tooltip title="Reflect reads the whole bank, so the input side grows as the bank does">
              <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                {(usage.input_tokens ?? 0).toLocaleString()} in ·{" "}
                {(usage.output_tokens ?? 0).toLocaleString()} out
              </Typography>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Button
              size="small" variant="text" disabled={busy}
              onClick={() => { setAsked(""); setResult(null); setQuestion(""); }}
              sx={{ fontSize: 11.5 }}
            >
              Ask something else
            </Button>
          </Stack>
        </>
      )}
    </Drawer>
  );
}
