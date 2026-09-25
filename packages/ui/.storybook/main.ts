import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

/* `@tailwindcss/vite` returns an *array* of plugins (scan, serve, build).
 * Spreading it into an object collapses the three into one invalid plugin and
 * Tailwind silently stops compiling. */
const tailwindPlugins = tailwindcss();

/**
 * Storybook is the maintenance surface for `@lms/ui`: another developer should
 * be able to see every state of every primitive without booting a portal.
 *
 * No `transpilePackages` equivalent is needed — the package ships raw TS source
 * and `@storybook/react-vite` compiles it directly.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // Served at `/illustrations/<name>.svg`, the same root-relative path the
  // portals use once the assets are copied into their `public/` folder.
  staticDirs: [{ from: '../illustrations', to: '/illustrations' }],
  framework: { name: '@storybook/react-vite', options: {} },
  docs: {},

  /**
   * `.storybook/main.ts` is itself a preset, so this hook is certain to run —
   * the one place the Tailwind plugin is registered. A sibling `vite.config.ts`
   * was silently ignored here (with and without `viteConfigPath`), and the
   * failure was invisible: stories render, nothing is styled.
   */
  async viteFinal(viteConfig) {
    const plugins = viteConfig.plugins ?? [];
    const hasTailwind = plugins.some((plugin) =>
      (plugin as { name?: string })?.name?.startsWith('@tailwindcss/vite'),
    );
    if (!hasTailwind) plugins.push(...tailwindPlugins);
    return {
      ...viteConfig,
      plugins: [react(), ...plugins],
      resolve: { ...viteConfig.resolve, dedupe: ['react', 'react-dom'] },
    };
  },
};

export default config;
