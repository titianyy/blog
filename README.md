# Titian's Notes

Personal blog. Astro + TypeScript, static output, deployed to GitHub Pages.

Live at **https://titianyy.github.io/blog/**

## Stack

- [Astro](https://astro.build) 7 with TypeScript in `strict` mode
- Content collections for posts, validated by a Zod schema
- Plain CSS with custom-property design tokens — no CSS framework
- Deployed by GitHub Actions (`.github/workflows/deploy.yml`)

## Layout

```
astro.config.ts            site, base path, Shiki dual-theme config
src/content.config.ts      blog collection schema — the source of every post type
src/content/blog/*.md      posts, one file each
src/utils/url.ts           withBase() — the single place base paths are applied
src/utils/posts.ts         published posts, newest first
src/utils/tags.ts          tag slugging and grouping
src/layouts/               BaseLayout (document shell), PostLayout (article)
src/components/            SiteHeader, SiteFooter, PostList
src/pages/                 index, posts/[...id], tags/index, tags/[tag], 404
src/styles/global.css      design tokens and all component styles
```

## Writing a post — the editor

```bash
npm run write
```

Opens a writing tool at http://localhost:4322. Write Markdown on the left, see
it styled as it will appear on the right, press **Publish**.

The editor owns frontmatter entirely, so there is no YAML to write and no git
commands to run.

- **Preview** loads the blog's real `src/styles/global.css`, so type, spacing
  and dark mode match the live site. Code blocks show without syntax colour —
  that happens in the site's build, not in the browser.
- **Autosave** writes your work to `src/content/blog/<slug>.md` with
  `draft: true` about a second after you stop typing. It does not commit, and
  the build already excludes drafts, so an unfinished post cannot go live.
- **Publish** writes the post, runs the site build, and only then commits and
  pushes to `main`. GitHub Actions takes it live about a minute later.

Publishing fails loudly rather than quietly:

| Situation | What happens |
| --- | --- |
| You are not on `main` | Refuses. Pushing a feature branch would look like it worked while deploying nothing. |
| The build fails | Reports the error, commits nothing. Your file stays on disk to fix in place. |
| The slug is taken | Refuses rather than overwriting a different post. |
| The push is rejected | Says so. The commit stays on your machine — nothing is forced. |

Editing a post that is already published adds an `updatedDate` and commits as
`Update: <title>` instead of `Publish: <title>`.

The tool lives in `tools/editor/`. It is separate from the site build on
purpose: it cannot ship itself to the public site, and the site does not need to
know it exists.

## Writing a post by hand

Still works, and is what the editor writes on your behalf. Add a Markdown file
to `src/content/blog/`. The filename becomes the URL slug.

```markdown
---
title: Post title
description: One-line subtitle shown in the post list.
pubDate: 2026-09-18
tags: ['Machine Learning']
draft: false
---

Body text.
```

| Field         | Required | Notes                                       |
| ------------- | -------- | ------------------------------------------- |
| `title`       | yes      | Post heading                                |
| `description` | yes      | Subtitle in the list; also the meta description |
| `pubDate`     | yes      | Sort key — listings are newest first        |
| `updatedDate` | no       | Renders a second line under the date        |
| `tags`        | no       | Drives `/tags/` and the tag links           |
| `draft`       | no       | `true` hides the post from production builds |

Drafts stay visible under `npm run dev` and are excluded from `npm run build`.

## Commands

| Command              | Does                                                 |
| -------------------- | ---------------------------------------------------- |
| `npm run write`      | Writing tool at `http://localhost:4322/`              |
| `npm run test`       | Unit tests for the editor's parsing and slug logic    |
| `npm run dev`        | Dev server at `http://localhost:4321/blog/`           |
| `npm run build`      | `astro check` then build into `dist/`                 |
| `npm run build:fast` | Build only, skipping type checking                    |
| `npm run preview`    | Serve the built `dist/` — test the production output  |

If port 4322 is busy: `PORT=4323 npm run write`.

## The base path

The site is a GitHub Pages **project page**, so it is served from `/blog/`, not
from the domain root. `astro.config.ts` sets `base: '/blog'`.

Rules that follow from that:

- **Every link and asset in an `.astro` file must go through `withBase()`**
  from `src/utils/url.ts`. A literal `href="/tags/"` resolves to the domain
  root and 404s.
- **Links inside Markdown must be relative**, e.g. `../style-showcase/`, never
  leading-slash absolute. Markdown cannot call `withBase()`.
- `npm run dev` serves at `/blog/` too, and `/` correctly 404s. That is
  expected, not a bug.

Dev mode will not catch a bad root-absolute link, because it serves whatever
you wrote. To actually verify, build and grep the output:

```bash
npm run build
grep -rhoE '(href|src)="/[^"]*"' dist --include='*.html' | sort -u
```

Every result must start with `/blog/`. Anything else is a broken link.

## Dark mode

`BaseLayout.astro` carries a small `is:inline` script in `<head>` that reads the
stored theme and sets `data-theme` on `<html>` before first paint. Keep it
`is:inline` — Astro would otherwise emit it as a deferred module, which runs
after paint and produces a visible flash of the wrong theme. The click handler
in `SiteHeader.astro` is a normal bundled script; it has no such deadline.

An explicit choice is stored in `localStorage` and always overrides
`prefers-color-scheme`, in both directions.

## Deployment

Pushing to `main` triggers the workflow. Pages must be configured with
**Source: GitHub Actions** (not the legacy branch builder):

```bash
gh api -X POST repos/titianyy/blog/pages -f build_type=workflow
```

Note that `titianyy/titianyy.github.io` is a separate Jekyll site that owns the
domain root at https://titianyy.github.io/. This repo is independent — do not
rename it, and do not add a `CNAME` file here.
