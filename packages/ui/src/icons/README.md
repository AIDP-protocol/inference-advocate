# AIRP icon family

24×24 grid · stroke 2.1 · round caps and joins on solid strokes, butt caps on dashed ones.
`stroke="currentColor"` throughout, so colour is inherited from CSS.

React wrappers live in `../icons.tsx`. Raster app icons and favicons are generated from the
Inference Advocate mark by `tools/generate-app-icons.mjs` (solid `#252a33` ground, white
strokes), then `npx tauri icon` expands that master into desktop / iOS / Android / Windows
tiles under `packages/desktop/src-tauri/icons/`.

## The system

Every icon is one recognizable object, and exactly one stroke of that object is dashed:
the boundary AIRP governs. Dash arrays are solved against each path's measured length so
every run closes on a whole number of cycles and no corner falls inside a gap.

- **AIRP**: stamped ring with a solid token. Six ring segments, one per component below.
- **Inference Advocate**: shield, outline unbroken, boundary passing through it.
- **Serving Register**: ruled card, spine dashed.
- **Delivery Policy**: document with a cut corner and a forked route, spine dashed.
- **Taxonomy**: label; point solid, dashes mid-edge.
- **Jurisdiction**: place marker standing on a dashed ground line.
- **Rule Evaluator**: checklist, spine dashed.

## Rules to keep if you extend the set

1. Dash ≥ 1.7× stroke, gap = 1.0× stroke, minimum two breaks per run.
2. No vertex may fall inside a gap. Corners belong to solid paths.
3. Parallel strokes no closer than 1.6u; interior detail spaced ≥3.7u.
4. Dashed strokes are butt-capped; round caps close the gaps.
5. Solve arrays against `getTotalLength()`, not analytic geometry. Browsers flatten
   circles to beziers and the real length is ~0.6% shorter.
