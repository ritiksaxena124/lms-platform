import { describe, expect, it } from 'vitest';

import { MAIL_OUTBOX_STATUS_CODES } from './mail-outbox';

/**
 * The list is five words, and the two things worth pinning about five words are that nothing else
 * is one of them and that the two which look alike are not the same claim.
 */
describe('mail outbox statuses', () => {
  it('names every state the sweep can leave a row in, and nothing a writer invented', () => {
    // The column is text rather than a lookup type, so this list is the only place the vocabulary
    // is written down. A sixth value would be a state no reader of a row could look up.
    expect(Object.values(MAIL_OUTBOX_STATUS_CODES)).toEqual([
      'queued',
      'sending',
      'sent',
      'failed',
      'dropped',
    ]);
  });

  it('keeps a drop away from the word for a delivery', () => {
    // 6a's port promises this on the interface: `NoMail` resolves, and `delivers` says it sent
    // nothing. A queue that recorded the drop as `sent` would be the one claim in this system that
    // nobody could check afterwards — and the two answers mean different things to the person
    // asking why they never heard.
    expect(MAIL_OUTBOX_STATUS_CODES.DROPPED).not.toBe(MAIL_OUTBOX_STATUS_CODES.SENT);
    expect(MAIL_OUTBOX_STATUS_CODES.DROPPED).toBe('dropped');
  });
});
