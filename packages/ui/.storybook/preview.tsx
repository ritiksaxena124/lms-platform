import type { Decorator } from '@storybook/react';
import type { Preview } from '@storybook/react-vite';

import '@fontsource-variable/inter/opsz.css';
import './tailwind.css';
import './preview.css';

declare module 'storybook/internal/types' {
  interface StorybookParameters {
    /** Which surface a story is framed on; `false` opts out entirely. */
    frame?: 'paper' | 'surface' | 'sunk' | false;
  }
}

/**
 * Every story is framed like a portal: the app background, not Storybook's
 * white canvas. `parameters.frame` picks which surface, and `false` opts out
 * for stories that bring their own layout.
 */
const withFrame: Decorator = (Story, context) => {
  const frame = context.parameters.frame ?? 'paper';
  const story = <Story />;

  if (frame === false) return story;

  return <div className={`sb-frame sb-frame--${frame}`}>{story}</div>;
};

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true, presetColor: 'background' },
    options: { storySort: { order: ['Design system', ['Primitives', 'Motion', 'Feedback']] } },
  },
  decorators: [withFrame],
};

export default preview;
