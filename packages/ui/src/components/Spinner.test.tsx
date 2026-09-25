import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('is a polite live region with a readable label', () => {
    render(<Spinner label="Uploading resources" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAccessibleName('Uploading resources');
    expect(status).toHaveTextContent('Uploading resources');
  });

  it('falls back to a generic label so an unlabelled spinner is never silent', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
  });

  it('carries the size to styling', () => {
    render(<Spinner size="sm" />);
    expect(screen.getByRole('status')).toHaveAttribute('data-size', 'sm');
  });
});
