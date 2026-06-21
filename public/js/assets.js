/* Blobbie Dash - tiny image asset cache.
 * Loads images (PNG/JPG/SVG/GIF) on demand and caches them. `get(url)` returns
 * the <img> only once it's fully loaded (else null), so callers can fall back
 * to drawn art until the image is ready — no pop-in errors. */
(function () {
  'use strict';
  const cache = Object.create(null);

  function get(url) {
    if (!url) return null;
    let img = cache[url];
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = url;
      cache[url] = img;
    }
    return (img.complete && img.naturalWidth > 0) ? img : null;
  }

  function preload(urls) {
    (urls || []).forEach((u) => { if (u) get(u); });
  }

  window.BlobbieAssets = { get, preload, cache };
})();
