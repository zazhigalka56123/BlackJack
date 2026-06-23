// Debug-логи WS-трафика. Включи в консоли: localStorage.debug = '1' (потом перезагрузи).
// Чтобы видеть и тики state — localStorage.debug = 'verbose'.
function debugMode() {
  try {
    return localStorage.getItem('debug')
  } catch {
    return null
  }
}

const STYLE_IN = 'background:#1f3a52;color:#7cc4ff;padding:1px 4px;border-radius:3px'
const STYLE_OUT = 'background:#3a2752;color:#d0aaff;padding:1px 4px;border-radius:3px'
const STYLE_SYS = 'background:#3a3a1a;color:#f5c542;padding:1px 4px;border-radius:3px'
const STYLE_ESP = 'background:#1a3a1a;color:#7fe07f;padding:1px 4px;border-radius:3px'

export class GameSocket {
  constructor(url, { onMessage, onStatusChange } = {}) {
    this.url = url
    this.onMessage = onMessage || (() => {})
    this.onStatusChange = onStatusChange || (() => {})
    this.ws = null
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.offlineTimer = null
    this.closedByUser = false
    this.playerId = null
    this.lastStatus = null
  }

  _setStatus(s) {
    if (this.lastStatus === s) return
    this.lastStatus = s
    this.onStatusChange(s)
  }

  connect(playerId) {
    this.playerId = playerId
    this.closedByUser = false
    this._open()
  }

  _open() {
    this._setStatus('connecting')
    this._sys(`connecting → ${this.url}`)
    try {
      this.ws = new WebSocket(this.url)
    } catch (e) {
      this._sys(`ctor failed: ${e}`)
      this._scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      clearTimeout(this.offlineTimer)
      this.offlineTimer = null
      this._setStatus('connected')
      this._sys('open')
      this.send({ type: 'join', player_id: this.playerId })
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        this._logIn(msg)
        this.onMessage(msg)
      } catch (e) {
        console.error('[WS] Bad message', event.data)
      }
    }

    this.ws.onclose = (event) => {
      // Если был coonnected — не паникуем сразу. Сначала пробуем тихо переподключиться;
      // 'disconnected' покажем только если реконнект не успел.
      if (this.lastStatus === 'connected') {
        this._setStatus('connecting')
        clearTimeout(this.offlineTimer)
        this.offlineTimer = setTimeout(() => this._setStatus('disconnected'), 1500)
      } else {
        this._setStatus('disconnected')
      }
      this._sys(`close code=${event.code} reason="${event.reason || ''}"`)
      if (!this.closedByUser) this._scheduleReconnect()
    }

    this.ws.onerror = () => {
      this._sys('error (see browser network tab)')
    }
  }

  // ---- debug helpers ----
  _sys(msg) {
    const mode = debugMode()
    if (!mode) return
    console.log('%c[WS]%c %s', STYLE_SYS, '', msg)
  }

  _logIn(msg) {
    const mode = debugMode()
    if (!mode) return
    // state ходит каждую секунду — показываем только в verbose,
    // но всегда показываем переходы фаз и наличие ESP-ставок.
    if (msg.type === 'state') {
      const espBets = (msg.players || []).filter(p => p.bet)
      const hasResult = msg.phase !== 'BETTING' && msg.result
      const phaseShown = window.__wsLastPhase !== msg.phase
      window.__wsLastPhase = msg.phase
      if (mode === 'verbose' || phaseShown || espBets.length > 0 || hasResult) {
        const tag = phaseShown ? `phase→${msg.phase}` : msg.phase
        const extras = []
        if (hasResult) extras.push(`result=${msg.result.number}(${msg.result.color})`)
        if (espBets.length) {
          extras.push('bets=' + espBets.map(p =>
            `${p.id.slice(-5)}:${p.bet.type}/${p.bet.amount}${p.won != null ? `→won${p.won}` : ''}`
          ).join(','))
        }
        const style = espBets.length || hasResult ? STYLE_ESP : STYLE_IN
        console.log(`%c[WS←]%c ${tag} t=${msg.timer} ${extras.join(' ')}`, style, '')
      }
      return
    }
    console.log(`%c[WS←]%c ${msg.type}`, STYLE_IN, '', msg)
  }

  _logOut(msg) {
    const mode = debugMode()
    if (!mode) return
    console.log(`%c[WS→]%c ${msg.type}`, STYLE_OUT, '', msg)
  }

  _scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000)
    this.reconnectAttempts += 1
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this._open(), delay)
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._logOut(payload)
      this.ws.send(JSON.stringify(payload))
    }
  }

  close() {
    this.closedByUser = true
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.offlineTimer)
    if (this.ws) this.ws.close()
  }
}
