import type { ReactNode } from 'react';

/**
 * The primitives every notification is built from, written for mail clients rather than for
 * browsers (§6, README Phase 6).
 *
 * They look like the middle of 2005 on purpose. Outlook renders HTML with Word's engine, which
 * ignores flexbox, grid and positioning; Gmail clips a `<style>` block it does not recognise and
 * rewrites what is left; Apple Mail inverts colours in dark mode by reading the ones it can find.
 * What all of them honour is a table with a width written as an attribute, styles sitting on the
 * element they style, and a font the machine already has. §15 gives the portals a Tailwind
 * stylesheet and Inter as a self-hosted font; neither of those can survive a mailbox, so this file
 * restates the app's palette in inline values instead of importing it.
 *
 * There is no image here, and none should be added. An SVG renders badly or is blocked outright,
 * and a hosted PNG needs a public URL — which §6 refuses for gated bytes, and which would tell
 * whoever served the file that this particular person read this particular message.
 */

/** The app's own stack, spelled out because a mail client has no stylesheet to read it from.
 * Inter is deliberately absent: it is self-hosted in the portals and exists on none of the
 * machines that will open this. */
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** From `packages/ui/src/styles/tokens.css`, as literals: `--color-paper`, `--color-surface`,
 * `--color-ink-strong`, `--color-ink`, `--color-ink-faint`, `--color-line`, `--color-brand-deep`
 * (the primary action, AA against white) and `--radius-field`. */
const PAPER = '#f7f8f9';
const SURFACE = '#ffffff';
const INK = '#1f2328';
const INK_STRONG = '#10131a';
const INK_FAINT = '#68707c';
const LINE = '#e5e8eb';
const BRAND_DEEP = '#0a6b52';

/** Every table in a mail is spacing, so every table says so: `role="presentation"` is what stops a
 * screen reader from announcing the layout as data with headers and cells. */
const TABLE_PROPS = {
  role: 'presentation',
  cellPadding: 0,
  cellSpacing: 0,
  border: 0,
} as const;

/**
 * The document's body, and the column the message lives in.
 *
 * `renderToStaticMarkup` cannot write a doctype or a `<head>` — those are not elements it is
 * given, and a doctype is what switches Outlook out of its quirks mode — so the wrapper is written
 * by the renderer and this component is the part React is actually asked to lay out.
 *
 * 600px is the convention because Outlook's reading pane and a phone are both narrower than
 * anything wider, and `width` is written as an attribute as well as a style because Word's engine
 * reads the attribute and the rest read the style. React leaves attribute names in the case it was
 * given (`cellPadding`), which HTML parses as lowercase, so a client sees the attribute it wants.
 */
export function EmailShell({ children }: { children: ReactNode }) {
  return (
    <body style={{ margin: 0, padding: 0, background: PAPER, fontFamily: FONT }}>
      <table
        {...TABLE_PROPS}
        width="600"
        style={{ width: '100%', maxWidth: 600, margin: '0 auto' }}
      >
        <tr>
          <td style={{ background: SURFACE }}>{children}</td>
        </tr>
      </table>
    </body>
  );
}

/** Who sent this, in words. The header is the one place a logo would go, and a logo is an image
 * (§6), so the platform's name is written instead. */
export function EmailWordmark() {
  return (
    <table {...TABLE_PROPS} width="600" style={{ width: '100%', maxWidth: 600 }}>
      <tr>
        <td
          style={{
            padding: '24px 28px 16px',
            borderBottom: `1px solid ${LINE}`,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: BRAND_DEEP,
            fontFamily: FONT,
          }}
        >
          LMS
        </td>
      </tr>
    </table>
  );
}

export function EmailBody({ children }: { children: ReactNode }) {
  return (
    <table {...TABLE_PROPS} width="600" style={{ width: '100%', maxWidth: 600 }}>
      <tr>
        <td style={{ padding: '24px 28px 8px', fontFamily: FONT }}>{children}</td>
      </tr>
    </table>
  );
}

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        margin: '0 0 16px',
        fontSize: 22,
        lineHeight: '28px',
        fontWeight: 650,
        letterSpacing: '-0.01em',
        color: INK_STRONG,
        fontFamily: FONT,
      }}
    >
      {children}
    </h1>
  );
}

/** One sentence of the copy, printed as its own paragraph. A notification's body is a list of
 * lines rather than a blob so an operator can reword one of them (§6). */
export function EmailParagraph({ children }: { children: ReactNode }) {
  return (
    <p
      style={{ margin: '0 0 14px', fontSize: 15, lineHeight: '22px', color: INK, fontFamily: FONT }}
    >
      {children}
    </p>
  );
}

/**
 * The one link a message offers, built as a table cell rather than a styled `<a>`.
 *
 * A block-level anchor is what a browser turns into a button; Word's engine does not honour
 * padding on an anchor, so the clickable area shrinks to the height of the text and a recipient
 * on a work Outlook has to aim at the words themselves. Wrapping it in a cell gives the button its
 * shape from the cell's own background, which every client paints.
 */
export function EmailAction({ label, href }: { label: string; href: string }) {
  return (
    <table {...TABLE_PROPS} style={{ margin: '8px 0 0' }}>
      <tr>
        <td style={{ background: BRAND_DEEP, borderRadius: 6, textAlign: 'center' }}>
          <a
            href={href}
            style={{
              display: 'block',
              padding: '12px 20px',
              fontSize: 15,
              fontWeight: 600,
              color: SURFACE,
              textDecoration: 'none',
              fontFamily: FONT,
            }}
          >
            {label}
          </a>
        </td>
      </tr>
    </table>
  );
}

/** The small print: why this person is getting this. Kept in code rather than in a row because it
 * is the same sentence for every notification, and a template table per event is for the copy that
 * changes. */
export function EmailFooter({ note }: { note: string }) {
  return (
    <table {...TABLE_PROPS} width="600" style={{ width: '100%', maxWidth: 600 }}>
      <tr>
        <td
          style={{
            padding: '20px 28px 28px',
            borderTop: `1px solid ${LINE}`,
            fontSize: 12,
            lineHeight: '18px',
            color: INK_FAINT,
            fontFamily: FONT,
          }}
        >
          {note}
        </td>
      </tr>
    </table>
  );
}
