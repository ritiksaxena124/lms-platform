'use client';

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Reveal } from '../motion/Reveal';
import { Stagger } from '../motion/Stagger';

const meta = {
  title: 'Motion/Reveal',
  parameters: { frame: 'paper' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const METRICS = [
  ['Sessions this week', '14'],
  ['Pending requests', '3'],
  ['Rating', '4.8'],
] as const;

/** Remounting by key is how a portal replays a reveal after a mutation. */
const Grid = () => (
  <div className="w-full max-w-2xl">
    <Stagger className="grid gap-4 sm:grid-cols-3">
      {METRICS.map(([label, value]) => (
        <Card key={label}>
          <p className="text-label text-ink-muted">{label}</p>
          <p className="mt-1 text-metric tabular text-ink-strong">{value}</p>
        </Card>
      ))}
    </Stagger>
  </div>
);

function ReplayableGrid() {
  const [replayKey, setReplayKey] = useState(0);
  return (
    <div className="flex flex-col items-start gap-5">
      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={() => setReplayKey((key) => key + 1)}
      >
        Replay reveal
      </Button>
      <Grid key={replayKey} />
    </div>
  );
}

export const Staggered: Story = {
  render: () => <ReplayableGrid />,
};

/** Each step is 36ms apart; the whole grid lands inside one duration-slow. */
export const SingleItem: Story = {
  render: () => (
    <Reveal index={0}>
      <Card className="w-72">One card, no container element added.</Card>
    </Reveal>
  ),
};
