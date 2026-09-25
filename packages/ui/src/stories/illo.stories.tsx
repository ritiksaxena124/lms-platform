import type { Meta, StoryObj } from '@storybook/react-vite';

import { Illo } from '../components/Illo';

const GALLERY = [
  'peep-standing-01',
  'peep-standing-02',
  'peep-standing-03',
  'peep-standing-11',
  'peep-standing-19',
  'peep-sitting-01',
  'peep-sitting-02',
  'peep-sitting-06',
  'peep-sitting-17',
] as const;

const meta = {
  title: 'Components/Illo',
  component: Illo,
  args: { src: '/illustrations/peep-sitting-01.svg' },
  parameters: { frame: 'surface' },
} satisfies Meta<typeof Illo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-end gap-8">
      <Illo {...args} size="sm" />
      <Illo {...args} size="md" />
      <Illo {...args} size="lg" />
    </div>
  ),
};

/**
 * The set lives in `packages/ui/illustrations` and is served here at
 * `/illustrations/`. Portals read it from their own `public/` folder — run
 * `bun run sync:illustrations` after adding artwork.
 */
export const Gallery: Story = {
  parameters: { frame: 'paper' },
  render: () => (
    <div className="flex flex-wrap items-end gap-8 rounded-card border border-line bg-surface p-6">
      {GALLERY.map((name) => (
        <div key={name} className="flex w-32 flex-col items-center gap-2">
          <Illo src={`/illustrations/${name}.svg`} size="sm" />
          <p className="text-center font-mono text-[0.6875rem] text-ink-faint">{name}</p>
        </div>
      ))}
    </div>
  ),
};
