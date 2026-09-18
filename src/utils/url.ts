/**
 * Every internal link and asset URL in this site goes through withBase().
 * The site is served from a subpath on GitHub Pages, so a bare `/tags/` would
 * 404 in production while still appearing to work in some dev setups.
 */
const BASE = import.meta.env.BASE_URL;

export function withBase(path = '/'): string {
  // BASE_URL carries a trailing slash only when trailingSlash is 'always' or
  // 'ignore', so normalise instead of concatenating blindly.
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
