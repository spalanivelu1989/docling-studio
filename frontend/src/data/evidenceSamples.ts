/** Sample questions for the Evidence Agent: eight a user can ask to see what
 *  it does, each chosen to show one behaviour. The 27-question evaluation set
 *  (evalQuestions.ts) is a test instrument and stays with the Fit-Gap page;
 *  these are for someone meeting the agent for the first time. */
export interface SampleQuestion {
  id: string;
  /** What the question shows about the agent, in a few words. */
  shows: string;
  question: string;
  /** One line on what to look for in the answer. */
  lookFor: string;
}

export const EVIDENCE_SAMPLES: SampleQuestion[] = [
  {
    id: "S1", shows: "A process, end to end",
    question: "Explain the customer return management process.",
    lookFor: "One answer built from workshop decks, minutes and the BPML, with each step a separate claim and its quote.",
  },
  {
    id: "S2", shows: "An integration, explained",
    question: "Which systems does the SOVOS interface specification connect, and how?",
    lookFor: "The graph names the systems; retrieval supplies how they are connected. Both engines appear in the investigation.",
  },
  {
    id: "S3", shows: "SAP standard against the programme's choice",
    question: "In SAP S/4HANA standard, which credit check reactions are available when a sales order fails the credit check, and which reaction does the programme use?",
    lookFor: "What standard offers and what the programme decided, kept apart and each sourced.",
  },
  {
    id: "S4", shows: "Sources that disagree",
    question: "What delivery block does the Forecast Check use, and what does it stop?",
    lookFor: "Where documents conflict, both sides are reported and the answer is marked Conflicted rather than one being chosen.",
  },
  {
    id: "S5", shows: "Counting from the graph",
    question: "Which SPARK tickets does the eCommerce interface specification cover?",
    lookFor: "An exact list taken from the knowledge graph, confirmed against the specification's own text.",
  },
  {
    id: "S6", shows: "The landscape at a glance",
    question: "Which external systems does the L2C landscape integrate with?",
    lookFor: "The systems the Lead-to-Cash stream touches, and the documents that say so.",
  },
  {
    id: "S7", shows: "A decision and its history",
    question: "Should sales from ECC to S/4HANA be avoided during the interim period?",
    lookFor: "What was decided, in which meeting, and whether anything later changed it.",
  },
  {
    id: "S8", shows: "Catching a wrong reference",
    question: "What does SPARK-21999 cover?",
    lookFor: "There is no SPARK-21999: the file is named for it but its text says SPARK-21199. The agent should notice rather than answer as if the number were right.",
  },
];
