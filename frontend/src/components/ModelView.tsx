import { Box, IconButton, Paper, Tooltip, Typography, alpha, useTheme } from "@mui/material";
import * as d3 from "d3";
import { ArrowLeft, Compass, CornerLeftUp, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphModel, GraphNode, ModelNode } from "../api";
import { frappe } from "../theme";

/** The graph's schema drawn the way Neo4j's model editor draws it: a circle per
 *  label, a labelled arrow per relationship type, positions taken from the
 *  generated model file.
 *
 *  A label can be opened into the nodes it stands for, which is the only way to
 *  see a hierarchy the schema can merely assert: :Process has a
 *  :SUBPROCESS_OF self-relationship, but only the data shows what is under
 *  Lead to Cash. */

const R = 54;                      // node radius in model units

// Data Importer draws a neutral canvas: white circles with a thin grey rim,
// grey arrows, and a green tick on a label backed by data. Every label here is,
// since the model was generated from the graph.
//
// Importer's green is mixed for white paper and goes muddy on Frappé, so the
// dark canvas gets the palette's own Green instead.
const tick = (dark: boolean) => (dark ? frappe.green : "#2e9e4f");

interface Props {
  model: GraphModel;
  /** The built graph, so a label can be opened into the nodes it stands for. */
  graph?: GraphData | null;
  /** Label token currently expanded into instances, e.g. "Process". */
  expanded?: string | null;
  onExpandedChange?: (token: string | null) => void;
  onSelect?: (node: ModelNode | null) => void;
  onFocusNode?: (id: string) => void;
}

/** Label token -> node `type` in the built graph. */
const LABEL_TYPE: Record<string, string> = {
  Stream: "stream",
  System: "system",
  Document: "document",
  Process: "process",
  Spec: "spec",
};

/** Relationships that join two nodes of the same label -- the ones that make an
 *  expansion a shape rather than a scatter of circles. */
const SELF_RELATION: Record<string, string> = { process: "subprocess_of" };

const INST_R = 46;

/** Where an edge meets a circle, so arrowheads stop at the rim not the centre. */
function onRim(from: ModelNode, to: ModelNode, bend: number) {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular offset gives parallel edges between the same pair their own
  // lane; Interface->System carries three relationship types at once.
  const nx = (-dy / len) * bend;
  const ny = (dx / len) * bend;
  const mx = (from.position.x + to.position.x) / 2 + nx;
  const my = (from.position.y + to.position.y) / 2 + ny;
  const a1 = Math.atan2(my - from.position.y, mx - from.position.x);
  const a2 = Math.atan2(my - to.position.y, mx - to.position.x);
  return {
    x1: from.position.x + Math.cos(a1) * R,
    y1: from.position.y + Math.sin(a1) * R,
    x2: to.position.x + Math.cos(a2) * R,
    y2: to.position.y + Math.sin(a2) * R,
    mx,
    my,
  };
}

export default function ModelView({
  model,
  graph,
  expanded,
  onExpandedChange,
  onSelect,
  onFocusNode,
}: Props) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const fittedRef = useRef(false);
  const [transform, setTransform] = useState(d3.zoomIdentity);
  // Where the pointer went down, so that panning does not count as a click on
  // the background and silently clear the selection.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(240, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(
    () => Object.fromEntries(model.nodes.map((n) => [n.id, n])),
    [model.nodes]
  );

  // --- expanding a label into the nodes it stands for ----------------------
  // The schema says :Process HAS a hierarchy; only the data shows what that
  // hierarchy is. An expansion lays the real nodes out with d3.tree, keeping
  // the canvas, the styling and the zoom exactly as they are for the schema.
  const [focusId, setFocusId] = useState<string | null>(null);

  const instance = useMemo(() => {
    if (!expanded || !graph) return null;
    const type = LABEL_TYPE[expanded];
    if (!type) return null;

    const pool = graph.nodes.filter((n) => n.type === type);
    if (pool.length === 0) return null;
    const nodeById = new Map(pool.map((n) => [n.id, n]));
    const endId = (v: string | GraphNode) => (typeof v === "string" ? v : v.id);

    const relation = SELF_RELATION[type];
    const parentOf = new Map<string, string>();
    const kids = new Map<string, string[]>();
    if (relation) {
      graph.edges.forEach((e) => {
        if (e.relation !== relation) return;
        const from = endId(e.source);
        const to = endId(e.target);
        if (!nodeById.has(from) || !nodeById.has(to)) return;
        parentOf.set(from, to);
        kids.set(to, [...(kids.get(to) || []), from]);
      });
    }

    // Focus defaults to the busiest root, which for :Process is 4.0 Lead to Cash.
    const roots = pool.filter((n) => !parentOf.has(n.id));
    const defaultFocus =
      roots.sort((a, b) => (kids.get(b.id)?.length || 0) - (kids.get(a.id)?.length || 0))[0]?.id ||
      pool[0].id;
    const root = focusId && nodeById.has(focusId) ? focusId : defaultFocus;

    // Two generations at a time: the focus, its children and their children.
    // The whole :Process tree is 183 nodes under one root and unreadable drawn
    // at once, so depth is traded for the ability to walk down it.
    const levels: string[][] = [[root]];
    for (let d = 0; d < 2; d += 1) {
      const next: string[] = [];
      levels[d].forEach((id) => next.push(...(kids.get(id) || [])));
      if (next.length === 0) break;
      levels.push(next);
    }

    // A level is wrapped rather than laid out in one line: 4.5 Manage Sales
    // Orders has 33 grandchildren, and a single row of those is ~4,700 units
    // wide, which fits the panel only by shrinking every circle to nothing.
    const PER_ROW = 9;
    const laid: { id: string; x: number; y: number; node: GraphNode; depth: number }[] = [];
    let y = -200;
    levels.forEach((level, depth) => {
      for (let start = 0; start < level.length; start += PER_ROW) {
        const row = level.slice(start, start + PER_ROW);
        const span = Math.max(row.length, 1);
        const width = Math.max(span * (INST_R * 3.1), 640);
        row.forEach((id, i) => {
          const node = nodeById.get(id);
          if (!node) return;
          laid.push({
            id,
            node,
            depth,
            x: -width / 2 + (width / (span + 1)) * (i + 1),
            y,
          });
        });
        y += 150;
      }
      y += 110;
    });
    const placed = new Map(laid.map((l) => [l.id, l]));
    const links = laid
      .filter((l) => l.depth > 0 && parentOf.has(l.id))
      .map((l) => ({ from: parentOf.get(l.id)!, to: l.id }))
      .filter((l) => placed.has(l.from));

    return {
      token: expanded,
      relation,
      rootNode: nodeById.get(root)!,
      hasParent: parentOf.has(root),
      parentOfRoot: parentOf.get(root) || null,
      total: pool.length,
      laid,
      links,
      hasChildren: (id: string) => (kids.get(id) || []).length > 0,
    };
  }, [expanded, graph, focusId]);

  // Lay out parallel edges: every from/to pair gets its own set of lanes, and
  // a self-relationship (HAS_SUBPROCESS, DEPENDS_ON, NEXT) becomes a loop.
  const edges = useMemo(() => {
    const lanes: Record<string, number> = {};
    return model.relationships.map((r) => {
      const key = [r.from, r.to].sort().join("|");
      const index = (lanes[key] = (lanes[key] ?? -1) + 1);
      return { rel: r, lane: index };
    });
  }, [model.relationships]);

  // The extent of the model in its own coordinate space. Zoom and pan are done
  // with a transform on a <g> rather than by rewriting the viewBox, so that a
  // drag moves the diagram exactly as far as the pointer travels: a viewBox
  // scales user units against pixels and the two stop agreeing as soon as you
  // zoom.
  const bounds = useMemo(() => {
    const xs = instance ? instance.laid.map((l) => l.x) : model.nodes.map((n) => n.position.x);
    const ys = instance ? instance.laid.map((l) => l.y) : model.nodes.map((n) => n.position.y);
    if (xs.length === 0) return { minX: 0, minY: 0, w: 1, h: 1 };
    const pad = (instance ? INST_R : R) * 2.6;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      minX,
      minY,
      w: Math.max(...xs) + pad - minX,
      h: Math.max(...ys) + pad - minY,
    };
  }, [model.nodes, instance]);

  const fit = useCallback(() => {
    if (!svgRef.current || !zoomRef.current || !bounds.w || !bounds.h) return;
    const k = Math.min(size.w / bounds.w, size.h / bounds.h) * 0.92;
    const next = d3.zoomIdentity
      .translate(size.w / 2 - k * (bounds.minX + bounds.w / 2), size.h / 2 - k * (bounds.minY + bounds.h / 2))
      .scale(k);
    d3.select(svgRef.current).call(zoomRef.current.transform, next);
  }, [bounds, size]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.12, 6])
      .on("zoom", (event) => setTransform(event.transform));
    zoomRef.current = zoom;
    svg.call(zoom);
    // The double-click default zooms; it is more useful as "fit" here, and a
    // stray double-click on a label otherwise leaves the diagram off-screen.
    svg.on("dblclick.zoom", null);
    return () => {
      svg.on(".zoom", null);
      zoomRef.current = null;
    };
  }, []);

  // Fit once, as soon as there is a real size to fit into. Refitting on every
  // resize would throw away whatever the viewer had zoomed to.
  useEffect(() => {
    if (fittedRef.current || size.w < 40) return;
    fittedRef.current = true;
    fit();
  }, [fit, size.w]);

  // Refit whenever the canvas changes what it is showing: a new model, a
  // different label expanded, or a different node focused inside one.
  useEffect(() => {
    fittedRef.current = false;
  }, [model, expanded, focusId]);

  useEffect(() => {
    if (fittedRef.current || size.w < 40) return;
    fittedRef.current = true;
    fit();
  }, [fit, size.w, model, expanded, focusId]);

  // Leaving the expansion should not strand the old focus on the next one.
  useEffect(() => {
    setFocusId(null);
  }, [expanded]);

  const nudge = (factor: number) => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(180).call(zoomRef.current.scaleBy, factor);
  };

  const pick = (node: ModelNode | null) => {
    setSelected(node?.id ?? null);
    onSelect?.(node);
  };


  return (
    <Box ref={wrapRef} sx={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        style={{ display: "block", cursor: panning ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={(e) => {
          downAt.current = { x: e.clientX, y: e.clientY };
          setPanning(true);
        }}
        onPointerUp={() => setPanning(false)}
        onClick={(e) => {
          const from = downAt.current;
          downAt.current = null;
          if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
          pick(null);
        }}
      >
        <defs>
          {["edge", "faint"].map((key) => (
            <marker
              key={key}
              id={`arrow-${key}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                fill={key === "edge" ? (dark ? frappe.overlay2 : "#9aa5b1") : dark ? frappe.surface2 : "#cbd5e1"}
              />
            </marker>
          ))}
        </defs>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
        {instance ? (
          <>
            {instance.links.map((l) => {
              const a = instance.laid.find((x) => x.id === l.from);
              const b = instance.laid.find((x) => x.id === l.to);
              if (!a || !b) return null;
              // The edge is drawn child -> parent, the direction the graph
              // stores it in: :SUBPROCESS_OF points upward.
              const dx = a.x - b.x;
              const dy = a.y - b.y;
              const len = Math.hypot(dx, dy) || 1;
              return (
                <g key={`${l.from}-${l.to}`}>
                  <path
                    d={`M ${b.x + (dx / len) * INST_R} ${b.y + (dy / len) * INST_R}
                        L ${a.x - (dx / len) * INST_R} ${a.y - (dy / len) * INST_R}`}
                    stroke={dark ? frappe.overlay2 : "#9aa5b1"}
                    strokeWidth={1.6}
                    fill="none"
                    markerEnd="url(#arrow-edge)"
                  />
                </g>
              );
            })}

            {instance.laid.map((l) => {
              const isRoot = l.depth === 0;
              const drillable = instance.hasChildren(l.id) && !isRoot;
              return (
                <g
                  key={l.id}
                  style={{ cursor: drillable ? "zoom-in" : "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const from = downAt.current;
                    downAt.current = null;
                    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
                    if (drillable) setFocusId(l.id);
                    else onFocusNode?.(l.id);
                  }}
                >
                  <circle
                    cx={l.x}
                    cy={l.y}
                    r={INST_R}
                    fill={dark ? frappe.surface0 : "#ffffff"}
                    stroke={isRoot ? theme.palette.primary.main : dark ? frappe.surface2 : "#b9c0c8"}
                    strokeWidth={isRoot ? 3 : 1.8}
                  />
                  <text
                    x={l.x}
                    y={l.y + 2}
                    textAnchor="middle"
                    fontSize={15}
                    fontWeight={600}
                    fill={dark ? frappe.text : "#1f2328"}
                  >
                    {l.node.code || l.node.label}
                  </text>
                  {l.node.jira_key && (
                    <text
                      x={l.x}
                      y={l.y + 19}
                      textAnchor="middle"
                      fontSize={12}
                      fill={dark ? frappe.overlay2 : "#8b949e"}
                    >
                      {l.node.jira_key}
                    </text>
                  )}
                  <text
                    x={l.x}
                    y={l.y + INST_R + 18}
                    textAnchor="middle"
                    fontSize={14}
                    fill={dark ? frappe.subtext1 : "#4b5563"}
                    style={{ paintOrder: "stroke", stroke: dark ? frappe.mantle : "#f5f6f7", strokeWidth: 5 }}
                  >
                    {(l.node.description || "").slice(0, 26)}
                  </text>
                </g>
              );
            })}

            {instance.relation && instance.laid.length > 1 && (
              <text
                x={instance.laid[0].x + 90}
                y={instance.laid[0].y + 120}
                fontSize={15}
                fill={dark ? frappe.overlay2 : "#8b949e"}
                letterSpacing={0.4}
              >
                :{instance.relation.toUpperCase()}
              </text>
            )}
          </>
        ) : (
          <>
        {edges.map(({ rel, lane }) => {
          const from = byId[rel.from];
          const to = byId[rel.to];
          if (!from || !to) return null;
          const dim = hovered && hovered !== rel.from && hovered !== rel.to;
          const common = {
            stroke: dark ? frappe.overlay2 : "#9aa5b1",
            strokeWidth: 1.6,
            fill: "none",
            markerEnd: "url(#arrow-edge)",
            opacity: dim ? 0.15 : 1,
          };

          if (rel.from === rel.to) {
            // Self-loop, rotated around the node by its lane: :SapObject holds
            // both IS_PART_OF and SOURCED_FROM, and drawn at a fixed angle the
            // two loops and their labels land exactly on top of each other.
            const theta = -Math.PI / 2 + lane * 1.15;
            const cx = from.position.x + Math.cos(theta) * R;
            const cy = from.position.y + Math.sin(theta) * R;
            const px = -Math.sin(theta);
            const py = Math.cos(theta);
            const d =
              `M ${cx - px * R * 0.5} ${cy - py * R * 0.5} ` +
              `A ${R * 0.62} ${R * 0.62} 0 1 1 ${cx + px * R * 0.5} ${cy + py * R * 0.5}`;
            return (
              <g key={rel.id}>
                <path d={d} {...common} />
                <text
                  x={cx + Math.cos(theta) * R * 0.95}
                  y={cy + Math.sin(theta) * R * 0.95}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={16}
                  fill={dark ? frappe.overlay2 : "#8b949e"}
                  letterSpacing={0.4}
                  opacity={dim ? 0.2 : 1}
                  style={{ paintOrder: "stroke", stroke: dark ? frappe.mantle : "#f5f6f7", strokeWidth: 5 }}
                >
                  {rel.type}
                </text>
              </g>
            );
          }

          const bend = lane === 0 ? 0 : (lane % 2 === 1 ? 1 : -1) * Math.ceil(lane / 2) * 46;
          const g = onRim(from, to, bend);
          return (
            <g key={rel.id}>
              <path d={`M ${g.x1} ${g.y1} Q ${g.mx} ${g.my} ${g.x2} ${g.y2}`} {...common} />
              <text
                x={g.mx}
                y={g.my - 6}
                textAnchor="middle"
                fontSize={16}
                fill={dark ? frappe.overlay2 : "#8b949e"}
                letterSpacing={0.4}
                opacity={dim ? 0.2 : 1}
                style={{ paintOrder: "stroke", stroke: dark ? frappe.mantle : "#f5f6f7", strokeWidth: 5 }}
              >
                {rel.type}
              </text>
            </g>
          );
        })}

        {model.nodes.map((n) => {
          const isOn = selected === n.id || hovered === n.id;
          const dim = hovered !== null && !isOn;
          // A label backed by real nodes can be opened into them. Without a
          // mark on the circle the only clue was a chip in the side panel,
          // which you had to select the label to see at all.
          const canOpen = Boolean(graph) && n.count > 0 && n.id in byId;
          return (
            <g
              key={n.id}
              style={{ cursor: "pointer" }}
              opacity={dim ? 0.4 : 1}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => {
                e.stopPropagation();
                const from = downAt.current;
                downAt.current = null;
                if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
                pick(n);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (canOpen) onExpandedChange?.(n.token);
              }}
            >
              {/* Selection halo, the way the tool shows the node you picked. */}
              {selected === n.id && (
                <circle
                  cx={n.position.x}
                  cy={n.position.y}
                  r={R + 5}
                  fill="none"
                  stroke={theme.palette.primary.main}
                  strokeWidth={7}
                  opacity={0.55}
                />
              )}
              <circle
                cx={n.position.x}
                cy={n.position.y}
                r={R}
                fill={dark ? frappe.surface0 : "#ffffff"}
                stroke={dark ? frappe.surface2 : "#b9c0c8"}
                strokeWidth={1.8}
              />
              <text
                x={n.position.x}
                y={n.position.y + (n.count ? -3 : 6)}
                textAnchor="middle"
                fontSize={19}
                fontWeight={500}
                fill={dark ? frappe.text : "#1f2328"}
              >
                {n.token.length > 13 ? `${n.token.slice(0, 12)}…` : n.token}
              </text>
              {n.count > 0 && (
                <text
                  x={n.position.x}
                  y={n.position.y + 17}
                  textAnchor="middle"
                  fontSize={16}
                  fill={dark ? frappe.overlay2 : "#8b949e"}
                >
                  {n.count}
                </text>
              )}
              {/* Affordance: this label can be opened into its nodes. */}
              {canOpen && (
                <g opacity={isOn ? 1 : 0.75}>
                  <circle
                    cx={n.position.x}
                    cy={n.position.y + R}
                    r={13}
                    fill={dark ? frappe.base : "#ffffff"}
                    stroke={theme.palette.primary.main}
                    strokeWidth={1.8}
                  />
                  <path
                    d={`M ${n.position.x - 6} ${n.position.y + R} h 12
                        M ${n.position.x} ${n.position.y + R - 6} v 12`}
                    stroke={theme.palette.primary.main}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                  />
                </g>
              )}

              {/* The green tick Data Importer puts on a mapped label. */}
              {(
                <path
                  d={`M ${n.position.x + R * 0.46} ${n.position.y - R * 0.68}
                      l ${R * 0.12} ${R * 0.15} l ${R * 0.26} ${-R * 0.32}`}
                  fill="none"
                  stroke={tick(dark)}
                  strokeWidth={4.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </g>
          );
        })}
          </>
        )}
        </g>
      </svg>

      {instance && (
        <Paper
          elevation={0}
          sx={{
            position: "absolute",
            top: 16,
            left: 16,
            right: 96,
            px: 1.25,
            py: 0.75,
            border: 1,
            borderColor: "divider",
            bgcolor: (t) => alpha(t.palette.background.paper, 0.94),
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Tooltip title="Back to the schema">
            <IconButton size="small" onClick={() => onExpandedChange?.(null)}>
              <ArrowLeft size={15} />
            </IconButton>
          </Tooltip>
          <Typography variant="caption" sx={{ fontWeight: 800 }}>
            :{instance.token}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {instance.rootNode.code || instance.rootNode.label}
            {instance.rootNode.description ? ` — ${instance.rootNode.description}` : ""} ·{" "}
            {instance.laid.length} of {instance.total} shown
          </Typography>
          {instance.parentOfRoot && (
            <Tooltip title="Up one level">
              <IconButton size="small" onClick={() => setFocusId(instance.parentOfRoot)}>
                <CornerLeftUp size={15} />
              </IconButton>
            </Tooltip>
          )}
        </Paper>
      )}

      <Paper
        elevation={0}
        sx={{
          position: "absolute",
          top: 16,
          right: 16,
          border: 1,
          borderColor: "divider",
          bgcolor: (t) => alpha(t.palette.background.paper, 0.92),
          backdropFilter: "blur(6px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Tooltip title="Zoom in" placement="left">
          <IconButton size="small" onClick={() => nudge(1.35)}>
            <Plus size={15} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out" placement="left">
          <IconButton size="small" onClick={() => nudge(1 / 1.35)}>
            <Minus size={15} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit model to view" placement="left">
          <IconButton size="small" onClick={fit}>
            <Compass size={15} />
          </IconButton>
        </Tooltip>
        <Box sx={{ px: 0.5, pb: 0.5, textAlign: "center" }}>
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", fontWeight: 700 }}>
            {Math.round(transform.k * 100)}%
          </Typography>
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          position: "absolute",
          display: instance ? "none" : "block",
          left: 16,
          bottom: 16,
          px: 1.5,
          py: 1,
          border: 1,
          borderColor: "divider",
          bgcolor: (t) => alpha(t.palette.background.paper, 0.92),
          backdropFilter: "blur(6px)",
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 0.5 }}>
          {model.stats.labels} labels · {model.stats.relationship_types} relationship types
        </Typography>
        {graph && (
          <Typography
            variant="caption"
            sx={{ display: "block", mb: 0.5, color: "text.secondary" }}
          >
            Double-click a <strong>+</strong> label to open its nodes
          </Typography>
        )}
        <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
          {model.stats.nodes} nodes · {model.stats.edges} relationships ·{" "}
          {model.stats.constraints} constraints
        </Typography>
      </Paper>

    </Box>
  );
}
