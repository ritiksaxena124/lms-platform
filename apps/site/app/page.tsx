import { Audiences } from '@/components/landing/audiences';
import { Architecture } from '@/components/landing/architecture';
import { FAQ } from '@/components/landing/faq';
import { Features } from '@/components/landing/features';
import { FinalCTA } from '@/components/landing/final-cta';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { ProblemSolution } from '@/components/landing/problem-solution';
import { SiteFooter } from '@/components/landing/site-footer';
import { StatusSection } from '@/components/landing/status-section';
import { readPortalUrls } from '@/lib/portals';

/**
 * The landing page of Hourloom's public site. Structured as a narrative:
 *
 *   1. Hero — what is it and why should I care
 *   2. How it works — the four-step class lifecycle
 *   3. Problem / solution — the pain of teaching independently
 *   4. Audiences — who it is for (teachers and learners)
 *   5. Features — the pieces that make a class work
 *   6. Status — what is built and what is not
 *   7. Architecture — how the platform is built (trust)
 *   8. FAQ — real questions answered
 *   9. Final CTA — what to do next
 *  10. Footer — navigation and brand
 *
 * Every section has a purpose. Every claim is supported by the product.
 */
export default function Home() {
  const portals = readPortalUrls();

  return (
    <>
      <Hero portals={portals} />
      <HowItWorks />
      <ProblemSolution />
      <Audiences />
      <Features />
      <StatusSection />
      <Architecture />
      <FAQ />
      <FinalCTA portals={portals} />
      <SiteFooter portals={portals} />
    </>
  );
}
