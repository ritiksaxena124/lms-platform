import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('owns exactly one h1 so the page has a single document title', () => {
    render(
      <PageHeader title="My courses" description="Publish, edit and archive what you teach." />,
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'My courses' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Publish, edit and archive what you teach.')).toBeInTheDocument();
  });

  it('keeps actions on the title row and after it in reading order', () => {
    render(
      <PageHeader
        title="Bookings"
        meta="12 upcoming"
        actions={<button type="button">Export CSV</button>}
      />,
    );

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.parentElement?.parentElement).toContainElement(
      screen.getByRole('button', { name: 'Export CSV' }),
    );
    expect(
      heading.compareDocumentPosition(screen.getByRole('button')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('12 upcoming')).toBeInTheDocument();
  });

  it('renders as a header landmark', () => {
    const { container } = render(<PageHeader title="Payouts" />);
    expect(container.querySelector('header')).toBeInTheDocument();
  });

  it('renders a breadcrumb trail and marks the current page', () => {
    render(
      <PageHeader
        title="Lesson editor"
        breadcrumbs={[
          { label: 'Courses', href: '/courses' },
          { label: 'Physics 101', href: '/courses/7' },
          { label: 'Lesson 3' },
        ]}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText('Lesson 3')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Physics 101' })).toHaveAttribute('href', '/courses/7');
  });

  it('shows a skeleton title area instead of a blank flash while loading', () => {
    render(<PageHeader title="Sessions" loading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
