'use client';

import toast from 'react-hot-toast';

import { ToastCard, type ToastTone } from './ToastCard';

/** Same shape the API returns, so the envelope can be shown without mapping. */
export interface ApiErrorShape {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: {
    validation?: Record<string, string | string[]>;
    [key: string]: unknown;
  };
}

/** Mirrors the generic 500 message in the API's exception filter. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

const DEFAULT_DURATION: Record<ToastTone, number> = {
  neutral: 5000,
  success: 4000,
  error: 7000, // an error needs time to be read, and to be copied out of
  info: 5000,
  loading: Number.POSITIVE_INFINITY,
};

export interface NotifyOptions {
  /** Reuse an id to turn a loading toast into its own success or failure. */
  id?: string;
  duration?: number;
  position?:
    'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  details?: string[];
  action?: { label: string; onClick: () => void };
}

let sequence = 0;

function nextId(tone: ToastTone): string {
  sequence += 1;
  return `${tone}-${sequence}`;
}

function show(tone: ToastTone, message: string, options: NotifyOptions = {}): string {
  const id = options.id ?? nextId(tone);
  const { action, position = 'bottom-right', duration = DEFAULT_DURATION[tone] } = options;

  toast.custom(
    (current) => (
      <ToastCard
        tone={tone}
        message={message}
        details={options.details}
        onDismiss={() => toast.dismiss(current?.id)}
        action={
          action
            ? {
                label: action.label,
                onClick: () => {
                  toast.dismiss(id);
                  action.onClick();
                },
              }
            : undefined
        }
      />
    ),
    { id, duration, position },
  );

  return id;
}

/**
 * The only notification surface in this codebase.
 *
 * Built on `react-hot-toast` for the timing and stacking, but every call renders
 * our own `ToastCard`, so a client-side success and an API validation failure
 * share one shape. Call it from event handlers and effects — never during
 * render.
 */
export const notify = {
  success: (message: string, options?: NotifyOptions) => show('success', message, options),
  error: (message: string, options?: NotifyOptions) => show('error', message, options),
  info: (message: string, options?: NotifyOptions) => show('info', message, options),
  neutral: (message: string, options?: NotifyOptions) => show('neutral', message, options),
  /** Returns the id; pass it to `dismiss`, or reuse it as `options.id` to replace. */
  loading: (message: string, options?: NotifyOptions) => show('loading', message, options),

  withAction: (input: {
    message: string;
    actionLabel: string;
    onAction: () => void;
    tone?: ToastTone;
    duration?: number;
  }) =>
    show(input.tone ?? 'neutral', input.message, {
      action: { label: input.actionLabel, onClick: input.onAction },
      duration: input.duration ?? 8000,
    }),

  /** Turns anything thrown by the API layer into a readable line plus field errors. */
  fromApiError: (error: unknown, options?: NotifyOptions) => {
    const { message, details } = describeError(error);
    return show('error', message, { ...options, details: details ?? options?.details });
  },

  dismiss: (id?: string) => {
    toast.dismiss(id);
  },
};

function describeError(error: unknown): { message: string; details?: string[] } {
  if (typeof error === 'string' && error.trim() !== '') return { message: error };
  if (error instanceof Error) return { message: error.message || GENERIC_ERROR_MESSAGE };

  if (error && typeof error === 'object') {
    const shape = error as ApiErrorShape;
    const message = shape.message?.trim() || GENERIC_ERROR_MESSAGE;
    const validation = shape.details?.validation;

    if (validation && typeof validation === 'object') {
      const details = Object.entries(validation).map(
        ([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : value}`,
      );
      return { message, details: details.length > 0 ? details.slice(0, 4) : undefined };
    }

    return { message };
  }

  return { message: GENERIC_ERROR_MESSAGE };
}
