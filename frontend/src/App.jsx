import { useGameSocket } from './hooks/useGameSocket.js'
import { Marquee } from './components/Marquee.jsx'
import { RouletteWheel } from './components/RouletteWheel.jsx'
import { SegDisplay } from './components/SegDisplay.jsx'
import { BettingBoard } from './components/BettingBoard.jsx'
import { HistoryStrip } from './components/HistoryStrip.jsx'
import { ConnectionStatus } from './components/ConnectionStatus.jsx'
import { ControlPanel } from './components/ControlPanel.jsx'

const PHASE_NAME = {
  BETTING: 'BETTING',
  SPINNING: 'SPINNING',
  RESULT: 'RESULT',
}

export default function App() {
  const game = useGameSocket()

  const pot = (game.players || []).reduce(
    (sum, p) => sum + (p.bet ? p.bet.amount : 0),
    0
  )
  const playersCount = (game.players || []).length
  const timer = Math.max(0, game.timer)
  const lowTimer = game.phase === 'BETTING' && timer <= 5

  return (
    <div className={`app phase-${game.phase.toLowerCase()}`}>
      <div className="cab">
        <Marquee />

        <div className="crt">
          <div className="crt-head">
            <ConnectionStatus status={game.status} />
            <span className="phase-name">{PHASE_NAME[game.phase] || game.phase}</span>
            <span className="rnd" />
          </div>

          <div className="stage">
            <div className="stage-col left">
              <SegDisplay
                label="TIMER"
                kind="timer"
                value={timer}
                lowTimer={lowTimer}
              />
              <SegDisplay label="POT" kind="pot" value={pot} />
            </div>

            <div className="stage-wheel">
              <RouletteWheel phase={game.phase} result={game.result} />
            </div>

            <div className="stage-col right">
              <SegDisplay
                label="PLAYERS"
                kind="players"
                value={playersCount}
                live={game.status === 'connected'}
              />
            </div>
          </div>

          <BettingBoard
            players={game.players}
            phase={game.phase}
            result={game.result}
          />

          <HistoryStrip history={game.history} />
        </div>

        <ControlPanel
          phase={game.phase}
          players={game.players}
          result={game.result}
        />
      </div>
    </div>
  )
}
