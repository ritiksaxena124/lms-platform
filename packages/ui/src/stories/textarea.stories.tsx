import type { Meta, StoryObj } from '@storybook/react-vite';

import { Textarea } from '../components/Textarea';

const meta = {
  title: 'Components/Fields/Textarea',
  component: Textarea,
  args: {
    id: 'description',
    label: 'Description',
    defaultValue:
      'Every chapter starts with the questions that actually appeared, then builds the maths ' +
      'needed to answer them without memorising the paper.',
  },
  render: (args) => (
    <div className="w-full max-w-lg">
      <Textarea {...args} />
    </div>
  ),
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Five rows by default: enough to write a paragraph without the box looking like a
 * one-liner that broke. */
export const Default: Story = {};

export const WithHint: Story = {
  args: { hint: 'A student decides from this. Length is fine; vagueness is not.' },
};

/** Publishing is refused until this and the summary are filled, and the reason arrives on
 * the field it belongs to. */
export const BlocksPublishing: Story = {
  args: { defaultValue: '', error: ['Fill this in before publishing.'] },
};

/** The limit is the server's, and the field enforces it while typing. A counter is the
 * form's business: it already holds the value, so it can count without the primitive
 * keeping a second copy of the text. */
export const UnderAMaximum: Story = {
  args: { maxLength: 5000, rows: 8 },
};
