import type { Meta, StoryObj } from '@storybook/react-vite';

import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Illo } from '../components/Illo';
import { SkeletonGroup } from '../components/Skeleton';
import { Spinner } from '../components/Spinner';
import { StatusPill } from '../components/StatusPill';

/**
 * The five states every data view must handle. A portal screen that cannot name
 * all five is unfinished — this page is the checklist.
 */
const meta = {
  title: 'States',
  parameters: { frame: 'paper' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  render: () => (
    <div className="w-full max-w-md rounded-card border border-line bg-surface p-5">
      <StatusPill tone="neutral">Draft</StatusPill>
      <h3 className="mt-3 text-h3 text-ink-strong">Beginner acoustic · batch 3</h3>
      <p className="mt-1 text-[0.875rem] text-ink-muted">
        Nothing is happening here yet, and that is a valid state — not an empty one.
      </p>
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-6">
      <SkeletonGroup rows={4} />
      <div className="flex items-center gap-2 text-label text-ink-muted">
        <Spinner size="sm" /> Rebuilding the schedule…
      </div>
    </div>
  ),
};

/** An illustration earns its place when the user will see this state often. */
export const Empty: Story = {
  render: () => (
    <div className="flex w-full flex-col gap-8">
      <EmptyState
        className="w-full max-w-lg"
        title="No bookings yet"
        description="Share your first course link and students will show up here."
        actionLabel="Create a course"
        onAction={() => undefined}
        illustration={<Illo src="/illustrations/peep-sitting-01.svg" size="md" />}
      />
      <EmptyState
        className="w-full max-w-lg"
        title="No results for “sitar”"
        description="Try a different spelling, or clear the filters."
        actionLabel="Clear filters"
        onAction={() => undefined}
      />
    </div>
  ),
};

export const Error: Story = {
  render: () => (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <ErrorState
        title="Could not load bookings"
        message="The request timed out. Your data is safe — try again."
        onRetry={() => undefined}
      />
      <ErrorState title="Session expired" message="Sign in again to continue." busy />
    </div>
  ),
};

export const Success: Story = {
  render: () => (
    <div className="w-full max-w-md rounded-card border border-line bg-surface p-5">
      <StatusPill tone="success" pulse>
        Live now
      </StatusPill>
      <h3 className="mt-3 text-h3 text-ink-strong">Slot published</h3>
      <p className="mt-1 text-[0.875rem] text-ink-muted">
        Tuesdays and Thursdays, 18:00–18:45 IST. Students can request it immediately.
      </p>
    </div>
  ),
};
