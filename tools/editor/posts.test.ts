import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveSlug,
  formatDateOnly,
  isValidSlug,
  parsePost,
  serializePost,
  slugify,
  type PostFile,
} from './posts.ts';

test('slugify turns a title into a URL segment', () => {
  assert.equal(slugify('Hello, world'), 'hello-world');
  assert.equal(slugify('Style  Showcase!'), 'style-showcase');
  assert.equal(slugify('  Trailing and leading  '), 'trailing-and-leading');
  // The apostrophe is dropped, not turned into a separator.
  assert.equal(slugify("Titian's Notes"), 'titians-notes');
  assert.equal(slugify('Ünïcödé and E18'), 'unicode-and-e18');
  assert.equal(slugify('a/b?c#d'), 'a-b-c-d');
});

test('slugify does not end on a hyphen after truncating', () => {
  const slug = slugify('x'.repeat(70) + ' ' + 'y'.repeat(30));
  assert.ok(slug.length <= 80);
  assert.ok(!slug.endsWith('-'), `slug ended with a hyphen: ${slug}`);
});

test('deriveSlug falls back for titles with no latin characters', () => {
  assert.equal(slugify('测试'), '');
  const slug = deriveSlug('测试', new Date('2026-09-18T00:00:00Z'));
  assert.match(slug, /^post-2026-09-18-[a-z0-9]+$/);
});

test('deriveSlug prefers the readable slug when there is one', () => {
  assert.equal(deriveSlug('A Good Title'), 'a-good-title');
});

test('isValidSlug rejects anything that could escape the content directory', () => {
  assert.ok(isValidSlug('hello-world'));
  assert.ok(isValidSlug('a1'));
  assert.ok(!isValidSlug('../secrets'));
  assert.ok(!isValidSlug('..'));
  assert.ok(!isValidSlug('/etc/passwd'));
  assert.ok(!isValidSlug('Upper-Case'));
  assert.ok(!isValidSlug('has space'));
  assert.ok(!isValidSlug('-leading-hyphen'));
  assert.ok(!isValidSlug('x'.repeat(81)));
});

test('formatDateOnly is UTC, so a date never shifts by a day', () => {
  assert.equal(formatDateOnly(new Date('2026-09-18T00:00:00Z')), '2026-09-18');
  assert.equal(formatDateOnly(new Date('2026-01-01T00:00:00Z')), '2026-01-01');
});

test('parsePost reads the frontmatter shape the site uses', () => {
  const post = parsePost(
    ['---', 'title: Hello, world', 'description: Why this exists.', 'pubDate: 2026-09-14',
     "tags: ['Meta', 'Reference']", 'draft: false', '---', '', 'Body text here.', ''].join('\n'),
  );

  assert.equal(post.data.title, 'Hello, world');
  assert.equal(post.data.description, 'Why this exists.');
  assert.equal(formatDateOnly(post.data.pubDate), '2026-09-14');
  assert.deepEqual(post.data.tags, ['Meta', 'Reference']);
  assert.equal(post.data.draft, false);
  assert.equal(post.body.trim(), 'Body text here.');
});

test('parsePost defaults tags and draft when they are absent', () => {
  const post = parsePost('---\ntitle: T\ndescription: D\npubDate: 2026-01-02\n---\n\nBody\n');
  assert.deepEqual(post.data.tags, []);
  assert.equal(post.data.draft, false);
  assert.equal(post.data.updatedDate, undefined);
});

test('parsePost rejects files it cannot trust', () => {
  assert.throws(() => parsePost('no frontmatter at all'), /frontmatter/i);
  assert.throws(() => parsePost('---\ndescription: D\n---\n\nx\n'), /title/);
  assert.throws(() => parsePost('---\ntitle: T\n---\n\nx\n'), /description/);
  assert.throws(() => parsePost('---\ntitle: T\ndescription: D\npubDate: not-a-date\n---\n\nx\n'), /date/i);
  assert.throws(
    () => parsePost('---\ntitle: T\ndescription: D\npubDate: 2026-01-01\ntags: nope\n---\n\nx\n'),
    /tags/,
  );
});

test('serialize then parse returns the same post', () => {
  const original: PostFile = {
    data: {
      title: 'Round trip',
      description: 'Survives a save and a reload.',
      pubDate: new Date('2026-09-18T00:00:00Z'),
      tags: ['Meta', 'Reference'],
      draft: true,
    },
    body: '## Heading\n\nSome *text* and `code`.\n',
  };

  assert.deepEqual(parsePost(serializePost(original)), original);
});

test('serializePost keeps tags inline and key order stable', () => {
  const text = serializePost({
    data: {
      title: 'Ordering',
      description: 'Keys stay put.',
      pubDate: new Date('2026-09-18T00:00:00Z'),
      tags: ['Meta'],
      draft: false,
    },
    body: 'Body.\n',
  });

  assert.match(text, /^---\ntitle: Ordering\n/);
  assert.match(text, /\ntags: \[Meta\]\n/);
  assert.match(text, /\ndraft: false\n---\n\nBody\.\n$/);
  // Stable output means repeated saves produce no spurious diff.
  assert.equal(text, serializePost(parsePost(text)));
});

test('serializePost omits tags when there are none', () => {
  const text = serializePost({
    data: {
      title: 'No tags',
      description: 'D',
      pubDate: new Date('2026-09-18T00:00:00Z'),
      tags: [],
      draft: true,
    },
    body: 'Body.\n',
  });

  assert.ok(!text.includes('tags:'));
  assert.match(text, /draft: true/);
});

test('serializePost quotes a value that would otherwise break YAML', () => {
  const text = serializePost({
    data: {
      title: 'Colon: a value with "quotes"',
      description: 'D',
      pubDate: new Date('2026-09-18T00:00:00Z'),
      tags: [],
      draft: false,
    },
    body: 'Body.\n',
  });

  assert.equal(parsePost(text).data.title, 'Colon: a value with "quotes"');
});

test('updatedDate survives the round trip when present', () => {
  const text = serializePost({
    data: {
      title: 'Updated',
      description: 'D',
      pubDate: new Date('2026-09-01T00:00:00Z'),
      updatedDate: new Date('2026-09-18T00:00:00Z'),
      tags: [],
      draft: false,
    },
    body: 'Body.\n',
  });

  assert.match(text, /updatedDate: 2026-09-18/);
  assert.equal(formatDateOnly(parsePost(text).data.updatedDate!), '2026-09-18');
});
