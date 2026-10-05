# Interactive Tutorial System

Hourloom now has a guided tour system that walks users through key flows step-by-step. This document explains how it works and how to add tours to new features.

## How It Works

The tour system has three layers:

1. **Shared types** (`packages/shared/src/tour.ts`) - Tour definitions and completion tracking
2. **UI components** (`packages/ui/src/components/TourOverlay.tsx`) - Visual overlay with highlighting
3. **Hook** (`packages/ui/src/hooks/use-tour.ts`) - State management for active tours

## Using an Existing Tour

### Video Call Flow (Teacher)

The video call tour is already integrated into the teacher's classes page. To trigger it:

```tsx
import { VideoCallTour, ShowMeHowButton } from '@/components/video-call-tour';

function TeacherClassesPage() {
  const [showTour, setShowTour] = useState(false);

  return (
    <>
      <ShowMeHowButton onClick={() => setShowTour(true)} />
      {/* ... class list ... */}
      <VideoCallTour triggerStart={showTour} />
    </>
  );
}
```

The tour will highlight:
1. Class cards showing upcoming classes
2. The "Join video call" button when door opens
3. The embedded Jitsi room
4. The "Leave the room" button

## Creating a New Tour

### Step 1: Define the Tour

Create a tour definition in your feature folder:

```tsx
// apps/teacher/components/create-course-tour.tsx
import type { TourDefinition } from '@lms/shared';

export const CREATE_COURSE_TOUR: TourDefinition = {
  id: 'create-course',
  title: 'Creating Your First Course',
  steps: [
    {
      target: '[data-tour="course-title"]',
      title: 'Course Title',
      description: 'Give your course a clear, descriptive name that tells students what they will learn.',
      placement: 'bottom',
    },
    {
      target: '[data-tour="course-level"]',
      title: 'Difficulty Level',
      description: 'Choose the right level so students know if this course matches their experience.',
      placement: 'right',
    },
    // ... more steps
  ],
};
```

### Step 2: Add Data Attributes

Add `data-tour` attributes to the elements you want to highlight:

```tsx
<TextField
  id="title"
  label="Course title"
  data-tour="course-title"  // ← This attribute
/>
```

### Step 3: Create Tour Component

```tsx
// apps/teacher/components/create-course-tour.tsx
'use client';

import { TourOverlay, useTour } from '@lms/ui';
import { CREATE_COURSE_TOUR } from './create-course-tour-definition';

export function CreateCourseTour({ triggerStart }: { triggerStart?: boolean }) {
  const tour = useTour({
    tour: CREATE_COURSE_TOUR,
    autoStart: triggerStart,
  });

  if (!tour.isActive) return null;

  return (
    <TourOverlay
      step={CREATE_COURSE_TOUR.steps[tour.currentStepIndex]}
      stepNumber={tour.currentStepIndex + 1}
      totalSteps={tour.totalSteps}
      onNext={tour.nextStep}
      onPrev={tour.prevStep}
      onSkip={tour.skipTour}
      onComplete={tour.completeTour}
    />
  );
}
```

### Step 4: Integrate Into Page

```tsx
// apps/teacher/app/courses/new/page.tsx
import { CreateCourseTour, ShowMeHowButton } from '@/components/create-course-tour';

export default function NewCoursePage() {
  const [showTour, setShowTour] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1>Create a course</h1>
        <ShowMeHowButton onClick={() => setShowTour(true)} />
      </div>
      {/* ... form fields ... */}
      <CreateCourseTour triggerStart={showTour} />
    </div>
  );
}
```

## Tour Best Practices

### Writing Good Steps

- **Keep it short**: 3-5 steps max per tour
- **One concept per step**: Don't explain multiple things at once
- **Action-oriented**: Tell users what to do, not just what something is
- **Explain why**: Help users understand the purpose, not just the mechanics

### Target Selectors

Use specific, stable selectors:

```tsx
// ✅ Good - specific and unlikely to change
data-tour="join-button"
data-tour="course-title"

// ❌ Bad - generic or likely to change
data-tour="button"
data-tour="input-1"
```

### Placement

Choose placement that keeps the card visible:

- `'top'` - Above the target (good for bottom-of-page elements)
- `'bottom'` - Below the target (default, good for most cases)
- `'left'` - Left of target (good for right-side actions)
- `'right'` - Right of target (good for left-side navigation)

The overlay automatically adjusts to stay on screen, but choosing the right initial placement makes the flow smoother.

## Available Tours

| Tour ID | Portal | Purpose |
|---------|--------|---------|
| `video-call-flow` | Teacher/Student | How to join and leave live classes |
| `teacher-onboarding` | Teacher | First-time setup walkthrough |
| `student-onboarding` | Student | How to browse, enroll, and book |
| `create-course` | Teacher | Writing your first course |
| `book-class` | Student | Booking a 1:1 session |

## Resetting Tours

Users can reset all tour completions by clearing browser localStorage, or programmatically:

```tsx
import { resetTours } from '@lms/shared';

resetTours(); // All tours will be available again
```

## Testing Tours

Tours are easy to test because they're declarative:

```tsx
it('shows tour steps in order', () => {
  render(<CreateCourseTour triggerStart />);

  expect(screen.getByText('Course Title')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Next'));
  expect(screen.getByText('Difficulty Level')).toBeInTheDocument();
});
```

## Future Enhancements

Potential improvements for the tour system:

- [ ] Progress indicator showing which step user is on
- [ ] Ability to jump to specific steps
- [ ] Video tooltips with embedded demos
- [ ] Contextual help links in each step
- [ ] Analytics tracking which tours users complete/skip
