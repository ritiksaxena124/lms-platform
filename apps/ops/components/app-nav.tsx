'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buttonClass, cn, notify, Skeleton } from '@lms/ui';

import { useSession } from './session-provider';

/**
 * The screens that exist. An item is added with its page, never before it, because a desk an operator
 * opens during an incident cannot afford a link that turns out to be a promise.
 */
const ITEMS = [
  { href: '/', label: 'Desk' },
  { href: '/activity', label: 'Activity log' },
  { href: '/accounts', label: 'Accounts' },
] as const;

/**
 * The one element that never animates: content slides, the chrome stays put, so a navigation always
 * reads as "the page changed" rather than "the app moved".
 *
 * The screen links arrive with the screens (8d); what is here from the start is the account corner,
 * because on this portal the person standing in front of the screen is the fact most worth naming —
 * every row they read is somebody else's history, and every write is made in their own name.
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <aside
      style={{ viewTransitionName: 'app-chrome' }}
      className="shrink-0 border-line px-4 py-5 lg:flex lg:w-56 lg:flex-col lg:border-r lg:px-5 lg:py-10"
    >
      <Link
        href="/"
        transitionTypes={['nav-back']}
        className="flex items-baseline gap-2 text-h2 text-ink-strong"
      >
        <span aria-hidden="true" className="inline-block size-2 rounded-pill bg-ember" />
        Ops desk
      </Link>

      <nav aria-label="Portal" className="mt-5 lg:mt-8">
        <ul className="flex gap-1 rounded-card bg-paper-sunk p-1 lg:flex-col lg:gap-0.5 lg:bg-transparent lg:p-0">
          {ITEMS.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

            return (
              <li key={item.href} className="flex-1 lg:flex-none">
                <Link
                  href={item.href}
                  transitionTypes={['nav-forward']}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-2 rounded-field px-3 py-2 text-label',
                    'transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                    active
                      ? 'bg-brand-soft font-semibold text-brand-deep'
                      : 'text-ink-muted hover:bg-paper-sunk hover:text-ink',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -left-2 hidden h-4 w-[3px] rounded-pill bg-brand lg:block',
                      !active && 'lg:hidden',
                    )}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <AccountSlot />
    </aside>
  );
}

/**
 * Who this tab is acting as, and the one way to stop.
 *
 * Signing out has no redirect of its own: the session flips to signed-out, and `RequireSession`
 * sends the page away. Two places deciding where a signed-out person belongs is one too many, and
 * they would not always agree.
 */
function AccountSlot() {
  const { status, user, signOut } = useSession();

  if (status === 'signed-in' && user) {
    return (
      <div className="mt-6 border-t border-line pt-4 lg:mt-auto">
        <p className="truncate text-label text-ink">{user.fullName}</p>
        <p className="mt-0.5 truncate text-[0.75rem] text-ink-faint">{user.email}</p>
        <p className="mt-0.5 truncate text-[0.75rem] text-ink-faint">{user.role}</p>
        <button
          type="button"
          onClick={() => {
            void signOut()
              .then(() => notify.success('Signed out'))
              .catch(() =>
                notify.error('The API could not hear the goodbye, but this device has let go.'),
              );
          }}
          className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), 'mt-2 -ml-3')}
        >
          Sign out
        </button>
      </div>
    );
  }

  if (status === 'bootstrapping') return <Skeleton className="mt-6 h-12 w-full rounded-card" />;

  return (
    <div className="mt-6 border-t border-line pt-4 lg:mt-auto">
      <Link href="/login" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
        Sign in
      </Link>
    </div>
  );
}
