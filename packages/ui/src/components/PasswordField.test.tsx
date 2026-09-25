import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PasswordField } from './PasswordField';

describe('PasswordField', () => {
  it('starts masked and under the same label contract as any other field', () => {
    render(<PasswordField id="password" label="Password" />);

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('id', 'password');
  });

  it('reveals the text on demand and says what the button will do next', async () => {
    render(<PasswordField id="password" label="Password" />);

    const toggle = screen.getByRole('button', { name: 'Show password' });
    await userEvent.click(toggle);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('keeps what was typed across the toggle, because losing a password is the worst', async () => {
    render(<PasswordField id="password" label="Password" />);

    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

    expect(screen.getByLabelText('Password')).toHaveValue('correct horse battery staple');
  });

  it('never lets the toggle submit the form it sits inside', async () => {
    // The default type of a <button> is "submit", so a reveal control that forgets to say
    // otherwise signs the user in with half a password and no warning.
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <PasswordField id="password" label="Password" />
      </form>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('carries the error through to the input it describes', () => {
    render(<PasswordField id="password" label="Password" error="Wrong password" />);

    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong password');
  });
});
