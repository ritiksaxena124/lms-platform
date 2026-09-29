import { AppNav } from '@/components/app-nav';
import { RequireSession } from '@/components/require-session';

/**
 * Every signed-in screen in one place: the chrome stays, the content is gated, and the gate on this
 * portal is a role as well as a session.
 *
 * Gating here rather than per page means a new screen cannot be added without protection by accident
 * — opting out is the visible choice, not the default. It also means the "you are not ops" answer is
 * written once: three screens inventing three polite versions of that refusal is how an operator ends
 * up unsure which desk they are standing at.
 *
 * The frame is the viewport, not the document: the sidebar runs flush to the left edge and holds still
 * while `main` scrolls, because a desk you read tables at should not move when the table does.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden lg:flex-row">
      <AppNav />
      <main id="main" className="min-w-0 flex-1 overflow-y-auto px-5 py-8 lg:px-10 lg:py-10">
        <RequireSession>{children}</RequireSession>
      </main>
    </div>
  );
}
