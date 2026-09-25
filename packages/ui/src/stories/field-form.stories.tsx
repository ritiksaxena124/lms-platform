import type { Meta, StoryObj } from '@storybook/react-vite';

import { PasswordField } from '../components/PasswordField';
import { TextField } from '../components/TextField';

/**
 * A composed story, so this file declares no `component`: a form has no single set of args,
 * and forcing one would only invent a field that exists to satisfy the type.
 */
const meta = { title: 'Components/Fields/In a form' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The vertical rhythm a real form gets from these parts — label, control, hint, error. */
export const SignIn: Story = {
  render: () => (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <TextField id="form-name" label="Full name" defaultValue="Aditi Sharma" />
      <TextField id="form-email" label="Email" type="email" hint="We never share it." />
      <PasswordField id="form-password" label="Password" />
      <p className="text-[0.8125rem] text-ink-faint">
        Submitting here does nothing — this is a layout story.
      </p>
    </form>
  ),
};

/** One field per line the API rejected, each message under the control it names. */
export const Rejected: Story = {
  render: () => (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <TextField
        id="rejected-headline"
        label="Profile headline"
        defaultValue="hi"
        error={['Headline must be at least 3 characters']}
      />
      <TextField
        id="rejected-email"
        label="Email"
        defaultValue="aditi@school"
        error={['That is not an email address']}
      />
      <PasswordField
        id="rejected-password"
        label="Password"
        defaultValue="short"
        hint="At least 12 characters."
        error={['Use at least 12 characters']}
      />
    </form>
  ),
};
