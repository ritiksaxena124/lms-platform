'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  notify,
  Reveal,
  Skeleton,
  Spinner,
  StatusPill,
} from '@lms/ui';

const SWATCHES = [
  { token: '--color-paper', label: 'paper' },
  { token: '--color-paper-sunk', label: 'paper-sunk' },
  { token: '--color-surface', label: 'surface' },
  { token: '--color-line', label: 'line' },
  { token: '--color-ink', label: 'ink' },
  { token: '--color-ink-muted', label: 'ink-muted' },
  { token: '--color-ember-deep', label: 'ember-deep' },
  { token: '--color-ember', label: 'ember' },
  { token: '--color-ember-soft', label: 'ember-soft' },
  { token: '--color-success', label: 'success' },
  { token: '--color-warning', label: 'warning' },
  { token: '--color-danger', label: 'danger' },
  { token: '--color-info', label: 'info' },
] as const;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Not a product screen: the working reference for the shared package, so the
 * student and ops portals can be built against something visible.
 */
export function ToolkitDemo() {
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<'error' | 'loading' | 'ready'>('error');
  const [replayKey, setReplayKey] = useState(0);

  async function saveAvailability() {
    setSaving(true);
    // One toast, replaced in place: the id is how a job reports back.
    const id = notify.loading('Saving availability');
    await wait(1400);
    setSaving(false);
    notify.success('Availability saved', { id });
  }

  async function refetch() {
    setPanel('loading');
    await wait(900);
    setPanel('ready');
  }

  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader
          eyebrow="Type"
          title="Scale and voice"
          description="Fraunces for titles, Public Sans for UI, JetBrains Mono wherever digits line up."
        />
        <div className="mt-5 grid gap-6 border-t border-line pt-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-3">
            <h2 className="text-h1 font-display text-ink-strong">Tuesday, 6 March</h2>
            <p className="text-label uppercase tracking-[0.09em] text-ink-muted">
              eyebrow · section label
            </p>
            <h3 className="font-display text-h2 text-ink-strong">Section heading</h3>
            <h4 className="font-display text-h3 text-ink">Sub-section heading</h4>
            <p className="max-w-reading text-[0.9375rem] text-ink-muted">
              Body copy sits at 15px on a 1.55 line height — wide enough to scan a timetable without
              crowding it, narrow enough to stay readable at 46 characters.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-metric font-display text-ink-strong tabular">₹4,820</span>
            <span className="text-label text-ink-faint tabular">this month · 12 sessions</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          eyebrow="Actions"
          title="Buttons"
          description="One shape for posting and for navigating."
        />
        <div className="mt-5 space-y-4 border-t border-line pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveAvailability} loading={saving}>
              Save availability
            </Button>
            <Button type="button" variant="secondary">
              Preview slot
            </Button>
            <Button type="button" variant="ghost">
              Ignore
            </Button>
            <Button type="button" variant="danger">
              Cancel booking
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm">
              Small
            </Button>
            <Button type="button" size="md">
              Medium
            </Button>
            <Button type="button" size="lg">
              Large
            </Button>
            <Button
              type="button"
              disabled
              leadingIcon={
                <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              }
            >
              Disabled
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          eyebrow="Status"
          title="Pills"
          description="Text always carries the meaning; colour only supports it."
        />
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5">
          <StatusPill>Neutral</StatusPill>
          <StatusPill tone="ember">Pending</StatusPill>
          <StatusPill tone="info">Requested</StatusPill>
          <StatusPill tone="success">Confirmed</StatusPill>
          <StatusPill tone="warning">Needs reply</StatusPill>
          <StatusPill tone="danger">Cancelled</StatusPill>
          <StatusPill tone="info" pulse>
            In class
          </StatusPill>
        </div>
      </Card>

      <Card>
        <CardHeader
          eyebrow="Feedback"
          title="Toasts"
          description="react-hot-toast for timing; our own card for shape."
        />
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => notify.success('Lesson published')}
          >
            Success
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => notify.error('Could not reach the server')}
          >
            Error
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => notify.info('Payout scheduled for the 1st')}
          >
            Info
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              notify.fromApiError({
                statusCode: 422,
                code: 'VALIDATION_FAILED',
                message: 'Check the highlighted fields.',
                details: { validation: { email: 'Already taken', hour: 'Outside your window' } },
              })
            }
          >
            API error
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              notify.withAction({
                message: 'Blocked 20:00–21:00 on Friday',
                actionLabel: 'Undo',
                onAction: () => notify.info('Friday 20:00 is open again'),
              })
            }
          >
            With undo
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          eyebrow="Operations"
          title="Every state"
          description="Idle, loading, empty, failed, settled — the same five everywhere."
        />
        <div className="mt-5 space-y-4 border-t border-line pt-5">
          {panel === 'loading' ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : panel === 'error' ? (
            <ErrorState
              title="Could not load your schedule"
              message="The request timed out. Nothing was changed."
              onRetry={refetch}
            />
          ) : (
            <div className="flex items-center gap-3 rounded-card border border-success-soft bg-success-soft px-4 py-3">
              <StatusPill tone="success">Loaded</StatusPill>
              <span className="text-[0.9375rem] text-ink">3 sessions this week</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setPanel('error')}
              >
                Fail again
              </Button>
            </div>
          )}

          <EmptyState
            title="No requests from students"
            description="Requests appear here the moment your profile is visible."
          />

          <div className="flex items-center gap-3 text-label text-ink-muted">
            <Spinner size="sm" label="Syncing calendar" />
            <span>Inline spinner, next to the thing it describes.</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          eyebrow="Colour"
          title="Tokens"
          description="A portal re-themes by overriding these and nothing else."
        />
        <ul className="mt-5 grid grid-cols-2 gap-2 border-t border-line pt-5 sm:grid-cols-3">
          {SWATCHES.map((swatch) => (
            <li key={swatch.token} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-6 shrink-0 rounded-field border border-line"
                style={{ backgroundColor: `var(${swatch.token})` }}
              />
              <span className="truncate text-[0.75rem] text-ink-muted">{swatch.label}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          eyebrow="Motion"
          title="Entrance and navigation"
          description="Content reveals in 36ms steps; routes slide with the View Transitions API. Try the sidebar."
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setReplayKey((key) => key + 1)}
            >
              Replay reveal
            </Button>
          }
        />
        <div key={replayKey} className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-3">
          <Reveal index={0}>
            <div className="rounded-card bg-paper-sunk p-4">
              <p className="text-label text-ink-faint">Reveal step</p>
              <p className="text-metric font-display tabular">36ms</p>
            </div>
          </Reveal>
          <Reveal index={1}>
            <div className="rounded-card bg-paper-sunk p-4">
              <p className="text-label text-ink-faint">Exit</p>
              <p className="text-metric font-display tabular">150ms</p>
            </div>
          </Reveal>
          <Reveal index={2}>
            <div className="rounded-card bg-paper-sunk p-4">
              <p className="text-label text-ink-faint">Enter</p>
              <p className="text-metric font-display tabular">380ms</p>
            </div>
          </Reveal>
        </div>
      </Card>
    </div>
  );
}
