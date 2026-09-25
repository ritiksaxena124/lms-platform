import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/Button';
import { buttonClass } from '../lib/button';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Publish course' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Controls: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} />
      <Button {...args} variant="secondary" />
      <Button {...args} variant="ghost" />
      <Button {...args} variant="danger" />
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="sm" />
      <Button {...args} size="md" />
      <Button {...args} size="lg" />
    </div>
  ),
};

/**
 * `loading` is the state a mutation spends most of its life in: the label stays
 * so the button does not change width, and `aria-busy` tells assistive tech.
 */
export const Loading: Story = {
  args: { loading: true },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} />
      <Button {...args} variant="secondary" />
      <Button {...args} variant="danger" size="sm" />
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithIcons: Story = {
  args: {
    children: 'Import students',
    leadingIcon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 2.5v7m0 0 2.75-2.75M8 9.5 5.25 6.75M2.5 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
};

export const FullWidth: Story = {
  args: { fullWidth: true, children: 'Save and continue' },
  parameters: { frame: 'sunk' },
  render: (args) => (
    <div className="w-full max-w-sm rounded-card border border-line bg-surface p-4">
      <Button {...args} />
    </div>
  ),
};

/** A `<Link>` and a `<button>` must be indistinguishable — same classes, own element. */
export const AsALink: Story = {
  render: (args) => (
    <a href="#course" className={buttonClass({ variant: args.variant, size: args.size })}>
      View course
    </a>
  ),
};
