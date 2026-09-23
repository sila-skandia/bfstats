// The image, font and tint caches a menu screen paints out of.
//
// `menu-screen.js` is pure — it is handed an `env` and asked to paint — and
// `skirmish.js` grew its own `env` inline before there was a second screen.
// This is that same env, as a thing a screen can ask for: `multiplay.js` and
// `nav-strip.js` both need the plates and the bitmap faces out of a layout
// pack, and neither is the Instant Battle screen. `skirmish.js` and
// `mod-picker-screen.js` now ask for it as well, laying their own lookups
// (thumbnail, icon, text, the live level list and hover) over its env.
//
// Nothing here knows what it is drawing. It is handed a layout (the
// `textures` / `fontFiles` tables an extractor wrote) and a way to turn a
// pack-relative path into a URL, and it hands back the three lookups
// `paintElement` asks for.

/**
 * @param {object} options
 * @param {(rel: string) => string} options.url  pack-relative path -> URL
 * @param {() => string} [options.bust]  cache-buster suffix, if any
 * @param {() => void} [options.onImage] an image finished loading; repaint
 * @param {object} [options.env]  the screen's own lookups (`thumbnail`,
 *                                `icon`, `text`, `levels`, `hover`...), laid
 *                                over the pack's with their getters intact
 */
export function createMenuPack({ url, bust = () => '', onImage = () => {}, env: own = null }) {
  const images = new Map();
  const fonts = new Map();
  const tints = new Map();
  let layout = null;

  const json = href => fetch(href + bust()).then(r => {
    if (!r.ok) throw new Error(`${r.status} ${href}`);
    return r.json();
  });

  function image(href) {
    if (images.has(href)) return images.get(href);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => onImage();
    img.onerror = () => images.set(href, null);
    img.src = href + bust();
    images.set(href, img);
    return img;
  }

  const ready = img => (img && img.complete && img.naturalWidth ? img : null);

  // Not `decode()`: a background tab never decodes, so the promise would
  // never settle and the screen would never finish loading. `load` fires
  // anywhere, the bytes are what the first paint waits on, and `drawImage`
  // decodes on its own. (Same reasoning as `skirmish.js`.)
  const loaded = img => (img.complete ? Promise.resolve() : new Promise(resolve => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }));

  /** The variable table a screen's conditions read, and the live values it
   *  writes over the file's. Owned by the screen; the pack only carries it
   *  so `env.text` can reach it. */
  let values = {};

  const env = {
    texture: name => {
      const entry = layout?.textures?.[name];
      return entry ? ready(image(url(entry.file))) : null;
    },
    thumbnail: () => null,
    font: id => fonts.get(id) || null,
    text: name => (name in values ? String(values[name]) : ''),
    tint: (font, rgb) => {
      const key = `${font.id}|${rgb.join(',')}`;
      let c = tints.get(key);
      if (c) return c;
      const img = ready(font.img);
      if (!img) return null;
      c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
      g.fillRect(0, 0, c.width, c.height);
      tints.set(key, c);
      return c;
    },
    levels: [],
    hover: null,
  };
  if (own) Object.defineProperties(env, Object.getOwnPropertyDescriptors(own));

  /** Fetch every face and every plate the layout names. The screens here
   *  are a few dozen small textures and paint once, so nothing is lazy. */
  async function load(pack) {
    layout = pack;
    await Promise.all(Object.entries(pack.fontFiles || {}).map(async ([id, entry]) => {
      const meta = await json(url(entry.glyphs));
      const img = image(url(entry.file));
      await loaded(img);
      fonts.set(id, { id, meta, img });
    }));
    for (const entry of Object.values(pack.textures || {})) image(url(entry.file));
    return pack;
  }

  /** Point `env.texture` at a layout now, ahead of `load` fetching its
   *  faces — a screen that paints in between draws the new layout's plates. */
  function use(pack) {
    layout = pack;
  }

  return {
    env,
    load,
    use,
    json,
    image,
    ready,
    get layout() { return layout; },
    get values() { return values; },
    set values(next) { values = next; },
  };
}
