import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SiteHeader } from './site-header';

const PORTALS = {
  teacher: 'http://teacher.localtest.me:3000',
  student: 'http://student.localtest.me:3001',
};

describe('the site header', () => {
  it('carries the two doors a visitor can actually walk through', () => {
    render(<SiteHeader portals={PORTALS} />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Teacher portal' })).toHaveAttribute(
      'href',
      PORTALS.teacher,
    );
    expect(screen.getByRole('link', { name: 'Student portal' })).toHaveAttribute(
      'href',
      PORTALS.student,
    );
  });

  it('links nothing the export does not build', () => {
    render(<SiteHeader portals={PORTALS} />);

    // A static export has no server to answer an unknown path, so an internal href is only as good as
    // the file behind it — and nothing in the build checks that. Off-origin links are exempt: their
    // 404 belongs to whoever owns that host, not to this one.
    const built = new Set(['/']);
    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('http')) expect(built).toContain(href);
    }
  });

  it('says where the link goes rather than dressing it up', () => {
    render(<SiteHeader portals={PORTALS} />);

    // A public page that links off-origin should not be mistaken for navigation within the site:
    // these two leave, and the reader should know before the click.
    expect(screen.getByRole('link', { name: 'Teacher portal' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getByRole('link', { name: 'Teacher portal' })).toHaveAttribute(
      'rel',
      expect.stringContaining('noopener'),
    );
  });

  it('does not mention the operator, its queue, or its ledger', () => {
    render(<SiteHeader portals={PORTALS} />);

    // The desk at `ops` is a real address, and this page is read by strangers. Naming it here is a
    // gift to anybody scanning for a login form that belongs to somebody else.
    expect(screen.queryByRole('link', { name: /ops|operator|desk|ledger/i })).toBeNull();
    expect(screen.queryByText(/ops|operator/i)).toBeNull();
  });
});
