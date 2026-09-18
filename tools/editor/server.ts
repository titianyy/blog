import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveSlug,
  formatDateOnly,
  isValidSlug,
  parsePost,
  serializePost,
  type PostFile,
} from './posts.ts';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CONTENT_DIR = path.join(ROOT, 'src/content/blog');
const UI_DIR = path.join(HERE, 'ui');
const BLOG_CSS = path.join(ROOT, 'src/styles/global.css');
const MARKED = path.join(ROOT, 'node_modules/marked/lib/marked.esm.js');

const PORT = Number(process.env.PORT ?? 4322);

/** Nothing in this tool may run a history-rewriting git command. */
const GIT_ALLOWED = new Set([
  'add',
  'commit',
  'push',
  'status',
  'diff',
  'log',
  'rev-parse',
]);

/**
 * Publishing means "go live", and the live site builds from `main`. Pushing
 * whatever branch happens to be checked out would look like it worked while
 * nothing deployed, and pushing HEAD into main from a feature branch would
 * carry unrelated commits along with it. So require main and say so plainly.
 */
const PUBLISH_BRANCH = 'main';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

function contentTypeFor(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Generous, but bounded: a runaway client should not exhaust memory.
    if (size > 5_000_000) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid JSON body: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Post storage
// ---------------------------------------------------------------------------

function postPath(slug: string): string {
  if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
  const file = path.join(CONTENT_DIR, `${slug}.md`);
  // Belt and braces: the slug regex already forbids separators.
  if (path.dirname(file) !== CONTENT_DIR) throw new Error('Slug escapes content dir');
  return file;
}

async function listPosts(): Promise<unknown[]> {
  const entries = await readdir(CONTENT_DIR, { withFileTypes: true });
  const posts: unknown[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const slug = entry.name.replace(/\.md$/, '');
    try {
      const post = parsePost(await readFile(path.join(CONTENT_DIR, entry.name), 'utf8'));
      posts.push({
        slug,
        title: post.data.title,
        description: post.data.description,
        pubDate: formatDateOnly(post.data.pubDate),
        tags: post.data.tags,
        draft: post.data.draft,
      });
    } catch (error) {
      // One malformed file must not blank the whole sidebar.
      posts.push({ slug, title: slug, description: '', pubDate: '', tags: [], draft: true,
        error: (error as Error).message });
    }
  }

  posts.sort((a, b) =>
    String((b as { pubDate: string }).pubDate).localeCompare(
      String((a as { pubDate: string }).pubDate),
    ),
  );
  return posts;
}

/** Fields the editor is allowed to set. Everything else keeps its old value. */
function postFromInput(
  input: Record<string, unknown>,
  existing: PostFile | null,
  draft: boolean,
): PostFile {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new Error('Title cannot be empty');

  const description =
    typeof input.description === 'string' ? input.description.trim() : '';
  if (!description) throw new Error('Subtitle cannot be empty');

  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : existing?.data.tags ?? [];

  const rawDate = typeof input.pubDate === 'string' ? input.pubDate : '';
  const pubDate = rawDate ? new Date(`${rawDate}T00:00:00Z`) : existing?.data.pubDate ?? new Date();
  if (Number.isNaN(pubDate.valueOf())) throw new Error('Publish date is not a valid date');

  // Editing a published post should record that it moved, not silently rewrite
  // its original date.
  const updatedDate =
    existing && !existing.data.draft
      ? new Date(`${formatDateOnly(new Date())}T00:00:00Z`)
      : existing?.data.updatedDate;

  return {
    data: {
      title,
      description,
      pubDate,
      ...(updatedDate ? { updatedDate } : {}),
      tags,
      draft,
    },
    body: typeof input.body === 'string' ? input.body : '',
  };
}

async function loadExisting(slug: string): Promise<PostFile | null> {
  const file = postPath(slug);
  if (!existsSync(file)) return null;
  return parsePost(await readFile(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

async function git(args: string[]): Promise<string> {
  if (!GIT_ALLOWED.has(args[0] ?? '')) {
    throw new Error(`Refusing to run git ${args[0]} — not on the allowed list`);
  }
  const { stdout } = await execFileAsync('git', args, { cwd: ROOT, timeout: 60_000 });
  return stdout.trim();
}

async function runBuild(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('npm', ['run', 'build:fast'], {
      cwd: ROOT,
      timeout: 240_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    return {
      ok: false,
      output: `${failure.stdout ?? ''}\n${failure.stderr ?? failure.message}`.trim(),
    };
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const route = url.pathname;
  const method = req.method ?? 'GET';

  // --- static assets -------------------------------------------------------
  if (method === 'GET' && !route.startsWith('/api/')) {
    const assets: Record<string, [string, string]> = {
      '/': [path.join(UI_DIR, 'index.html'), 'text/html; charset=utf-8'],
      '/app.js': [path.join(UI_DIR, 'app.js'), 'text/javascript; charset=utf-8'],
      '/style.css': [path.join(UI_DIR, 'style.css'), 'text/css; charset=utf-8'],
      // The preview pane uses the blog's real stylesheet, so what you see here
      // is what the site renders.
      '/blog.css': [BLOG_CSS, 'text/css; charset=utf-8'],
      '/vendor/marked.js': [MARKED, 'text/javascript; charset=utf-8'],
    };

    // Images sitting next to a post resolve against the post's URL on the
    // live site, which does not exist here. Serve them straight from the
    // content directory instead so the preview can show them.
    if (route.startsWith('/content/')) {
      const name = decodeURIComponent(route.slice('/content/'.length));
      if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        sendJson(res, 400, { error: 'Invalid image name' });
        return;
      }
      const file = path.join(CONTENT_DIR, name);
      if (path.dirname(file) !== CONTENT_DIR || !existsSync(file)) {
        sendJson(res, 404, { error: `No image named ${name}` });
        return;
      }
      res.writeHead(200, { 'content-type': contentTypeFor(name) });
      res.end(await readFile(file));
      return;
    }

    const asset = assets[route];
    if (asset) {
      try {
        sendText(res, 200, await readFile(asset[0], 'utf8'), asset[1]);
      } catch {
        sendJson(res, 404, { error: `Asset not found: ${route}` });
      }
      return;
    }
    sendJson(res, 404, { error: `No route for ${route}` });
    return;
  }

  // --- API -----------------------------------------------------------------
  if (method === 'GET' && route === '/api/posts') {
    sendJson(res, 200, { posts: await listPosts() });
    return;
  }

  const postMatch = /^\/api\/posts\/([^/]+)$/.exec(route);
  if (postMatch && (method === 'GET' || method === 'PUT')) {
    const slug = decodeURIComponent(postMatch[1]!);

    if (method === 'GET') {
      const existing = await loadExisting(slug);
      if (!existing) {
        sendJson(res, 404, { error: `No post named ${slug}` });
        return;
      }
      const { data } = existing;
      // Dates go out as YYYY-MM-DD. A full ISO timestamp is rejected by
      // <input type="date">, which silently renders an empty field.
      sendJson(res, 200, {
        slug,
        title: data.title,
        description: data.description,
        pubDate: formatDateOnly(data.pubDate),
        ...(data.updatedDate
          ? { updatedDate: formatDateOnly(data.updatedDate) }
          : {}),
        tags: data.tags,
        draft: data.draft,
        body: existing.body,
      });
      return;
    }

    const input = await readBody(req);
    const existing = await loadExisting(slug);
    // A published post stays published across autosaves.
    const draft = existing ? existing.data.draft : true;
    const post = postFromInput(input, existing, draft);
    await writeFile(postPath(slug), serializePost(post), 'utf8');
    sendJson(res, 200, { saved: true, slug, draft });
    return;
  }

  if (method === 'POST' && route === '/api/publish') {
    const input = await readBody(req);
    const rawSlug = typeof input.slug === 'string' ? input.slug.trim() : '';
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const requested = rawSlug || deriveSlug(title || 'untitled');

    if (!isValidSlug(requested)) {
      sendJson(res, 400, {
        error: 'Invalid slug',
        detail: 'Use lowercase letters, numbers and hyphens only.',
      });
      return;
    }

    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== PUBLISH_BRANCH) {
      sendJson(res, 409, {
        error: `You are on branch "${branch}", not ${PUBLISH_BRANCH}`,
        detail:
          `Publishing deploys from ${PUBLISH_BRANCH}, so nothing would go live from here.\n\n` +
          `Switch to ${PUBLISH_BRANCH} and try again:\n\n    git switch ${PUBLISH_BRANCH}\n\n` +
          `Your draft is saved on disk either way.`,
      });
      return;
    }

    const existing = await loadExisting(requested);
    // Refuse to overwrite a different post that happens to share the slug.
    if (existing && existing.data.title.trim() !== title) {
      sendJson(res, 409, {
        error: 'Slug already taken',
        detail: `"${requested}" already belongs to "${existing.data.title}". Pick another slug.`,
      });
      return;
    }

    const isNew = existing === null;
    const post = postFromInput(input, existing, false);

    await writeFile(postPath(requested), serializePost(post), 'utf8');

    const build = await runBuild();
    if (!build.ok) {
      sendJson(res, 422, {
        error: 'Build failed — nothing was committed',
        detail: build.output.slice(-4000),
      });
      return;
    }

    const relative = path.relative(ROOT, postPath(requested));
    await git(['add', relative]);

    const subject = `${isNew ? 'Publish' : 'Update'}: ${post.data.title}`;
    await git(['commit', '-m', subject, '-m', post.data.description]);

    try {
      await git(['push']);
    } catch (error) {
      sendJson(res, 502, {
        error: 'Committed locally, but the push failed',
        detail: `${(error as Error).message}\n\nThe commit is safe on your machine. Resolve the remote state, then push from the terminal.`,
      });
      return;
    }

    const sha = await git(['rev-parse', '--short', 'HEAD']);
    sendJson(res, 200, {
      published: true,
      slug: requested,
      sha,
      url: `https://titianyy.github.io/blog/posts/${requested}/`,
    });
    return;
  }

  sendJson(res, 404, { error: `No route for ${method} ${route}` });
}

// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) sendJson(res, 500, { error: message });
    else res.end();
  });
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\n  Port ${PORT} is already in use.\n` +
        `  Something else is probably running. Use a different port:\n\n` +
        `      PORT=4323 npm run write\n`,
    );
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Writing tool ready — ${url}\n  Stop with Ctrl+C\n`);

  if (process.env.NO_OPEN !== '1' && process.platform === 'darwin') {
    execFile('open', [url], () => {
      /* opening the browser is a convenience; failing is not an error */
    });
  }
});
