
- source_spec: `spec-1-8-design-tokens-theming-and-brand-assets.md`
  summary: Choose and add a native backdrop-blur library so Glass blurs behind its tint (currently tint and border only).
  evidence: Story 1.8 AC asks for blur; no library is chosen and each adds a native dependency. Decide alongside the S8 glass frame-rate measurement.
- source_spec: `spec-1-8-design-tokens-theming-and-brand-assets.md`
  summary: Replace the placeholder coin-flip Lottie with the final asset (GATE-12).
  evidence: Placeholder shipped on purpose; the AC allows it until GATE-12.
- source_spec: `spec-4-1-categories-screen-add-edit-reorder-icons-palette-colours-and-need-want-type.md`
  summary: SaveCategory should refuse (or define behaviour for) editing an archived category.
  evidence: Review of 4.1: edit path does not check archived; unreachable from the UI until Story 4.3 archives categories.
