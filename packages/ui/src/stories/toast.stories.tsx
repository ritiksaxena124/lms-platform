import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/Button';
import { Toaster } from '../toast/Toaster';
import { ToastCard } from '../toast/ToastCard';
import { notify } from '../toast/notify';

const meta = {
  title: 'Feedback/Toasts',
  parameters: { frame: 'paper' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const API_ERROR = {
  statusCode: 422,
  code: 'VALIDATION_FAILED',
  message: 'The request was invalid.',
  details: {
    validation: [
      'hourlyRate must be an integer in minor units',
      'timezone must be a valid IANA zone',
      'email must be verified',
      'displayName is required',
      'slotDurationMinutes must be 15, 30, 45 or 60',
    ],
  },
};

/** Field errors render as their own lines — capped, so a bad payload cannot fill the screen. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Toaster />
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={() => notify.success('Course published')}>
          Success
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => notify.error('Could not save the payout details.')}
        >
          Error
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => notify.info('3 requests are waiting for a reply')}
        >
          Info
        </Button>
        <Button type="button" variant="danger" onClick={() => notify.fromApiError(API_ERROR)}>
          API error envelope
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            notify.withAction({
              message: 'Booking cancelled',
              actionLabel: 'Undo',
              onAction: () => undefined,
            })
          }
        >
          With undo
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const id = notify.loading('Publishing…');
            setTimeout(() => notify.success('Slot is live', { id }), 1400);
          }}
        >
          Loading → success, same slot
        </Button>
      </div>
    </div>
  ),
};

/** The body on its own, for composing a screen that shows one inline rather than floating. */
export const Cards: Story = {
  parameters: { frame: 'surface' },
  render: () => (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <ToastCard tone="success" message="Payout scheduled for the 1st." />
      <ToastCard
        tone="error"
        message="The request was invalid."
        details={['hourlyRate must be an integer', 'timezone must be a valid IANA zone']}
        onDismiss={() => undefined}
      />
      <ToastCard
        tone="neutral"
        message="Booking cancelled"
        action={{ label: 'Undo', onClick: () => undefined }}
      />
    </div>
  ),
};
