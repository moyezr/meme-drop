export function QualityRing({ score, size = "large" }: { score: number; size?: "small" | "large" }) {
  return (
    <div
      aria-label={`${score}% complete`}
      className={`quality-ring ${size}`}
      style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}
    >
      <span>{score}</span>
      {size === "large" ? <small>%</small> : null}
    </div>
  );
}
