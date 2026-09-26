import type { ReactNode } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Design System',
  parameters: { frame: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The rules, not just the values: a developer who reads this page should be able
 * to make an unlisted component look like it belongs here. Every sample is built
 * from the token names themselves, so the page cannot drift from `tokens.css`.
 */
export const Tokens: Story = {
  name: 'Tokens and rules',
  render: () => <TokensPage />,
};

const SURFACES = ['paper', 'paper-sunk', 'surface', 'surface-raised'] as const;

const INKS = [
  ['ink-strong', 'Headings'],
  ['ink', 'Body text'],
  ['ink-muted', 'Labels, metadata'],
  ['ink-faint', 'Placeholders, timestamps'],
] as const;

const BRAND = ['brand', 'brand-deep', 'brand-soft', 'brand-line'] as const;

const STATUS = [
  ['success', 'Booked, saved, paid'],
  ['warning', 'Needs attention'],
  ['danger', 'Failed, cancelled'],
  ['info', 'Neutral context'],
] as const;

/** The utility is spelled out in full — Tailwind scans source, not interpolated names. */
const TYPE_STEPS = [
  ['text-metric', 'Metric — key figure', 'Tuesday, 6 March'],
  ['text-h1', 'H1 — page title', 'Tuesday, 6 March'],
  ['text-h2', 'H2 — section / card title', 'Tuesday, 6 March'],
  ['text-h3', 'H3 — sub-section', 'Tuesday, 6 March'],
  ['text-label', 'Label — nav, buttons, table heads', 'Tuesday, 6 March'],
  ['eyebrow', 'Eyebrow — uppercase kicker', 'This week'],
] as const;

const RULES = [
  [
    'One typeface',
    'Inter Variable everywhere, loaded in the build that carries its optical-size axis. Hierarchy comes from size, weight and colour — never from a second font.',
  ],
  [
    'Borders separate, surfaces stack',
    'Flat layout gets a 1px line. The only shadow in the system belongs to things that float: menus, dialogs, toasts.',
  ],
  [
    'Colour is meaningful',
    'Graphite does the structural work, brand emerald marks the primary action, and semantic tones stay in their own hue families.',
  ],
  [
    'Text clears AA where it is used',
    'Every ink and accent is contrast-checked against both surfaces by tokens.test.ts, at the 12–13px sizes the ramp actually appears at. A gray that fails is not subtle, it is unreadable.',
  ],
  [
    'Gradient is a highlighter',
    'Exactly three gradients exist, each with a named job. A fourth needs a reason, not a taste.',
  ],
] as const;

function TokensPage() {
  return (
    <div className="min-h-screen bg-paper px-8 py-10 font-sans text-ink">
      <header className="mx-auto max-w-page">
        <p className="eyebrow">@lms/ui · Graphite</p>
        <h1 className="mt-2 text-h1 text-ink-strong">Design system</h1>
        <p className="mt-2 max-w-[70ch] text-[0.9375rem] text-ink-muted">
          Shared tokens, primitives and motion for the teacher, student and ops portals. Portals
          import this package as source — there is no build step to keep in sync.
        </p>
      </header>

      <div className="mx-auto mt-10 flex max-w-page flex-col gap-10">
        <Section title="Rules that outrank taste">
          <ul className="grid gap-3 sm:grid-cols-2">
            {RULES.map(([heading, body]) => (
              <li key={heading} className="rounded-card border border-line bg-surface p-4">
                <p className="text-label text-ink-strong">{heading}</p>
                <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-muted">{body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Surfaces">
          <Swatches tokens={SURFACES.map((name) => [`color-${name}`, name, `bg-${name}`])} />
        </Section>

        <Section title="Ink">
          <div className="flex flex-wrap gap-4">
            {INKS.map(([name, job]) => (
              <div key={name} className="w-52 rounded-card border border-line bg-surface p-4">
                <p className="text-[0.9375rem]" style={{ color: `var(--color-${name})` }}>
                  The quick brown fox
                </p>
                <p className="mt-1 text-[0.75rem] text-ink-faint">
                  <code className="font-mono">text-{name}</code> · {job}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Lines">
          <div className="flex flex-wrap gap-4">
            {(['line', 'line-strong'] as const).map((name) => (
              <div key={name} className="w-52 rounded-card border border-line bg-surface p-4">
                <div className="h-px w-full" style={{ background: `var(--color-${name})` }} />
                <p className="mt-3 text-[0.75rem] text-ink-faint">
                  <code className="font-mono">border-{name}</code>
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Brand">
          <Swatches tokens={BRAND.map((name) => [`color-${name}`, name, `bg-${name}`])} />
        </Section>

        <Section title="Semantic status">
          <div className="flex flex-wrap gap-4">
            {STATUS.map(([tone, job]) => (
              <div key={tone} className="w-44 rounded-card border border-line bg-surface p-4">
                <span
                  className="inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[0.75rem] leading-none font-medium"
                  style={{
                    color: `var(--color-${tone})`,
                    background: `var(--color-${tone}-soft)`,
                    borderColor: `var(--color-${tone}-soft)`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ background: `var(--color-${tone})` }}
                  />
                  {tone}
                </span>
                <p className="mt-2 text-[0.75rem] text-ink-faint">{job}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <div className="flex flex-col gap-4">
            {TYPE_STEPS.map(([className, label, sample]) => (
              <div key={className} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className={`${className} text-ink-strong`} translate="no">
                  {sample}
                </p>
                <span className="text-[0.75rem] text-ink-faint">
                  {label} · <code className="font-mono">{className}</code>
                </span>
              </div>
            ))}
            <p className="pt-2 text-[0.8125rem] text-ink-muted">
              One family: Inter Variable, 100–900. Digits in money and time columns use{' '}
              <code className="font-mono">.tabular</code> —{' '}
              <span className="tabular text-ink">₹4,820.00 · 14:05</span>.
            </p>
          </div>
        </Section>

        <Section title="Spacing — a single 4px scale">
          <div className="flex flex-wrap items-end gap-4">
            {(['1', '2', '3', '4', '5', '6', '8', '10', '12', '16'] as const).map((step) => (
              <div key={step} className="text-center">
                <div
                  className="mx-auto rounded-field bg-brand-soft ring-1 ring-brand-line"
                  style={{ width: `var(--space-${step})`, height: `var(--space-${step})` }}
                />
                <p className="mt-2 text-[0.6875rem] text-ink-faint">space-{step}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Radii">
          <div className="flex flex-wrap gap-4">
            {(['field', 'card', 'sheet', 'pill'] as const).map((name) => (
              <div key={name}>
                <div
                  className="h-16 w-16 border border-line-strong bg-surface"
                  style={{ borderRadius: `var(--radius-${name})` }}
                />
                <p className="mt-2 text-[0.75rem] text-ink-faint">
                  <code className="font-mono">rounded-{name}</code>
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Elevation">
          <div className="flex flex-wrap gap-4">
            <div className="w-52 rounded-card border border-line bg-surface p-4">
              <p className="text-label">Flat</p>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">
                <code className="font-mono">border border-line</code> — cards, rows, panels.
              </p>
            </div>
            <div className="w-52 rounded-card bg-surface p-4 shadow-overlay ring-1 ring-line">
              <p className="text-label">Overlay</p>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">
                <code className="font-mono">shadow-overlay</code> — floating layers only.
              </p>
            </div>
            <div className="w-52 rounded-card border border-line bg-surface p-4 ring-1 ring-brand-soft">
              <p className="text-label">Focus</p>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">
                <code className="font-mono">--shadow-focus</code> — applied globally to{' '}
                <code className="font-mono">:focus-visible</code>.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Gradients — three, each with a job">
          <div className="flex flex-wrap gap-4">
            <GradientTile
              className="bg-brand-gradient"
              token="brand-gradient"
              job="Primary button"
            />
            <GradientTile
              className="bg-brand-wash"
              token="brand-wash"
              job="Welcome / feature panel"
            />
            <GradientTile
              className="bg-paper-sheen"
              token="paper-sheen"
              job="Panel settling into the page"
            />
          </div>
        </Section>

        <Section title="Motion">
          <ul className="flex flex-wrap gap-4">
            {(
              [
                ['instant', '90ms', 'colour swaps'],
                ['fast', '140ms', 'hover, press'],
                ['base', '210ms', 'panel and route exits'],
                ['slow', '340ms', 'page enter, reveals'],
              ] as const
            ).map(([name, value, job]) => (
              <li key={name} className="w-44 rounded-card border border-line bg-surface p-4">
                <p className="text-label">duration-{name}</p>
                <p className="mt-1 text-metric tabular text-ink-strong">{value}</p>
                <p className="mt-1 text-[0.75rem] text-ink-muted">{job}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-[70ch] text-[0.875rem] text-ink-muted">
            Route changes use the View Transitions API with{' '}
            <code className="font-mono">nav-forward</code> /{' '}
            <code className="font-mono">nav-back</code> types, the app chrome is anchored out of the
            transition, and everything degrades to a fade under{' '}
            <code className="font-mono">prefers-reduced-motion</code>.
          </p>
        </Section>

        <Section title="Illustrations">
          <p className="max-w-[70ch] text-[0.875rem] text-ink-muted">
            Hand-drawn characters from Open Peeps, licensed CC0 and kept in{' '}
            <code className="font-mono">packages/ui/illustrations</code>. Use{' '}
            <code className="font-mono">&lt;Illo&gt;</code> — it reserves the slot so nothing
            reflows, and stays out of the accessibility tree unless you pass a{' '}
            <code className="font-mono">label</code>.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-h2 text-ink-strong">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Swatches({ tokens }: { tokens: readonly (readonly [string, string, string])[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {tokens.map(([cssName, name, utility]) => (
        <div key={cssName} className="sb-swatch">
          <div className="sb-swatch__chip" style={{ background: `var(--${cssName})` }} />
          <div className="sb-swatch__label">
            <p className="font-medium">{name}</p>
            <p className="text-ink-faint">
              <code className="font-mono">{utility}</code>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function GradientTile({
  className,
  token,
  job,
}: {
  className: string;
  token: string;
  job: string;
}) {
  return (
    <div className="w-48 overflow-hidden rounded-card border border-line">
      <div className={`h-20 ${className}`} />
      <div className="bg-surface p-3">
        <p className="text-label">{token}</p>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">{job}</p>
      </div>
    </div>
  );
}
