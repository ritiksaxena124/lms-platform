import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { InfoTip, Tooltip } from './Tooltip';

/**
 * The bubble's text is always in the document — that is what lets a screen reader hear it from the
 * trigger without a pointer — so every "not shown here" assertion in this file is about `data-open`,
 * which is the one attribute the stylesheet paints against.
 */
function bubble() {
  return screen.getByRole('tooltip');
}

describe('Tooltip', () => {
  it('stays shut until the pointer or the keyboard asks', () => {
    render(
      <Tooltip content="Ends the course for everybody, including the students inside it.">
        <button type="button">Archive</button>
      </Tooltip>,
    );

    expect(bubble()).not.toHaveAttribute('data-open');
  });

  it('opens on hover and shuts when the pointer leaves', () => {
    render(
      <Tooltip content="Ends the course for everybody.">
        <button type="button">Archive</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Archive' }));
    expect(bubble()).toHaveAttribute('data-open', 'true');

    fireEvent.mouseLeave(screen.getByRole('button', { name: 'Archive' }));
    expect(bubble()).not.toHaveAttribute('data-open');
  });

  it('opens on keyboard focus, because a hover-only explanation is no explanation at all', async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <Tooltip content="Editing is locked while a course is on the shelf.">
        <button type="button">Unpublish</button>
      </Tooltip>,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Unpublish' })).toHaveFocus();
    expect(bubble()).toHaveAttribute('data-open', 'true');

    await user.tab();
    expect(bubble()).not.toHaveAttribute('data-open');
  });

  it('lets Escape close it, since a bubble that follows the caret across a form cannot be dismissed', () => {
    render(
      <Tooltip content="Anybody can find it.">
        <button type="button">Publish</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Publish' }), { key: 'Escape' });

    expect(bubble()).not.toHaveAttribute('data-open');
  });

  it('hangs the sentence on the focusable control rather than on the box around it', () => {
    render(
      <Tooltip content="Ends the course for everybody.">
        <button type="button">Archive</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Archive' });
    expect(trigger).toHaveAttribute('aria-describedby', bubble().getAttribute('id'));
    expect(bubble().id).toBeTruthy();
  });

  it('cannot swallow a click on the row behind it while shut', () => {
    render(
      <Tooltip content="A second click is one event.">
        <button type="button">Publish</button>
      </Tooltip>,
    );

    expect(bubble()).toHaveClass('pointer-events-none');

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Publish' }));
    expect(bubble()).not.toHaveClass('pointer-events-none');
  });
});

describe('InfoTip', () => {
  it('is a small mark with a name, not a mystery glyph', () => {
    render(<InfoTip label="What Archive does">Ends the course for everybody.</InfoTip>);

    const trigger = screen.getByRole('button', { name: 'What Archive does' });
    const mark = trigger.querySelector('svg');

    // Lucide, at the kit's one stroke weight and one step below the body size.
    expect(mark).toHaveClass('lucide-info');
    expect(mark).toHaveAttribute('stroke-width', '1.5');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', bubble().getAttribute('id'));
  });

  it('reveals its sentence to the keyboard as readily as to the mouse', async () => {
    const user = userEvent.setup({ delay: null });

    render(<InfoTip label="What Archive does">Ends the course for everybody.</InfoTip>);

    await user.tab();
    expect(screen.getByRole('button', { name: 'What Archive does' })).toHaveFocus();
    expect(bubble()).toHaveAttribute('data-open', 'true');
    expect(bubble()).toHaveTextContent('Ends the course for everybody.');
  });

  it('is a button that does nothing on its own, so a tap cannot be mistaken for the action', () => {
    render(<InfoTip label="What Archive does">Ends the course for everybody.</InfoTip>);

    expect(screen.getByRole('button', { name: 'What Archive does' })).toHaveAttribute(
      'type',
      'button',
    );
  });
});
