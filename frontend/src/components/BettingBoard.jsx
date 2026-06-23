import { BET_TYPES, isWinningBet } from '../roulette.js'

const SLOT_LABEL = { RED: 'RED', BLACK: 'BLK', GREEN: '0', EVEN: 'EVN', ODD: 'ODD' }
const SLOT_CLASS = { RED: 'red', BLACK: 'black', GREEN: 'green', EVEN: 'even', ODD: 'odd' }

function shortId(id) {
  if (!id) return '???'
  if (id.startsWith('browser-')) return id.slice(8, 12)
  return id.slice(-2)
}

export function BettingBoard({ players, phase, result }) {
  const byType = Object.fromEntries(BET_TYPES.map((t) => [t, []]))
  for (const p of players || []) {
    if (p.bet && byType[p.bet.type]) byType[p.bet.type].push(p)
  }

  return (
    <div className="slots">
      <div className="slots-label">PLACE YOUR BETS</div>
      <div className="slots-grid">
        {BET_TYPES.map((type) => {
          const isWin =
            phase === 'RESULT' && result && isWinningBet(type, result.number)
          const stateCls =
            phase === 'RESULT' ? (isWin ? 'win' : 'lose') : ''
          const bets = byType[type]
          return (
            <div key={type} className={`slot ${SLOT_CLASS[type]} ${stateCls}`}>
              <div className="slot-name">{SLOT_LABEL[type]}</div>
              <div className="slot-bets">
                {bets.length === 0 ? (
                  <span className="slot-empty">--</span>
                ) : (
                  bets.map((p) => (
                    <span key={p.id}>
                      {shortId(p.id)}:{p.bet.amount}
                    </span>
                  ))
                )}
              </div>
              <div className="slot-mult">×{type === 'GREEN' ? 14 : 2}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
