import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/**
 * Published posts, newest first. Every listing page funnels through here so
 * ordering and draft filtering cannot drift between routes.
 */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) =>
    // Drafts stay visible in `astro dev`, but never reach a real build.
    import.meta.env.PROD ? data.draft !== true : true,
  );

  // Collection order is not guaranteed, so sort explicitly.
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
