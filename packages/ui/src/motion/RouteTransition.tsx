import { Suspense, ViewTransition, type ReactNode } from 'react';

/**
 * The animation vocabulary, kept in one file so a page never invents a class name
 * that the stylesheet does not know about. The keyframes and timing live in
 * `styles/motion.css`; the type names are matched by `<Link transitionTypes={...}>`.
 */

const NAVIGATION_ANIMATIONS = {
  'nav-forward': 'nav-forward',
  'nav-back': 'nav-back',
  default: 'none',
} as const;

export interface RouteTransitionProps {
  children: ReactNode;
}

/**
 * Wrap a page's content — not a layout, which persists across navigations and so
 * would never fire enter or exit. Forward links tag themselves `nav-forward`;
 * untyped navigations (back button, refresh) stay still.
 */
export function RouteTransition({ children }: RouteTransitionProps) {
  return (
    <ViewTransition enter={NAVIGATION_ANIMATIONS} exit={NAVIGATION_ANIMATIONS} default="none">
      {children}
    </ViewTransition>
  );
}

export interface ContentRevealProps {
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * The skeleton-to-data handoff inside a page: the placeholder yields in 150ms and
 * the content rises after it, so a slow query still reads as one continuous move.
 */
export function ContentReveal({ fallback, children }: ContentRevealProps) {
  return (
    <Suspense
      fallback={
        <ViewTransition exit="skeleton-out" default="none">
          {fallback}
        </ViewTransition>
      }
    >
      <ViewTransition enter="content-in" default="none">
        {children}
      </ViewTransition>
    </Suspense>
  );
}
