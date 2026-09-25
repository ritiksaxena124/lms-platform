import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Reveal } from './Reveal';
import { Stagger } from './Stagger';

describe('Reveal', () => {
  it('tags its child for the entrance animation and offsets it by position', () => {
    render(
      <Reveal index={3}>
        <p>Next session: Tuesday 6pm</p>
      </Reveal>,
    );

    const node = screen.getByText('Next session: Tuesday 6pm');
    expect(node).toHaveAttribute('data-reveal', '');
    expect(node).toHaveStyle({ '--reveal-delay': '108ms' });
  });

  it('leaves an explicit delay alone', () => {
    render(
      <Reveal delayMs={500}>
        <p>Slow burn</p>
      </Reveal>,
    );
    expect(screen.getByText('Slow burn')).toHaveStyle({ '--reveal-delay': '500ms' });
  });

  it('does not wrap the child in an extra element', () => {
    const { container } = render(
      <Reveal>
        <ul>
          <li>one</li>
        </ul>
      </Reveal>,
    );
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe('UL');
  });
});

describe('Stagger', () => {
  it('hands its children increasing reveal delays', () => {
    render(
      <Stagger as="div">
        <span>First</span>
        <span>Second</span>
        <span>Third</span>
      </Stagger>,
    );

    expect(screen.getByText('First')).toHaveStyle({ '--reveal-delay': '0ms' });
    expect(screen.getByText('Second')).toHaveStyle({ '--reveal-delay': '36ms' });
    expect(screen.getByText('Third')).toHaveStyle({ '--reveal-delay': '72ms' });
  });

  it('skips non-element slots without shifting the rhythm of the rest', () => {
    render(
      <Stagger as="div">
        <span>First</span>
        {null}
        <span>Second</span>
      </Stagger>,
    );
    expect(screen.getByText('Second')).toHaveStyle({ '--reveal-delay': '36ms' });
  });
});
