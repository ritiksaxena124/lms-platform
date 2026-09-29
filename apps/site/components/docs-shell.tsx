import Link from 'next/link';

import { cn } from '@lms/ui';

import { docGroups, type DocPage } from '@/lib/docs';

/**
 * The three columns one docs page sits in: what else is here, this page, and where this page goes
 * inside itself.
 *
 * The page keeps its own title. The markdown already opens with `#`, so a header written here would
 * hand the reader the same sentence twice and give the document two first headings.
 */
export function DocsShell({ page }: { page: DocPage }) {
  const current = page.entry.slug;

  return (
    <div className="mx-auto grid w-full max-w-page gap-x-12 gap-y-12 px-5 py-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:px-8 xl:grid-cols-[13rem_minmax(0,1fr)_12rem]">
      <nav
        aria-label="Documentation"
        className="lg:sticky lg:top-10 lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto"
      >
        {docGroups().map((group) => (
          <div key={group.group} className="mb-6 last:mb-0">
            <p className="text-eyebrow uppercase text-ink-faint">{group.group}</p>
            <ul className="mt-2.5 space-y-1">
              {group.entries.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={hrefFor(entry.slug)}
                    aria-current={entry.slug === current ? 'page' : undefined}
                    className={cn(
                      'block rounded-field px-2.5 py-1.5 text-label leading-snug',
                      'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                      entry.slug === current
                        ? 'bg-brand-soft text-brand-deep'
                        : 'text-ink-muted hover:bg-paper-sunk hover:text-ink',
                    )}
                  >
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <article className="prose-doc min-w-0">
        {/* The prose is written here, in this repository, by whoever wrote the code it describes.
         * Nothing in it came from a request, so it goes in as markup rather than as text. */}
        <div dangerouslySetInnerHTML={{ __html: page.html }} />
      </article>

      {page.headings.length > 0 && (
        <nav aria-label="On this page" className="xl:sticky xl:top-10 xl:self-start">
          <p className="text-eyebrow uppercase text-ink-faint">On this page</p>
          <ul className="mt-2.5 space-y-1 border-l border-line">
            {page.headings.map((heading) => (
              <li key={heading.id} className={heading.depth > 2 ? 'pl-5' : 'pl-3'}>
                <a
                  href={`#${heading.id}`}
                  className="block text-label leading-snug text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-brand"
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

/**
 * The index is `/docs`, not `/docs/index`: one page with two addresses is two things that can drift,
 * and the shorter of them is the one a reader would write down.
 */
function hrefFor(slug: string): string {
  return slug === 'index' ? '/docs' : `/docs/${slug}`;
}
