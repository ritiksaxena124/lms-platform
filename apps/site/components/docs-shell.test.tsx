import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { readDoc } from '@/lib/docs';
import { DocsShell } from './docs-shell';

/**
 * The shell is written against a real page rather than a fixture: the point of these tests is that
 * the contents match the manifest and the anchors match the headings the markdown actually became,
 * so a stub that agrees with itself would prove nothing.
 */
const PAGE = readDoc('running-it-locally');

describe('the docs shell', () => {
  it('lists every page the manifest holds, under its group', () => {
    render(<DocsShell page={PAGE} />);

    const sidebar = screen.getByRole('navigation', { name: 'Documentation' });
    expect(within(sidebar).getByRole('link', { name: 'What this is' })).toHaveAttribute(
      'href',
      '/docs',
    );
    expect(within(sidebar).getByRole('link', { name: 'Rules the code enforces' })).toHaveAttribute(
      'href',
      '/docs/conventions',
    );
    expect(within(sidebar).getByText('How it works')).toBeInTheDocument();
  });

  it('marks the page being read, including from the index', () => {
    render(<DocsShell page={readDoc('index')} />);

    const sidebar = screen.getByRole('navigation', { name: 'Documentation' });

    // Scoped to the sidebar on purpose: the index prose also links to the page it points at, and
    // `aria-current` belongs to the contents list rather than to a link in a sentence.
    expect(within(sidebar).getByRole('link', { name: 'What this is' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sidebar).getByRole('link', { name: 'Run it locally' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('points at a section that is really on the page', () => {
    render(<DocsShell page={PAGE} />);

    // The list is built from the heading tokens the renderer just stamped with an id, so an
    // agreement between the two is not proof — this asks the document for the element.
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(toc).getAllByRole('link');

    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      PAGE.headings.map((heading) => `#${heading.id}`),
    );
    for (const link of links) {
      const id = (link.getAttribute('href') ?? '').slice(1);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('leaves the page its own title', () => {
    render(<DocsShell page={PAGE} />);

    // The markdown carries the `#`, and the shell that wrapped it in a header of its own would give
    // the reader two of them and the outline a page with no first heading.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.querySelector('article h1')?.textContent).toBe('Run it locally');
  });
});
