import {
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Columns2,
  Cpu,
  DatabaseZap,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  MessageSquareText,
  ScanEye,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";

type Page = "extract" | "batch" | "add-kb" | "review" | "viewer" | "ask" | "landing";

export default function LandingPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <Box
      sx={{
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        bgcolor: "background.default",
        position: "relative",
      }}
    >
      {/* Ambient background glow effects */}
      <Box
        sx={{
          position: "absolute",
          top: -120,
          left: "50%",
          transform: "translateX(-50%)",
          width: 900,
          height: 480,
          background: (t) =>
            t.palette.mode === "dark"
              ? "radial-gradient(circle, rgba(59,130,246,0.18) 0%, rgba(139,92,246,0.12) 45%, rgba(0,0,0,0) 70%)"
              : "radial-gradient(circle, rgba(59,130,246,0.12) 0%, rgba(99,102,241,0.08) 45%, rgba(255,255,255,0) 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 }, position: "relative", zIndex: 1 }}>
        {/* Hero Section */}
        <Stack spacing={3} sx={{ textAlign: "center", alignItems: "center", mb: { xs: 7, md: 10 } }}>
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <Chip
              icon={<Sparkles size={14} />}
              label="Enterprise Document Intelligence & Multimodal RAG"
              color="primary"
              variant="outlined"
              sx={{
                fontWeight: 600,
                fontSize: 12.5,
                py: 0.5,
                px: 1,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
                borderColor: (t) => alpha(t.palette.primary.main, 0.3),
              }}
            />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.1 }}>
            <Typography
              variant="h2"
              component="h1"
              sx={{
                fontWeight: 850,
                letterSpacing: "-0.03em",
                lineHeight: 1.15,
                maxWidth: 950,
                fontSize: { xs: "2.25rem", sm: "3rem", md: "3.6rem" },
                color: "text.primary",
              }}
            >
              Turn Complex Enterprise Docs into{" "}
              <Box
                component="span"
                sx={{
                  background: (t) =>
                    t.palette.mode === "dark"
                      ? "linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #f472b6 100%)"
                      : "linear-gradient(135deg, #2563eb 0%, #7c3aed 60%, #db2777 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Structured Knowledge
              </Box>
            </Typography>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
            <Typography
              variant="body1"
              sx={{
                color: "text.secondary",
                fontSize: { xs: 16, md: 19 },
                lineHeight: 1.65,
                maxWidth: 780,
                mx: "auto",
              }}
            >
              Docling Studio bridges complex office documents, presentations, spreadsheets, and PDFs with modern AI pipelines. Extract layout-aware Markdown, rebuild PowerPoint flowcharts in Mermaid.js, read embedded graphics with Claude Vision, and query your knowledge base using hybrid pgvector search.
            </Typography>
          </motion.div>

          {/* Quick CTA Buttons */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}>
            <Stack direction="row" spacing={2} sx={{ pt: 1, flexWrap: "wrap", justifyContent: "center", gap: 1.5 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<FileText size={18} />}
                onClick={() => onNavigate("extract")}
                sx={{ px: 3.5, py: 1.25, borderRadius: 2.5, fontWeight: 700, fontSize: 14.5 }}
              >
                Start Converting
              </Button>
              <Button
                variant="outlined"
                size="large"
                startIcon={<FolderArchive size={18} />}
                onClick={() => onNavigate("batch")}
                sx={{ px: 3.5, py: 1.25, borderRadius: 2.5, fontWeight: 700, fontSize: 14.5 }}
              >
                Batch Upload & Convert
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                size="large"
                startIcon={<MessageSquareText size={18} />}
                onClick={() => onNavigate("ask")}
                sx={{ px: 3, py: 1.25, borderRadius: 2.5, fontWeight: 700, fontSize: 14.5 }}
              >
                Ask Knowledge Base
              </Button>
            </Stack>
          </motion.div>
        </Stack>

        {/* Feature Services Grid */}
        <Box sx={{ mb: { xs: 8, md: 12 } }}>
          <Stack spacing={1.5} sx={{ textAlign: "center", mb: 5 }}>
            <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 700, letterSpacing: "0.1em" }}>
              Comprehensive Platform Capabilities
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
              Five Integrated Workspaces for Every Stage
            </Typography>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
              gap: 3,
            }}
          >
            {/* Service 1: Convert */}
            <ServiceCard
              icon={<FileText size={24} />}
              color="#3b82f6"
              title="1. Document Convert"
              subtitle="Deep layout extraction and flowchart recovery"
              badge="Core Converter"
              description="Upload single documents (PPTX, DOCX, XLSX, PDF, PNG/JPG). Employs LibreOffice and Poppler for faithful rendering, recovers PowerPoint connectors into Mermaid flowcharts, extracts spreadsheet tables, and reads complex diagrams with Claude Vision Models."
              features={[
                "Native PPTX connector graph to Mermaid.js",
                "Full Excel table reconstruction with openpyxl",
                "Claude 3.7 / GPT-4o / Qwen-VL Vision Models",
                "Tesseract optical OCR fallback",
              ]}
              buttonText="Open Convert"
              onClick={() => onNavigate("extract")}
            />

            {/* Service 2: Batch Convert */}
            <ServiceCard
              icon={<FolderArchive size={24} />}
              color="#8b5cf6"
              title="2. Batch Convert"
              subtitle="High-throughput folder & multi-file conversion"
              badge="High Throughput"
              description="Drop an entire directory or queue multiple documents at once. Streams real-time Server-Sent Events (SSE) progress, generates full tools & libraries execution telemetry, downloads all results in bulk as a ZIP, and inserts into pgvector with one click."
              features={[
                "Entire folder upload with webkitdirectory",
                "Real-time sequential SSE conversion pipeline",
                "Per-file tools and library execution breakdown",
                "Bulk .zip export & 1-click pgvector ingestion",
              ]}
              buttonText="Open Batch Convert"
              onClick={() => onNavigate("batch")}
            />

            {/* Service 3: Doc vs MD */}
            <ServiceCard
              icon={<ScanEye size={24} />}
              color="#06b6d4"
              title="3. Doc vs MD Review"
              subtitle="Side-by-side source & Markdown verification"
              badge="Visual QA"
              description="Compare original presentation slides, PDFs, or Word documents in the left pane alongside the generated Markdown in the right pane. Features synchronized relative scrolling, zoom controls, continuous or single-page navigation, and on-the-fly conversion."
              features={[
                "High-res page image rendering of original docs",
                "Dual-pane synchronized relative scrolling",
                "Zoom in/out (50%–200%) & single page navigation",
                "Direct markdown preview with live stats",
              ]}
              buttonText="Open Doc vs MD"
              onClick={() => onNavigate("review")}
            />

            {/* Service 4: MD Viewer */}
            <ServiceCard
              icon={<Columns2 size={24} />}
              color="#10b981"
              title="4. MD Viewer"
              subtitle="Dual Markdown comparator & revision inspector"
              badge="Diff & Inspect"
              description="Load two Markdown documents side-by-side to review extraction revisions, compare prompt variations, or audit changes. Includes synchronized scrolling, editable pane titles, rendered vs raw source toggles, and document metrics."
              features={[
                "Side-by-side Markdown comparison",
                "Synchronized scroll locking",
                "Rich rendered preview with KaTeX & diagrams",
                "Live word, character, and line count stats",
              ]}
              buttonText="Open MD Viewer"
              onClick={() => onNavigate("viewer")}
            />

            {/* Service 5: Ask */}
            <ServiceCard
              icon={<MessageSquareText size={24} />}
              color="#f59e0b"
              title="5. Ask & Knowledge Base"
              subtitle="Hybrid semantic vector search and grounded Q&A"
              badge="pgvector + RAG"
              description="Ask questions across your entire document repository. Powered by BGE-M3 embeddings (via local Ollama) stored in PostgreSQL pgvector, Reciprocal Rank Fusion (RRF) combining vector cosine similarity with Postgres BM25 keyword search, and Claude-synthesized answers with citations."
              features={[
                "PostgreSQL pgvector cosine HNSW indexing (1024d)",
                "Postgres full-text TSV keyword search (BM25)",
                "Reciprocal Rank Fusion (RRF) hybrid scoring",
                "Claude answer synthesis with source links",
              ]}
              buttonText="Open Ask"
              onClick={() => onNavigate("ask")}
            />

            {/* Platform Overview Tile */}
            <Paper
              sx={{
                p: 3.5,
                borderRadius: 3.5,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
                border: 1,
                borderColor: (t) => alpha(t.palette.primary.main, 0.2),
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <Box>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 2.5,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: (t) => alpha(t.palette.primary.main, 0.15),
                      color: "primary.main",
                    }}
                  >
                    <Workflow size={24} />
                  </Box>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Architecture & Pipeline
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Engineered for Enterprise Documents
                    </Typography>
                  </Box>
                </Stack>
                <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.65, mb: 2 }}>
                  Docling Studio handles the documents other parsers fail on: process flow diagrams with custom connectors, massive financial spreadsheets, multi-column process orders, and complex tabular specifications.
                </Typography>
              </Box>

              <Stack spacing={1}>
                <Chip size="small" icon={<CheckCircle2 size={13} />} label="No cloud lock-in: runs local or hosted" variant="outlined" sx={{ fontSize: 11.5 }} />
                <Chip size="small" icon={<CheckCircle2 size={13} />} label="FastAPI backend with background threadpool" variant="outlined" sx={{ fontSize: 11.5 }} />
                <Chip size="small" icon={<CheckCircle2 size={13} />} label="State preserved across navigation tabs" variant="outlined" sx={{ fontSize: 11.5 }} />
              </Stack>
            </Paper>
          </Box>
        </Box>

        {/* Technical Pipeline Flowchart */}
        <Box sx={{ mb: { xs: 8, md: 12 } }}>
          <Paper
            sx={{
              p: { xs: 3, md: 5 },
              borderRadius: 4,
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider",
              overflow: "hidden",
            }}
          >
            <Stack spacing={1.5} sx={{ textAlign: "center", mb: 4 }}>
              <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 700, letterSpacing: "0.1em" }}>
                How It Works
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                End-to-End Processing Architecture
              </Typography>
            </Stack>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
                gap: 2.5,
              }}
            >
              <PipelineStep
                number="01"
                title="Ingestion & Normalization"
                icon={<FileSpreadsheet size={20} />}
                desc="Upload PPTX, DOCX, XLSX, PDF, or images. LibreOffice and Poppler render visual pages for preview while raw OOXML/PDF DOMs are queued for extraction."
              />
              <PipelineStep
                number="02"
                title="Structure Extraction"
                icon={<Cpu size={20} />}
                desc="Docling engine extracts semantic hierarchies. OpenPyXL reads spreadsheet tables. Specialized parser resolves native PPTX connector arrows into Mermaid diagrams."
              />
              <PipelineStep
                number="03"
                title="Vision AI & OCR Augmentation"
                icon={<Sparkles size={20} />}
                desc="Multimodal AI (Claude 3.7 / GPT-4o) transcribes flattened infographics and complex visuals. Tesseract OCR handles scanned document text."
              />
              <PipelineStep
                number="04"
                title="pgvector Ingestion & RAG"
                icon={<DatabaseZap size={20} />}
                desc="Converted Markdown is chunked with header preservation, embedded with Ollama BGE-M3 (1024d), and stored in PostgreSQL pgvector for hybrid semantic and keyword search."
              />
            </Box>
          </Paper>
        </Box>

        {/* Supported Formats & Tech Badges */}
        <Box sx={{ textAlign: "center", mb: 6 }}>
          <Typography variant="subtitle2" sx={{ color: "text.secondary", fontWeight: 600, mb: 2 }}>
            Supported Input Formats & Technologies
          </Typography>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "center", flexWrap: "wrap", gap: 1 }}>
            {["PowerPoint (.pptx, .ppt)", "Word (.docx, .doc)", "Excel (.xlsx, .xls)", "PDF (.pdf)", "HTML / XML", "PNG / JPG / Images", "Mermaid.js", "Docling Engine", "LibreOffice", "Poppler", "Tesseract OCR", "Claude 3.7", "BGE-M3 (Ollama)", "PostgreSQL pgvector", "FastAPI", "React 19"].map((tech) => (
              <Chip
                key={tech}
                label={tech}
                size="small"
                variant="outlined"
                sx={{
                  fontSize: 12,
                  bgcolor: (t) => alpha(t.palette.background.paper, 0.6),
                }}
              />
            ))}
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}

// Subcomponent: Service Card
function ServiceCard({
  icon,
  color,
  title,
  subtitle,
  badge,
  description,
  features,
  buttonText,
  onClick,
}: {
  icon: ReactNode;
  color: string;
  title: string;
  subtitle: string;
  badge: string;
  description: string;
  features: string[];
  buttonText: string;
  onClick: () => void;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3.5,
        borderRadius: 3.5,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        transition: "all 0.2s ease",
        "&:hover": {
          borderColor: color,
          boxShadow: `0 8px 24px ${alpha(color, 0.12)}`,
          transform: "translateY(-2px)",
        },
      }}
    >
      <Box sx={{ mb: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", mb: 2 }}>
          <Box
            sx={{
              width: 46,
              height: 46,
              borderRadius: 2.5,
              display: "grid",
              placeItems: "center",
              bgcolor: alpha(color, 0.12),
              color: color,
            }}
          >
            {icon}
          </Box>
          <Chip size="small" label={badge} sx={{ fontWeight: 600, fontSize: 11, bgcolor: alpha(color, 0.08), color: color, borderColor: alpha(color, 0.25) }} variant="outlined" />
        </Stack>
        <Typography variant="h6" sx={{ fontWeight: 750, mb: 0.5, fontSize: "1.15rem" }}>
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, display: "block" }}>
          {subtitle}
        </Typography>
      </Box>

      <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 13, lineHeight: 1.6, mb: 2.5, flex: 1 }}>
        {description}
      </Typography>

      <Stack spacing={1} sx={{ mb: 3 }}>
        {features.map((f, i) => (
          <Stack key={i} direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Box sx={{ color: color, display: "flex" }}>
              <CheckCircle2 size={14} />
            </Box>
            <Typography variant="caption" sx={{ color: "text.primary", fontSize: 12 }}>
              {f}
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Button
        variant="outlined"
        size="small"
        endIcon={<ArrowRight size={15} />}
        onClick={onClick}
        sx={{
          borderColor: alpha(color, 0.4),
          color: color,
          fontWeight: 650,
          "&:hover": {
            bgcolor: alpha(color, 0.08),
            borderColor: color,
          },
        }}
      >
        {buttonText}
      </Button>
    </Paper>
  );
}

// Subcomponent: Pipeline Step
function PipelineStep({
  number,
  title,
  icon,
  desc,
}: {
  number: string;
  title: string;
  icon: ReactNode;
  desc: string;
}) {
  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 3,
        bgcolor: (t) => alpha(t.palette.action.hover, 0.3),
        border: 1,
        borderColor: "divider",
      }}
    >
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 800, color: "primary.main", fontFamily: "monospace", fontSize: 13 }}>
          {number}
        </Typography>
        <Box sx={{ color: "text.secondary", display: "flex" }}>{icon}</Box>
      </Stack>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
        {title}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.55, display: "block" }}>
        {desc}
      </Typography>
    </Box>
  );
}
