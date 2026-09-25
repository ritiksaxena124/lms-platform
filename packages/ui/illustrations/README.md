# Illustrations

Hand-drawn characters from [Open Peeps](https://www.openpeeps.com/) by Pablo
Stanley, published under **CC0 1.0** — public domain, free for commercial use,
modification and redistribution, no attribution required.

- Files are the vector exports, trimmed to the characters this design system
  actually uses. `peep-standing-*` for welcome and empty states,
  `peep-sitting-*` for the quieter "nothing here yet" cases.
- The artwork is pure paths: black strokes and white fills, **no embedded
  fonts**, so it renders identically without any webfont.
- Portals serve them from their own `public/illustrations/` folder; run
  `bun run sync:illustrations` in this package after adding or renaming a file.
- Consume them with `<Illo>` from `@lms/ui`, which sizes the slot, keeps the
  default decorative (`alt=""`), and only exposes a label when the drawing
  genuinely carries information.
