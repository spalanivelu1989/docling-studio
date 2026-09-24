# The dark theme is Catppuccin Frappé

Light mode is unchanged. Frappé is a dark flavour — Catppuccin's light flavour
is Latte — so this swapped the dark branch of every colour in the app and left
the light branch alone.

The palette lives in one place: `frappe` in `frontend/src/theme.ts`, 26 values
transcribed from <https://catppuccin.com/palette/>. Nothing else in the
frontend writes a dark colour as a hex. `test/frappe-palette.mjs` enforces
both halves of that: the values match the published palette, and no dark
branch anywhere draws a colour from outside it.

## The mapping

| Role | Frappé |
| --- | --- |
| `background.default` | Mantle `#292c3c` |
| `background.paper` | Base `#303446` |
| a well — code block, graph canvas, document pane | Crust `#232634` |
| `divider` | Surface0 `#414559` |
| `text.primary` | Text `#c6d0f5` |
| `text.secondary` | Subtext1 `#b5bfe2` |
| `primary` / `secondary` / `info` | Blue / Mauve / Sapphire |
| `success` / `warning` / `error` | Green / Yellow / Red |

Base sits **on top of** Mantle, not under it: in Catppuccin the cards are the
lighter surface and the page recedes behind them. That is the opposite of what
this app did before, where `background.default` was darker than `paper` by a
similar step but both were near-black.

## Four decisions that are not obvious

**`text.secondary` is Subtext1, not Subtext0.** Subtext0 is the name that
*sounds* like secondary text, and on Base it is fine at 5.55:1. It fails inside
a `surface()` panel — 4.34:1 against a 4.5:1 floor — and a lot of secondary
text in this app is inside one. `test/surface-contrast.mjs` fails if it goes
back.

**The search highlight flips its text colour instead of dimming.** Light mode
puts near-black on pale yellow. Dark mode cannot do the same trick, because a
wash of Yellow dim enough to keep Frappé's light Text legible on top of it
reaches 4.5:1 at best and 4.0:1 inside a tinted snippet box — a highlight you
have to hunt for. So `mark` carries its own `fg`: Crust on the full Yellow,
9.3:1, which looks like what it is.

**One value per hue, where the old palette had a ramp.** The graph canvas drew
a link in `#38bdf8` and its label in the lighter `#7dd3fc`. Frappé publishes
one sky, so both are `frappe.sky`. Inventing a second shade would put a colour
on the canvas that is not in the palette, which is exactly what the test
forbids.

**Node hues moved into the theme.** The five knowledge-graph categories
(`stream`, `system`, `process`, `document`, `spec`) used to be written out
twice — `TYPE_CONFIG` in `KnowledgeGraphPage` and `NODE_HUE` in
`AgentTraceDrawer` — as one set of light-mode hexes shown in both themes. They
are now `nodeHues` in `theme.ts`, one map, two modes. `TYPE_META` keeps the
label, icon and default visibility; `typeConfig(mode)` puts the two halves back
together.

The same went for the file-type chips on the Add to Knowledge Base page, which
were a switch returning three hand-written `rgba()` strings per case, all of
them light-mode values: `#059669` on Base is 2.5:1, a label you cannot read.

## What stayed white

The rendered page images of a source document — the Convert page's page
previews and the left pane of Doc vs MD Review. A scanned PDF page is white
paper in either theme, and tinting it would misrepresent the document.

## Tab label damping

`LABEL_ALPHA` in `App.tsx` dims the Convert and Index groups so the four tab
groups read as peers. Those numbers were tuned for the palette that came
before, and were re-measured rather than assumed: on Frappé the four groups
land within 3.46–3.73:1 of their own tinted background, tighter than the
3.04–3.57:1 they held before. Frappé mixes its accents to a common weight,
which is most of why. The numbers were left alone.
