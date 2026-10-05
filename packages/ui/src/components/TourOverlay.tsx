'use client';

import { useEffect, useRef, useState } from 'react';
import type { TourStep } from '@lms/shared';

import { Button, cn } from '../index';

export interface TourOverlayProps {
  step: TourStep;
  stepNumber: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

/**
 * The guided-tour overlay: a highlighted target with an instruction card beside it.
 *
 * Only one of these is ever on screen at once — a tour that tried to explain two things
 * would explain neither. The backdrop dims everything else so the reader's eye goes to
 * the named element, and the card floats just outside it rather than covering it.
 */
export function TourOverlay({
  step,
  stepNumber,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
  onComplete,
}: TourOverlayProps) {
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  // Position the card next to the target element.
  useEffect(() => {
    const target = document.querySelector(step.target) as HTMLElement;
    if (!target || !cardRef.current) return;

    const rect = target.getBoundingClientRect();
    const cardRect = cardRef.current.getBoundingClientRect();

    // Default placement: below the target, centered horizontally.
    let top = rect.bottom + 16;
    let left = rect.left + rect.width / 2 - cardRect.width / 2;

    // Keep the card on screen.
    if (left < 16) left = 16;
    if (left + cardRect.width > window.innerWidth - 16) {
      left = window.innerWidth - cardRect.width - 16;
    }
    if (top + cardRect.height > window.innerHeight - 16) {
      // Flip above the target if there's no room below.
      top = rect.top - cardRect.height - 16;
    }

    setPosition({ top, left });

    // Scroll the target into view if needed.
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [step.target]);

  // Keyboard shortcuts: ESC to skip, arrows to navigate.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onSkip();
      } else if (event.key === 'ArrowRight') {
        onNext();
      } else if (event.key === 'ArrowLeft') {
        onPrev();
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onNext, onPrev, onSkip]);

  return (
    <>
      {/* Backdrop dims everything except the target. */}
      <div className="fixed inset-0 z-40 bg-paper/60" />

      {/* Highlight ring around the target element. */}
      <HighlightRing target={step.target} />

      {/* Instruction card. */}
      <div
        ref={cardRef}
        style={{ top: position.top, left: position.left }}
        className="fixed z-50 w-80 rounded-card border border-line bg-surface p-4 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[0.75rem] font-semibold uppercase tracking-wide text-ink-faint">
            Step {stepNumber} of {totalSteps}
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="text-[0.75rem] text-ink-muted hover:text-ink"
            aria-label="Skip tour"
          >
            Skip
          </button>
        </div>

        <h3 className="text-h3 text-ink-strong">{step.title}</h3>
        <p className="mt-2 text-[0.8125rem] text-ink-muted">{step.description}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onPrev}
            disabled={stepNumber === 1}
          >
            Previous
          </Button>
          <div className="flex items-center gap-2">
            {stepNumber === totalSteps ? (
              <Button type="button" size="sm" onClick={onComplete}>
                Got it
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={onNext}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Draws a subtle ring around the target element to guide the eye. */
function HighlightRing({ target }: { target: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = document.querySelector(target) as HTMLElement;
    if (!el) return;

    const update = () => setRect(el.getBoundingClientRect());
    update();

    // Update on resize.
    const observer = new ResizeObserver(update);
    observer.observe(el);

    return () => observer.disconnect();
  }, [target]);

  if (!rect) return null;

  return (
    <div
      style={{
        top: rect.top - 4,
        left: rect.left - 4,
        width: rect.width + 8,
        height: rect.height + 8,
      }}
      className={cn(
        'pointer-events-none fixed z-45 rounded-field border-2 border-brand',
        'shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]',
        'transition-all duration-200',
      )}
    />
  );
}
