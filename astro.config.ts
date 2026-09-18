import { defineConfig } from 'astro/config';

export default defineConfig({
  // User host. Pages for a project repo live under a subpath, so `site` stays
  // the bare origin and `base` carries the repo name.
  site: 'https://titianyy.github.io',
  base: '/blog',
  output: 'static',
  trailingSlash: 'always',
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      wrap: true,
    },
  },
});
