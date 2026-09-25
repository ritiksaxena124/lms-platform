import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatusPill } from '../components/StatusPill';

const TONES = ['neutral', 'ember', 'info', 'success', 'warning', 'danger'] as const;

const meta = {
  title: 'Components/StatusPill',
  component: StatusPill,
  args: { children: 'Confirmed' },
  parameters: { frame: 'surface' },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Every tone reads as a label, never as a button — the tints come from the
 * status family, not the brand family.
 */
export const All: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {TONES.map((tone) => (
        <StatusPill key={tone} {...args} tone={tone}>
          {tone === 'ember' ? 'Active' : tone[0] ? tone[0].toUpperCase() + tone.slice(1) : tone}
        </StatusPill>
      ))}
    </div>
  ),
};

/** For states that are true right now: in class, processing, live. */
export const Pulsing: Story = {
  args: { tone: 'success', pulse: true, children: 'In class' },
};
