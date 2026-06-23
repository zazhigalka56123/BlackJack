export function SegDisplay({ label, value, kind = 'pot', ghost, lowTimer = false, live = false }) {
  return (
    <div className={`seg-panel seg-${kind}${lowTimer ? ' timer-low' : ''}`}>
      <div className="seg-label">{label}</div>
      <div className="seg-value-wrap">
        {ghost != null && <span className="seg-ghost">{ghost}</span>}
        <span className="seg-value">{value}</span>
      </div>
      {live && (
        <div className="live">
          <span className="dot" />
          LIVE
        </div>
      )}
    </div>
  )
}
