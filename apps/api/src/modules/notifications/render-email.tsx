import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  EmailAction,
  EmailBody,
  EmailFooter,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  EmailWordmark,
} from './email-primitives';

/** The copy half of a message — the columns of an `email_template` row an operator may reword, and
 * nothing else. A separate type rather than the Prisma row, so a spec can hand the renderer a
 * message without a database under it. */
export interface EmailTemplateCopy {
  subject: string;
  heading: string;
  bodyLines: string[];
  ctaLabel: string | null;
}

/** A message as the mail port wants it: one subject, two bodies carrying the same words. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** A slot the copy asks for that the payload does not answer. */
export class UnfilledEmailSlotError extends Error {
  constructor(part: string, slots: string[]) {
    super(
      `A notification cannot be written: ${part} asks for ${slots
        .map((slot) => `{${slot}}`)
        .join(', ')} and the payload has no answer`,
    );
    this.name = 'UnfilledEmailSlotError';
  }
}

/** The row or the caller is wrong: a subject spanning lines, or half of a button. The sweep (6e)
 * renders inside its own attempt, so this refusal ends a row's retries rather than starting them —
 * the message it names is what lands in `failureReason`, and a copy that cannot be filled needs
 * somebody to edit it rather than another hour of the transport being dialed. The caller that
 * decided to notify names which event this was. */
export class UnusableEmailTemplateError extends Error {
  constructor(detail: string) {
    super(`A notification is not usable: ${detail}`);
    this.name = 'UnusableEmailTemplateError';
  }
}

/** An address a message would link to that is not a portal page. The value is deliberately not
 * repeated: an `href` is where a room URL would arrive if a caller ever passed one by mistake, and
 * a room name is a secret with a URL's shape (§10) — this message outlives the request in a log
 * line, and may be filed in an outbox row. */
export class UnsafeEmailLinkError extends Error {
  constructor() {
    super(
      'A notification was given an href that is not an absolute http(s) URL; the address is not repeated here',
    );
    this.name = 'UnsafeEmailLinkError';
  }
}

/** `{slot}` — a name, not an expression, so nothing a row asks for can be coaxed into doing
 * something clever by the interpolation. */
const SLOT = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

const LINE_BREAK = /[\r\n]/;

/** The same sentence in every message, which is why it lives here rather than in a row an operator
 * edits: it is not the copy that changes. It carries no address, because the pages a reader needs
 * are reached from the portal, and a link that outlives the news it describes is a link to a
 * moment that has passed. */
const FOOTER_NOTE =
  'You are getting this because you have an account on LMS. Every page this message points at asks who is calling before it shows anything.';

export interface RenderEmailInput {
  template: EmailTemplateCopy;
  payload: Record<string, string>;
  /** Where the button goes, decided by the code that owns the thing the message is about. */
  action?: { href: string };
}

/**
 * One row and one payload, out in two shapes.
 *
 * The text version is written from the same filled strings as the HTML rather than derived from
 * the HTML by stripping tags, because stripping loses the one thing a reader needs in order to act:
 * the address behind a button whose label is a sentence. Both shapes come from one interpolation, so
 * a reworded row cannot land in one and not the other.
 *
 * Every value the payload contributes reaches React as text, which is what escapes it. A course
 * title is a string somebody typed, and so is the copy an operator edits.
 */
export function renderEmail({ template, payload, action }: RenderEmailInput): RenderedEmail {
  const subject = fill(template.subject, payload, 'the subject');
  if (LINE_BREAK.test(subject)) {
    throw new UnusableEmailTemplateError('the subject spans lines, and a header line is one line');
  }

  const heading = fill(template.heading, payload, 'the heading');
  const lines = template.bodyLines.map((line) => fill(line, payload, 'a body line'));

  if (template.ctaLabel && !action) {
    throw new UnusableEmailTemplateError(
      'the copy names a button and the caller gave no action to link to',
    );
  }
  if (action && !template.ctaLabel) {
    throw new UnusableEmailTemplateError(
      'the caller gave an action and the copy has no label to put on it',
    );
  }
  if (action) assertPortalHref(action.href);

  const label = template.ctaLabel ? fill(template.ctaLabel, payload, 'the button label') : null;

  const text = [heading, ...lines, label && action ? `${label}: ${action.href}` : null, FOOTER_NOTE]
    .filter((part): part is string => part !== null)
    .join('\n\n');

  const html = emailDocument({
    subject,
    page: (
      <EmailShell>
        <EmailWordmark />
        <EmailBody>
          <EmailHeading>{heading}</EmailHeading>
          {lines.map((line) => (
            <EmailParagraph key={line}>{line}</EmailParagraph>
          ))}
          {label && action ? <EmailAction label={label} href={action.href} /> : null}
        </EmailBody>
        <EmailFooter note={FOOTER_NOTE} />
      </EmailShell>
    ),
  });

  return { subject, text, html };
}

/**
 * The document, wrapped around what React laid out.
 *
 * A mail renderer has to write the two things a React tree cannot: the doctype, which is what keeps
 * Outlook out of the quirks mode that changes how a table's width is read, and the character set,
 * which has to be declared before the first non-ASCII word — a course title with an en dash in it
 * arrives before any stylesheet could say what encoding to expect. The `<head>` is a string for the
 * same reason `renderToStaticMarkup` writes no doctype: it is not an element it was given.
 *
 * `lang` is `en` because English is the only copy the templates hold today. The day a school writes
 * a notification in another language, the value comes from the row rather than from here.
 */
function emailDocument({ subject, page }: { subject: string; page: ReactElement }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeText(
    subject,
  )}</title></head>${renderToStaticMarkup(page)}</html>`;
}

/** The subject as it goes inside a `<title>`, which React is not rendering. Escaping text is not a
 * favour to the reader — a subject carrying `<` or `&` would otherwise end the element early, and
 * the rest of the line would be markup the row did not intend. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fill(copy: string, payload: Record<string, string>, part: string): string {
  const missing: string[] = [];

  const filled = copy.replace(SLOT, (matched, slot: string) => {
    const value = payload[slot];
    if (value === undefined) {
      missing.push(slot);
      return matched;
    }
    return value;
  });

  // Refused rather than left as `{when}`: a reader who got "Your class is on {when}" was told
  // something with the useful part missing, and the row that caused it would still be standing for
  // the next person.
  if (missing.length > 0) throw new UnfilledEmailSlotError(part, missing);

  return filled;
}

function assertPortalHref(href: string): void {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new UnsafeEmailLinkError();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeEmailLinkError();
}
