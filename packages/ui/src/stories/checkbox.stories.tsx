import type { Meta, StoryObj } from '@storybook/react-vite';

import { Checkbox } from '../components/Checkbox';

const meta = {
  title: 'Components/Fields/Checkbox',
  component: Checkbox,
  args: {
    id: 'free-preview',
    label: 'Free to read',
  },
  render: (args) => (
    <div className="w-full max-w-md">
      <Checkbox {...args} />
    </div>
  ),
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A box and a label, the way the platform draws them. */
export const Default: Story = {};

/** The label says what the box is; the hint says what the yes commits to.
 * A checkbox whose consequence only appears after saving is a checkbox nobody trusts. */
export const WithHint: Story = {
  args: { hint: 'Anyone can open this page without an account.' },
};

export const Checked: Story = {
  args: { defaultChecked: true },
};

/** Nothing happens while the row's request is in flight, and the box says so rather than
 * accepting a click that will be thrown away. */
export const Disabled: Story = {
  args: { disabled: true, defaultChecked: true },
};

export const Rejected: Story = {
  args: { error: ['Not a yes or a no.'] },
};
