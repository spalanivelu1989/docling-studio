# Eight questions that separate the three engines

A discriminating evaluation set for the Solvay SPARK L2C corpus
(`solvay-spark/pkg/markdown`, 83 documents / 4,257 chunks), aimed at the three
query systems in Docling Studio:

| Engine | Route | Where it is strong | Where it breaks |
|---|---|---|---|
| **RAG** (`/ask`) | bge-m3 vector + BM25 → RRF → top-8 → Claude | exact codes, verbatim detail | sees only 8 chunks; no notion of document version, date or count |
| **Graph** (`/graph`) | regex + ontology → BFS → templated answer | enumeration, connectivity, counting | 6 systems only; no dotted BPML codes; co-membership looks like integration |
| **Fit-Gap Copilot** (`/fit-gap`) | both, as agent tools → rubric → verifier | judgement with cited evidence | one BPML step at a time; 12 tool calls; will answer UNKNOWN |

Every **Ground truth** below was read out of the corpus and checked. The
**Watch for** lines are the failure modes each question is built to provoke —
they are hypotheses to score, not claims about what the systems will do. Q2 is
the exception: its failure is reproduced verbatim from a live run.

A question is only doing its job if the three engines answer it *differently*.

---

## Q1 · Can it admit what its own model cannot represent?

> **"Which BPML step does SPARK-22234 implement, and what is the end-to-end message flow for the signed PDF invoice?"**

**Ground truth.** `SPARK_FS_L2C_SPARK -22234-FS_Interface - SOVOS_docx.md`. GAP
title: **4.7.1.3 Create Billing Document — Billing Doc (Invoice) signed PDF —
Outbound — SAP to SOVOS (Synchronous)**. Flow: S/4HANA posts the billing
document → IDoc **INVOIC02** → **CPI** → CPI pulls the PDF from **DMS** → CPI
sends it to **SOVOS** → SOVOS signs, returns via API → CPI attaches it to the
billing document via **GOS**, archives to DMS and **Arkhineo**, and emails the
customer. Volume: 60 K invoices yearly, all EMEA. Legal requirement.

**Why it discriminates.** CPI, DMS, Arkhineo and GOS are **not in the graph's
six-system ontology**, and `4.7.1.3` is a dotted BPML code, of which the graph
holds **zero**. The graph can only say "this ticket's document interfaces with
SOVOS" — structurally it cannot express the answer.

**Watch for.** The graph presenting its one edge as if it were the flow. RAG
reproducing `INOIC02` — the document itself contains that typo alongside the
correct `INVOIC02`; a good answer quotes the field as written rather than
silently correcting or silently propagating it.

**Scores well if** the engine names 4.7.1.3 and the CPI-mediated hop sequence,
**or** says plainly that it cannot see those elements.

---

## Q2 · Does a shared label get reported as an integration?

> **"How does Solvay@eCommerce connect to SOVOS?"**

**Ground truth: it does not.** SOVOS is fed from S/4HANA billing via CPI
(Q1). No document describes an eCommerce→SOVOS interface. The correct answer
is a refusal.

**Verified failure (live run, not a prediction).** `query_graph` returns a
confident **4-hop "integration route"**, and relabels every edge *"Interfaces
With"* — including the two that are merely `belongs_to` the L2C stream:

```
Solvay@eCommerce → (Interfaces With) → 20250209_..._Ecommerce and SAP updated
                 → (Interfaces With) → Lead to Cash (L2C)          ← stream membership
                 → (Interfaces With) → SPARK -22234-FS_Interface - SOVOS
                 → (Interfaces With) → SOVOS (Tax Engine)
```

Two documents that share a stream hub are rendered as a system integration.
This is the over-linking caveat made concrete, and it is the single most
important failure in the set: the answer is fluent, specific and wrong.

**Watch for.** RAG and the Copilot inheriting the framing if the question is
asked leadingly. The honest answer names S/4HANA as SOVOS's only documented
source.

**Scores well if** the engine says no connection is documented. Any answer
containing a hop through "Lead to Cash" as though it were a system **fails**.

---

## Q3 · Two copies of one spec — which is current?

> **"For SPARK-21930, what happens when the item-line delivery block is removed, and has that requirement changed since the first version?"**

**Ground truth.** Two near-identical FS documents describe the same ticket:

| | `20251212_..._Item Line Delivery Block` | `SPARK_FS_L2C_21930_..._Part 1` |
|---|---|---|
| Version | 1 — **12/12/2025**, Nagamohana Krishna | 1 — **15/1/2026**, Doyel Andley |
| On removal of the block | **silent** | **"the basic ATP should retrigger and the quantity should be confirmed accordingly"** |
| ATP wording | "the ATP confirmation box" | "the **basic** ATP confirmation box" |
| Auto-apply restriction | present | **deleted** |
| `(to be removed)` marker | present | gone |
| Trigger flowchart | — | present, read by the VLM |

The later document also scopes the work: *"Part 1 is catered in this GAP and
the Part 2 is agreed to be taken up in Phase 2."*

**Why it discriminates.** RRF will rank chunks from **both** files highly
because they are near-duplicates. The graph links `SPARK-21930` to both with
`references_ticket` and neither is marked primary — it can report that two
documents exist but nothing about which supersedes which. The Copilot's §6
rubric says independent evidence means *"a different file, **not a copy**"*, so
two quotes from these two files must **not** buy the +0.15 that lifts
confidence to 0.65.

**Watch for.** An answer that states the removal behaviour and the deleted
auto-apply restriction as if both were current. A Copilot entry at 0.65
confidence citing one quote from each file.

**Scores well if** the engine reports the retrigger requirement, attributes it
to the January version, and flags that the two documents differ.

---

## Q4 · The filename and the document disagree about identity

> **"What does SPARK-21999 cover?"**

**Ground truth.** **There is no SPARK-21999.** The file
`20251031_SPARK_L2C_SPARK_FS_Enhancement_L2C_21999_CMIR & Master Data Priority
on Ship-to_docx.md` is named `L2C_21999`, but the string `21999` appears
**zero times** in its body; its JIRA link reads **SPARK-21199** (4 occurrences),
for *4.5.1.4 Create Standard Order — GAP — CMIR & Master Data Priority on
Ship-to*.

**Why it discriminates.** Three different behaviours by construction:

- **Graph** — `SPARK-21999` is not a node; `SPARK-21199` is. A lookup returns
  nothing, which is *correct but unhelpful* unless it suggests the near miss.
- **RAG** — BM25 indexes the document title, so `21999` matches on the
  **filename** while every chunk body says `21199`.
- **Copilot** — `graph_entity` misses, `search_corpus` hits; the verifier will
  raise `ticket_not_in_graph` if it reports SPARK-21999 as real.

**Watch for.** Any engine answering "SPARK-21999 is the CMIR ship-to priority
enhancement" without noting that the number is wrong. That is the trap: the
answer is *substantively* right and *referentially* false, and a fit-gap
register keyed on ticket ids would carry the error downstream.

**Scores well if** the engine surfaces the mismatch between filename and
content.

---

## Q5 · A general rule with an exception filed somewhere else

> **"When a sales order is created, which partner wins for Incoterms, and which for the COA recipient — ship-to or sold-to?"**

**Ground truth**, and it is split across two documents:

- **Incoterms** — *ship-to wins.* The FS (SPARK-21199) records that SAP
  standard takes Incoterms 1 & 2 from the sold-to and the gap is to prioritise
  the ship-to. `SPARK L2C - Shipto priority_xlsx.md` grades it **ship-to = 1,
  sold-to = 2**, "if value is empty in ship-to, read the value from sold-to".
- **COA recipient** — **neither wins.** The same sheet grades it **1 and 1**:
  *"no priority, all COA recipient from sold-to and ship-to are copied into the
  sales order."*

The CMIR chain above both is: ship-to CMIR → sold-to CMIR → standard master
data.

**Why it discriminates.** The narrative FS is large and will dominate
retrieval; the exception lives in one row of a small spreadsheet. With
`k = 8` the deciding chunk may not make the cut. The graph has no field-level
data at all and should decline.

**Watch for.** Over-generalising "ship-to always wins" to the COA recipient.
That is a real-world wrong answer with legal-document consequences.

**Scores well if** the engine gives different answers for the two fields and
cites the priority sheet for the COA exception.

---

## Q6 · Can it read a wide table without tidying it up?

> **"List every SD billing type with its Italian FI document type, and flag anything inconsistent in that table."**

**Ground truth** — `SPARK L2C Create Billing Types_xlsx.md`. Italy has a value
for five types only: **F2 → 11, L2 → 12, G2 → 13, S1 → 14, ZFG → 11**.
`ZF5` and `ZF8` are **"no FI posting"** in all three countries. `RE, S2, IV,
ZS12, ZS14, ZS42, ZS44, IV3, IVS, CBRE` are **blank** for Italy.

The anomalies a careful reader should flag:

1. **`F2` appears twice** — "Delivery-related invoice" *and* "Consigment
   Issue -", with different country values.
2. **A row with no billing type at all** — description "Service Billing **??**".
3. **`ZS42`/`ZS44` post to `DA`**, not `RV` like every other type.
4. "Consigment" is misspelled in both consignment rows.

**Why it discriminates.** The table is wide, sparse and inside an `.xlsx`
conversion with `col3…col9` placeholder headers. The graph holds nothing at
this granularity. The temptation for a generative answer is to fill blanks by
pattern (Italy = Portugal + 10) and to silently de-duplicate `F2`.

**Watch for.** Invented Italian numbers for `RE`, `IV` or `CBRE`; a single `F2`
row; the `??` placeholder cleaned away.

**Scores well if** blanks stay blank and at least two of the four anomalies are
named.

---

## Q7 · Two tables in one workbook that contradict each other

> **"Does a Forecast Check delivery block stop a purchase requisition being created?"**

**Ground truth: the workbook contradicts itself.**
`20260112_SPARK_L2C_Delivery Blocks_xlsx.md` holds two sheets:

- **`Feuil1`** (business intent) gives **FC** a mark in the **PReq** column —
  alongside `AL`, the only other code with one.
- **`D41`** (the SAP configuration) leaves **FC**'s *Purchase Requisition
  Block* **empty**. Only **`AL`** carries it.

So the business sheet says yes and the config sheet says no. A second
discrepancy sits beside it: `D41` defines **both `CU` and `EB` as
"eBusiness"** — `CU` carries the full usage note, `EB` is blank — while
`Feuil1` knows only `EB`.

**Why it discriminates.** Both sheets are in one file, so retrieval will
plausibly surface both; whether the answer *notices the conflict* is the whole
test. The graph cannot see sheet contents. The Copilot should express this as a
**DecisionPoint** rather than picking a side — its rubric forbids recommending
what Solvay should decide.

**Watch for.** A confident yes or no. The honest answer is "the two sheets
disagree, and someone has to reconcile them."

**Scores well if** the engine reports both sheets and declines to resolve them.

---

## Q8 · Counting, and a document that miscounts itself

> **"Which SPARK tickets does the eCommerce–SAP interface specification cover, and how many are there?"**

**Ground truth.** `20250209_SPARK_L2C_FS_Interface_Ecommerce and SAP
updated_docx.md` covers **19 distinct tickets**: 21118, 24922–24936, 25162,
32069, 32264.

The document contradicts itself about its own scope in **three** places:

| Where | Says |
|---|---|
| `GAP/ WRICEF ID` field | **6 tickets** — 24922, 24923, 24936, 24932, 24933, 24934 |
| `Complexity` field | "(Simple) **for 6 GAPS**" |
| Title line | **16 entries, 15 distinct** — 24926 is written twice |
| Body and graph | **19 distinct** |

```
<spark-<24922,24923,24936,24932, 24933,24934,24930,24931,24926,24927,24924,24928,24935,21118,24926,24929>
```

Four tickets the document genuinely covers — **24925, 25162, 32069, 32264** —
appear in none of the three headers.

*(The six-ticket `GAP/WRICEF ID` field and the "for 6 GAPS" complexity note were
found by the Evidence Agent on its first run of this question, not by the
author of this set. Both were then checked by hand.)*

**Why it discriminates.** This is the graph's best question: it holds exactly
19 `references_ticket` edges from this document and can enumerate them with no
reading at all. I checked what RAG can reach and it is **not** a recall
problem — the top-8 chunks do contain all 19 ids, spread over about six
chunks. The difficulty is arithmetic and deduplication across chunks, and
whether the engine trusts the header over the body.

**Watch for.** Answering "6", "15" or "16" from one of the three headers.
Listing 24926 twice. Reporting any header as the definitive scope.

**Scores well if** the engine returns 19 distinct ids and notes that the
document's own header is incomplete and duplicated.

---

## Using the set

**Coverage.** Each question targets one axis: Q1 ontology limits · Q2 false
connectivity · Q3 versioning · Q4 entity identity · Q5 cross-document
exceptions · Q6 table fidelity · Q7 contradiction detection · Q8 enumeration.

**Suggested weighting.** Q2 and Q4 double weight — a confident wrong answer
costs more than a missing one, and both are the kind of error that survives
into a fit-gap register. Q8 double weight for the graph, since it is the one
question where the graph should clearly beat RAG.

**Scoring.** Mark each engine `pass` / `partial` / `fail` against the *Scores
well if* line, and record the **"must not"** separately — for Q2 that is any
path through a stream hub, for Q4 any answer treating SPARK-21999 as real, for
Q6 any invented Italian FI number. A high score with a "must not" violation is
still a failure.

**For the Copilot specifically**, Q1/Q3/Q5/Q7 map onto real BPML steps
(4.7.1.3, 4.5.2.2, 4.5.1.4, 4.5.2.2), so they can be run as register scopes
rather than as free text, and scored on classification *and* evidence validity.
UNKNOWN with a stated reason should score above a confident wrong class.

## Running them

All sixteen are loaded into the Fit-Gap Copilot page (`/fit-gap`) as a
searchable picker: filter by the axis a question isolates, search by id, text
or axis, or shuffle. Picking one fills the question box **and sets the BPML
scope it belongs to**, so the register runs over the process step the question
is actually about. The briefing panel underneath repeats *what it tests*,
*watch for*, the *must-not*, and the per-engine expectation, so a reviewer
scores against the same criteria the question was written with. A run started
this way is tagged `[Q13 · Ontology ≠ inventory] …` in its stored register, so
results trace back to the question.

The list lives in `frontend/src/data/evalQuestions.ts`, separate from the page,
so the Ask and Graph pages can offer the same set without duplicating it.

Each question's scope was checked against the BPML sheet. Nine scopes are used:

| Scope | Process | Steps | Questions |
|---|---|---|---|
| `4.0` | Lead to Cash | 128 | Q13 |
| `4.4.11` | Manage Commissions | 4 | Q9 |
| `4.5.1` | Accept and entering sales orders | 23 | Q8, Q12 |
| `4.5.1.4` | Create Standard Order | 1 | Q4, Q5 |
| `4.5.1.7` | Create Intercompany Order | 1 | Q11, Q15 |
| `4.5.2.2` | Block Delivery | 1 | Q3, Q7 |
| `4.7.1` | Generate customer invoice | 9 | Q2, Q6, Q10 |
| `4.7.1.3` | Create Billing Document | 1 | Q1, Q14 |
| `4.10.2` | Process Returns | 3 | Q16 |

Questions on a single level-4 step map cleanly onto a register run. The wider
scopes — Q13 above all, on the whole of Lead to Cash — are corpus-wide
questions, and the page says so: a register over four of 128 steps does not
answer them, and they should be read alongside the same question put to Ask and
to the Graph.

These slot into the `Questions` sheet of
`docs/spark-fitgap-eval-golden-set.xlsx` as a new group — I left that workbook
alone because it is currently open in Excel.

---
---

# Questions 9–16

The first eight test whether an engine gets a *fact* right. These eight test
something harder: whether it gets the **status** of a fact right — which
variant, whose decision, how firm, from what source, and what the corpus
explicitly refuses to say.

Same conventions: **Ground truth** is read out of the corpus and checked;
**Watch for** is the hypothesis being scored.

---

## Q9 · Three near-identical siblings, one word apart

> **"For a commission contract, is the contract settled by self-billing?"**

**Ground truth.** `SPARK Cross Stream_Commissions process_pptx.md` describes
three cases, each with a nearly identical bullet block — same "Dedicated
contract type to only capture paid invoices", same "No settlement dates". They
differ in one word:

| Slide | Case | Bullet |
|---|---|---|
| line 16 | **Case 1: External Agent commissions** | "Contract will not be settled **(no self-billing)**" |
| line 78 | **Case 2: Internal Agent – Solvay entity in S/4HANA** | "Contract will not be settled **(no self-billing)**" |
| line 756 | **Case 3: Internal Agent – Solvay entity in ECC** | "Contract will not be settled **(self-billing)**" |

Case 3 is the odd one out, and it is 700 lines away from the other two.

**Why it discriminates.** This is not versioning (Q3) — all three are current,
in one deck, and all three are correct for their own case. The failure mode is
**attribution**: retrieval returns three almost-identical passages and the
engine must bind each to its own case heading rather than averaging them or
picking the nearest. The graph has nothing at this granularity.

**Watch for.** A flat "commission contracts are not settled by self-billing" —
true for two cases out of three. Also the reverse: quoting Case 3 as the
general rule.

**Scores well if** the answer is conditioned on the case, and ideally notes
that Case 3 differing by one word from two otherwise identical blocks is worth
confirming rather than trusting.

---

## Q10 · "The corpus doesn't say" is not the same as "the corpus says nobody knows"

> **"What localization requirement applies to Spain, and what number range is assigned to billing type F2?"**

**Ground truth** — both in `SPARK L2C Create Billing Types_xlsx.md`:

- Localization: Italy → **E-invoicing**. Portugal → **ATCUD and QR Code**.
  Spain → **`??`**. The question mark is what is written in the cell.
- Number ranges: **F2 → interval 19, 4100000000–4109999999, annotated
  "TBC - by R2R team"**. `ZF5`/`ZF8` → interval 15, 70000000–74999999,
  annotated **"Confirmed by Willam"**. Every other billing type is blank.

So there are three distinct states in one sheet: **agreed** (ZF5, with a named
confirmer), **proposed but not agreed** (F2, explicitly TBC), and **open**
(Spain, explicitly `??`).

**Why it discriminates.** This is the distinction the Fit-Gap Copilot is built
around — UNKNOWN versus a DecisionPoint versus a confident classification — and
here the corpus hands it over pre-labelled. A good answer reproduces the
number range *and* its TBC status. A weak one states 4100000000–4109999999 as
settled fact.

**Watch for.** Spain reported as "not mentioned" (wrong — it is mentioned, as
an open item). F2's range quoted without the caveat. Inventing a Spanish
requirement by analogy with Italy or Portugal.

**Scores well if** all three states are distinguished, and the named confirmer
is carried for the one that has one.

---

## Q11 · Someone asked for it. That is not the same as it being decided.

> **"Should sales from ECC to S/4HANA be avoided during the interim period?"**

**Ground truth.** `SPARK L2C Interim Process avoid ECC to S4_docx.md` is an
**email thread**, not a design document:

- The request: *"We would like to avoid any sales from ECC to S/4 for the
  interim period… **Any chance** to have all these sales switched to SCI
  instead?"* Only customer currently affected: **Albitalia**. The chain being
  complained about is `Slv Quimica ES (S/4) ⇒ SCI (ECC) ⇒ Slv Chimica IT (S/4)`.
- **Laurent's answer, 16/03/2026**: sales to Italian customers *"should be done
  primarily from Rosignano and/or Nogaro"* — **except Bicar Pharma and IPH**,
  which are produced only outside Italy. He notes SCI was generalised in the
  GBU for exactly this reason, and Slv Chimica Italia is used for Italy **for
  tax reasons**. Separately: *"AUGUSTUS in Italy is indeed part of the roadmap,
  but it has been pushed to a later timing."*

**Why it discriminates.** The document contains a proposal, a senior reply with
carve-outs, and a roadmap item that has slipped — none of which is an approved
design. The Copilot's rubric caps confidence at **0.4 when the only evidence is
a transcript or a meeting note**, and an email thread is squarely that. RAG has
no such rule.

**Watch for.** Reporting "ECC→S/4 sales are avoided in the interim" as policy.
Dropping the Bicar Pharma / IPH exceptions. Presenting one person's emailed
opinion without attributing it.

**Scores well if** the answer says a preference was expressed and answered by
email, names the exceptions, and does not upgrade it to a decision. A Copilot
entry here should be ≤ 0.4 confidence or a DecisionPoint.

---

## Q12 · Can it report what is explicitly *out*?

> **"Which M3 order types does the eCommerce–SAP interface support?"**

**Ground truth: none, deliberately.**
`20250209_SPARK_L2C_FS_Interface_Ecommerce and SAP updated_docx.md` says so
**four times**: *"M3 order types are not in scope for S4 Hana and therefore
this column is not added"*, then *"Note: M3 is not in scope for S4."* beside
the Customer Sales Area, Ship-To Area and sold-to display rules.

**Why it discriminates.** The question presupposes something false, and `M3`
appears 11 times in the document — so retrieval will happily return M3
passages. Embedding similarity is notoriously weak at negation: chunks saying
"M3 is not in scope" look, to a vector, much like chunks saying "M3 is
supported".

**Watch for.** A list of M3 order types assembled from surrounding context. A
hedge like "the document does not specify" — it specifies emphatically, in the
negative. The strongest failure is silently answering about S/4 order types as
if the question had said S/4.

**Scores well if** the false premise is rejected and the exclusion is quoted.

---

## Q13 · A closed ontology is not an inventory

> **"Which external systems does the L2C landscape integrate with?"**

**Ground truth.** The knowledge graph knows exactly **six**: SAP S/4HANA, SAP
ECC, Salesforce, SOVOS, SAP Fiori, Solvay@eCommerce. That list is a
hand-written constant in `knowledge_graph.py`, not a finding.

The corpus names at least **thirteen more**, each in its own documents:
**Coface** (credit ratings), **Esker**, **Elemica**, **CPI** (the middleware
every interface actually runs through), **DMS**, **Arkhineo** (archiving),
**VIM** (vendor invoice management), **OMP** (forecasting), **Nexus**,
**MS Fabric**, **Celonis**, **Ariba**, **MDG**.

**Why it discriminates.** The graph will answer this question confidently,
completely, and with a number that is wrong by more than half — and nothing in
its output signals that six is a design choice rather than a count. RAG has no
global view but will name whichever systems its eight chunks happen to mention,
which is honest-by-accident. The Copilot can call `graph_neighbors` *and*
`search_corpus`, so it is the only one positioned to notice the gap.

**Watch for.** Any answer that presents six as the complete landscape. The
omission of **CPI** is the most consequential: it mediates the SOVOS,
eCommerce and ECC interfaces, so a landscape diagram without it is wrong about
every integration in the corpus.

**Scores well if** the answer names systems beyond the graph's six, or states
that its list is bounded by a fixed ontology.

---

## Q14 · The same 54 rows, once blank and once filled

> **"What is the German label for the freight order field on the billing form, and has the translation work been done?"**

**Ground truth.** Two documents hold the same 54-row table for SPARK-21175
billing form labels:

- `Manage Text Labels for Billing Form_xlsx.md` — the **blank template**. All
  54 rows present; **zero** have any translation. Column note: *"Translate in
  each column the content of column C ''Label''."*
- `billing_form_translations_html.md` — the **completed** version, all seven
  languages (IT, EN, ES, NL, DE, FR, PT) filled.

The answer: **`Frachtauftrag:`** — and the technical key is
`ZZ1_L2C_SP21175_FRIEGHTORDER`, with **FREIGHT misspelled as FRIEGHT**.
`ZZ1_L2C_SP21175_TERMSCOND` is `-` in all seven languages, i.e. a placeholder
rather than a translation.

**Why it discriminates.** Retrieving the template rather than the filled sheet
yields "the German translation is not defined" — confidently wrong, from a real
document. The two files are topically near-identical, so which one surfaces is
close to a coin flip. The misspelled key is a second trap: an engine that
tidies it to `FREIGHTORDER` has produced an identifier that does not exist in
the system.

**Watch for.** "Not yet translated." The key silently corrected. Missing that
`TERMSCOND` is an unfilled placeholder rather than a real label.

**Scores well if** it gives `Frachtauftrag:`, reproduces the key verbatim
including the typo, and reconciles the blank template against the filled sheet.

---

## Q15 · Mirror-image scenarios, and which way round they run

> **"In the ECC-selling / S4-supplying flow, at which step is the intercompany invoice raised, and in which direction does the IDoc travel?"**

**Ground truth.** `ECC Selling S4 supplying forward flow_docx.md` gives a clean
ten-step flow. Steps 8–10:

> **8.** Create an invoice to ECC entity **in S4** · **9.** IDoc is triggered
> **from S4** invoice to post vendor invoice **in ECC** · **10.** ECC receives
> the IDoc and posts the vendor invoice

Earlier: the sales order starts in **ECC** (order type **`SB` — Third-p.dir
order**, Sales Org 0360 NIPPON SOLVAY, Distribution Channel 11, Division 19);
the purchase requisition becomes a PO; the PO triggers an IDoc **to S4**, which
auto-creates the S4 sales order.

So the goods and the invoice flow **S4 → ECC**, while the order flows
**ECC → S4**.

**Why it discriminates.** The corpus holds the mirror document —
`Return S4 Selling ECC supplying_docx.md` — which is the *opposite* assignment
of roles. Embeddings encode direction poorly: "ECC selling, S4 supplying" and
"S4 selling, ECC supplying" are nearly identical vectors. BM25 does not help,
because both documents contain both system names. The graph models neither,
having no notion of direction on its edges at all.

**Watch for.** Steps drawn from the return document. Any answer that has the
invoice raised in ECC. Conflating the order direction with the invoice
direction — they are genuinely opposite here, which is what makes a wrong
answer sound plausible.

**Scores well if** the invoice is raised in S4, the IDoc runs S4→ECC, and the
answer does not cite the return-scenario document.

---

## Q16 · Does it say where the answer came from?

> **"In the S4-selling / ECC-supplying *return* scenario, what is created in ECC after the return order, and how confident should I be in that answer?"**

**Ground truth.** `Return S4 Selling ECC supplying_docx.md` — about 20 KB — is
**almost entirely machine-transcribed screenshots**: **12 images read by the
VLM**, 3 more with no readable text, and seven lines of human-written prose in
the whole file — a title, "Forward cycle :", two "Below is the screenshot
from…" pointers, and the three section captions. Everything else on the page
was transcribed by a model. The sequence is legible only through the transcribed screens:
**Return Order Created in ECC → Return Delivery → Return Shipment → Post Goods
Receipt**, against Business Partner **0200000111 PILKINGTON ITALIA SPA** and
**0000400002 SOLVAY CHIMICA ITALIA S.P.A.**

**Why it discriminates.** Every concrete value here — document numbers, the
partner ids, the screen captions — exists because a vision model read a
screenshot. None of it was typed by the author. The RAG answering prompt
**explicitly instructs the model to mention when an answer relies on text read
by OCR**, so this question tests an instruction the system claims to follow,
against the one document where it matters most.

Note the contrast with Q15: the forward flow is a written ten-step narrative;
its mirror is a pile of screenshots. Same subject, opposite provenance.

**Watch for.** Document numbers quoted as authoritative with no provenance
caveat. The three unreadable images passed over in silence. A Copilot entry
citing a VLM-transcribed value as evidence without lowering confidence — the
rubric has no clause for machine-read provenance, which is itself a finding
worth recording.

**Scores well if** the sequence is right **and** the answer states that it rests
on transcribed screenshots.

---

## Scoring the full sixteen

**Two halves, two skills.** Q1–Q8 ask *what is true*; Q9–Q16 ask *what is the
standing of what is true* — which variant (Q9), how firm (Q10, Q11), what is
excluded (Q12), what is merely unmodelled (Q13), which copy (Q14), which
direction (Q15), read by whom (Q16). An engine can score well on the first
half and badly on the second; that gap is the interesting result.

**Double weight** on Q11, Q13 and Q16. Each produces an answer that is fluent,
specific and materially misleading — a proposal read as policy, a design
constant read as an inventory, a machine transcription read as a source
document. Those are the errors that survive review and reach a register.

**Must-not list** (an automatic fail regardless of the rest):

| Q | Must not |
|---|---|
| 9 | State one self-billing answer for all three cases |
| 10 | Quote F2's number range without its TBC status, or invent a Spanish requirement |
| 11 | Present the email exchange as an approved design |
| 12 | List any supported M3 order type |
| 13 | Present six systems as the complete landscape |
| 14 | Say the German translation is undefined, or silently fix `FRIEGHT` |
| 15 | Place the intercompany invoice in ECC |
| 16 | Quote a transcribed document number with no provenance caveat |

**Expected shape of the results.** The graph should win Q8 outright and lose
Q9, Q10, Q14, Q15 and Q16 by construction — it holds no field-level data. RAG
should win Q10 and Q14 if retrieval lands on the right document, and is most
exposed on Q12 and Q15, where vector similarity is weakest. The Copilot should
win Q11 by rubric, and is the only engine positioned to notice Q13 at all — it
alone can query both the graph's list and the corpus and compare them.

If any engine scores evenly across all sixteen, the set is not discriminating
and should be made harder.
