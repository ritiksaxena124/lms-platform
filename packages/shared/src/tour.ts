/** Tour identifiers for different guided flows in the platform. */
export const TOUR_IDS = [
  'teacher-onboarding',
  'student-onboarding',
  'video-call-flow',
  'create-course',
  'book-class',
] as const;

export type TourId = (typeof TOUR_IDS)[number];

/** One step in a guided tour. */
export interface TourStep {
  /** CSS selector for the element to highlight. */
  target: string;
  /** Short title shown in the tooltip card. */
  title: string;
  /** Longer explanation of what this step does or why it matters. */
  description: string;
  /** Optional placement hint: where the tooltip should appear relative to the target. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/** A complete tour definition. */
export interface TourDefinition {
  id: TourId;
  title: string;
  steps: readonly TourStep[];
}

const TOUR_STORAGE_PREFIX = 'hourloom.tour.completed.';

/** Read the set of completed tours from localStorage. */
export function getCompletedTours(): Set<TourId> {
  if (typeof globalThis === 'undefined') return new Set();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (globalThis as any)?.window;
  if (!win) return new Set();

  try {
    const stored = win.localStorage.getItem(TOUR_STORAGE_PREFIX + 'all');
    if (!stored) return new Set();
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is TourId => TOUR_IDS.includes(id as TourId)));
  } catch {
    return new Set();
  }
}

/** Mark a tour as completed so it won't auto-start again. */
export function setTourCompleted(tourId: TourId): void {
  if (typeof globalThis === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (globalThis as any)?.window;
  if (!win) return;

  const completed = getCompletedTours();
  completed.add(tourId);
  win.localStorage.setItem(TOUR_STORAGE_PREFIX + 'all', JSON.stringify([...completed]));
}

/** Check whether a specific tour has been completed. */
export function isTourCompleted(tourId: TourId): boolean {
  return getCompletedTours().has(tourId);
}

/** Reset all tour completions (useful for testing or "show me again" feature). */
export function resetTours(): void {
  if (typeof globalThis === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (globalThis as any)?.window;
  if (!win) return;

  win.localStorage.removeItem(TOUR_STORAGE_PREFIX + 'all');
}
