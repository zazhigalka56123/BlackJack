import { isWinningBet } from '../roulette.js'

const BTNS = [
  { k: 'S1', l: 'RED', type: 'RED', kc: '#ff5555' },
  { k: 'S2', l: 'BLK', type: 'BLACK', kc: '#dddddd' },
  { k: 'S3', l: '0', type: 'GREEN', kc: '#3ddc84' },
  { k: 'S4', l: 'EVN', type: 'EVEN', kc: '#9be7ff' },
  { k: 'S5', l: 'ODD', type: 'ODD', kc: '#c9a8ff' },
  { k: 'S6', l: '+10', kc: '#ffb000' },
  { k: 'S7', l: '-10', kc: '#ffb000' },
  { k: 'S8', l: 'BET', confirm: true, kc: '#39ff14' },
]

// LED-цвета в порядке типов ставок (как на железной панели LED1..LED5)
const TYPE_LEDS = [
  { type: 'RED', color: '#b81818' },
  { type: 'BLACK', color: '#9aa0a6' },
  { type: 'GREEN', color: '#0a8a3a' },
  { type: 'EVEN', color: '#2f6fb0' },
  { type: 'ODD', color: '#7a4fb0' },
]

function Led({ color, on, blink }) {
  return (
    <span
      className={`led${on ? ' on' : ''}${blink ? ' blink' : ''}`}
      style={on ? { background: color, color, boxShadow: `0 0 6px ${color}` } : undefined}
    />
  )
}

export function ControlPanel({ phase, players, result }) {
  const betting = phase === 'BETTING'
  const typesWithBets = new Set(
    (players || []).filter((p) => p.bet).map((p) => p.bet.type)
  )
  const anyWin =
    phase === 'RESULT' &&
    result &&
    (players || []).some((p) => p.bet && isWinningBet(p.bet.type, result.number))
  const anyBetThisRound = (players || []).some((p) => p.bet)

  return (
    <div className="controls">
      <div className="controls-btns">
        {BTNS.map((b) => {
          const active =
            betting && (b.type ? typesWithBets.has(b.type) : true)
          return (
            <div
              key={b.k}
              className={`cbtn${b.confirm ? ' confirm' : ''}${
                active ? ' active' : ''
              }${betting ? '' : ' dim'}`}
            >
              <div className="k" style={{ color: b.kc }}>
                {b.k}
              </div>
              <div className="l" style={b.confirm && active ? { color: b.kc } : undefined}>
                {b.l}
              </div>
            </div>
          )
        })}
      </div>

      <div className="controls-leds">
        {TYPE_LEDS.map((t) => (
          <Led key={t.type} color={t.color} on={typesWithBets.has(t.type)} />
        ))}
        {/* LED6 — мигает в SPINNING */}
        <Led color="#ffb000" on={phase === 'SPINNING'} blink={phase === 'SPINNING'} />
        {/* LED7 — выигрыш в раунде */}
        <Led color="#39ff14" on={anyWin} />
        {/* LED8 — раунд без выигрыша */}
        <Led color="#b81818" on={phase === 'RESULT' && anyBetThisRound && !anyWin} />
      </div>
    </div>
  )
}
