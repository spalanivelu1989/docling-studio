/** The Fit-Gap Copilot's look: a navy object header over the app's own
 *  ground, one teal accent (the logo's), square corners, figures in a
 *  monospace. Colours that the app theme does not already have are named here
 *  once, with a Frappé value for the dark theme, so the page never writes a
 *  hex of its own. */
import { alpha, useTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";

import type { Deviation, Materiality } from "../../api";
import { frappe } from "../../theme";

export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
export const RADIUS = "4px";

export function usePremium() {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  return {
    dark,
    band: dark ? frappe.crust : "#101c2e",
    bandLine: dark ? frappe.surface0 : "#2a3a52",
    bandText: dark ? frappe.text : "#ffffff",
    bandMuted: dark ? frappe.subtext0 : "#aab6c6",
    bandSoft: dark ? frappe.subtext1 : "#c9d2de",
    accent: dark ? frappe.teal : "#1b7c77",
    accentOnBand: dark ? frappe.teal : "#7fd1c8",
    amberOnBand: dark ? frappe.yellow : "#f0b86a",
    onAccent: dark ? frappe.crust : "#0b1624",
    // A panel raised off the band, and one chosen on it -- the facilitator
    // view is drawn entirely on the band.
    bandRaised: dark ? frappe.mantle : "#16243a",
    bandPicked: dark ? frappe.surface0 : "#1d3a44",
  };
}

/** Materiality as a colour; the word always travels beside it. */
export function materialityColour(theme: Theme, m: Materiality | string): string {
  return m === "Critical" || m === "High" ? theme.palette.error.main
    : m === "Medium" ? theme.palette.warning.main
      : theme.palette.text.secondary;
}

/** A 0–4 dimension rating as a colour: weak red, middling amber, sound teal. */
export function ratingColour(theme: Theme, accent: string, rating: number | null): string {
  if (rating === null) return theme.palette.text.disabled;
  return rating <= 1 ? theme.palette.error.main : rating === 2 ? theme.palette.warning.main : accent;
}

/** The alignment bands rollout/scoring.py cuts the score into, as widths on a
 *  0–100 scale. Kept beside the header that draws them. */
export const ALIGNMENT_BANDS = [40, 20, 15, 15, 10];

/** A step reference as the agent writes it -- "AS-04, AS-13", "AS-03 to
 *  AS-11", "n/a" -- as the step ids it names. A range is returned as
 *  `spans`, not expanded: a deviation about the whole middle of a process is
 *  not a finding about each of its steps. */
export function stepsOf(ref: string | null | undefined): { ids: string[]; spans: boolean } {
  const text = (ref || "").trim();
  if (!text || /^n\/?a$/i.test(text)) return { ids: [], spans: false };
  if (/\bto\b|–|—/.test(text)) return { ids: [], spans: true };
  return { ids: text.split(/[,;\s]+/).filter((t) => /^[A-Z]{1,4}-\d+/i.test(t)).map((t) => t.toUpperCase()), spans: false };
}

/** The deviations in the order a reader should meet them: must-discuss first,
 *  then by materiality. */
export function ranked(devs: Deviation[]): Deviation[] {
  const bucket = (d: Deviation) => (d.workshop_bucket === "MUST_DISCUSS" ? 0 : d.workshop_bucket === "CONFIRM" ? 1 : 2);
  const mat = (d: Deviation) => ["Critical", "High", "Medium", "Low", "Informational"].indexOf(d.materiality);
  return [...devs].sort((a, b) => bucket(a) - bucket(b) || mat(a) - mat(b) || a.gap_id.localeCompare(b.gap_id));
}

/** A 1–5 impact score as a cell fill and the text that reads on it. */
export function heatCell(theme: Theme, score: number): { bg: string; fg: string } {
  const strength = [0, 0.12, 0.24, 0.42, 0.66, 0.88][Math.max(0, Math.min(5, score))];
  if (!score) return { bg: theme.palette.action.hover, fg: theme.palette.text.disabled };
  return {
    bg: alpha(theme.palette.error.main, strength),
    fg: score >= 4 ? (theme.palette.mode === "dark" ? frappe.crust : "#ffffff") : theme.palette.text.primary,
  };
}

/** Dispositions in a few words, for tables and bars; the vocabulary's own
 *  descriptions are sentences. */
export const DISPOSITION_LABEL: Record<string, string> = {
  ADOPT_GT: "Adopt the template", CONFIGURE_STANDARD: "Configure SAP standard", USE_SAP_LOCALIZATION: "Use SAP localization",
  ADOPT_SAP_BP: "Move to SAP Best Practice", EXTEND_STANDARD: "Extend standard", RETAIN_LOCAL_EXCEPTION: "Retain local exception",
  REDESIGN_GT: "Redesign the template", RETIRE_LEGACY: "Retire legacy step", REQUIRES_DECISION: "Requires a decision",
  OUT_OF_SCOPE: "Out of scope",
};

/** A column wide enough for the longest gap id, which varies by run
 *  ("GAP-01", "GAP-IN-OF-004"). */
export const idColumn = (ids: string[]) => `${Math.max(64, Math.ceil(Math.max(0, ...ids.map((i) => i.length)) * 8.4) + 6)}px`;

export const BUCKET_LABEL: Record<string, string> = {
  MUST_DISCUSS: "Must discuss", CONFIRM: "Confirm", NO_WORKSHOP_TIME: "No floor time",
};
