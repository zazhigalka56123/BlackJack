const STATUS_LABEL = {
  connecting: 'CONNECT',
  connected: 'ONLINE',
  disconnected: 'OFFLINE',
}

export function ConnectionStatus({ status }) {
  return (
    <span className={`conn ${status}`}>
      <span className="dot" />
      {STATUS_LABEL[status] || status}
    </span>
  )
}
