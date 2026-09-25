import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('associates the label with the box, so clicking the label focuses it', () => {
    render(<Textarea id="description" label="Description" />);

    const box = screen.getByLabelText('Description');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('id', 'description');
    expect(screen.getByText('Description').getAttribute('for')).toBe('description');
  });

  it('gives a multi-paragraph answer room, and the caller can ask for more', () => {
    render(<Textarea id="notes" label="Notes" />);
    expect(screen.getByLabelText('Notes')).toHaveAttribute('rows', '5');

    render(<Textarea id="long" label="Longer" rows={9} />);
    expect(screen.getByLabelText('Longer')).toHaveAttribute('rows', '9');
  });

  it('points at the error from the box and announces it', () => {
    render(<Textarea id="description" label="Description" error={['Fill this in before publishing.']} />);

    const box = screen.getByLabelText('Description');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box.getAttribute('aria-describedby')).toContain('description-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Fill this in before publishing.');
  });

  it('keeps the hint in the description alongside an error', () => {
    render(
      <Textarea
        id="description"
        label="Description"
        hint="What a student reads before booking"
        error="Required"
      />,
    );

    const described = screen.getByLabelText('Description').getAttribute('aria-describedby') ?? '';
    expect(described).toContain('description-hint');
    expect(described).toContain('description-error');
  });

  it('says nothing about validity when there is nothing wrong', () => {
    render(<Textarea id="description" label="Description" value="" onChange={() => {}} />);

    expect(screen.getByLabelText('Description')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('carries the counting attributes a limit needs, so the server decides and the form agrees', () => {
    render(<Textarea id="description" label="Description" maxLength={5000} required />);

    const box = screen.getByLabelText('Description');
    expect(box).toHaveAttribute('maxlength', '5000');
    expect(box).toBeRequired();
  });
});
