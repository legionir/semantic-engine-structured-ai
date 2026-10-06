# Spacing scale

Every gap, padding and margin comes from one scale, in pixels:

    4, 8, 12, 16, 24, 32, 48, 64

Rules:

- Inside a control, use 4 to 12. Between controls, use 8 to 16.
- Between sections, use 24 or more. A section that needs 20 needs 24.
- A value outside the scale is a bug, not a preference. If a layout only
  works at 18, the problem is the layout.
- Vertical rhythm beats horizontal symmetry: keep the vertical gaps
  consistent down a column even when the columns differ.

Density:

- A dense tool surface (tables, logs, trees) uses the lower half of the
  scale and a 12px type size.
- A reading surface uses the upper half and a 14 to 16px type size.
