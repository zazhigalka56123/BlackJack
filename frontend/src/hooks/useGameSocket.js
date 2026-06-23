import { useEffect, useRef, useState } from 'react'
import { GameSocket } from '../api/socket.js'

// Адрес WS определяется автоматически из хоста, с которого открыта страница,
// чтобы фронт работал и при заходе по IP ноута с других устройств в локалке.
// Порт сервера можно переопределить через VITE_SERVER_PORT, а весь URL — через VITE_WS_URL.
function resolveWsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.hostname || 'localhost'
  const port = import.meta.env.VITE_SERVER_PORT || '8000'
  return `${proto}://${host}:${port}/ws`
}

const WS_URL = resolveWsUrl()
const PLAYER_ID_KEY = 'roulette-browser-id'

function getOrCreatePlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY)
  if (!id) {
    id = 'browser-' + Math.random().toString(36).slice(2, 10)
    localStorage.setItem(PLAYER_ID_KEY, id)
  }
  return id
}

const INITIAL_STATE = {
  status: 'connecting',
  phase: 'BETTING',
  timer: 0,
  roundId: 0,
  players: [],
  result: null,
  history: [],
  lastError: null,
}

export function useGameSocket() {
  const [state, setState] = useState(INITIAL_STATE)
  const socketRef = useRef(null)
  const prevPhaseRef = useRef(null)

  useEffect(() => {
    const playerId = getOrCreatePlayerId()
    const socket = new GameSocket(WS_URL, {
      onStatusChange: (status) => {
        setState((s) => ({ ...s, status }))
      },
      onMessage: (msg) => {
        if (msg.type === 'state') {
          setState((s) => {
            const next = {
              ...s,
              phase: msg.phase,
              timer: msg.timer,
              roundId: msg.round_id ?? s.roundId,
              players: msg.players ?? s.players,
              result: msg.result ?? (msg.phase === 'BETTING' ? null : s.result),
            }
            // при переходе RESULT → BETTING сохраняем число в историю
            if (
              prevPhaseRef.current === 'RESULT' &&
              msg.phase === 'BETTING' &&
              s.result
            ) {
              next.history = [s.result, ...s.history].slice(0, 12)
            }
            prevPhaseRef.current = msg.phase
            return next
          })
        } else if (msg.type === 'welcome') {
          setState((s) => ({ ...s, lastError: null }))
        } else if (msg.type === 'error') {
          setState((s) => ({ ...s, lastError: msg }))
        }
      },
    })
    socketRef.current = socket
    socket.connect(playerId)
    return () => socket.close()
  }, [])

  return state
}
