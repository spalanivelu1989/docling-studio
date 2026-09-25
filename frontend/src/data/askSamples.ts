/** Sample questions for Ask RAG: eight a user can ask to see what grounded
 *  retrieval does, each chosen to show one behaviour. Every one but the last
 *  has been asked on this corpus and scored well by the judges; the last is
 *  there to show the assistant staying in scope. */
import type { SampleQuestion } from "./evidenceSamples";

export const ASK_SAMPLES: SampleQuestion[] = [
  {
    id: "S1", shows: "A process, explained",
    question: "Explain the BKP1 customer return management process.",
    lookFor: "A step-by-step answer, every step carrying a numbered citation you can open in its document.",
  },
  {
    id: "S2", shows: "What a workshop concluded",
    question: "How is the invoice split handled, and what did the billing workshop conclude about it?",
    lookFor: "The design as specified and the workshop's own words, cited to the transcript and the specification.",
  },
  {
    id: "S3", shows: "A programme decision",
    question: "Should sales from ECC to S/4HANA be avoided during the interim period?",
    lookFor: "The decision and where it was recorded, from the meeting minutes.",
  },
  {
    id: "S4", shows: "A precise rule",
    question: "For a commission contract, is the contract settled by self-billing?",
    lookFor: "A direct yes or no with the passage that settles it — and a high faithfulness score in the Evaluation tab.",
  },
  {
    id: "S5", shows: "Which system does what",
    question: "Which system signs the PDF invoice?",
    lookFor: "The system named in the interface specification, with the flow around it.",
  },
  {
    id: "S6", shows: "A control and its effect",
    question: "What does the Forecast Check delivery block do?",
    lookFor: "What the block is, when it is set and what it stops, from the functional specification.",
  },
  {
    id: "S7", shows: "Two documents, one answer",
    question: "When a sales order is created, which partner wins for Incoterms, and which for the COA recipient — ship-to or sold-to?",
    lookFor: "Each half answered from a different document; open the Sources tab to see which excerpt carried which.",
  },
  {
    id: "S8", shows: "Staying in scope",
    question: "What is the capital of France?",
    lookFor: "Nothing in the project documents covers it, so the answer is “I don't have the information.” rather than a guess.",
  },
];
