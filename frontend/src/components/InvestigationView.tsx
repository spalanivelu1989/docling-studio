/** Investigation — how a run arrived at each finding, and how to check it.
 *
 *  Shared by the Fit-Gap Copilot (rollout/lineage.py) and the Evidence Agent
 *  (evidence/lineage.py), which trace their runs into one shape through the
 *  checks in fitgap/lineage.py. Two readings of the same record:
 *
 *    Trace a finding  pick any claim -- an As-Is step, a deviation, a fit
 *                     area, a rating -- and walk it back: its quotes, the call
 *                     that retrieved each one and with what query and rank,
 *                     whether the quote really is in what that call returned,
 *                     the reasoning behind the calls, the graph entities it
 *                     names, the send-backs and gates that touched it, and how
 *                     its numbers were computed.
 *    Audit trail      the investigation in order, every call annotated with
 *                     which findings it supplied evidence for.
 *
 *  Every call number opens the call itself, so a reader can see the full
 *  ranked result the agent was shown and check a quote with their own eyes. */
import {
  Alert, Box, Button, ButtonBase, Chip, InputAdornment, Link, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip,
  Typography, useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  CircleAlert, CircleCheck, CircleDashed, Download, GitBranch, Globe, Network, ScanLine, Search, Sigma, Terminal,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  type Lineage, type LineageClaim, type LineageEvidence, type LineageGraphFact, type LineageTrailEntry,
} from "../api";
import { MONO, RADIUS, usePremium } from "./rollout/premium";

const KIND_LABEL: Record<LineageClaim["kind"], string> = {
  claim: "Claims", deviation: "Deviations", asis_step: "As-Is steps", fit_area: "Fit areas", localization: "Localization",
  dimension: "Dimension ratings", backlog: "Backlog",
};
const KIND_ORDER: LineageClaim["kind"][] = ["claim", "deviation", "dimension", "fit_area", "localization", "asis_step", "backlog"];

const STANCE_TONE: Record<string, "success" | "error" | "default"> = {
  supports: "success", opposes: "error", context: "default",
};

const SIDE_LABEL: Record<string, string> = {
  as_is: "As-Is", template: "Global Template", sap_bp: "SAP Best Practice", localization: "Localization",
};

const QUOTE_FACE: Record<string, { label: string; tone: "success" | "warning" | "error"; hint: string }> = {
  verbatim: { label: "verbatim", tone: "success", hint: "The quote appears word for word in the text this call returned." },
  partial: { label: "partial", tone: "warning", hint: "Only part of the quote appears in the returned text — read the chunk." },
  not_found: { label: "not in text", tone: "error", hint: "The chunk was retrieved, but the quote is not in its text." },
  not_retrieved: { label: "not retrieved", tone: "error", hint: "No call in this run returned this chunk." },
  unrecorded: { label: "not checkable", tone: "warning", hint: "The call that retrieved this chunk did not keep its results, so the quote cannot be checked here. Open the chunk in the corpus." },
  empty: { label: "empty", tone: "error", hint: "The quote is empty." },
};

const ENGINE_ICON: Record<string, ReactNode> = {
  rag: <ScanLine size={12} />, session: <ScanLine size={12} />, graph: <Network size={12} />,
  bpml: <GitBranch size={12} />, web: <Globe size={12} />,
};

function StatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  const theme = useTheme();
  if (status === "traced") return <CircleCheck size={size} color={theme.palette.success.main} aria-label="traced" />;
  if (status === "partial") return <CircleAlert size={size} color={theme.palette.warning.main} aria-label="partly traced" />;
  return <CircleDashed size={size} color={theme.palette.text.disabled} aria-label="not traced" />;
}

function Stat({ value, label, hint }: { value: ReactNode; label: string; hint: string }) {
  return (
    <Tooltip title={hint}>
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: RADIUS, px: 1.75, py: 1.25, minWidth: 0 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>{value}</Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.25 }}>{label}</Typography>
      </Box>
    </Tooltip>
  );
}

function Heading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mt: 2.25, mb: 0.75 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "text.secondary", textTransform: "uppercase" }}>
        {children}
      </Typography>
      {right}
    </Stack>
  );
}

/** A call number that opens the call. */
function CallLink({ n, onOpen, highlight }: { n: number; onOpen: (i: number, chunks?: string[]) => void; highlight?: string[] }) {
  const p = usePremium();
  return (
    <ButtonBase onClick={() => onOpen(n, highlight)} title={`Open call ${n + 1} — everything it returned`}
                sx={{ fontFamily: MONO, fontSize: 11.5, color: p.accent, px: 0.5, borderRadius: 0.5,
                      textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>
      #{n + 1}
    </ButtonBase>
  );
}

function EvidenceCard({ e, onOpenCall }: { e: LineageEvidence; onOpenCall: (i: number, chunks?: string[]) => void }) {
  const theme = useTheme();
  const face = QUOTE_FACE[e.verification.status] ?? QUOTE_FACE.not_found;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: RADIUS, p: 1.5 }}>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        {e.side && <Chip size="small" label={SIDE_LABEL[e.side] ?? e.side} variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
        {e.stance && (
          <Tooltip title="What the passage does for the claim: carries it, contradicts it, or frames it">
            <Chip size="small" label={e.stance} color={STANCE_TONE[e.stance] ?? "default"} variant="outlined"
                  sx={{ height: 20, fontSize: 11 }} />
          </Tooltip>
        )}
        {e.evidence_class && (
          <Tooltip title="Evidence class — E1 stated in a source, E2 inferred from one, E3 an assumption, E4 external">
            <Chip size="small" label={e.evidence_class} variant="outlined" sx={{ height: 20, fontSize: 11, fontFamily: MONO }} />
          </Tooltip>
        )}
        <Tooltip title={face.hint + (e.verification.status === "partial" ? ` (${Math.round(e.verification.match * 100)}% matched)` : "")
                        + (e.verification.short ? " The quote is short, so a match proves less." : "")
                        + (e.verification.elided ? " The quote joins passages with an ellipsis; each is present." : "")}>
          <Chip size="small" color={face.tone} variant="outlined"
                icon={e.verification.status === "verbatim" ? <CircleCheck size={12} /> : <CircleAlert size={12} />}
                label={face.label} sx={{ height: 20, fontSize: 11 }} />
        </Tooltip>
        <Typography sx={{ fontFamily: MONO, fontSize: 11, color: "text.disabled" }}>{e.chunk_id}</Typography>
      </Stack>
      <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 0.75 }}>
        {e.doc}{e.heading_path ? ` › ${e.heading_path}` : ""}
      </Typography>
      {e.provenance_note && (
        <Typography sx={{ fontSize: 11.5, color: "warning.main", mt: 0.25 }}>How the document was made: {e.provenance_note}</Typography>
      )}
      <Box component="blockquote"
           sx={{ m: 0, mt: 0.75, pl: 1.25, borderLeft: `3px solid ${alpha(theme.palette.text.primary, 0.18)}`,
                 fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {e.quote}
      </Box>
      <Box sx={{ mt: 1 }}>
        {e.retrievals.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: e.verification.status === "not_retrieved" ? "error.main" : "text.secondary" }}>
            {e.verification.status === "not_retrieved"
              ? "No call in this run returned this chunk."
              : e.verification.via
                ? "Retrieved in this run (the run's source index holds it); the call that returned it did not keep its results."
                : "This run did not record which call retrieved it."}
          </Typography>
        ) : e.retrievals.map((r, i) => (
          <Stack key={i} direction="row" spacing={0.75} sx={{ alignItems: "baseline", fontSize: 12 }}>
            <Typography component="span" sx={{ fontSize: 12, color: "text.disabled", minWidth: 78 }}>
              {i === 0 ? "Retrieved by" : "also by"}
            </Typography>
            <CallLink n={r.call} onOpen={onOpenCall} highlight={[e.chunk_id]} />
            <Typography component="span" sx={{ fontSize: 12, fontFamily: MONO, color: "text.secondary" }}>{r.tool}</Typography>
            <Typography component="span" sx={{ fontSize: 12, flex: 1, minWidth: 0, wordBreak: "break-word" }}>
              {r.query ? `“${r.query}”` : ""}
              <Box component="span" sx={{ color: "text.disabled" }}>
                {r.rank != null ? ` · rank ${r.rank}` : ""}
                {r.score != null ? ` · score ${r.score}` : ""}
                {r.vector_rank != null || r.keyword_rank != null
                  ? ` (vector ${r.vector_rank ?? "–"}, keyword ${r.keyword_rank ?? "–"})` : ""}
              </Box>
            </Typography>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}

function GraphFactCard({ g, onOpenCall }: { g: LineageGraphFact; onOpenCall: (i: number, chunks?: string[]) => void }) {
  const all = g.confirmed === g.total;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: RADIUS, p: 1.5 }}>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Chip size="small" icon={<Network size={12} />} label="graph" variant="outlined" color="info" sx={{ height: 20, fontSize: 11 }} />
        <Tooltip title="Whether each node and edge this fact names was actually returned by a graph or process-register call in this run">
          <Chip size="small" variant="outlined" color={all ? "success" : "warning"}
                icon={all ? <CircleCheck size={12} /> : <CircleAlert size={12} />}
                label={`${g.confirmed}/${g.total} seen in calls`} sx={{ height: 20, fontSize: 11 }} />
        </Tooltip>
        {!g.meaningful && <Chip size="small" color="warning" label="route flagged as an artefact" sx={{ height: 20, fontSize: 11 }} />}
        <Stack direction="row">{g.calls.map((n) => <CallLink key={n} n={n} onOpen={onOpenCall} />)}</Stack>
      </Stack>
      <Typography sx={{ fontSize: 13, mt: 0.75 }}>{g.statement}</Typography>
      {g.note && <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>{g.note}</Typography>}
      <Stack spacing={0.25} sx={{ mt: 0.75 }}>
        {g.edges.map((e) => (
          <Typography key={e.id} sx={{ fontSize: 12, fontFamily: MONO, color: e.seen ? "text.secondary" : "warning.main", wordBreak: "break-word" }}>
            {e.source.split(":").slice(1).join(":") || e.source} —{e.relation}→ {e.target.split(":").slice(1).join(":") || e.target}
            {e.seen ? "" : "  (not returned by any call)"}
            {e.chunks?.length ? (
              <Box component="span" sx={{ color: "text.disabled" }}>{`  · extracted from ${e.chunks.join(", ")}`}</Box>
            ) : null}
          </Typography>
        ))}
        {g.nodes.filter((n) => !g.edges.some((e) => e.source === n.id || e.target === n.id)).map((n) => (
          <Typography key={n.id} sx={{ fontSize: 12, fontFamily: MONO, color: n.seen ? "text.secondary" : "warning.main" }}>
            {n.type} · {n.label}{n.seen ? "" : "  (not returned by any call)"}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

function ClaimDetail({ c, byRef, onSelect, onOpenCall }: {
  c: LineageClaim;
  byRef: Map<string, LineageClaim>;
  onSelect: (ref: string) => void;
  onOpenCall: (i: number, chunks?: string[]) => void;
}) {
  const p = usePremium();
  const own = !c.evidence_inherited;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <StatusIcon status={c.status} size={16} />
        <Typography sx={{ fontFamily: MONO, fontSize: 12, color: p.accent, fontWeight: 600 }}>
          {KIND_LABEL[c.kind].replace(/s$/, "").toUpperCase()} · {c.ref}
        </Typography>
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
          · {c.status === "traced" ? "fully traced" : c.status === "partial" ? "partly traced" : "not traced"}
          {c.score != null ? ` · score ${c.score}` : ""}
        </Typography>
        {c.governs && (
          <Tooltip title="The weakest supported claim. An answer is only as strong as the weakest thing it asserts, so this sets the answer's confidence.">
            <Chip size="small" color="warning" variant="outlined" label="sets the confidence" sx={{ height: 20, fontSize: 11 }} />
          </Tooltip>
        )}
      </Stack>
      <Typography sx={{ fontSize: 16, fontWeight: 600, mt: 0.75, lineHeight: 1.4 }}>{c.title}</Typography>
      {c.kind === "deviation" && (
        <Box sx={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", columnGap: 1.5, rowGap: 0.5, mt: 1.25, fontSize: 13 }}>
          {c.as_is_statement && <><Typography sx={{ fontSize: 12, color: "text.secondary" }}>Subject says</Typography><Typography sx={{ fontSize: 13 }}>{c.as_is_statement}</Typography></>}
          {c.gt_statement && <><Typography sx={{ fontSize: 12, color: "text.secondary" }}>Template says</Typography><Typography sx={{ fontSize: 13 }}>{c.gt_statement}</Typography></>}
          {c.sap_bp_reference && <><Typography sx={{ fontSize: 12, color: "text.secondary" }}>SAP standard</Typography><Typography sx={{ fontSize: 13 }}>{c.sap_bp_reference}</Typography></>}
        </Box>
      )}
      {c.statement && c.kind !== "deviation" && c.statement !== c.title && (
        <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.75 }}>{c.statement}</Typography>
      )}

      <Heading>Checks</Heading>
      <Stack spacing={0.4}>
        {c.checks.map((k) => (
          <Stack key={k.check} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
            <Box sx={{ position: "relative", top: 2 }}>{k.ok ? <StatusIcon status="traced" size={13} /> : <StatusIcon status="partial" size={13} />}</Box>
            <Typography sx={{ fontSize: 13 }}>{k.check}</Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>— {k.detail}</Typography>
          </Stack>
        ))}
      </Stack>

      {!!c.supported_by?.length && (
        <>
          <Heading>Rests on</Heading>
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
            {c.supported_by.map((r) => {
              const s = byRef.get(r);
              return (
                <Chip key={r} size="small" clickable onClick={() => onSelect(r)} variant="outlined"
                      icon={s ? <StatusIcon status={s.status} size={12} /> : undefined}
                      label={r} sx={{ fontFamily: MONO, fontSize: 11.5 }} />
              );
            })}
          </Stack>
        </>
      )}

      {!!c.derivation?.length && (
        <>
          <Heading>How the numbers were reached</Heading>
          <Box sx={{ display: "grid", gridTemplateColumns: "minmax(140px, auto) minmax(60px, auto) minmax(0, 1fr)", columnGap: 2, rowGap: 0.5 }}>
            {c.derivation.map((d) => (
              <Box key={d.what} sx={{ display: "contents" }}>
                <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{d.what}</Typography>
                <Typography sx={{ fontSize: 12.5, fontFamily: MONO, fontWeight: 600 }}>{d.value ?? "—"}</Typography>
                <Typography sx={{ fontSize: 12.5 }}>{d.how}</Typography>
              </Box>
            ))}
          </Box>
          {!!c.standard_options_considered?.length && (
            <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.75 }}>
              Standard options weighed first: {c.standard_options_considered.join(" · ")}
            </Typography>
          )}
        </>
      )}

      {own && c.evidence.length > 0 && (
        <>
          <Heading right={<Typography sx={{ fontSize: 11.5, color: "text.disabled" }}>click a call number to see everything it returned</Typography>}>
            Evidence ({c.evidence.length})
          </Heading>
          <Stack spacing={1}>
            {c.evidence.map((e, i) => <EvidenceCard key={i} e={e} onOpenCall={onOpenCall} />)}
          </Stack>
        </>
      )}

      {!!c.graph_facts?.length && (
        <>
          <Heading>Graph facts ({c.graph_facts.length})</Heading>
          <Stack spacing={1}>
            {c.graph_facts.map((g, i) => <GraphFactCard key={i} g={g} onOpenCall={onOpenCall} />)}
          </Stack>
        </>
      )}

      {c.intents.length > 0 && (
        <>
          <Heading>Why those calls were made</Heading>
          <Stack spacing={0.75}>
            {c.intents.map((it) => (
              <Stack key={it.seq} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                <Box sx={{ color: "info.main", position: "relative", top: 2 }}><Sigma size={12} /></Box>
                <Typography sx={{ fontSize: 13, fontStyle: "italic", flex: 1 }}>{it.text}</Typography>
                <Stack direction="row" sx={{ flexShrink: 0 }}>
                  {it.calls.map((n) => <CallLink key={n} n={n} onOpen={onOpenCall} />)}
                </Stack>
              </Stack>
            ))}
          </Stack>
        </>
      )}

      {c.graph.length > 0 && (
        <>
          <Heading>Knowledge-graph entities it names</Heading>
          <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 0.75 }}>
            Entities the investigation looked up in the graph whose name appears in this finding. A mention, not a citation.
          </Typography>
          <Stack spacing={0.5}>
            {c.graph.map((g) => (
              <Stack key={g.id} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                <Box sx={{ color: "info.main", position: "relative", top: 2 }}><Network size={12} /></Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{g.label}</Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary", flex: 1 }}>
                  {g.type}{g.in_corpus != null ? (g.in_corpus ? " · also in the corpus" : " · new to the corpus") : ""}
                  {g.description ? ` — ${g.description}` : ""}
                </Typography>
                <Stack direction="row">{g.calls.map((n) => <CallLink key={n} n={n} onOpen={onOpenCall} />)}</Stack>
              </Stack>
            ))}
          </Stack>
        </>
      )}

      {(c.reasoning.length > 0 || c.sendbacks.length > 0 || !!c.gates?.length) && (
        <>
          <Heading>Where the investigation discussed it</Heading>
          <Stack spacing={0.75}>
            {c.reasoning.map((r) => (
              <Typography key={`r${r.seq}`} sx={{ fontSize: 13, fontStyle: "italic" }}>
                <Box component="span" sx={{ fontFamily: MONO, fontStyle: "normal", fontSize: 11, color: "text.disabled", mr: 1 }}>step {r.seq}</Box>
                {r.text}
              </Typography>
            ))}
            {c.sendbacks.map((r) => (
              <Typography key={`s${r.seq}`} sx={{ fontSize: 13 }}>
                <Box component="span" sx={{ fontWeight: 600, color: "warning.main", mr: 1 }}>Sent back:</Box>{r.text}
              </Typography>
            ))}
            {c.gates?.map((g, i) => (
              <Typography key={`g${i}`} sx={{ fontSize: 13 }}>
                <Box component="span" sx={{ fontWeight: 600, color: g.severity === "hard" ? "error.main" : "warning.main", mr: 1 }}>
                  Gate {g.gate} ({g.severity}):
                </Box>{g.detail}
              </Typography>
            ))}
          </Stack>
        </>
      )}

      {!!c.decisions?.length && (
        <>
          <Heading>What the workshop decided</Heading>
          <Stack spacing={0.5}>
            {c.decisions.map((d, i) => (
              <Typography key={i} sx={{ fontSize: 13, color: d.is_current === false ? "text.disabled" : "text.primary" }}>
                <b>{d.verdict}</b>{d.option_text ? ` — ${d.option_text}` : ""}{d.rationale ? `. ${d.rationale}` : ""}
                <Box component="span" sx={{ color: "text.secondary" }}> · {d.decided_by} · {String(d.decided_at ?? "").slice(0, 16).replace("T", " ")}
                  {d.is_current === false ? " · superseded" : ""}</Box>
              </Typography>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}

function TrailRow({ t, onOpenCall, onSelect }: {
  t: LineageTrailEntry; onOpenCall: (i: number, chunks?: string[]) => void; onSelect: (ref: string) => void;
}) {
  const theme = useTheme();
  const p = usePremium();
  if (t.kind === "note" && t.note === "stage") {
    return (
      <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", color: p.accent, textTransform: "uppercase", pt: 1.5, pb: 0.5 }}>
        {t.title}
      </Typography>
    );
  }
  const face: Record<string, { label: string; colour: string }> = {
    question: { label: "ASKED", colour: theme.palette.primary.main },
    memory: { label: "RECALLED", colour: theme.palette.secondary.main },
    thinking: { label: "REASONS", colour: theme.palette.info.main },
    note: { label: t.note === "rejected" ? "SENT BACK" : t.note === "submitted" ? "SUBMITTED" : t.note === "gates" ? "GATES"
      : t.note === "prompt" ? "CONTEXT" : t.note === "budget" ? "BUDGET" : t.note === "retained" ? "REMEMBERED" : "NOTE",
      colour: t.note === "rejected" ? theme.palette.warning.main : theme.palette.text.secondary },
    tool_call: { label: (t.engine ?? "call").toUpperCase(), colour: theme.palette.text.primary },
    answer: { label: "CONCLUDED", colour: theme.palette.success.main },
    scoring: { label: "COMPUTED", colour: theme.palette.success.main },
    decision: { label: "DECIDED", colour: p.accent },
    error: { label: "ERROR", colour: theme.palette.error.main },
  };
  const f = face[t.kind] ?? face.note;
  const isCall = t.kind === "tool_call" && t.call != null;
  const used = (t.cited_chunks ?? 0) > 0;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "42px 92px minmax(0, 1fr)", columnGap: 1, py: 0.6,
               borderBottom: 1, borderColor: "divider", opacity: isCall && !used ? 0.72 : 1 }}>
      <Box>{isCall ? <CallLink n={t.call!} onOpen={onOpenCall} /> : null}</Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: f.colour }}>
        {isCall ? ENGINE_ICON[t.engine ?? ""] : null}
        <Typography sx={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.05em", color: f.colour }}>{f.label}</Typography>
      </Stack>
      <Box sx={{ minWidth: 0 }}>
        {isCall ? (
          <>
            <Typography sx={{ fontSize: 12.5, wordBreak: "break-word" }}>
              <Box component="span" sx={{ fontFamily: MONO, color: "text.secondary", mr: 1 }}>{t.tool}</Box>
              {t.error ? <Box component="span" sx={{ color: "error.main" }}>{t.error}</Box> : t.summary}
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mt: 0.25 }}>
              <Typography sx={{ fontSize: 11.5, color: "text.disabled" }}>
                {t.source ? `${t.source} · ` : ""}{t.returned ?? 0} returned · {used ? `${t.cited_chunks} cited` : "nothing cited"}
                {t.ms != null ? ` · ${t.ms} ms` : ""}
              </Typography>
              {(t.supports ?? []).map((r) => (
                <Chip key={r} size="small" label={r} clickable onClick={() => onSelect(r)}
                      sx={{ height: 18, fontSize: 10.5, fontFamily: MONO }} />
              ))}
            </Stack>
          </>
        ) : (
          <>
            {t.title && <Typography sx={{ fontSize: 12.5, fontWeight: t.kind === "answer" ? 600 : 500 }}>{t.title}</Typography>}
            {t.text && (
              <Typography sx={{ fontSize: 12.5, color: "text.secondary", fontStyle: t.kind === "thinking" ? "italic" : "normal",
                                whiteSpace: "pre-wrap", wordBreak: "break-word",
                                display: "-webkit-box", WebkitLineClamp: t.note === "prompt" ? 3 : 6,
                                WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {t.text}
              </Typography>
            )}
            {t.kind === "decision" && (
              <Stack direction="row" spacing={0.75} sx={{ mt: 0.25 }}>
                {(t.supports ?? []).map((r) => (
                  <Chip key={r} size="small" label={r} clickable onClick={() => onSelect(r)} sx={{ height: 18, fontSize: 10.5, fontFamily: MONO }} />
                ))}
                {t.by && <Typography sx={{ fontSize: 11.5, color: "text.disabled" }}>{t.by}</Typography>}
              </Stack>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

function AnswerBlock({ a, byRef, onSelect }: {
  a: NonNullable<Lineage["answer"]>; byRef: Map<string, LineageClaim>; onSelect: (ref: string) => void;
}) {
  const [memOpen, setMemOpen] = useState(false);
  const gov = a.governing ? byRef.get(a.governing) : undefined;
  return (
    <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, p: 2.5 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "text.secondary", textTransform: "uppercase" }}>
        The conclusion being traced
      </Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 600, mt: 0.75 }}>{a.question}</Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mt: 0.75 }}>
        <Chip size="small" label={a.state.replace(/_/g, " ")} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
        <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{a.state_blurb}</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, lineHeight: 1.6, mt: 1 }}>{a.text}</Typography>
      {a.confidence != null && (
        <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 1 }}>
          Confidence <b>{a.confidence}</b> — set by the weakest supported claim
          {gov && (
            <>
              {", "}
              <Link component="button" onClick={() => onSelect(gov.ref)} sx={{ fontSize: 12.5, verticalAlign: "baseline" }}>
                {gov.ref}
              </Link>
              {`: “${gov.title.slice(0, 110)}${gov.title.length > 110 ? "…" : ""}”`}
            </>
          )}
        </Typography>
      )}
      {(a.open_questions.length > 0 || a.limits.length > 0) && (
        <Box sx={{ display: "grid", gap: 2, mt: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          {a.limits.length > 0 && (
            <Box>
              <Heading>Limits the agent declared</Heading>
              {a.limits.map((l, i) => <Typography key={i} sx={{ fontSize: 12.5, mb: 0.5 }}>• {l}</Typography>)}
            </Box>
          )}
          {a.open_questions.length > 0 && (
            <Box>
              <Heading>Left open</Heading>
              {a.open_questions.map((l, i) => <Typography key={i} sx={{ fontSize: 12.5, mb: 0.5 }}>• {l}</Typography>)}
            </Box>
          )}
        </Box>
      )}
      {(a.memory.recalled.length > 0 || a.memory.retained) && (
        <Alert severity="info" variant="outlined" sx={{ mt: 2, fontSize: 12.5, borderRadius: RADIUS }}
               action={a.memory.recalled.length > 0
                 ? <Button size="small" onClick={() => setMemOpen(!memOpen)} sx={{ textTransform: "none" }}>{memOpen ? "Hide" : "Show"}</Button>
                 : undefined}>
          {a.memory.recalled.length > 0
            ? `${a.memory.recalled.length} note(s) from earlier investigations were handed to the agent before it started. They steer where it looks but are not evidence: no claim can cite them, and every claim above rests on passages retrieved in this run.`
            : "Nothing was recalled from earlier investigations."}
          {a.memory.retained ? " This run's answer was written back to memory afterwards." : ""}
          {memOpen && (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {a.memory.recalled.map((m, i) => (
                <Typography key={i} sx={{ fontSize: 12.5 }}>
                  <Box component="span" sx={{ fontFamily: MONO, fontSize: 11, color: "text.disabled", mr: 1 }}>{m.type}</Box>{m.text}
                </Typography>
              ))}
            </Stack>
          )}
        </Alert>
      )}
    </Box>
  );
}

export default function InvestigationView({ exportUrl, lineage, error, focus, onOpenCall, onOpenLogs, logCount }: {
  /** Where the audit file downloads from, per format. */
  exportUrl: (format: "md" | "json") => string;
  lineage: Lineage | null;
  error?: string;
  /** A claim to open, e.g. from a deviation's "Trace" link. */
  focus?: string | null;
  onOpenCall: (i: number, chunks?: string[]) => void;
  onOpenLogs: () => void;
  logCount: number;
}) {
  const theme = useTheme();
  const p = usePremium();
  const [view, setView] = useState<"trace" | "trail">("trace");
  const [picked, setPicked] = useState<string | null>(null);
  const [kind, setKind] = useState<LineageClaim["kind"] | "all" | null>(null);
  const [q, setQ] = useState("");
  const [onlyUsed, setOnlyUsed] = useState(false);

  const byRef = useMemo(() => new Map((lineage?.claims ?? []).map((c) => [c.ref, c])), [lineage]);
  useEffect(() => {
    if (focus && byRef.has(focus)) {
      setView("trace"); setPicked(focus); setKind(byRef.get(focus)!.kind); setQ("");
    }
  }, [focus, byRef]);

  if (error) return <Typography sx={{ fontSize: 13, color: "error.main" }}>{error}</Typography>;
  if (!lineage) return <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Tracing the findings…</Typography>;

  const s = lineage.summary;
  const shownKind = kind ?? KIND_ORDER.find((k) => lineage.claims.some((c) => c.kind === k)) ?? "all";
  const traced = s.by_status.traced ?? 0;
  const needle = q.trim().toLowerCase();
  const list = lineage.claims
    .filter((c) => shownKind === "all" || c.kind === shownKind)
    .filter((c) => !needle || `${c.ref} ${c.title} ${c.statement ?? ""}`.toLowerCase().includes(needle));
  const current = (picked && byRef.get(picked)) || list[0] || null;
  const select = (ref: string) => {
    const c = byRef.get(ref);
    if (!c) return;
    setView("trace"); setPicked(ref); setKind(c.kind); setQ("");
  };
  const counts = KIND_ORDER.map((k) => [k, lineage.claims.filter((c) => c.kind === k).length] as const).filter(([, n]) => n > 0);
  const trail = onlyUsed
    ? lineage.trail.filter((t) => t.kind !== "tool_call" || (t.cited_chunks ?? 0) > 0)
    : lineage.trail;

  return (
    <Stack spacing={2.5}>
      <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, p: 2.5 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ justifyContent: "space-between", alignItems: { md: "flex-start" } }}>
          <Box sx={{ maxWidth: 760 }}>
            <Typography component="h2" sx={{ fontSize: 15, fontWeight: 600 }}>Traceability</Typography>
            <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.5, lineHeight: 1.55 }}>
              Every finding traced to the passages it quotes, the tool call that retrieved each one, and the reasoning
              behind those calls. Each quote is checked against the text the call actually returned. Semantic accuracy —
              whether the finding is <i>right</i> — stays a human judgement.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button size="small" variant="outlined" startIcon={<Terminal size={14} />} onClick={onOpenLogs}
                    disabled={!logCount} sx={{ textTransform: "none", borderRadius: RADIUS }}>
              Raw log{logCount ? ` (${logCount})` : ""}
            </Button>
            <Button size="small" variant="outlined" startIcon={<Download size={14} />} href={exportUrl("md")}
                    sx={{ textTransform: "none", borderRadius: RADIUS }}>
              Audit trail (.md)
            </Button>
            <Button size="small" variant="outlined" startIcon={<Download size={14} />} href={exportUrl("json")}
                    sx={{ textTransform: "none", borderRadius: RADIUS }}>
              .json
            </Button>
          </Stack>
        </Stack>
        <Box sx={{ display: "grid", gap: 1.25, mt: 2, gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", md: "repeat(6, minmax(0,1fr))" } }}>
          <Stat value={`${traced}/${s.claims}`} label="claims fully traced"
                hint={lineage.answer
                  ? "A claim is fully traced when every passage's chunk was returned by a call in this run, every quote is in that text, and every graph node and edge it names was returned by a graph call."
                  : "A claim is fully traced when it has quotes, every quote's chunk was returned by a call in this run, every quote is in that text, and a deviation quotes both sides."} />
          <Stat value={`${s.verbatim}/${s.quotes}`} label="quotes found verbatim"
                hint={`${s.partial} partial, ${s.not_found} not in the returned text, ${s.not_retrieved} never retrieved, ${s.unrecorded} not checkable because the call kept no results`} />
          <Stat value={`${s.contributing_calls}/${s.calls}`} label="calls supplied evidence"
                hint={Object.entries(s.engines).map(([k, v]) => `${k} ${v}`).join(" · ")} />
          <Stat value={`${s.chunks_cited}/${s.chunks_retrieved}`} label="chunks cited / read"
                hint={`Cited from ${s.documents_cited} document(s). The rest were read and set aside.`} />
          {s.graph_facts != null ? (
            <Stat value={`${s.graph_facts_confirmed}/${s.graph_facts}`} label="graph facts confirmed"
                  hint={`Graph facts whose every node and edge was returned by a graph call this run. ${s.graph_entities} graph entities were looked up.`} />
          ) : (
            <Stat value={`${s.graph_entities_mentioned}/${s.graph_entities}`} label="graph entities named"
                  hint="Knowledge-graph entities the investigation looked up, and how many of them the findings name." />
          )}
          {lineage.answer ? (
            <Stat value={s.sendbacks} label="send-backs"
                  hint="Answers the verifier returned to the agent for correction before accepting one." />
          ) : (
            <Stat value={`${s.sendbacks} · ${s.gate_issues}`} label="send-backs · gate issues"
                  hint="Submissions the verifier returned for correction, and quality-gate findings on the final analysis." />
          )}
        </Box>
        {s.record !== "full" && (
          <Alert severity={s.record === "none" ? "warning" : "info"} variant="outlined" sx={{ mt: 1.5, fontSize: 12.5, borderRadius: RADIUS }}>
            {s.record === "none"
              ? "This run was recorded before the investigation log was kept. Its quotes can be read, but not traced to the calls that retrieved them — run the analysis again for a full trace."
              : `${s.calls_without_results} retrieval call(s) of this run did not keep their results. Quotes from them are checked against the run's source index where it holds them.`}
          </Alert>
        )}
        <Typography sx={{ fontSize: 11.5, color: "text.disabled", mt: 1.25, fontFamily: MONO }}>
          model {lineage.context.model} · prompt {lineage.context.prompt_hash} · corpus {lineage.context.corpus_fingerprint || "—"}
          {lineage.context.categories.length ? ` · categories ${lineage.context.categories.join(", ")}` : ""}
        </Typography>
      </Box>

      {lineage.answer && <AnswerBlock a={lineage.answer} byRef={byRef} onSelect={select} />}

      <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
        <ToggleButton value="trace" sx={{ textTransform: "none", px: 2 }}>Trace a finding</ToggleButton>
        <ToggleButton value="trail" sx={{ textTransform: "none", px: 2 }}>Audit trail ({lineage.trail.length} steps)</ToggleButton>
      </ToggleButtonGroup>

      {view === "trace" ? (
        <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", lg: "minmax(280px, 360px) minmax(0, 1fr)" }, alignItems: "start" }}>
          <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, p: 1.5,
                     position: { lg: "sticky" }, top: { lg: 16 } }}>
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", mb: 1 }}>
              {counts.length > 1 && counts.map(([k, n]) => (
                <Chip key={k} size="small" label={`${KIND_LABEL[k]} ${n}`} clickable
                      color={shownKind === k ? "primary" : "default"} variant={shownKind === k ? "filled" : "outlined"}
                      onClick={() => setKind(k)} sx={{ fontSize: 11.5 }} />
              ))}
              {counts.length > 1 && <Chip size="small" label="All" clickable color={shownKind === "all" ? "primary" : "default"}
                    variant={shownKind === "all" ? "filled" : "outlined"} onClick={() => setKind("all")} sx={{ fontSize: 11.5 }} />}
            </Stack>
            <TextField size="small" fullWidth placeholder="Find a finding…" value={q} onChange={(e) => setQ(e.target.value)}
                       slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> } }}
                       sx={{ mb: 1 }} />
            <Box sx={{ maxHeight: { lg: "calc(100vh - 260px)" }, overflowY: "auto" }}>
              {list.map((c) => {
                const on = current?.ref === c.ref;
                return (
                  <ButtonBase key={c.ref} onClick={() => setPicked(c.ref)}
                              sx={{ display: "flex", width: "100%", textAlign: "left", alignItems: "flex-start", gap: 1,
                                    px: 1, py: 0.9, borderRadius: RADIUS,
                                    bgcolor: on ? alpha(p.accent, 0.12) : "transparent",
                                    "&:hover": { bgcolor: on ? alpha(p.accent, 0.16) : theme.palette.action.hover } }}>
                    <Box sx={{ pt: 0.25 }}><StatusIcon status={c.status} size={13} /></Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontFamily: MONO, fontSize: 11, color: on ? p.accent : "text.secondary" }}>
                        {c.ref}{c.evidence.length && !c.evidence_inherited ? ` · ${c.evidence.length} quote${c.evidence.length === 1 ? "" : "s"}` : ""}
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {c.title}
                      </Typography>
                    </Box>
                  </ButtonBase>
                );
              })}
              {list.length === 0 && <Typography sx={{ fontSize: 12.5, color: "text.secondary", p: 1 }}>Nothing matches.</Typography>}
            </Box>
          </Box>
          <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, p: 2.5, minWidth: 0 }}>
            {current
              ? <ClaimDetail c={current} byRef={byRef} onSelect={select} onOpenCall={onOpenCall} />
              : <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Pick a finding on the left.</Typography>}
          </Box>
        </Box>
      ) : (
        <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: RADIUS, p: 2.5 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline", mb: 0.5 }}>
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
              What the agent was given, what it reasoned, every call it made and what each one supplied, the send-backs,
              the gates, the computed scores and the workshop's decisions — in order.
            </Typography>
            <Chip size="small" clickable variant={onlyUsed ? "filled" : "outlined"} color={onlyUsed ? "primary" : "default"}
                  label="Only calls that supplied evidence" onClick={() => setOnlyUsed(!onlyUsed)} sx={{ fontSize: 11.5, flexShrink: 0, ml: 2 }} />
          </Stack>
          {trail.map((t, i) => <TrailRow key={i} t={t} onOpenCall={onOpenCall} onSelect={select} />)}
        </Box>
      )}
    </Stack>
  );
}
