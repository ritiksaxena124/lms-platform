import { describe, expect, it } from 'vitest';

import {
  MAIL_DELIVERY_BATCH_SIZE,
  MAIL_OUTBOX_STATUS_CODES,
  MAIL_OUTBOX_STATUS_LABELS,
  MAIL_RETRY_DELAYS_MINUTES,
  MAIL_SENDING_RECLAIM_MINUTES,
  MAIL_SWEEP_INTERVAL_MINUTES,
  mailOutboxStatusLabel,
  mailRetryDelayMinutes,
} from './mail-outbox';

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

  it('gives the queue screen a phrase for every state, and one for a state that is not a state', () => {
    // The label is what tells `waiting` from `sending` apart to somebody reading a table, and the
    // fallback is what keeps one hand-written row from failing the page beside it — the column is
    // text, and 6c's schema test proves the table accepts a status no code writes.
    expect(Object.keys(MAIL_OUTBOX_STATUS_LABELS).sort()).toEqual(
      [...Object.values(MAIL_OUTBOX_STATUS_CODES)].sort(),
    );
    expect(MAIL_OUTBOX_STATUS_LABELS[MAIL_OUTBOX_STATUS_CODES.QUEUED]).not.toBe(
      MAIL_OUTBOX_STATUS_LABELS[MAIL_OUTBOX_STATUS_CODES.SENDING],
    );
    expect(mailOutboxStatusLabel('invented_by_a_test')).toBe('invented_by_a_test');
  });
});

/**
 * The retry curve is the part of the sweep a reader can argue about, which is why it is five numbers
 * here rather than arithmetic in a service: a class confirmation should survive a mail host having a
 * bad afternoon, and should stop being retried inside a day, and both of those are claims about
 * these values rather than about the code that reads them.
 */
describe('the retry curve a queued row follows', () => {
  it('is five waits, each longer than the one before it', () => {
    expect(MAIL_RETRY_DELAYS_MINUTES).toEqual([1, 5, 30, 120, 360]);
    // A typo that put 5 before 1 would schedule a later retry sooner than an earlier one, which is
    // the kind of thing a curve is supposed to make impossible.
    const ascending = MAIL_RETRY_DELAYS_MINUTES.every(
      (wait, index) => index === 0 || wait > (MAIL_RETRY_DELAYS_MINUTES[index - 1] ?? 0),
    );
    expect(ascending).toBe(true);
  });

  it('answers a failed attempt with the wait before the next one', () => {
    // `attempts` counts times the transport was asked, so the row that has just failed its first ask
    // is the row waiting one minute for its second.
    expect(mailRetryDelayMinutes(1)).toBe(1);
    expect(mailRetryDelayMinutes(2)).toBe(5);
    expect(mailRetryDelayMinutes(3)).toBe(30);
    expect(mailRetryDelayMinutes(4)).toBe(120);
    expect(mailRetryDelayMinutes(5)).toBe(360);
  });

  it('runs out, and running out is what `failed` means', () => {
    // The curve is the whole budget: a row with no wait left has had its sixth ask, and the sweep
    // must have a way to be told to stop rather than scheduling it a seventh time.
    expect(mailRetryDelayMinutes(6)).toBeNull();
    expect(mailRetryDelayMinutes(0)).toBeNull();
  });

  it('keeps a row inside one day of the news it carries', () => {
    // The last wait lands eight and a half hours after the first failure, and a notification that
    // takes longer than a day to give up is a notification nobody will act on either way.
    const total = MAIL_RETRY_DELAYS_MINUTES.reduce((sum, wait) => sum + wait, 0);
    expect(total).toBeLessThanOrEqual(24 * 60);
  });

  it('reclaims a claim that outran the process that made it', () => {
    // A row left `sending` by a process that died is not a row being sent, and the queue cannot
    // assume the claim is honest. The window has to be wider than a run — a row claimed at the top
    // of a page of 25 may still be legitimately in flight an interval later — and narrow enough that
    // an abandoned letter comes back the same day rather than sitting in a state no reader chose.
    expect(MAIL_SENDING_RECLAIM_MINUTES).toBeGreaterThan(MAIL_SWEEP_INTERVAL_MINUTES);
    expect(MAIL_SENDING_RECLAIM_MINUTES).toBeLessThan(MAIL_RETRY_DELAYS_MINUTES.at(-1) ?? 0);
  });

  it('runs on a clock, and takes a page of the queue per run', () => {
    // The sweep's two numbers are a pair: a five-minute wait between runs is what makes a one-minute
    // retry delay meaningful, and a page rather than the whole queue bounds how many calls to
    // somebody else's server one run holds.
    expect(MAIL_SWEEP_INTERVAL_MINUTES).toBe(5);
    expect(MAIL_DELIVERY_BATCH_SIZE).toBe(25);
  });
});
