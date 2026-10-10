/** Five stars, filled up to `count`; six stars shows all five in gold. */
export default function Stars({
  count,
  small = false,
}: {
  count: number;
  small?: boolean;
}) {
  const gold = count >= 6;
  return (
    <span
      className={"stars" + (gold ? " gold" : "") + (small ? " small" : "")}
      role="img"
      aria-label={gold ? "Gold stars" : `${count} of 5 stars`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < count ? "on" : ""}>
          ★
        </i>
      ))}
    </span>
  );
}
