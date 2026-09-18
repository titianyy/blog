import yaml from 'js-yaml';

/**
 * Pure post parsing, serialising and slug logic. No filesystem, no network —
 * so these are the parts worth testing directly.
 */

export interface PostData {
  title: string;
  description: string;
  pubDate: Date;
  updatedDate?: Date;
  tags: string[];
  draft: boolean;
}

export interface PostFile {
  data: PostData;
  body: string;
}

/** Matches a leading `---\n...\n---` block. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/** YYYY-MM-DD in UTC, so a date never shifts by a day across timezones. */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/**
 * Slug for a new post. Titles with no latin characters (or no characters at
 * all) slug to an empty string, so fall back to something unique rather than
 * refusing to save what someone just wrote.
 */
export function deriveSlug(title: string, now: Date = new Date()): string {
  const slug = slugify(title);
  if (slug) return slug;
  return `post-${formatDateOnly(now)}-${now.getTime().toString(36).slice(-4)}`;
}

/** Rejects anything that could escape the content directory. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Frontmatter field "${field}" must be a string`);
  }
  return value;
}

function asDate(value: unknown, field: string): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }
  throw new Error(`Frontmatter field "${field}" is not a valid date`);
}

export function parsePost(raw: string): PostFile {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    throw new Error('File has no YAML frontmatter block');
  }

  const loaded = yaml.load(match[1]);
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    throw new Error('Frontmatter is not a YAML mapping');
  }
  const front = loaded as Record<string, unknown>;

  const rawTags = front.tags ?? [];
  if (!Array.isArray(rawTags)) {
    throw new Error('Frontmatter field "tags" must be a list');
  }

  return {
    data: {
      title: asString(front.title, 'title'),
      description: asString(front.description, 'description'),
      pubDate: asDate(front.pubDate, 'pubDate'),
      ...(front.updatedDate !== undefined
        ? { updatedDate: asDate(front.updatedDate, 'updatedDate') }
        : {}),
      tags: rawTags.map((tag) => String(tag).trim()).filter(Boolean),
      draft: front.draft === true,
    },
    body: raw.slice(match[0].length).replace(/^\n+/, ''),
  };
}

/**
 * Emits frontmatter in a fixed key order so repeated saves produce stable
 * diffs. `tags` is forced to flow style to match how posts are written by hand.
 */
export function serializePost(post: PostFile): string {
  const front: Record<string, unknown> = {
    title: post.data.title,
    description: post.data.description,
    pubDate: formatDateOnly(post.data.pubDate),
  };

  if (post.data.updatedDate) {
    front.updatedDate = formatDateOnly(post.data.updatedDate);
  }
  if (post.data.tags.length > 0) {
    front.tags = post.data.tags;
  }
  front.draft = post.data.draft;

  const yamlText = yaml.dump(front, {
    lineWidth: -1,
    flowLevel: 1,
    quotingType: '"',
  })
    // js-yaml quotes date-like strings to stop other YAML parsers coercing
    // them. Both this tool and the site's schema read a bare YYYY-MM-DD fine,
    // and posts are written by hand in that style — so unquote to match.
    .replace(/^(pubDate|updatedDate): "(\d{4}-\d{2}-\d{2})"$/gm, '$1: $2');

  return `---\n${yamlText}---\n\n${post.body.replace(/^\n+/, '').replace(/\s*$/, '')}\n`;
}
