import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TextField } from './TextField';

describe('TextField', () => {
  it('associates the label with the input, so clicking the label focuses it', () => {
    render(<TextField id="email" label="Work email" />);

    const input = screen.getByLabelText('Work email');
    expect(input).toHaveAttribute('id', 'email');
    expect(input.tagName).toBe('INPUT');
    expect(screen.getByText('Work email').getAttribute('for')).toBe('email');
  });

  it('refers the hint to assistive tech without making it part of the name', () => {
    render(<TextField id="tz" label="Timezone" hint="Used for class reminders" />);

    const input = screen.getByLabelText('Timezone');
    expect(input).toHaveAttribute('aria-describedby', 'tz-hint');
    expect(screen.getByText('Used for class reminders')).toBeInTheDocument();
  });

  it('points at the error from the input and announces it once it appears', () => {
    render(<TextField id="email" label="Email" error={['Already taken']} />);

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('email-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Already taken');
  });

  it('keeps the hint in the description when both a hint and an error are present', () => {
    render(<TextField id="email" label="Email" hint="We never share it" error="Already taken" />);

    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toContain('email-hint');
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toContain(
      'email-error',
    );
  });

  it('says nothing about validity when there is nothing wrong', () => {
    render(<TextField id="name" label="Full name" />);

    const input = screen.getByLabelText('Full name');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input.getAttribute('aria-describedby') ?? '').not.toContain('name-error');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('passes the input attributes the browser needs to help', () => {
    render(
      <TextField
        id="email"
        label="Email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@school.org"
      />,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(input).toHaveAttribute('placeholder', 'you@school.org');
  });
});
