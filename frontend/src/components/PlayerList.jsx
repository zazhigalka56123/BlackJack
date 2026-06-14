function shortId(id) {
  if (!id) return '???'
  if (id.startsWith('browser-')) return '👁 ' + id.slice(8, 12)
  // MAC-адрес — показываем последние 5 символов
  return '🎮 ' + id.slice(-5)
}

export function PlayerList({ players }) {
  if (!players || players.length === 0) {
    return (
      <div className="player-list empty">
        <h3>Игроки</h3>
        <div className="empty-text">Никто не подключён</div>
      </div>
    )
  }

  return (
    <div className="player-list">
      <h3>Игроки ({players.length})</h3>
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            <span className="player-name">{shortId(p.id)}</span>
            <span className="player-balance">{p.balance ?? '—'} ¢</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
