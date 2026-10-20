import type { BestScore, Level, Part, Song } from "./types";
import Stars from "./Stars";
export const artUrl = (song: Song) =>
  song.art ? `backstage://app/art/${song.id}?v=${song.art}` : "";
const LEVELS: Level[] = ["Easy", "Medium", "Hard", "Expert"];
export type Scores = Record<string, BestScore>;
export const scoreKey = (id: string, part: Part, level: Level) =>
  `${id}|${part}|${level}`;
/** Highest star count earned on any chart of a song. */
export function bestStars(song: Song, scores: Scores) {
  let stars = -1;
  for (const c of song.charts)
    stars = Math.max(
      stars,
      scores[scoreKey(song.id, c.part, c.level)]?.stars ?? -1,
    );
  return stars;
}
function Intensity({ value }: { value: number }) {
  return (
    <span className="intensity" aria-label={`Intensity ${value} of 6`}>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <i key={n} className={n <= value ? "on" : ""} />
      ))}
    </span>
  );
}
/** Clone Hero-style details for the highlighted song. */
export default function SongInfo({
  song,
  scores,
  length,
}: {
  song: Song;
  scores: Scores;
  length: string;
}) {
  const parts = [...new Set(song.charts.map((c) => c.part))];
  const meta = [
    ["Album", song.details?.album],
    ["Year", song.details?.year],
    ["Genre", song.details?.genre],
    ["Charter", song.details?.charter],
    ["Length", length],
  ].filter(([, value]) => value);
  return (
    <aside className="song-info" aria-label="Song details">
      <div className="info-cover">
        {song.art ? (
          <img src={artUrl(song)} alt="" />
        ) : (
          <span>
            {song.practice ? "✦" : song.title.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <h2>{song.title}</h2>
      <p className="info-artist">{song.artist}</p>
      <dl className="info-meta">
        {meta.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="info-parts">
        {parts.map((part) => {
          const available = LEVELS.filter((l) =>
            song.charts.some((c) => c.part === part && c.level === l),
          );
          const top = [...available]
            .reverse()
            .map((l) => [l, scores[scoreKey(song.id, part, l)]] as const)
            .find(([, best]) => best);
          const intensity = song.intensity?.[part] ?? -1;
          return (
            <div className="info-part" key={part}>
              <div className="part-head">
                <strong>{part}</strong>
                {intensity >= 0 && <Intensity value={intensity} />}
              </div>
              <div className="part-levels">
                {LEVELS.map((l) => (
                  <span
                    key={l}
                    className={available.includes(l) ? "on" : ""}
                    title={available.includes(l) ? l : `${l} not charted`}
                  >
                    {l[0]}
                  </span>
                ))}
              </div>
              <div className="part-best">
                {top ? (
                  <>
                    <Stars count={top[1]!.stars} small />
                    <b>{top[1]!.score.toLocaleString()}</b>
                    <small>
                      {top[0]} · {top[1]!.accuracy}%
                    </small>
                  </>
                ) : (
                  <small>Not played yet</small>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
