// Album cover lookup via Apple's public iTunes Search API. A cover is used only
// when both artist and title match; alternate versions are rejected so a wrong
// cover is never shown in place of the generated one.
const ALTERNATE =
  /\b(instrumental|karaoke|tribute|cover|covers|piano|originally performed|in the style of|made famous|lullaby|8-bit|acapella|a cappella)\b/i;
const MAX_BYTES = 3 * 1024 * 1024;
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\((?:feat|ft)\.?[^)]*\)|\s(?:feat|ft)\.?\s.*$/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const words = (s) => new Set(norm(s).split(" ").filter(Boolean));
/** Picks the best matching result's 600 px artwork URL, or null. */
function pickCover(results, title, artist) {
  const t = norm(title),
    a = norm(artist);
  if (!t || !a) return null;
  const wanted = words(title);
  const scored = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (r?.kind !== "song" || typeof r.artworkUrl100 !== "string") continue;
    if (
      !ALTERNATE.test(title) &&
      ALTERNATE.test(`${r.trackName} ${r.collectionName}`)
    )
      continue;
    const ra = norm(r.artistName);
    if (!ra || !(ra.includes(a) || a.includes(ra))) continue;
    const rt = norm(r.trackName);
    const got = words(r.trackName);
    const shared = [...wanted].filter((w) => got.has(w)).length;
    const exact = rt === t;
    if (!exact && shared / Math.max(wanted.size, got.size) < 0.75) continue;
    // Prefer exact titles, then the artist's own release over compilations.
    const compilation =
      r.collectionArtistName && norm(r.collectionArtistName) !== ra;
    scored.push({ r, score: (exact ? 2 : 0) + (compilation ? 0 : 1) });
  }
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0]?.r;
  return best
    ? best.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/600x600bb.jpg")
    : null;
}
function searchUrl(title, artist) {
  const term = `${artist} ${norm(title)}`.trim();
  return (
    "https://itunes.apple.com/search?" +
    new URLSearchParams({ term, entity: "song", limit: "10" })
  );
}
function artworkAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)mzstatic\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}
/** Finds and downloads a cover. `fetch` is injected (Electron net.fetch). */
async function findCover(fetch, title, artist) {
  const response = await fetch(searchUrl(title, artist));
  if (!response.ok) throw Error("Cover search is unavailable right now.");
  const url = pickCover((await response.json()).results, title, artist);
  if (!url) return null;
  if (!artworkAllowed(url)) return null;
  const image = await fetch(url);
  const type = image.headers.get("content-type") || "";
  if (!image.ok || !type.startsWith("image/")) return null;
  const bytes = Buffer.from(await image.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  return bytes;
}
module.exports = { pickCover, searchUrl, artworkAllowed, findCover };
