/** Source documents — which documents the answers were written from, and
 *  whether the judge found them useful when they were.
 *
 *  Built from the judge's per-excerpt verdicts. A document retrieved often and
 *  rarely useful is crowding better excerpts out of the answer; that is
 *  something a person can act on (re-chunk it, exclude it), which a metric
 *  average is not. Choosing a row lists the answers that retrieved it.
 */
import {
  Box, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel, Typography,
  alpha, useTheme,
} from "@mui/material";
import { useMemo, useState } from "react";

import type { QualityDocument } from "../../api";
import { MONO } from "./AnswersView";
import { Bullet } from "./charts";
import { Empty, RADIUS } from "./parts";

type Key = "title" | "category" | "retrieved" | "judged" | "useful" | "useful_rate";

/** quality.py's cut for "rarely useful" (NOISY_BELOW), drawn as the tick. */
const NOISY_BELOW = 0.4;

export default function DocumentsView({ documents, onOpen }: {
  documents: QualityDocument[];
  onOpen: (doc: QualityDocument) => void;
}) {
  const theme = useTheme();
  const [sort, setSort] = useState<{ key: Key; dir: "asc" | "desc" }>({ key: "retrieved", dir: "desc" });
  const rows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const v = (d: QualityDocument) => {
      const x = d[sort.key];
      return typeof x === "string" ? x.toLowerCase() : x ?? -1;
    };
    return [...documents].sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * dir);
  }, [documents, sort]);
  const noisy = documents.filter((d) => d.noisy).length;

  const head = (key: Key, label: string, numeric = false) => (
    <TableCell align={numeric ? "right" : "left"} sortDirection={sort.key === key ? sort.dir : false}
               sx={{ fontWeight: 600, fontSize: 12, color: "text.secondary", whiteSpace: "nowrap" }}>
      <TableSortLabel active={sort.key === key} direction={sort.key === key ? sort.dir : "asc"}
                      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}>
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: RADIUS, bgcolor: "background.paper", overflow: "hidden" }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Source documents ({documents.length})</Typography>
        <Typography sx={{ fontSize: 12, color: noisy ? "warning.main" : "text.secondary", fontWeight: noisy ? 600 : 400 }}>
          {noisy} flagged as noisy: retrieved often, useful under {Math.round(NOISY_BELOW * 100)}% of the time
        </Typography>
      </Stack>
      {rows.length ? (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ "& td, & th": { borderColor: "divider" }, "& td": { py: 0.9, fontSize: 13 } }}>
            <TableHead sx={{ bgcolor: alpha(theme.palette.text.primary, 0.03) }}>
              <TableRow>
                {head("title", "Document")}
                {head("category", "Category")}
                {head("retrieved", "Retrieved", true)}
                {head("judged", "Judged", true)}
                {head("useful", "Useful", true)}
                {head("useful_rate", "Useful rate")}
                <TableCell sx={{ fontWeight: 600, fontSize: 12, color: "text.secondary" }}>Flag</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.title} hover>
                  <TableCell sx={{ maxWidth: 520 }}>
                    <Link component="button" type="button" underline="hover" onClick={() => onOpen(d)}
                          sx={{ display: "block", maxWidth: "100%", textAlign: "left", overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                      {d.title}
                    </Link>
                  </TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>{d.category || "—"}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: MONO }}>{d.retrieved}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: MONO }}>{d.judged}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: MONO }}>{d.useful}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Bullet value={d.useful_rate} line={NOISY_BELOW} width={72} />
                      <Box component="span" sx={{ fontFamily: MONO, color: d.noisy ? "warning.main" : "text.primary", fontWeight: d.noisy ? 600 : 400 }}>
                        {d.useful_rate === null ? "—" : `${Math.round(d.useful_rate * 100)}%`}
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ color: d.noisy ? "warning.main" : "text.disabled", fontWeight: d.noisy ? 600 : 400, fontSize: "12.5px !important" }}>
                    {d.noisy ? "Noisy" : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : (
        <Box sx={{ px: 2 }}><Empty>No document was retrieved by a scored answer in this window.</Empty></Box>
      )}
    </Box>
  );
}
