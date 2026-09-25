import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton, SkeletonGroup } from './Skeleton';

describe('Skeleton', () => {
  it('is invisible to assistive tech — the shimmer is decoration, not content', () => {
    render(<Skeleton className="h-5 w-40" />);
    const node = screen.getByTestId('skeleton');
    expect(node).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('applies the caller box so a row can reserve its real height', () => {
    render(<Skeleton className="h-9 w-full rounded" />);
    expect(screen.getByTestId('skeleton')).toHaveClass('h-9');
    expect(screen.getByTestId('skeleton')).toHaveClass('w-full');
  });
});

describe('SkeletonGroup', () => {
  it('repeats one row shape for a list that is still loading', () => {
    render(<SkeletonGroup rows={3} />);
    // The group is the live region; the individual shimmers stay silent.
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
  });
});
