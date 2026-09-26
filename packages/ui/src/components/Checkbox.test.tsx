import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is a native box with the label attached, so the platform draws the tick', () => {
    render(<Checkbox id="free" label="Free to read" />);

    const box = screen.getByRole('checkbox', { name: 'Free to read' });
    expect(box).toBeInstanceOf(HTMLInputElement);
    expect(box).toHaveAttribute('id', 'free');
    expect(screen.getByLabelText('Free to read')).toBe(box);
  });

  it('points a screen reader at the hint, and at the error when there is one', () => {
    render(<Checkbox id="free" label="Free to read" hint="Only after publishing." />);

    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('free-hint'),
    );
  });

  it('lists what went wrong, and says which box it went wrong in', async () => {
    render(<Checkbox id="free" label="Free to read" error={['Not a yes or a no.']} />);

    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAttribute('aria-describedby', expect.stringContaining('free-error'));

    // The message is written twice on purpose — once as text, once as an `alert` region —
    // because a field the API refused has to announce itself to whoever cannot see it change.
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a yes or a no.');
  });

  it('toggles on the click itself, without a handler in the way', async () => {
    render(<Checkbox id="free" label="Free to read" />);

    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();

    await userEvent.click(screen.getByLabelText('Free to read'));
    expect(box).toBeChecked();

    await userEvent.click(box);
    expect(box).not.toBeChecked();
  });

  it('goes quiet when the row it belongs to is busy', () => {
    render(<Checkbox id="free" label="Free to read" disabled />);

    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
