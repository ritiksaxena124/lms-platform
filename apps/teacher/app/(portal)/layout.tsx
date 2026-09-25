import { AppNav } from '@/components/app-nav';
import { RequireSession } from '@/components/require-session';

/**
 * Every signed-in screen in one place: the chrome stays, the content is gated.
 *
 * Gating here rather than per page means a new screen cannot be added without
 * protection by accident — opting out is the visible choice, not the default.
 *
 * The frame is the viewport, not the document: the sidebar runs flush to the left edge and
 * holds still while `main` scrolls. That is why the height is `dvh` and not `screen` — a
 * mobile browser's URL bar is part of the viewport, and a frame measured against the screen
 * loses its bottom row of pixels to a bar that is not there in the layout.
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
