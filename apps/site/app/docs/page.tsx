import type { Metadata } from 'next';

import { DocsShell } from '@/components/docs-shell';
import { readDoc } from '@/lib/docs';

import './prose.css';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'What this platform is, how it is built, and how to run it from a clone to a signed-in browser.',
};

/**
 * The docs open here. The file behind it is the manifest's `index`, which `docRoutes` keeps off a
 * second URL: a page reachable two ways is a page whose links can quietly disagree with each other.
 */
export default function DocsIndex() {
  return <DocsShell page={readDoc('index')} />;
}
