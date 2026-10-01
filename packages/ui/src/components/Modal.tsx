'use client';

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Button } from './Button';
import { cn } from '../lib/cn';

/** The controls a Tab can land on, in the order the sheet holds them. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SIZE = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
} as const;

export type ModalSize = keyof typeof SIZE;

export interface ModalProps {
  /** The sheet is in the document only while this is true. Nothing is left behind when it is not. */
  open: boolean;
  /** Called by Escape, by the scrim, and by whatever control the caller puts in `actions`. */
  onClose: () => void;
  /** The question the sheet asks. It becomes the dialog's accessible name. */
  title: ReactNode;
  /** The one-line reason, read out with the title as the dialog's description. */
  description?: ReactNode;
  /** What the sheet holds besides its question — a form, a list, anything. Optional: a plain
   * confirmation asks its question through `description` alone. */
  children?: ReactNode;
  /** The answers. Left to the caller — a form's Save and a deletion's Confirm are not the same pair. */
  actions?: ReactNode;
  size?: ModalSize;
  className?: string;
}

/**
 * A sheet that asks for an answer before the page behind it can be used.
 *
 * This is what the portals answer a question with, rather than the browser's own `confirm`: a
 * system dialog cannot be styled, cannot hold more than a sentence, and takes the reader out of the
 * page it is asking about. The trade is everything a system dialog gets for free — which this files
 * itself: focus moves in on open and back to the trigger on close, Tab cannot step past the edge of
 * the sheet, Escape is always an answer, and the page underneath stops scrolling while it is up.
 *
 * There is deliberately no close icon in the corner. Every sheet is opened to answer something, and
 * the exit is that answer or Escape or the scrim — a third way out would be a third thing to place.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  size = 'sm',
  className,
}: ModalProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const panel = useRef<HTMLDivElement>(null);

  // The effect only runs while the sheet is up, so its cleanup is the close: the body scrolls
  // again, and the focus goes back where the reader was.
  useEffect(() => {
    if (!open) return;

    const hadFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();

    return () => {
      document.body.style.overflow = overflow;
      hadFocus?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }

    const [first, last] = [controls[0], controls[controls.length - 1]] as [
      HTMLElement,
      HTMLElement,
    ];
    // The panel itself is the first stop, so tabbing forward from it is tabbing to the first
    // control — which is where a reader who just arrived means to go.
    const atEdge = event.shiftKey
      ? first === document.activeElement || panel.current === document.activeElement
      : last === document.activeElement;

    if (atEdge) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  return createPortal(
    <div
      className="lms-scrim fixed inset-0 z-50 grid place-items-center bg-ink-strong/45 p-4"
      onMouseDown={(event) => {
        // Only the scrim itself: a press that started on the sheet and ended here is a reader
        // changing their mind about a drag, not a request to close.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trap}
        className={cn(
          'lms-modal relative w-full rounded-sheet border border-line bg-surface p-5 text-left shadow-[var(--shadow-overlay)] outline-none',
          SIZE[size],
          className,
        )}
      >
        <h2 id={titleId} className="text-h3 text-ink-strong">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-1 text-[0.8125rem] leading-snug text-ink-muted">
            {description}
          </p>
        ) : null}

        {children ? <div className="mt-3 text-[0.9375rem] text-ink">{children}</div> : null}


        {actions ? (
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{actions}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** The consequence, in the reader's terms. Replaces the sentence a `confirm()` used to hold. */
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for the answer that cannot be taken back. */
  tone?: 'primary' | 'danger';
  /** While the request is in flight: the answers shut, so a second click is not a second request. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** The sheet that replaces `window.confirm`. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={message}
      actions={
        <>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Modal>
  );
}
