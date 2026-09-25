import type { Meta, StoryObj } from '@storybook/react-vite';

import { PasswordField } from '../components/PasswordField';
import { TextField } from '../components/TextField';

const meta = {
  title: 'Components/Fields',
  component: TextField,
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A field is the label, the control and whatever the control needs said about it — never a
 * bare `<input>` with a placeholder doing the labelling, because a placeholder disappears
 * the moment the field has a value, which is exactly when the mistake happens.
 */
export const Default: Story = {
  args: { id: 'full-name', label: 'Full name', placeholder: 'Aditi Sharma' },
  render: (args) => (
    <div className="w-full max-w-sm">
      <TextField {...args} />
    </div>
  ),
};

/** A hint is what the value is for. It stays visible next to an error, because the person
 * may be re-reading it to work out what went wrong. */
export const WithHint: Story = {
  args: {
    id: 'timezone',
    label: 'Working timezone',
    hint: 'Classes are shown to students in this zone.',
  },
  render: Default.render,
};

export const Invalid: Story = {
  args: {
    id: 'email',
    label: 'Email',
    value: 'aditi@school.org',
    error: ['Already taken'],
  },
  render: Default.render,
};

/** The API sends one list per field, so a field that breaks two rules says both. */
export const SeveralRules: Story = {
  args: {
    id: 'headline',
    label: 'Profile headline',
    value: 'hi',
    error: ['Headline must be at least 3 characters', 'Keep it under 140 characters'],
  },
  render: Default.render,
};

export const Disabled: Story = {
  args: { id: 'rate', label: 'Hourly rate', value: '1200', disabled: true },
  render: Default.render,
};

/** The reveal control belongs to the field, not the page: it has to sit inside the box and
 * must never be a `type="submit"` button, which would sign someone in half-typed. */
export const Password: Story = {
  args: { id: 'password', label: 'Password' },
  render: (args) => (
    <div className="w-full max-w-sm">
      <PasswordField {...args} />
    </div>
  ),
};

export const PasswordWithHint: Story = {
  args: {
    id: 'new-password',
    label: 'New password',
    hint: 'At least 12 characters. Length beats symbols.',
    autoComplete: 'new-password',
  },
  render: Password.render,
};

/** How the pieces look together lives in `field-form.stories.tsx`: a composed story has no
 * single set of args to declare, which is what `meta.component` would otherwise demand. */
