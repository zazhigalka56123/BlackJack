import { useGameSocket } from './hooks/useGameSocket.js'
import { RouletteWheel } from './components/RouletteWheel.jsx'
import { PhaseTimer } from './components/PhaseTimer.jsx'
import { PlayerList } from './components/PlayerList.jsx'
import { BettingBoard } from './components/BettingBoard.jsx'
import { ResultBanner } from './components/ResultBanner.jsx'
import { HistoryStrip } from './components/HistoryStrip.jsx'
import { ConnectionStatus } from './components/ConnectionStatus.jsx'

export default function App() {
  const game = useGameSocket()

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎰 IoT Roulette</h1>
        <div className="header-right">
          <span className="round-id">Раунд #{game.roundId}</span>
          <ConnectionStatus status={game.status} />
        </div>
      </header>

      <HistoryStrip history={game.history} />

      <main className="app-main">
        <section className="wheel-section">
          <RouletteWheel phase={game.phase} result={game.result} />
          {game.phase === 'RESULT' && <ResultBanner result={game.result} />}
        </section>

        <aside className="side">
          <PhaseTimer phase={game.phase} timer={game.timer} />
          <PlayerList players={game.players} />
        </aside>
      </main>

      <section className="board-section">
        <BettingBoard
          players={game.players}
          phase={game.phase}
          result={game.result}
        />
      </section>

      <footer className="app-footer">
        Ставки делаются с физических устройств ESP8266. Браузер — наблюдатель.
      </footer>
    </div>
  )
}
