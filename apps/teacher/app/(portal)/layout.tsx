import { AppNav } from '@/components/app-nav';
import { RequireSession } from '@/components/require-session';

/**
 * Every signed-in screen in one place: the chrome stays, the content is gated.
 *
 * Gating here rather than per page means a new screen cannot be added without
 * protection by accident — opting out is the visible choice, not the default.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-page flex-col gap-6 lg:flex-row lg:gap-10 lg:px-6 xl:px-10">
      <AppNav />
      <main id="main" className="min-w-0 flex-1 px-5 py-8 lg:px-0 lg:py-10">
        <RequireSession>{children}</RequireSession>
      </main>
    </div>
  );
}
