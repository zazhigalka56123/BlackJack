import { colorOf } from '../roulette.js'

export function HistoryStrip({ history }) {
  return (
    <div className="history-strip">
      <span className="history-label">История:</span>
      {history.length === 0 && <span className="history-empty">пока пусто</span>}
      {history.map((h, i) => {
        const c = h.color || colorOf(h.number)
        return (
          <span
            key={i}
            className={`history-chip history-${c.toLowerCase()}`}
            title={c}
          >
            {h.number}
          </span>
        )
      })}
    </div>
  )
}
