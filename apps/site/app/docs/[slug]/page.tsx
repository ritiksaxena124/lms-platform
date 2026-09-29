import type { Metadata } from 'next';

import { DocsShell } from '@/components/docs-shell';
import { docSlugs, readDoc } from '@/lib/docs';

import '../prose.css';

/**
 * The manifest decides which pages exist, so a new docs page is a file in `content/` and a line in
 * `docs.json` — never a route to remember. The index is excluded because `/docs` already serves it.
 */
export function generateStaticParams(): { slug: string }[] {
  return docSlugs()
    .filter((slug) => slug !== 'index')
    .map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { entry } = readDoc(slug);

  return { title: entry.title, description: entry.summary };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // An unknown segment reaches `readDoc`, which refuses it. There is no server in a static export to
  // ask this question at request time: every path here was named by `generateStaticParams` or the
  // build did not emit a file for it.
  return <DocsShell page={readDoc(slug)} />;
}
