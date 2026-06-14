import { BET_TYPES, betLabel, isWinningBet } from '../roulette.js'

function shortId(id) {
  if (!id) return '???'
  if (id.startsWith('browser-')) return id.slice(8, 12)
  return id.slice(-5)
}

export function BettingBoard({ players, phase, result }) {
  const byType = Object.fromEntries(BET_TYPES.map((t) => [t, []]))
  for (const p of players || []) {
    if (p.bet && byType[p.bet.type]) {
      byType[p.bet.type].push(p)
    }
  }

  return (
    <div className="betting-board">
      <h3>Ставки</h3>
      <div className="bet-grid">
        {BET_TYPES.map((type) => {
          const isWin =
            phase === 'RESULT' && result && isWinningBet(type, result.number)
          return (
            <div
              key={type}
              className={`bet-cell bet-${type.toLowerCase()} ${
                phase === 'RESULT' ? (isWin ? 'win' : 'lose') : ''
              }`}
            >
              <div className="bet-cell-head">
                <span className="bet-name">{betLabel(type)}</span>
                <span className="bet-mult">
                  ×{type === 'GREEN' ? 14 : 2}
                </span>
              </div>
              <div className="bet-cell-bets">
                {byType[type].length === 0 ? (
                  <span className="bet-empty">—</span>
                ) : (
                  byType[type].map((p) => (
                    <span key={p.id} className="bet-chip">
                      {shortId(p.id)} · {p.bet.amount}
                    </span>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
