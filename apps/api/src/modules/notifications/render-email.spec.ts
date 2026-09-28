import { describe, expect, it } from 'vitest';

import { renderEmail } from './render-email';

const template = {
  subject: 'A minute has been asked for',
  heading: 'Rohan Mehta wants a class',
  bodyLines: [
    'They asked for {when}, on {course}.',
    'Answer them from your requests page — the request holds the minute until {holdUntil}.',
  ],
  ctaLabel: 'Answer the request',
};

const payload = {
  when: 'Monday 28 September, 09:30–10:15',
  course: 'Fractions, the slow way',
  holdUntil: '09:30 on 29 September',
};

/**
 * What Phase 6b exists to answer: can this platform turn a template row and a payload into a
 * message, in both shapes, from one code path?
 *
 * The renderer takes the copy (which lives in `email_template`) and the destination (which lives
 * in code) as separate arguments, because that split is the decision Phase 6 made: a row may hold
 * a sentence, and may not hold a document. Everything here is the seam between the two.
 */
describe('renderEmail', () => {
  it('fills every placeholder the copy names from the payload it is given', () => {
    const rendered = renderEmail({
      template,
      payload,
      action: { href: 'http://teacher.localtest.me:3000/requests' },
    });

    expect(rendered.subject).toBe('A minute has been asked for');
    expect(rendered.html).toContain('Rohan Mehta wants a class');
    expect(rendered.html).toContain('Monday 28 September, 09:30–10:15, on Fractions, the slow way');
    expect(rendered.html).not.toContain('{when}');
  });

  it('refuses to render a sentence whose slot the payload cannot fill', () => {
    // The silent direction of this failure is a parent reading "Your class is on {when}". A
    // template that names a slot no caller provides is a bug in a row somebody edited, and the
    // only useful thing to do with it is say which slot, at the moment the message is built.
    expect(() =>
      renderEmail({ template, payload: { when: 'Monday' }, action: { href: 'http://x.test/a' } }),
    ).toThrow(/course/);
  });

  it('refuses a subject that spans lines, naming the template rather than the transport', () => {
    // The port refuses a line break in a subject too, but by then the message is on its way and
    // the outbox would retry a broken row until somebody notices.
    expect(() =>
      renderEmail({
        template: { ...template, subject: 'Class\r\nBcc: everyone@example.com' },
        payload,
        action: { href: 'http://teacher.localtest.me:3000/requests' },
      }),
    ).toThrow(/subject/i);
  });

  it('writes the same message twice: one for a client that renders HTML, one for one that does not', () => {
    const rendered = renderEmail({
      template,
      payload,
      action: { href: 'http://teacher.localtest.me:3000/requests' },
    });

    // The text version is not the HTML with its tags cut out — that would lose the link, which is
    // the one thing a reader needs to be able to act on. Both come from the same filled copy.
    expect(rendered.text).toContain('Rohan Mehta wants a class');
    expect(rendered.text).toContain('Monday 28 September, 09:30–10:15, on Fractions, the slow way');
    expect(rendered.text).toContain('http://teacher.localtest.me:3000/requests');
    expect(rendered.text).not.toMatch(/<[a-z]/i);
  });

  it('prints no button when the copy names none', () => {
    const rendered = renderEmail({
      template: { ...template, ctaLabel: null },
      payload,
    });

    expect(rendered.html).not.toContain('<a ');
    expect(rendered.text).not.toContain('http://');
  });

  it('refuses a button with no destination, and a destination with no label', () => {
    // Each half alone is a message that cannot be read: a link with no words on it, or words that
    // lead nowhere. Both are template/caller mismatches, so both stop here.
    expect(() => renderEmail({ template, payload })).toThrow(/action/i);
    expect(() =>
      renderEmail({
        template: { ...template, ctaLabel: null },
        payload,
        action: { href: 'http://x.test/a' },
      }),
    ).toThrow(/label/i);
  });

  it('refuses a destination that is not an http(s) endpoint', () => {
    // The href comes from code today and from a route tomorrow, and either way it lands in an
    // `href` attribute a mail client will follow. `javascript:` and `data:` are the two values
    // that turn a rendered message into whatever the renderer was tricked into writing.
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>a</script>', '//x.test/a']) {
      expect(() => renderEmail({ template, payload, action: { href } })).toThrow(/href/i);
    }
  });

  it('names the problem without repeating the address, because an href can be a room URL', () => {
    // A room name is a secret with a URL's shape (§10), and this error is written to a log line
    // and possibly to an outbox row. The refusal is the useful part; the value is not.
    const thrown = (() => {
      try {
        renderEmail({
          template,
          payload,
          action: { href: 'javascript:open("https://meet.jit.si/9f3c-room-from-a-uuid")' },
        });
        return null;
      } catch (error) {
        return error as Error;
      }
    })();

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).not.toContain('9f3c-room-from-a-uuid');
    expect(thrown?.message).not.toContain('meet.jit.si');
  });

  it('escapes what a payload value says, because a course title is a string a person typed', () => {
    const rendered = renderEmail({
      template,
      payload: { ...payload, course: '<img src=x onerror="steal()">' },
      action: { href: 'http://teacher.localtest.me:3000/requests' },
    });

    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;img');
  });

  it('escapes the subject inside the title, because that one element React did not write', () => {
    // The `<head>` is assembled as a string, since `renderToStaticMarkup` writes no doctype and no
    // head. That makes the subject the one filled value reaching the document without React's
    // escaping, and a title ending early would put the rest of the line into the body as markup.
    const rendered = renderEmail({
      template: { ...template, subject: 'A class on {course} is waiting' },
      payload: { ...payload, course: '</title><img src=x onerror="steal()">' },
      action: { href: 'http://teacher.localtest.me:3000/requests' },
    });

    expect(rendered.html).toContain('&lt;/title&gt;');
    expect(rendered.html.match(/<title>/g)).toHaveLength(1);
  });

  it('carries no value the payload did not name', () => {
    const rendered = renderEmail({
      template,
      payload,
      action: { href: 'http://teacher.localtest.me:3000/requests' },
    });

    // A renderer that interpolated from anything but the slots the copy asks for would be a
    // channel from the payload to the message that nobody declared — and the payload is where a
    // booking id, a room name or a key would arrive if one were ever passed by mistake.
    expect(rendered.html).not.toMatch(/bookingId|roomName|storedKey/);
  });
});
