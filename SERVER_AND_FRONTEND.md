# Сервер и фронтенд — локальный запуск

## Структура проекта

```
casino/
  server/
    main.py
    requirements.txt
  frontend/
    src/
      App.jsx
      App.css
      hooks/
        useGameSocket.js
      components/
        RouletteWheel.jsx
        PlayerList.jsx
        PhaseTimer.jsx
    index.html
    package.json
    vite.config.js
```

---

## Часть 1 — Сервер (FastAPI + WebSocket)

### Установка

```bash
cd casino/server
python -m venv venv

# Mac/Linux
source venv/bin/activate
# Windows
venv\Scripts\activate

pip install -r requirements.txt
```

### `requirements.txt`

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
websockets==12.0
```

### `main.py`

```python
import asyncio
import json
import random
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Игровая логика ────────────────────────────────────────
RED_NUMBERS = {1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}

def get_color(n: int) -> str:
    if n == 0: return "GREEN"
    if n in RED_NUMBERS: return "RED"
    return "BLACK"

PAYOUTS = {"RED": 2, "BLACK": 2, "GREEN": 14, "EVEN": 2, "ODD": 2}

def check_win(bet_type: str, number: int) -> bool:
    if bet_type == "RED":   return number in RED_NUMBERS
    if bet_type == "BLACK": return number not in RED_NUMBERS and number != 0
    if bet_type == "GREEN": return number == 0
    if bet_type == "EVEN":  return number != 0 and number % 2 == 0
    if bet_type == "ODD":   return number % 2 == 1
    return False

# ─── Состояние ─────────────────────────────────────────────
STARTING_BALANCE = 1000
BETTING_TIME     = 20
SPINNING_TIME    = 4
RESULT_TIME      = 6

# players: { mac_or_id: { "balance": int, "bet": {"type": str, "amount": int} | None } }
players: dict = {}

# connections: { client_key: WebSocket }
connections: dict = {}

game_state = {
    "phase":  "BETTING",
    "timer":  BETTING_TIME,
    "number": None,
    "color":  None,
}

# ─── Broadcast ─────────────────────────────────────────────
async def broadcast(msg: dict):
    dead = []
    for key, ws in list(connections.items()):
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(key)
    for key in dead:
        connections.pop(key, None)

def make_state_msg(extra: dict = {}) -> dict:
    msg = {
        "type":    "state",
        "phase":   game_state["phase"],
        "timer":   game_state["timer"],
        "number":  game_state["number"],
        "color":   game_state["color"],
        "players": [
            {"id": pid, "balance": p["balance"], "bet": p["bet"]}
            for pid, p in players.items()
        ],
    }
    msg.update(extra)
    return msg

# ─── Game loop ─────────────────────────────────────────────
async def game_loop():
    while True:
        # ── BETTING ──────────────────────────────────────
        game_state["phase"]  = "BETTING"
        game_state["number"] = None
        game_state["color"]  = None
        for p in players.values():
            p["bet"] = None

        for t in range(BETTING_TIME, 0, -1):
            game_state["timer"] = t
            await broadcast(make_state_msg())
            await asyncio.sleep(1)

        # ── SPINNING ─────────────────────────────────────
        number = random.randint(0, 36)
        color  = get_color(number)
        game_state["phase"] = "SPINNING"

        for t in range(SPINNING_TIME, 0, -1):
            game_state["timer"] = t
            await broadcast(make_state_msg())
            await asyncio.sleep(1)

        # ── Считаем выигрыши ─────────────────────────────
        for pid, p in players.items():
            if p["bet"]:
                bt     = p["bet"]["type"]
                amount = p["bet"]["amount"]
                if check_win(bt, number):
                    p["balance"] += amount * (PAYOUTS[bt] - 1)
                else:
                    p["balance"] -= amount
                p["balance"] = max(0, p["balance"])

        # ── RESULT ───────────────────────────────────────
        game_state.update({"phase": "RESULT", "number": number, "color": color})

        for t in range(RESULT_TIME, 0, -1):
            game_state["timer"] = t
            await broadcast(make_state_msg())
            await asyncio.sleep(1)

# ─── Startup ───────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    asyncio.create_task(game_loop())

# ─── WebSocket endpoint ────────────────────────────────────
_browser_counter = 0

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    global _browser_counter
    await websocket.accept()

    client_key = f"anon_{_browser_counter}"
    _browser_counter += 1
    connections[client_key] = websocket

    # Сразу отправить текущее состояние
    await websocket.send_json(make_state_msg())

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # ── join ─────────────────────────────────────
            if msg_type == "join":
                pid = data["player_id"]
                connections.pop(client_key, None)
                client_key = pid
                connections[pid] = websocket

                if pid not in players:
                    players[pid] = {"balance": STARTING_BALANCE, "bet": None}

                await websocket.send_json({
                    "type":      "joined",
                    "player_id": pid,
                    "balance":   players[pid]["balance"],
                })

            # ── bet ──────────────────────────────────────
            elif msg_type == "bet":
                pid = data.get("player_id", client_key)

                if game_state["phase"] != "BETTING":
                    await websocket.send_json({
                        "type": "error", "player_id": pid, "code": "WRONG_PHASE"
                    })
                    continue

                if pid not in players:
                    continue

                amount   = int(data.get("amount", 0))
                bet_type = data.get("bet_type", "")

                if amount <= 0 or amount > players[pid]["balance"]:
                    await websocket.send_json({
                        "type": "error", "player_id": pid, "code": "BET_TOO_LARGE"
                    })
                    continue

                players[pid]["bet"] = {"type": bet_type, "amount": amount}
                await websocket.send_json({"type": "bet_accepted"})
                # Broadcast обновлённый список ставок
                await broadcast(make_state_msg())

    except WebSocketDisconnect:
        connections.pop(client_key, None)
```

### Запуск сервера

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Сервер доступен на `http://localhost:8000`.
WebSocket: `ws://localhost:8000/ws`

---

## Часть 2 — Фронтенд (React + Vite)

### Установка

```bash
cd casino/frontend
npm create vite@latest . -- --template react
npm install
```

Замени содержимое файлов ниже.

---

### `vite.config.js`

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
```

---

### `src/hooks/useGameSocket.js`

```js
import { useEffect, useRef, useState, useCallback } from 'react'

const WS_URL = `ws://${window.location.hostname}:8000/ws`

export function useGameSocket() {
  const ws = useRef(null)
  const [connected, setConnected] = useState(false)
  const [gameState, setGameState] = useState({
    phase: 'BETTING',
    timer: 20,
    number: null,
    color: null,
    players: [],
  })

  useEffect(() => {
    function connect() {
      const socket = new WebSocket(WS_URL)
      ws.current = socket

      socket.onopen = () => setConnected(true)
      socket.onclose = () => {
        setConnected(false)
        setTimeout(connect, 2000)
      }
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'state') {
          setGameState({
            phase:   msg.phase,
            timer:   msg.timer,
            number:  msg.number,
            color:   msg.color,
            players: msg.players ?? [],
          })
        }
      }
    }
    connect()
    return () => ws.current?.close()
  }, [])

  const sendBet = useCallback((playerId, betType, amount) => {
    ws.current?.send(JSON.stringify({
      type: 'bet', player_id: playerId, bet_type: betType, amount,
    }))
  }, [])

  return { connected, gameState, sendBet }
}
```

---

### `src/components/PhaseTimer.jsx`

```jsx
export function PhaseTimer({ phase, timer }) {
  const labels = { BETTING: 'Ставки', SPINNING: 'Крутится', RESULT: 'Результат' }
  const colors = { BETTING: '#4caf50', SPINNING: '#ff9800', RESULT: '#2196f3' }

  return (
    <div style={{ textAlign: 'center', marginBottom: 16 }}>
      <span style={{
        background: colors[phase] ?? '#888',
        color: '#fff',
        padding: '4px 16px',
        borderRadius: 20,
        fontWeight: 'bold',
        fontSize: 14,
        letterSpacing: 1,
      }}>
        {labels[phase] ?? phase}
      </span>
      <div style={{ fontSize: 32, fontWeight: 'bold', marginTop: 8 }}>
        {timer}с
      </div>
    </div>
  )
}
```

---

### `src/components/RouletteWheel.jsx`

```jsx
import { useEffect, useRef } from 'react'
import './RouletteWheel.css'

// Европейская рулетка — порядок чисел на колесе
const WHEEL_ORDER = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,
  24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26,
]
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])

function getColor(n) {
  if (n === 0) return '#2e7d32'
  return RED_NUMBERS.has(n) ? '#c62828' : '#212121'
}

export function RouletteWheel({ phase, resultNumber }) {
  const wheelRef = useRef(null)
  const prevPhase = useRef(phase)

  useEffect(() => {
    const el = wheelRef.current
    if (!el) return

    if (phase === 'SPINNING') {
      el.style.animation = 'none'
      el.offsetHeight // reflow
      el.style.animation = 'spin 0.6s linear infinite'
    } else if (phase === 'RESULT' && prevPhase.current === 'SPINNING') {
      // Остановить на позиции выпавшего числа
      const idx = WHEEL_ORDER.indexOf(resultNumber)
      const deg = idx !== -1 ? -(idx * (360 / WHEEL_ORDER.length)) : 0
      el.style.animation = 'none'
      el.style.transform = `rotate(${deg}deg)`
    } else if (phase === 'BETTING') {
      el.style.animation = 'none'
      el.style.transform = 'rotate(0deg)'
    }

    prevPhase.current = phase
  }, [phase, resultNumber])

  const total = WHEEL_ORDER.length
  const segAngle = 360 / total
  const radius = 130
  const cx = 150
  const cy = 150

  return (
    <div style={{ position: 'relative', width: 300, height: 300, margin: '0 auto' }}>
      {/* Указатель */}
      <div style={{
        position: 'absolute', top: 4, left: '50%',
        transform: 'translateX(-50%)',
        width: 0, height: 0,
        borderLeft: '8px solid transparent',
        borderRight: '8px solid transparent',
        borderTop: '20px solid gold',
        zIndex: 10,
      }} />

      <svg
        ref={wheelRef}
        width={300}
        height={300}
        style={{ transformOrigin: '150px 150px' }}
      >
        {WHEEL_ORDER.map((num, i) => {
          const startAngle = (i * segAngle - 90) * (Math.PI / 180)
          const endAngle   = ((i + 1) * segAngle - 90) * (Math.PI / 180)
          const x1 = cx + radius * Math.cos(startAngle)
          const y1 = cy + radius * Math.sin(startAngle)
          const x2 = cx + radius * Math.cos(endAngle)
          const y2 = cy + radius * Math.sin(endAngle)
          const midAngle = ((i + 0.5) * segAngle - 90) * (Math.PI / 180)
          const tx = cx + (radius - 20) * Math.cos(midAngle)
          const ty = cy + (radius - 20) * Math.sin(midAngle)

          return (
            <g key={i}>
              <path
                d={`M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 0,1 ${x2},${y2} Z`}
                fill={getColor(num)}
                stroke="#fff"
                strokeWidth={0.5}
              />
              <text
                x={tx} y={ty}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#fff"
                fontSize={9}
                transform={`rotate(${(i + 0.5) * segAngle}, ${tx}, ${ty})`}
              >
                {num}
              </text>
            </g>
          )
        })}
        {/* Центр */}
        <circle cx={cx} cy={cy} r={20} fill="#333" stroke="#fff" strokeWidth={2} />
      </svg>
    </div>
  )
}
```

### `src/components/RouletteWheel.css`

```css
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
```

---

### `src/components/PlayerList.jsx`

```jsx
const BET_LABELS = { RED: '🔴 Красное', BLACK: '⚫ Чёрное', GREEN: '🟢 Зелёное', EVEN: '🔵 Чётное', ODD: '🟡 Нечётное' }

export function PlayerList({ players, resultColor, resultNumber, phase }) {
  if (!players.length) {
    return <p style={{ color: '#888', textAlign: 'center' }}>Нет подключённых игроков</p>
  }

  return (
    <div>
      {players.map((p) => {
        let highlight = null
        if (phase === 'RESULT' && p.bet) {
          const won = checkWin(p.bet.type, resultNumber)
          highlight = won ? '#1b5e20' : '#b71c1c'
        }
        return (
          <div key={p.id} style={{
            background: highlight ?? '#1e1e2e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            transition: 'background 0.5s',
          }}>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {p.id.slice(-8)}
              </div>
              {p.bet && (
                <div style={{ fontSize: 13, color: '#ccc' }}>
                  {BET_LABELS[p.bet.type] ?? p.bet.type} — {p.bet.amount} монет
                </div>
              )}
              {!p.bet && <div style={{ fontSize: 12, color: '#555' }}>нет ставки</div>}
            </div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#fff' }}>
              {p.balance}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])
function checkWin(betType, number) {
  if (betType === 'RED')   return RED_NUMBERS.has(number)
  if (betType === 'BLACK') return !RED_NUMBERS.has(number) && number !== 0
  if (betType === 'GREEN') return number === 0
  if (betType === 'EVEN')  return number !== 0 && number % 2 === 0
  if (betType === 'ODD')   return number % 2 === 1
  return false
}
```

---

### `src/App.jsx`

```jsx
import { useGameSocket } from './hooks/useGameSocket'
import { RouletteWheel } from './components/RouletteWheel'
import { PlayerList } from './components/PlayerList'
import { PhaseTimer } from './components/PhaseTimer'
import './App.css'

const COLOR_LABELS = { RED: '🔴 Красное', BLACK: '⚫ Чёрное', GREEN: '🟢 Зелёное' }

export default function App() {
  const { connected, gameState } = useGameSocket()
  const { phase, timer, number, color, players } = gameState

  return (
    <div className="app">
      <header className="header">
        <h1>🎰 IoT Roulette</h1>
        <span className={`dot ${connected ? 'online' : 'offline'}`}>
          {connected ? 'Online' : 'Offline'}
        </span>
      </header>

      <main className="main">
        {/* Левая колонка — колесо */}
        <section className="wheel-section">
          <PhaseTimer phase={phase} timer={timer} />
          <RouletteWheel phase={phase} resultNumber={number} />

          {phase === 'RESULT' && number !== null && (
            <div className="result-banner">
              <div className="result-number">{number}</div>
              <div className="result-color">{COLOR_LABELS[color] ?? color}</div>
            </div>
          )}
        </section>

        {/* Правая колонка — игроки */}
        <section className="players-section">
          <h2>Игроки ({players.length})</h2>
          <PlayerList
            players={players}
            resultColor={color}
            resultNumber={number}
            phase={phase}
          />
        </section>
      </main>
    </div>
  )
}
```

---

### `src/App.css`

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #0d0d1a;
  color: #fff;
  font-family: 'Segoe UI', sans-serif;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #161625;
  border-bottom: 1px solid #2a2a3e;
}

.header h1 { font-size: 22px; }

.dot {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: bold;
}
.dot.online  { background: #1b5e20; color: #69f0ae; }
.dot.offline { background: #b71c1c; color: #ff8a80; }

.main {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 24px;
  padding: 24px;
  flex: 1;
}

@media (max-width: 700px) {
  .main { grid-template-columns: 1fr; }
}

.wheel-section {
  background: #161625;
  border-radius: 12px;
  padding: 20px;
}

.players-section {
  background: #161625;
  border-radius: 12px;
  padding: 20px;
}

.players-section h2 {
  margin-bottom: 12px;
  font-size: 16px;
  color: #aaa;
}

.result-banner {
  margin-top: 16px;
  text-align: center;
  animation: pop 0.4s ease;
}

.result-number {
  font-size: 64px;
  font-weight: bold;
  line-height: 1;
}

.result-color {
  font-size: 22px;
  margin-top: 4px;
  color: #ddd;
}

@keyframes pop {
  0%   { transform: scale(0.5); opacity: 0; }
  60%  { transform: scale(1.1); }
  100% { transform: scale(1);   opacity: 1; }
}
```

---

### Запуск фронтенда

```bash
cd casino/frontend
npm run dev
```

Открой `http://localhost:5173`

---

## Итоговый запуск

```bash
# Терминал 1 — сервер
cd casino/server
source venv/bin/activate   # или venv\Scripts\activate на Windows
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Терминал 2 — фронтенд
cd casino/frontend
npm run dev
```

Затем прошей ESP8266 (см. HARDWARE_SETUP.md) — он сам подключится к серверу по WebSocket.

---

## Проверка без железа

Можно протестировать WebSocket вручную:

```bash
# Установи wscat
npm install -g wscat

# Подключись
wscat -c ws://localhost:8000/ws

# Отправь join
{"type":"join","player_id":"TEST:00:00"}

# Сделай ставку (во время фазы BETTING)
{"type":"bet","player_id":"TEST:00:00","bet_type":"RED","amount":50}
```

Каждую секунду будет приходить `state` с текущей фазой и таймером.
