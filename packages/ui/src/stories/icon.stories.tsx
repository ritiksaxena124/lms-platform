import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icon, ICON_NAMES, type IconName } from '../components/Icon';

const meta = {
  title: 'Components/Icon',
  component: Icon,
  args: { name: 'layers' },
  parameters: { frame: 'surface' },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every glyph at both sizes, so a portal picks a name rather than a guess. */
export const Set: Story = {
  render: () => (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ICON_NAMES.map((name: IconName) => (
        <li
          key={name}
          className="flex items-center gap-2.5 rounded-field border border-line bg-surface px-3 py-2.5"
        >
          <Icon name={name} />
          <span className="truncate font-mono text-[0.6875rem] text-ink-faint">{name}</span>
        </li>
      ))}
    </ul>
  ),
};

/**
 * The gestures only happen under a host, so this story is the honest preview:
 * hover a card and the mark inside it answers. `data-icon-zone` is the opt-in;
 * a link or button is a zone without being told.
 */
export const HoverGestures: Story = {
  parameters: { docs: { description: { story: 'Requires a pointer over the card.' } } },
  render: () => (
    <div className="flex flex-wrap gap-3">
      {ICON_NAMES.map((name: IconName) => (
        <div
          key={name}
          data-icon-zone
          className="flex cursor-default items-center gap-2.5 rounded-field border border-line bg-surface px-3.5 py-2.5 text-label text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-line-strong hover:text-ink"
        >
          <Icon name={name} />
          {name}
        </div>
      ))}
    </div>
  ),
};

/** Icons sit beside words, so they are shown there: body text and label text. */
export const InText: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-[0.9375rem] text-ink">
        <Icon {...args} name="lock" />
        The nth term of an arithmetic progression
      </p>
      <p className="flex items-center gap-2 text-label text-ink-muted">
        <Icon {...args} name="clock" size="sm" />
        12 min
      </p>
      <p className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
        <Icon {...args} name="user" size="sm" />
        Aditi Sharma
      </p>
    </div>
  ),
};

/** A glyph that carries a state the words do not is content, not decoration. */
export const Labelled: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Icon name="unlock" label="Free to read" />
      <Icon name="lock" label="Behind enrollment" />
    </div>
  ),
};
