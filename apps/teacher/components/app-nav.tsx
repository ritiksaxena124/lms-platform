'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@lms/ui';

const ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/toolkit', label: 'Interface kit' },
] as const;

/**
 * The one element that never animates: content slides, the chrome stays put, so
 * a navigation always reads as "the page changed" rather than "the app moved".
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <aside
      style={{ viewTransitionName: 'app-chrome' }}
      className="shrink-0 border-line py-5 lg:w-56 lg:border-r lg:py-10"
    >
      <Link
        href="/"
        transitionTypes={['nav-back']}
        className="flex items-baseline gap-2 font-display text-h2 text-ink-strong"
      >
        <span aria-hidden="true" className="inline-block size-2 rounded-pill bg-ember" />
        Teacher
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
                      ? 'bg-surface text-ink shadow-card lg:bg-ember-soft lg:text-ember-deep lg:shadow-none'
                      : 'text-ink-muted hover:bg-ink/6 hover:text-ink',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -left-2 hidden h-4 w-[3px] rounded-pill bg-ember lg:block',
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
    </aside>
  );
}
