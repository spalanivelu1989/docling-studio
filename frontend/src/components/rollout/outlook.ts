/** Standardisation outlook: each deviation's harmonization potential as one of
 *  five levels a client can act on, rather than a percentage that suggests more
 *  precision than the rule behind it has.
 *
 *  The level is read from the same inputs as the computed figure
 *  (rollout/scoring.py `harmonization`): the proposed disposition and the
 *  localization state. A legal requirement outranks any disposition, and a
 *  suspected one cannot be counted on until it is checked, so it stays a
 *  decision however promising the disposition. Older runs, whose percentage
 *  was the agent's own, get a level from the same classification. */
import type { Deviation } from "../../api";

export type OutlookKey = "will" | "can" | "decide" | "local" | "law";

export const OUTLOOK: Record<OutlookKey, { label: string; tell: string; order: number }> = {
  will: { label: "Will standardise", tell: "Expected to go away", order: 0 },
  can: { label: "Can standardise", tell: "Achievable, with some design work", order: 1 },
  decide: { label: "Your decision", tell: "Depends on what this workshop decides", order: 2 },
  local: { label: "Likely stays local", tell: "A deliberate local difference", order: 3 },
  law: { label: "Required by law", tell: "Cannot be removed", order: 4 },
};

export const OUTLOOK_ORDER = (Object.keys(OUTLOOK) as OutlookKey[]).sort((a, b) => OUTLOOK[a].order - OUTLOOK[b].order);

const BY_DISPOSITION: Record<string, OutlookKey> = {
  ADOPT_GT: "will", CONFIGURE_STANDARD: "will", RETIRE_LEGACY: "will",
  ADOPT_SAP_BP: "can", USE_SAP_LOCALIZATION: "can", REDESIGN_GT: "can",
  REQUIRES_DECISION: "decide", OUT_OF_SCOPE: "decide",
  RETAIN_LOCAL_EXCEPTION: "local", EXTEND_STANDARD: "local",
};

export function outlookOf(d: Pick<Deviation, "candidate_disposition" | "localization_state">): OutlookKey {
  if (d.localization_state === "CONFIRMED_STATUTORY" || d.localization_state === "SAP_DELIVERED") return "law";
  const k = BY_DISPOSITION[d.candidate_disposition] ?? "decide";
  if (d.localization_state === "SUSPECTED" && (k === "will" || k === "can")) return "decide";
  return k;
}

/** How many deviations sit at each level, in display order, empty levels left out. */
export function outlookCounts(ds: Deviation[]): { key: OutlookKey; n: number }[] {
  return OUTLOOK_ORDER.map((key) => ({ key, n: ds.filter((d) => outlookOf(d) === key).length })).filter((x) => x.n);
}

const PHRASE: Record<OutlookKey, (n: number) => string> = {
  will: () => "will standardise",
  can: () => "can standardise",
  decide: (n) => `${n === 1 ? "depends" : "depend"} on this workshop`,
  local: (n) => `likely ${n === 1 ? "stays" : "stay"} local`,
  law: (n) => `${n === 1 ? "is" : "are"} required by law`,
};

/** The words after the count: "9" + "depend on this workshop". */
export const outlookPhrase = (key: OutlookKey, n: number) => PHRASE[key](n);

/** "5 will standardise, 9 depend on this workshop, 1 likely stays local" */
export function outlookSentence(ds: Deviation[]): string {
  return outlookCounts(ds).map(({ key, n }) => `${n} ${PHRASE[key](n)}`).join(", ");
}
