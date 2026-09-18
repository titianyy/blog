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

## Writing a post

Add a Markdown file to `src/content/blog/`. The filename becomes the URL slug.

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

| Command             | Does                                              |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Dev server at `http://localhost:4321/blog/`        |
| `npm run build`     | `astro check` then build into `dist/`              |
| `npm run build:fast`| Build only, skipping type checking                 |
| `npm run preview`   | Serve the built `dist/` — test the production output |

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
