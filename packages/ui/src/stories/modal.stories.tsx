import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/Button';
import { ConfirmDialog, Modal } from '../components/Modal';

const meta = {
  title: 'Components/Modal',
  parameters: {
    // The sheet is portalled to the document and covers the viewport, so a framed story would
    // show a box inside a box. Give it the whole frame.
    layout: 'centered',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const Answers = ({ confirm = 'Archive' }: { confirm?: string }) => (
  <>
    <Button type="button" variant="ghost">
      Cancel
    </Button>
    <Button type="button" variant="danger">
      {confirm}
    </Button>
  </>
);

/** The bare sheet: a question, room for whatever the caller has to say, and the answers. */
export const Basic: Story = {
  render: () => (
    <Modal
      open
      onClose={() => undefined}
      title="Move “Fractions, slowly” to the archive?"
      actions={<Answers />}
    >
      <p className="text-ink-muted">
        Students who hold a place will lose the pages they were reading. Bringing the course back
        returns it as a draft, not onto the shelf.
      </p>
    </Modal>
  ),
};

/** A line under the question, read out by a screen reader as the dialog's description. */
export const WithDescription: Story = {
  render: () => (
    <Modal
      open
      onClose={() => undefined}
      title="Change the address?"
      description="The old link will stop working."
      actions={<Answers confirm="Change it" />}
    >
      <p className="text-ink-muted">
        You shared this course in three posts. Each one will land on “not found”.
      </p>
    </Modal>
  ),
};

/** `ConfirmDialog` is the reason the primitive exists: the browser’s own `confirm()` cannot be
 * styled, cannot hold more than a sentence, and takes the reader out of the page it asks about. */
export const Confirm: Story = {
  render: () => (
    <ConfirmDialog
      open
      tone="danger"
      title="Deactivate this coupon?"
      message="It can no longer be used for enrollment."
      confirmLabel="Deactivate"
      cancelLabel="Keep it"
      onConfirm={() => undefined}
      onClose={() => undefined}
    />
  ),
};

/** While the request is in flight both answers shut: a second click is not a second request. */
export const Busy: Story = {
  render: () => (
    <ConfirmDialog
      open
      busy
      tone="danger"
      title="Deactivate this coupon?"
      message="It can no longer be used for enrollment."
      confirmLabel="Deactivate"
      onConfirm={() => undefined}
      onClose={() => undefined}
    />
  ),
};

const OpenedById = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Archive this course
      </Button>
      <ConfirmDialog
        open={open}
        tone="danger"
        title="Move this course to the archive?"
        message="Students who hold a place will lose it."
        confirmLabel="Archive"
        onConfirm={() => setOpen(false)}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

/** Opened by a control, closed by the answer, by Escape, or by the scrim — and the focus goes back
 * to the button it came from, which is the part a reader notices and a test insists on. */
export const OpenedByAButton: Story = {
  render: () => <OpenedById />,
};

/** Room for a form rather than a sentence. */
export const Wide: Story = {
  render: () => (
    <Modal
      open
      size="md"
      onClose={() => undefined}
      title="Invite a co-teacher"
      actions={
        <>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
          <Button type="button">Send the invite</Button>
        </>
      }
    >
      <p className="text-ink-muted">
        They will be able to edit the syllabus and attach recordings. They will not be able to
        publish the course or end it.
      </p>
    </Modal>
  ),
};
