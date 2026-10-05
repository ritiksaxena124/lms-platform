'use client';

import { TourOverlay, useTour } from '@lms/ui';
import type { TourDefinition } from '@lms/shared';

/** The guided tour for joining a live class. */
const VIDEO_CALL_TOUR: TourDefinition = {
  id: 'video-call-flow',
  title: 'Joining a Live Class',
  steps: [
    {
      target: '[data-tour="class-card"]',
      title: 'Your scheduled classes',
      description:
        'This card shows a class you have coming up. When it is time to teach, a green "Live class is open" box will appear here.',
      placement: 'bottom',
    },
    {
      target: '[data-tour="join-button"]',
      title: 'The join button',
      description:
        'Click this button when the door opens (5 minutes before class). It loads the Jitsi room directly on this page — no new tab needed.',
      placement: 'top',
    },
    {
      target: '[data-tour="video-frame"]',
      title: 'The video room',
      description:
        'The Jitsi room appears here. If the student has not arrived yet, you will see an empty room. Wait a few minutes before marking the class as missed.',
      placement: 'bottom',
    },
    {
      target: '[data-tour="leave-room"]',
      title: 'Leaving the room',
      description:
        'Click "Leave the room" to close the video and return to your class list. This does not cancel the class — it just closes the video.',
      placement: 'top',
    },
  ],
};

/**
 * Shows the video call tutorial overlay if active.
 *
 * Add this component inside TeacherClasses or any page that wants to offer the tour.
 * Trigger it with a "Show me how" link that calls startTour().
 */
export function VideoCallTour({ triggerStart }: { triggerStart?: boolean }) {
  const {
    isActive,
    currentStepIndex,
    totalSteps,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    completeTour,
  } = useTour({
    tour: VIDEO_CALL_TOUR,
    autoStart: triggerStart,
  });

  // Expose startTour to parent via effect if triggerStart changes.
  // Note: In real usage, you would lift this state up or use a context.

  if (!isActive) return null;

  const step = VIDEO_CALL_TOUR.steps[currentStepIndex];

  return (
    <TourOverlay
      step={step}
      stepNumber={currentStepIndex + 1}
      totalSteps={totalSteps}
      onNext={nextStep}
      onPrev={prevStep}
      onSkip={skipTour}
      onComplete={completeTour}
    />
  );
}

/** A reusable "Show me how" link for any page offering a tour. */
export function ShowMeHowButton({ onClick, label = 'Show me how' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[0.8125rem] text-brand hover:text-brand-deep underline-offset-2 hover:underline"
    >
      {label}
    </button>
  );
}
