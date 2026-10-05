'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TourDefinition, TourId } from '@lms/shared';
import { getCompletedTours, isTourCompleted, setTourCompleted } from '@lms/shared';

interface UseTourOptions {
  tour: TourDefinition;
  /** Auto-start the tour if it hasn't been completed yet. */
  autoStart?: boolean;
  /** Called when the tour completes (either by finishing or skipping). */
  onComplete?: () => void;
}

interface UseTourReturn {
  isActive: boolean;
  currentStepIndex: number;
  totalSteps: number;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  completeTour: () => void;
}

/**
 * Manages a guided tour's state and navigation.
 *
 * Reads completion status from localStorage on mount, writes it back when the tour
 * finishes, and exposes simple controls for stepping through or abandoning the flow.
 */
export function useTour({
  tour,
  autoStart = false,
  onComplete,
}: UseTourOptions): UseTourReturn {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Check if tour should auto-start on mount.
  useEffect(() => {
    if (autoStart && !isTourCompleted(tour.id)) {
      setIsActive(true);
      setCurrentStepIndex(0);
    }
  }, [autoStart, tour.id]);

  const startTour = useCallback(() => {
    setIsActive(true);
    setCurrentStepIndex(0);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStepIndex < tour.steps.length - 1) {
      setCurrentStepIndex((i) => i + 1);
    } else {
      completeTour();
    }
  }, [currentStepIndex, tour.steps.length]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((i) => i - 1);
    }
  }, [currentStepIndex]);

  const skipTour = useCallback(() => {
    setIsActive(false);
    setTourCompleted(tour.id);
    onComplete?.();
  }, [tour.id, onComplete]);

  const completeTour = useCallback(() => {
    setIsActive(false);
    setTourCompleted(tour.id);
    onComplete?.();
  }, [tour.id, onComplete]);

  return {
    isActive,
    currentStepIndex,
    totalSteps: tour.steps.length,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    completeTour,
  };
}

/** Returns whether any tours have been completed (for showing "Show me again" option). */
export function useHasCompletedTours(): boolean {
  const [hasCompleted, setHasCompleted] = useState(false);

  useEffect(() => {
    setHasCompleted(getCompletedTours().size > 0);
  }, []);

  return hasCompleted;
}
