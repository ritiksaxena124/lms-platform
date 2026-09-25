import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card, CardHeader } from '../components/Card';
import { Stagger } from '../motion/Stagger';
import { StatusPill } from '../components/StatusPill';
import { Button } from '../components/Button';

const meta = {
  title: 'Components/Card',
  component: Card,
  parameters: { frame: 'paper' },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'Next class: Tuesday 6pm · Batch "Advanced Guitar"' },
};

/** `raised` is a firmer border, not a shadow: a card never floats off the page. */
export const Elevation: Story = {
  args: { children: 'placeholder' },
  render: (args) => (
    <div className="flex flex-wrap gap-4">
      <Card {...args} elevation="flat" className="w-64">
        flat — the default
      </Card>
      <Card {...args} elevation="raised" className="w-64">
        raised — stronger border
      </Card>
    </div>
  ),
};

export const Padding: Story = {
  args: { children: 'placeholder' },
  render: (args) => (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <Card {...args} padding="default">
        default — p-5
      </Card>
      <Card {...args} padding="tight">
        tight — p-3.5
      </Card>
      <Card {...args} padding="flush">
        <table className="w-full text-left text-[0.875rem]">
          <thead className="bg-paper-sunk text-label text-ink-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Student</th>
              <th className="px-4 py-2 font-medium">Slot</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="px-4 py-2">Aarav</td>
              <td className="px-4 py-2 tabular">Mon 18:00</td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-4 py-2">Meera</td>
              <td className="px-4 py-2 tabular">Wed 07:30</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  ),
};

export const Interactive: Story = {
  args: { interactive: true, children: 'Open course · 12 students' },
};

export const WithHeader: Story = {
  args: { children: 'placeholder' },
  render: (args) => (
    <Card {...args} className="w-full max-w-md">
      <CardHeader
        eyebrow="This week"
        title="Earnings"
        description="Payouts land on the 1st."
        actions={<StatusPill tone="ember">Settled</StatusPill>}
      />
      <div className="mt-4 flex items-end justify-between">
        <p className="text-metric tabular text-ink-strong">₹18,400</p>
        <Button variant="secondary" size="sm" type="button">
          Export
        </Button>
      </div>
    </Card>
  ),
};

/** The grid reveal every dashboard uses; `Stagger` only adds a delay per child. */
export const StaggeredGrid: Story = {
  args: { children: 'placeholder' },
  render: () => (
    <div className="w-full max-w-2xl">
      <Stagger className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-label text-ink-muted">Sessions</p>
          <p className="mt-1 text-metric tabular">14</p>
        </Card>
        <Card>
          <p className="text-label text-ink-muted">Students</p>
          <p className="mt-1 text-metric tabular">9</p>
        </Card>
        <Card>
          <p className="text-label text-ink-muted">Rating</p>
          <p className="mt-1 text-metric tabular">4.8</p>
        </Card>
      </Stagger>
    </div>
  ),
};
