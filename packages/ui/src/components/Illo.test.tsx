import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Illo } from './Illo';

describe('Illo', () => {
  it('stays out of the accessibility tree — the surrounding text carries the meaning', () => {
    const { container } = render(<Illo src="/illustrations/peep-sitting-01.svg" />);
    const figure = container.firstElementChild as HTMLElement;
    const img = figure.querySelector('img');

    expect(figure).toHaveAttribute('aria-hidden', 'true');
    expect(img).toHaveAttribute('alt', '');
  });

  it('keeps its slot reserved while the artwork loads, so nothing jumps', () => {
    const { container } = render(
      <Illo src="/illustrations/peep-sitting-01.svg" size="md" className="mt-4" />,
    );
    const figure = container.firstElementChild as HTMLElement;

    expect(figure).toHaveClass('mt-4');
    expect(figure).toHaveClass('h-36');
  });

  it('lets a caller name the artwork when it does say something', () => {
    const { container } = render(
      <Illo src="/illustrations/peep-standing-01.svg" label="A teacher greeting a student" />,
    );
    const img = container.querySelector('img');

    expect(container.firstElementChild).not.toHaveAttribute('aria-hidden');
    expect(img).toHaveAttribute('alt', 'A teacher greeting a student');
  });
});
