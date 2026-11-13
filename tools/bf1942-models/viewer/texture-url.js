// The URL the page asks for a content-addressed texture by.
//
// `/textures/<2 hex>/<32 hex>.<ext>` is immutable: a name never gets new
// content. But a name requested before its file was published came back 404,
// and until 2026-11-13 nginx sent that 404 with the textures' one-year
// `immutable` header (`add_header ... always`), so Cloudflare kept the 404 for
// a year. On 2026-11-13 re-baked levels went live a few minutes before their
// textures, and 3,852 textures stayed 404 at the edge although the origin had
// them (production drew white terrain).
//
// Cloudflare's cache key includes the query string and nginx's `try_files $uri`
// ignores it, so a fixed query is a fresh key for every texture with the same
// file behind it. Raise `TEXTURE_EPOCH` only if the edge ever holds bad answers
// for texture names again; each raise costs one cold fetch per texture.
export const TEXTURE_EPOCH = '2';

const CONTENT_ADDRESSED = /\/textures\/[0-9a-f]{2}\/[0-9a-f]{32}\.(?:webp|png|jpe?g)$/;

/** `url` with the epoch query when it names a content-addressed texture. */
export function textureUrl(url) {
  if (typeof url !== 'string' || url.includes('?')) return url;
  return CONTENT_ADDRESSED.test(url) ? `${url}?r=${TEXTURE_EPOCH}` : url;
}

/** Route every URL `manager` resolves through `textureUrl` (once). */
export function withTextureEpoch(manager) {
  if (!manager || manager.__textureEpoch) return manager;
  manager.setURLModifier(textureUrl);
  manager.__textureEpoch = true;
  return manager;
}
