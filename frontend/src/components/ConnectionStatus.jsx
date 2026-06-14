const STATUS_LABEL = {
  connecting: 'Подключение…',
  connected: 'В сети',
  disconnected: 'Нет связи',
}

export function ConnectionStatus({ status }) {
  return (
    <div className={`connection-status status-${status}`}>
      <span className="status-dot" />
      {STATUS_LABEL[status] || status}
    </div>
  )
}
