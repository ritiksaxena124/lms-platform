import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ICON_NAMES, Icon } from './Icon';

describe('Icon', () => {
  it('is invisible to assistive tech until it is given a name', () => {
    const { container } = render(<Icon name="clock" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('becomes an image with an accessible name once labelled', () => {
    render(<Icon name="lock" label="Behind enrollment" />);

    expect(screen.getByRole('img', { name: 'Behind enrollment' })).toBeInTheDocument();
  });

  it('draws in one stroke geometry so colour follows the text around it', () => {
    const { container } = render(<Icon name="layers" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('viewBox', '0 0 20 20');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '1.5');
  });

  it.each(ICON_NAMES)('carries artwork for %s', (name) => {
    const { container } = render(<Icon name={name} />);
    const paths = container.querySelectorAll('svg > *');

    // A name in the union with no paths would render as a silent gap in a row.
    expect(paths.length).toBeGreaterThan(0);
    expect(container.querySelector('svg')).toHaveAttribute('data-icon', name);
  });

  it('sizes against the type scale rather than the viewport', () => {
    const { container } = render(<Icon name="user" size="sm" />);
    const { container: medium } = render(<Icon name="user" />);

    expect(container.querySelector('svg')).toHaveClass('size-3.5');
    expect(medium.querySelector('svg')).toHaveClass('size-4');
  });

  it('names the hover gesture after the icon so every portal animates it the same way', () => {
    const { container } = render(<Icon name="unlock" />);

    expect(container.querySelector('svg')).toHaveClass('lms-icon', 'lms-icon-unlock');
  });
});
