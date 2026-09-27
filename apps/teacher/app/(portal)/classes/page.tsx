import { PageHeader, RouteTransition } from '@lms/ui';

import { TeacherClasses } from '@/components/teacher-classes';

export const metadata = { title: 'Classes' };

export default function ClassesPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Classes"
        description="Every class on your schedule, soonest first — the ones waiting on your answer, the ones on, and the ones that have gone by."
      />
      <div className="mt-6 max-w-3xl">
        <TeacherClasses />
      </div>
    </RouteTransition>
  );
}
