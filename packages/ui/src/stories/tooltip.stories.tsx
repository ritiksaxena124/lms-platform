import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/Button';
import { InfoTip, Tooltip } from '../components/Tooltip';

const meta = {
  title: 'Components/Tooltip',
  parameters: {
    frame: 'surface',
    // A `top` bubble needs air above it, and a 19rem one needs air to either side. Pinned to the
    // corner of the frame the story would show half a sentence.
    layout: 'centered',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The base primitive: one focusable control, and the sentence that belongs to it. */
export const OnAButton: Story = {
  render: () => (
    <div className="py-20">
      <Tooltip content="Editing is locked while a course is on the shelf.">
        <Button type="button" variant="secondary">
          Unpublish
        </Button>
      </Tooltip>
    </div>
  ),
};

/** Hover, or Tab to the mark: the bubble answers to both, and Escape puts it away. */
export const InfoMarks: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4 py-20">
      <span className="flex items-center gap-1.5">
        Publish
        <InfoTip label="What Publish does">
          Puts the course on the shelf, lets a student take a place, and locks the form.
        </InfoTip>
      </span>
      <span className="flex items-center gap-1.5">
        Archive
        <InfoTip label="What Archive does">
          Ends the course for everybody, including the students who hold a place in it.
        </InfoTip>
      </span>
    </div>
  ),
};

/** Below the mark, for a control that sits against the top edge of its panel. */
export const Underneath: Story = {
  render: () => (
    <div className="flex items-center gap-1.5 py-20">
      Bring it back as a draft
      <InfoTip label="What bringing it back does" side="bottom">
        Returns the course to you as a draft, at the address it never lost.
      </InfoTip>
    </div>
  ),
};
