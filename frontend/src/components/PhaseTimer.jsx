const PHASE_LABEL = {
  BETTING: 'Делайте ставки',
  SPINNING: 'Крутим',
  RESULT: 'Результат',
}

export function PhaseTimer({ phase, timer }) {
  return (
    <div className={`phase-timer phase-${phase.toLowerCase()}`}>
      <div className="phase-label">{PHASE_LABEL[phase] || phase}</div>
      <div className="phase-seconds">{Math.max(0, timer)}</div>
    </div>
  )
}
