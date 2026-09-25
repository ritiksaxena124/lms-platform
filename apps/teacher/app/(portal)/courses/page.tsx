import Link from 'next/link';
import { PageHeader, RouteTransition, buttonClass } from '@lms/ui';

import { CourseList } from '@/components/course-list';

export const metadata = { title: 'Courses' };

export default function CoursesPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Courses"
        description="What you teach, and how far each one has got. A draft is yours alone; publishing is what puts it in front of a student."
        actions={
          <Link
            href="/courses/new"
            transitionTypes={['nav-forward']}
            className={buttonClass({ variant: 'primary' })}
          >
            New course
          </Link>
        }
      />
      <div className="mt-6">
        <CourseList />
      </div>
    </RouteTransition>
  );
}
