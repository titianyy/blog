import type { Post } from './posts';

export interface TagGroup {
  /** URL segment, e.g. "machine-learning". */
  slug: string;
  /** Display name as written in frontmatter, e.g. "Machine Learning". */
  name: string;
  posts: Post[];
}

export function slugifyTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/**
 * Groups posts by tag. Built from published posts only, so a tag that exists
 * solely on a draft never produces an empty page.
 */
export function buildTagIndex(posts: Post[]): TagGroup[] {
  const groups = new Map<string, TagGroup>();

  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = slugifyTag(tag);
      if (!slug) continue;

      let group = groups.get(slug);
      if (!group) {
        group = { slug, name: tag.trim(), posts: [] };
        groups.set(slug, group);
      }
      group.posts.push(post);
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
