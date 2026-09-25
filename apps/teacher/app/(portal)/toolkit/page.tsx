import { PageHeader, RouteTransition } from '@lms/ui';

import { ToolkitDemo } from '@/components/toolkit-demo';

export const metadata = { title: 'Interface kit' };

export default function ToolkitPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Interface kit"
        description="Every primitive the three portals share, on one page. Built from @lms/ui, so what you see here is what the teacher, student and ops apps will ship."
      />
      <ToolkitDemo />
    </RouteTransition>
  );
}
