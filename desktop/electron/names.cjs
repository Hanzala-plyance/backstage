// Song naming shared by the library and tests; mirrored in
// song-converter/songmaker/names.py against tests/fixtures/song-names.json.
const GENERIC = new Set([
  "",
  "unknown artist",
  "youtube artist",
  "various artists",
]);
// Bracketed video decorations, not musical versions like (Live) or (Remix).
const NOISE =
  /\b(official|video|visuali[sz]er|audio|lyrics?|exclusive|hd|hq|4k|mv|music video)\b/i;
const VERSION =
  /^(remaster(ed)?|remix|live|edit|radio edit|version|mono|stereo|acoustic|demo|instrumental)\b/i;
const FEAT = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;
const squash = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const same = (a, b) => squash(a).toLowerCase() === squash(b).toLowerCase();
/** Turns YouTube-style metadata into a display title and performing artist. */
function cleanSong(rawTitle, rawArtist) {
  let title = String(rawTitle ?? "").replace(
    /\s*[([]([^)\]]*)[)\]]/g,
    (match, inner) => (NOISE.test(inner) ? " " : match),
  );
  let artist = squash(rawArtist);
  if (GENERIC.has(artist.toLowerCase())) artist = "";
  const known = artist && title.toLowerCase().includes(artist.toLowerCase());
  const dash = title.indexOf(" - ");
  const gap = title.trim().split(/\s{2,}/);
  if (dash > 0) {
    const left = title.slice(0, dash),
      right = title.slice(dash + 3);
    // "Artist - Title": trust it when it names the known artist, or when the
    // artist field is just an uploader and the right side isn't a version tag.
    if (same(left, artist) || (!known && !VERSION.test(squash(right)))) {
      artist = squash(left);
      title = right;
    }
  } else if (gap.length >= 2 && FEAT.test(" " + gap[0] + " ")) {
    // Uploads like "Artist Feat. Guest  Title" separate parts with spaces.
    artist = squash(gap[0]);
    title = gap.slice(1).join(" ");
  }
  title = squash(title);
  const featured = artist.split(FEAT);
  if (featured.length > 1) {
    artist = squash(featured[0]);
    title = `${title} (feat. ${squash(featured.slice(1).join(", "))})`;
  }
  title = title
    .replace(/\((?:feat\.?|ft\.?|featuring)\s+/i, "(feat. ")
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+([^()]+)$/i, " (feat. $1)");
  if (GENERIC.has(artist.toLowerCase())) artist = "";
  return { title: squash(title), artist: squash(artist) };
}
/** "Artist - Title", safe as a single folder name on macOS, Windows and Linux. */
function folderName(title, artist) {
  const name = [squash(artist), squash(title)].filter(Boolean).join(" - ");
  return (
    squash(name.replace(/[\x00-\x1f<>:"/\\|?*]+/g, " "))
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 120)
      .replace(/[.\s]+$/, "") || "Untitled song"
  );
}
module.exports = { cleanSong, folderName };
