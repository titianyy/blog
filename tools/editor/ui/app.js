import { marked } from '/vendor/marked.js';

const $ = (id) => document.getElementById(id);

const el = {
  status: $('status'),
  publish: $('publish'),
  newPost: $('new'),
  posts: $('posts'),
  title: $('title'),
  description: $('description'),
  slug: $('slug'),
  pubDate: $('pubDate'),
  tags: $('tags'),
  body: $('body'),
  notice: $('notice'),
  detail: $('detail'),
  preview: $('preview'),
  theme: $('theme'),
};

/** Mirrors slugify() in ../posts.ts. Kept in step by the same rules. */
function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

const state = {
  /** Slug of the open post, or null when writing a new one. */
  slug: null,
  /** Once a post has been saved its URL is fixed. */
  slugLocked: false,
  published: false,
  dirty: false,
  previewReady: false,
};

marked.setOptions({ gfm: true, breaks: false });

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

const PREVIEW_DOC = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="/blog.css" />
<style>
  body { margin: 0; padding: 32px 36px 96px; }
  #root { max-width: 42rem; margin-inline: auto; }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body><article class="prose" id="root"></article></body>
</html>`;

el.preview.addEventListener('load', () => {
  state.previewReady = true;
  renderPreview();
});

el.preview.srcdoc = PREVIEW_DOC;

function renderPreview() {
  if (!state.previewReady) return;
  const doc = el.preview.contentDocument;
  const root = doc?.getElementById('root');
  if (!root) return;

  const template = doc.createElement('template');
  template.innerHTML = marked.parse(el.body.value || '');

  // A relative image resolves against the post's URL on the live site (where
  // the build has already copied it). Point it at the content directory so it
  // renders here too.
  for (const img of template.content.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/')) {
      img.setAttribute('src', `/content/${src.replace(/^\.\//, '')}`);
    }
  }

  root.replaceChildren(...template.content.childNodes);
  // The blog's stylesheet keys dark mode off a data-theme attribute.
  doc.documentElement.dataset.theme = state.theme ?? 'light';
}

el.theme.addEventListener('click', () => {
  state.theme = (state.theme ?? 'light') === 'light' ? 'dark' : 'light';
  renderPreview();
});

// ---------------------------------------------------------------------------
// Status and notices
// ---------------------------------------------------------------------------

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

function showNotice(text) {
  el.notice.textContent = text ?? '';
  el.notice.hidden = !text;
}

function showDetail(text) {
  el.detail.textContent = text ?? '';
  el.detail.hidden = !text;
}

/** The one mistake that builds cleanly and 404s once deployed. */
function checkLinks() {
  const bad = [...el.body.value.matchAll(/\]\((\/[^)]*)\)/g)].map((m) => m[1]);
  if (bad.length > 0) {
    showNotice(
      `Root-absolute link${bad.length > 1 ? 's' : ''} will 404 on the live site: ` +
        `${bad.join(', ')} — use a relative path instead, or withBase() if it is in a page.`,
    );
  } else {
    showNotice('');
  }
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function resetForm() {
  state.slug = null;
  state.slugLocked = false;
  state.published = false;
  state.dirty = false;

  el.title.value = '';
  el.description.value = '';
  el.slug.value = '';
  el.pubDate.value = today();
  el.tags.value = '';
  el.body.value = '';

  el.slug.readOnly = false;
  el.publish.disabled = false;
  showNotice('');
  showDetail('');
  renderPreview();
  renderPostList();
  setStatus('New post — add a title to start saving');
  el.title.focus();
}

async function openPost(slug) {
  const response = await fetch(`/api/posts/${encodeURIComponent(slug)}`);
  const post = await response.json();
  if (!response.ok) {
    setStatus(post.error ?? 'Could not open that post', 'error');
    return;
  }

  state.slug = slug;
  state.slugLocked = true;
  state.published = !post.draft;
  state.dirty = false;

  el.title.value = post.title;
  el.description.value = post.description;
  el.slug.value = slug;
  el.pubDate.value = post.pubDate;
  el.tags.value = (post.tags ?? []).join(', ');
  el.body.value = post.body;

  el.slug.readOnly = true;
  el.publish.disabled = false;
  showDetail('');

  renderPreview();
  checkLinks();
  renderPostList();
  setStatus(post.draft ? 'Draft' : 'Published');
}

function readForm() {
  return {
    title: el.title.value.trim(),
    description: el.description.value.trim(),
    pubDate: el.pubDate.value,
    tags: el.tags.value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    body: el.body.value,
  };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function schedule(fn, ms) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

const autosave = schedule(async () => {
  const form = readForm();
  if (!form.title) {
    setStatus('Add a title to start saving');
    return;
  }
  if (!state.slug) {
    setStatus('Add a slug to start saving');
    return;
  }

  setStatus('Saving…', 'busy');
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(state.slug)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error ?? 'Save failed', 'error');
      showDetail(result.detail ?? '');
      return;
    }
    state.dirty = false;
    setStatus(
      result.draft
        ? `Draft saved ${new Date().toLocaleTimeString()}`
        : `Saved ${new Date().toLocaleTimeString()}`,
    );
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, 'error');
  }
}, 1000);

const updatePreview = schedule(() => {
  renderPreview();
  checkLinks();
}, 200);

function onEdit({ fromTitle = false } = {}) {
  state.dirty = true;

  if (fromTitle && !state.slugLocked) {
    el.slug.value = slugify(el.title.value);
  }
  // A new post adopts the slug it just generated as soon as it is valid.
  if (!state.slugLocked && el.slug.value) {
    state.slug = el.slug.value;
  }

  updatePreview();
  autosave();
}

for (const field of [el.description, el.slug, el.pubDate, el.tags, el.body]) {
  field.addEventListener('input', () => onEdit());
}
el.title.addEventListener('input', () => onEdit({ fromTitle: true }));
el.slug.addEventListener('input', () => {
  state.slug = el.slug.value.trim();
});

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

el.publish.addEventListener('click', async () => {
  const form = readForm();
  showDetail('');

  if (!form.title || !form.description) {
    setStatus('A title and a subtitle are both required', 'error');
    return;
  }

  const slug = (el.slug.value || slugify(form.title)).trim();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
    setStatus('Slug may only contain lowercase letters, numbers and hyphens', 'error');
    return;
  }

  el.publish.disabled = true;
  setStatus('Building and pushing… this takes a few seconds', 'busy');

  try {
    const response = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, slug }),
    });
    const result = await response.json();

    if (!response.ok) {
      setStatus(result.error ?? 'Publish failed', 'error');
      showDetail(result.detail ?? '');
      return;
    }

    state.slug = slug;
    state.slugLocked = true;
    state.published = true;
    el.slug.value = slug;
    el.slug.readOnly = true;

    setStatus(`Published ${result.sha} — live in about a minute`);
    await refreshPosts();
    renderPostList();
  } catch (error) {
    setStatus(`Publish failed: ${error.message}`, 'error');
  } finally {
    el.publish.disabled = false;
  }
});

el.newPost.addEventListener('click', resetForm);

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

let posts = [];

async function refreshPosts() {
  const response = await fetch('/api/posts');
  const result = await response.json();
  posts = result.posts ?? [];
  renderPostList();
}

function renderPostList() {
  el.posts.replaceChildren();

  for (const post of posts) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(post.slug === state.slug));

    const title = document.createElement('span');
    title.className = 'post-title';
    title.textContent = post.title;

    const meta = document.createElement('span');
    meta.className = 'post-meta';
    meta.textContent = post.pubDate || '';

    if (post.draft) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'draft';
      meta.append(' ', badge);
    }

    button.append(title, meta);
    button.addEventListener('click', () => openPost(post.slug));
    item.append(button);
    el.posts.append(item);
  }

  if (posts.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'post-meta';
    empty.textContent = 'No posts yet.';
    el.posts.append(empty);
  }
}

// Warn before losing unsaved edits.
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) event.preventDefault();
});

resetForm();
refreshPosts();
