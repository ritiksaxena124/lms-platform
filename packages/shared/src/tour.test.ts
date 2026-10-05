import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCompletedTours,
  isTourCompleted,
  resetTours,
  setTourCompleted,
} from './tour';

// Mock localStorage for Node environment
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

beforeEach(() => {
  mockLocalStorage.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = {
    localStorage: mockLocalStorage,
  };
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
});

describe('tour state', () => {
  it('starts with no completed tours', () => {
    const completed = getCompletedTours();
    expect(completed.size).toBe(0);
  });

  it('marks a tour as completed', () => {
    setTourCompleted('teacher-onboarding');
    expect(isTourCompleted('teacher-onboarding')).toBe(true);
  });

  it('tracks multiple completed tours', () => {
    setTourCompleted('teacher-onboarding');
    setTourCompleted('student-onboarding');
    expect(isTourCompleted('teacher-onboarding')).toBe(true);
    expect(isTourCompleted('student-onboarding')).toBe(true);
    expect(isTourCompleted('video-call-flow')).toBe(false);
  });

  it('ignores invalid tour IDs in storage', () => {
    mockLocalStorage.setItem(
      'hourloom.tour.completed.all',
      JSON.stringify(['invalid-tour', 'teacher-onboarding']),
    );
    const completed = getCompletedTours();
    expect(completed.has('teacher-onboarding')).toBe(true);
    expect(completed.has('invalid-tour' as any)).toBe(false);
  });

  it('resets all tour completions', () => {
    setTourCompleted('teacher-onboarding');
    resetTours();
    expect(isTourCompleted('teacher-onboarding')).toBe(false);
  });

  it('handles malformed JSON gracefully', () => {
    mockLocalStorage.setItem('hourloom.tour.completed.all', 'not-json');
    const completed = getCompletedTours();
    expect(completed.size).toBe(0);
  });
});
