---
title: Style showcase
description: Every element the site can render, on one page.
pubDate: 2026-09-18
tags: ['Meta', 'Reference']
---

This post exists so every style has somewhere to be checked. Delete it when it
stops being useful.

## Headings

### Third level

#### Fourth level

## Text

Body text sits in a narrow column with generous line height. Links look like
[this one](https://astro.build), and `inline code` gets a light background.
Emphasis is *italic*, and strong is **bold**.

> A blockquote gets a left rule in the accent colour and drops to a muted
> grey, so it reads as an aside rather than as more body text.

## Lists

Unordered:

- Content lives as Markdown in `src/content/blog/`
- The schema in `src/content.config.ts` validates every frontmatter field
- Tag pages are generated from those tags at build time

Ordered:

1. Add a `.md` file with frontmatter.
2. Commit and push.
3. GitHub Actions builds and deploys.

## Code

Inline `const x = 1` and a fenced block:

```ts
interface Post {
  title: string;
  pubDate: Date;
  tags: string[];
}

export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => data.draft !== true);
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
```

A shell block, to check a second language:

```bash
npm run build
npm run preview
```

## Table

| Field         | Required | Purpose                        |
| ------------- | -------- | ------------------------------ |
| `title`       | yes      | Post heading                   |
| `description` | yes      | One-line subtitle in the list  |
| `pubDate`     | yes      | Sort key                       |
| `tags`        | no       | Drives the tag pages           |
| `draft`       | no       | Hidden from production builds  |

## Image

![Placeholder diagram showing the build pipeline](sample-diagram.png)
