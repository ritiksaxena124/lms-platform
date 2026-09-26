import { Illo, RouteTransition } from '@lms/ui';

import { CatalogShelf } from '@/components/catalog-shelf';

/**
 * The front door, and the only screen a visitor has to decide to stay on.
 *
 * The promise is the outline, so the hero says that in one line rather than describing the
 * platform. What is not said here: prices, ratings, "join thousands of learners". None of
 * those exist yet, and a storefront that invents them is worse received than one that admits
 * it is new.
 */
export default function ShelfPage() {
  return (
    <RouteTransition>
      <section className="overflow-hidden rounded-card border border-brand-line bg-brand-wash">
        <div className="flex flex-wrap items-end gap-6 px-6 py-9 sm:px-8 sm:py-11">
          <div className="min-w-[18rem] max-w-[44rem] flex-1">
            <p className="eyebrow text-brand-deep">Teacher marketplace</p>
            <h1 className="mt-2 text-h1 text-ink-strong">
              Read the whole syllabus before you commit an evening
            </h1>
            <p className="mt-3 max-w-[52ch] text-[0.9375rem] text-ink-muted">
              Every course here is written by the teacher who publishes it, and each one is
              listed the way it is taught: module by module, page by page, with roughly how long
              each takes to read.
            </p>
          </div>

          <Illo src="/illustrations/peep-sitting-02.svg" size="lg" className="hidden sm:block" />
        </div>
      </section>

      <div className="mt-10">
        <h2 className="text-h2 text-ink-strong">Published courses</h2>
        <div className="mt-4">
          <CatalogShelf />
        </div>
      </div>
    </RouteTransition>
  );
}
