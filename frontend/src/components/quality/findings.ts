/** What a judge found, in one line -- shared by the Ask page's evaluation
 *  panel and the RAG Metrics matrix, so the same answer is described in the
 *  same words wherever it is read. */
import type { MetricScore } from "../../api";

/** One line on what the judge found, read from its working where it kept
 *  one and from its stated reason where it did not. */
export function finding(key: string, m: MetricScore | undefined): string {
  if (!m) return "Not scored.";
  if (m.error) return `The judge did not return: ${m.error.slice(0, 120)}`;
  const w = m.working;
  if (w && "kind" in w) {
    if (w.kind === "claims") {
      const ok = w.items.filter((i) => i.supported).length;
      return `${ok} of ${w.items.length} claims supported by the excerpts.`;
    }
    if (w.kind === "excerpts") {
      const useful = w.items.filter((i) => i.useful);
      const first = useful.length ? w.items.findIndex((i) => i.useful) + 1 : 0;
      return key === "context_precision"
        ? `${useful.length} of ${w.items.length} excerpts useful${first ? `; the first useful one ranked ${first}` : ""}.`
        : `${useful.length} of ${w.items.length} excerpts used in the answer.`;
    }
    if (w.kind === "questions") {
      const vague = w.items.filter((i) => i.noncommittal).length;
      return vague
        ? `Judged non-committal on ${vague} of ${w.items.length} questions generated back from the answer.`
        : `The answer led back to the question on ${w.items.length} of ${w.items.length} attempts.`;
    }
    if (w.kind === "ratings") {
      return w.items.map((i) => `judge ${i.judge}: ${i.label}`).join(" · ") + ".";
    }
  }
  const first = (m.reason || "").split(/(?<=\.)\s/)[0].trim();
  if (!first) return "No reason given.";
  if (first.length <= 150) return first;
  return first.slice(0, first.lastIndexOf(" ", 150)).replace(/[,;:]$/, "") + "…";
}
