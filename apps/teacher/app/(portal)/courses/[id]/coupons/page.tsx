import { PageHeader, RouteTransition } from '@lms/ui';

import { CourseNav } from '@/components/course-nav';
import { CouponManager } from '@/components/coupon-manager';

export const metadata = { title: 'Coupons' };

export default async function CourseCouponsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <PageHeader
        title="Coupons"
        description="Create and manage discount codes for this course. Each code can offer a percentage or fixed-amount discount."
        breadcrumbs={[
          { label: 'Courses', href: '/courses' },
          { label: 'Course', href: `/courses/${id}/edit` },
          { label: 'Coupons' },
        ]}
      />
      <CourseNav courseId={id} active="coupons" />
      <div className="mt-6 max-w-3xl">
        <CouponManager courseId={id} />
      </div>
    </RouteTransition>
  );
}
