# Writing tool — design

Date: 2026-09-18
Status: approved

## Problem

Publishing a post means hand-writing YAML frontmatter, remembering that links
inside Markdown must be relative, then running git commands. That is a lot of
ceremony for writing an essay, and the failure modes are silent — a
root-absolute link builds fine and 404s only once it is live.

## Goal

Write a post in a browser, see it styled as it will appear, click Publish. No
frontmatter, no git commands, no knowledge of how the site is built.

## Decisions

| Decision | Choice |
| --- | --- |
| Form | Local web editor, served by a small Node process |
| Publish | Commit and push straight to `main`; Actions deploys |
| Scope | New posts and editing existing ones; no delete |
| Preview | Browser-rendered Markdown against the blog's real stylesheet |
| Drafts | Autosaved to disk with `draft: true`, not committed |

## Architecture

A standalone Node server, deliberately separate from the site's build. The
editor must not be able to ship itself to the public site, and the site's build
must not need to know the editor exists.

```
tools/editor/
  server.ts        HTTP server, file operations, git operations
  ui/index.html    editor shell
  ui/app.js        client logic
  ui/style.css     editor chrome only — not the blog's styles
```

`server.ts` runs directly under `node` using native TypeScript support (verified
on the local Node 26.7.0). No bundler, no build step, no transpile.

Client libraries are served straight out of `node_modules` rather than bundled.

### Dependencies

- `marked` — renders Markdown to HTML in the browser for the preview pane
- `js-yaml` — parses and writes frontmatter

Both are `devDependencies`: the deployed site does not use them.

## Data flow

### Frontmatter

The editor owns frontmatter completely. Title, subtitle, tags and the publish
date are entered as plain fields; the server serialises them to YAML.

The slug is derived from the title, shown as an editable field, and frozen once
the file exists — a published URL must never change by accident.

### Drafts

Autosave is debounced and writes the post to `src/content/blog/<slug>.md` with
`draft: true`. Nothing is committed. The site's schema and build already exclude
drafts, so a draft cannot reach the live site.

A post that is already published autosaves with `draft: false` — editing a live
post must not silently unpublish it. The client tracks which state a post is in
and sends the intended value.

### Publish

1. Write the post with `draft: false`.
2. Run `npm run build:fast` and check the exit code.
3. On failure: do not commit, return the build output to the editor, leave the
   file on disk so the error can be fixed in place.
4. On success: `git add` the single file, commit, push to `main`.

The build check is worth its ~1.5s because a failed deploy leaves the previous
version live — the risk is not downtime, it is a confusing failure appearing in
Actions a minute later instead of in the editor immediately.

Commits are attributed with the repository's standard `Co-Authored-By` line.

## HTTP interface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Editor shell |
| `GET` | `/app.js`, `/style.css` | Editor assets |
| `GET` | `/blog.css` | The blog's real `src/styles/global.css` |
| `GET` | `/vendor/marked.js` | Markdown renderer |
| `GET` | `/api/posts` | List posts: slug, title, subtitle, date, tags, draft |
| `GET` | `/api/posts/:slug` | One post: frontmatter fields and raw body |
| `PUT` | `/api/posts/:slug` | Autosave; writes the file, never commits |
| `POST` | `/api/publish` | Write, build, commit, push |

All responses are JSON except the asset routes. Errors return a non-2xx status
with `{ error, detail }` so the editor can show something useful.

## Preview fidelity

The preview pane loads the blog's actual `global.css`, so type, spacing,
blockquote rules, tag pills and dark mode match the live site. The pane wraps
rendered Markdown in the same `.prose` container the real post page uses.

Known and accepted difference: code blocks render without syntax colouring,
because highlighting happens in the site's build (Shiki), not in the browser.
Styling of the block itself still matches.

Links inside the body are the author's responsibility. The editor will warn on a
root-absolute Markdown link (`](/...)`), since that is the one mistake that
builds cleanly and 404s in production.

## Error handling

| Failure | Behaviour |
| --- | --- |
| Slug collides with an existing post | Refuse, ask for a different slug |
| Build fails on publish | Report the build output, do not commit |
| `git push` rejected (remote ahead) | Report it, leave the commit local, do not force |
| Draft file deleted outside the editor | Recreate on next autosave |
| Port already in use | Report clearly rather than dying silently |

No destructive git operations. Nothing in the tool runs `reset`, `checkout`, or
`push --force`.

## Testing

The server's frontmatter serialise/parse round-trip and slug derivation are pure
functions and are tested directly. Git and build steps are verified by running
the tool against the real repository: create a post, confirm it is excluded from
a build while `draft: true`, publish it, confirm the commit and the live page.
