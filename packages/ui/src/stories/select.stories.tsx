import type { Meta, StoryObj } from '@storybook/react-vite';

import { Select } from '../components/Select';

const LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const meta = {
  title: 'Components/Fields/Select',
  component: Select,
  args: {
    id: 'level',
    label: 'Level',
    options: LEVELS,
    defaultValue: 'beginner',
  },
  render: (args) => (
    <div className="w-full max-w-sm">
      <Select {...args} />
    </div>
  ),
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A native `select`. The option list is left to the browser and to a phone, which both do
 * it better than a menu built from divs — and a level is three rows, so there is nothing
 * to search.
 */
export const Default: Story = {};

/** A placeholder is not a value: it carries an empty one and cannot be picked. */
export const WithPlaceholder: Story = {
  args: { placeholder: 'Pick a level', defaultValue: '' },
};

export const WithHint: Story = {
  args: { hint: 'What a student reads before choosing between three of your courses.' },
};

/** The list is the caller's catalogue, in the caller's order — a portal never keeps its own
 * translation table for a lookup value. */
export const ShortList: Story = {
  args: { options: LEVELS.slice(0, 2) },
};

/** The API named this field, so the box says so too — the chosen option stays visible
 * while the person works out what to pick instead. */
export const Invalid: Story = {
  args: { defaultValue: 'beginner', error: ['Not a level we know: wizardry'] },
};

export const Disabled: Story = {
  args: { disabled: true, hint: 'Locked while the course is published.' },
};
