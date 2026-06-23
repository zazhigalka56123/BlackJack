import { colorOf } from '../roulette.js'

export function HistoryStrip({ history }) {
  return (
    <div className="last-strip">
      <span className="last-label">LAST</span>
      {history.length === 0 && <span className="last-empty">-- -- --</span>}
      {history.map((h, i) => {
        const c = (h.color || colorOf(h.number)).toLowerCase()
        return (
          <span key={i} className={`last-chip ${c}`} title={c}>
            {h.number}
          </span>
        )
      })}
    </div>
  )
}
