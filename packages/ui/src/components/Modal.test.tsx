import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog, Modal } from './Modal';

/**
 * The sheet is portalled to `document.body`, so every query here goes through `screen` (the whole
 * document) rather than a container that no longer holds it.
 */
function openModal(overrides: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = vi.fn();
  render(
    <>
      <button type="button">Open</button>
      <Modal open title="Move this course to the archive?" onClose={onClose} {...overrides}>
        <p>Students who hold a place will lose it.</p>
      </Modal>
    </>,
  );
  return { onClose };
}

describe('Modal', () => {
  it('is not in the document until it is open', () => {
    render(
      <Modal open={false} title="Never mind" onClose={vi.fn()}>
        <p>Hidden</p>
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a modal dialog named by its title, with the body as its description', () => {
    openModal({ description: 'This cannot be undone.' });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Move this course to the archive?');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby') as string)).toHaveTextContent(
      'This cannot be undone.',
    );
  });

  it('takes the focus when it opens and hands it back when it closes', async () => {
    const user = userEvent.setup({ delay: null });

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal open={open} title="Move this course to the archive?" onClose={() => setOpen(false)}>
            <p>Students who hold a place will lose it.</p>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape, which is the one gesture every dialog owes the keyboard', () => {
    const { onClose } = openModal();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the scrim is clicked, but not when the click lands on the sheet', async () => {
    const user = userEvent.setup({ delay: null });
    const { onClose } = openModal();

    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the tab key inside itself, so a dialog cannot be stepped past', async () => {
    const user = userEvent.setup({ delay: null });
    openModal({
      actions: (
        <>
          <button type="button">Cancel</button>
          <button type="button">Confirm</button>
        </>
      ),
    });

    screen.getByRole('button', { name: 'Confirm' }).focus();
    await user.tab();

    // Nothing past Confirm is reachable: the cycle comes back round to the first control.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('stops the page behind it scrolling while it is up, and starts it again after', () => {
    const { unmount } = render(
      <Modal open title="One more thing" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('ConfirmDialog', () => {
  it('replaces the browser’s own confirm: a question, two answers, no system chrome', async () => {
    const user = userEvent.setup({ delay: null });
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Deactivate this coupon?"
        message="It can no longer be used for enrollment."
        confirmLabel="Deactivate"
        cancelLabel="Keep it"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });

  it('reads the consequence with the question, not after it', () => {
    render(
      <ConfirmDialog
        open
        title="Deactivate this coupon?"
        message="It can no longer be used for enrollment."
        confirmLabel="Deactivate"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const describedBy = screen.getByRole('dialog').getAttribute('aria-describedby');
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'It can no longer be used for enrollment.',
    );
  });

  it('paints a destructive answer as destructive', () => {
    render(
      <ConfirmDialog
        open
        tone="danger"
        title="Deactivate this coupon?"
        message="It can no longer be used for enrollment."
        confirmLabel="Deactivate"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Deactivate' })).toHaveClass('border-danger');
  });

  it('holds the answer disabled while the work is happening, so a second click is not a second request', () => {
    render(
      <ConfirmDialog
        open
        busy
        title="Deactivate this coupon?"
        message="It can no longer be used for enrollment."
        confirmLabel="Deactivate"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /deactivate/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
