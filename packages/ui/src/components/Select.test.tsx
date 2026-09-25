import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Select } from './Select';

const LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
];

describe('Select', () => {
  it('associates the label with the control, so clicking the label focuses it', () => {
    render(<Select id="level" label="Level" options={LEVELS} />);

    const select = screen.getByLabelText('Level');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAttribute('id', 'level');
  });

  it('shows the option labels in the order the caller passed them', () => {
    render(<Select id="level" label="Level" options={LEVELS} />);

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Beginner', 'Intermediate']);
    expect(options[1]).toHaveValue('intermediate');
  });

  it('offers a placeholder a person cannot mistake for an answer', () => {
    render(
      <Select
        id="level"
        label="Level"
        options={LEVELS}
        placeholder="Pick a level"
        defaultValue=""
        onChange={() => {}}
      />,
    );

    const select = screen.getByLabelText('Level') as HTMLSelectElement;
    expect(select.value).toBe('');
    // Disabled rather than merely pre-selected: a placeholder is not a value, and a form
    // that submitted one would send a level nobody chose.
    expect(screen.getByText('Pick a level')).toBeDisabled();
  });

  it('points at the error from the control and announces it', () => {
    render(<Select id="level" label="Level" options={LEVELS} error={['Not a level we know']} />);

    const select = screen.getByLabelText('Level');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select.getAttribute('aria-describedby')).toContain('level-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Not a level we know');
  });

  it('keeps the hint in the description alongside an error', () => {
    render(
      <Select
        id="level"
        label="Level"
        hint="What a student reads first"
        options={LEVELS}
        error="Required"
      />,
    );

    const described = screen.getByLabelText('Level').getAttribute('aria-describedby') ?? '';
    expect(described).toContain('level-hint');
    expect(described).toContain('level-error');
  });

  it('says nothing about validity when there is nothing wrong', () => {
    render(
      <Select id="level" label="Level" options={LEVELS} value="beginner" onChange={() => {}} />,
    );

    const select = screen.getByLabelText('Level');
    expect(select).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(select).toHaveValue('beginner');
  });
});
