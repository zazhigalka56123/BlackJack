# IoT Roulette — план реализации

## Контекст
IoT-проект: веб-рулетка (React + FastAPI) + аппаратные клиенты на ESP8266 NodeMCU с панелью LED&KEY (TM1638: 8 цифр 7-сегмент + 8 LED + 8 кнопок). Ставки делаются с железа, рулетка крутится на сервере, результат отображается везде. **Запуск полностью локальный** — сервер на ноутбуке, ESP подключаются к той же Wi-Fi сети.

---

## Стек
| Уровень | Технологии |
|---|---|
| Сервер | Python 3.11+, FastAPI, `uvicorn`, встроенный `websockets` (через FastAPI), SQLite (`aiosqlite`) |
| Фронт | React 18, Vite, vanilla CSS (анимация колеса через `transform: rotate`) |
| ESP8266 | Arduino C++ (PlatformIO или Arduino IDE), `arduinoWebSockets` (Links2004), `TM1638plus` |

---

## Игровая механика

**Тайминг одного раунда:**
```
BETTING (20с) → SPINNING (4с) → RESULT (6с) → BETTING ...
```
Раунды идут непрерывно с момента старта сервера, даже если никто не подключён.

**Ставки и выплаты:**
| Тип | Описание | Множитель |
|---|---|---|
| RED | красные числа | x2 |
| BLACK | чёрные числа | x2 |
| GREEN | только 0 | x14 |
| EVEN | чётные 2,4,...,36 | x2 |
| ODD | нечётные 1,3,...,35 | x2 |

> Выплата x2 означает: ставка 50 → при выигрыше игрок получает 100 (т.е. чистая прибыль +50). При проигрыше -50.

**Европейская раскладка цветов (0–36):**
- GREEN: `{0}`
- RED: `{1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}`
- BLACK: `{2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35}`

**Баланс:**
- Новый игрок (новый MAC) → 1000 монет автоматически
- Хранится в SQLite на сервере
- Если баланс упал до 0 — игрок может смотреть, но не может ставить (сервер вернёт `INSUFFICIENT_FUNDS`)

**Ограничения ставок:**
- Мин ставка: 10
- Макс ставка: текущий баланс игрока
- Один игрок — одна активная ставка за раунд (новая `bet` заменяет предыдущую, разница возвращается)

---

## Архитектура WebSocket

Один WS-endpoint `ws://<server-ip>:8000/ws` — общий и для ESP, и для браузера.

### Идентификация
- ESP → `player_id` = MAC-адрес (формат `AA:BB:CC:DD:EE:FF`)
- Браузер → `player_id` = `"browser-<uuid>"` (сохраняется в localStorage), браузер видит игру в режиме наблюдателя (ставок не делает, балансы не имеет)

### Сообщения клиент → сервер

```json
// Подключение и идентификация (первое сообщение после WS connect)
{ "type": "join", "player_id": "AA:BB:CC:DD:EE:FF" }

// Ставка (только в фазе BETTING)
{ "type": "bet", "player_id": "AA:BB:CC:DD:EE:FF", "bet_type": "RED", "amount": 50 }

// Отмена ставки (вернуть деньги, только в фазе BETTING)
{ "type": "cancel_bet", "player_id": "AA:BB:CC:DD:EE:FF" }
```

### Сообщения сервер → клиент

**Broadcast (всем подключённым):**
```json
// Каждую секунду — общий state
{
  "type": "state",
  "phase": "BETTING",
  "timer": 18,
  "round_id": 42,
  "players": [
    { "id": "AA:BB:CC:DD:EE:FF", "balance": 980, "bet": { "type": "RED", "amount": 50 } }
  ]
}

// При SPINNING — добавляется уже известный результат (для синхронной анимации)
{
  "type": "state",
  "phase": "SPINNING",
  "timer": 3,
  "round_id": 42,
  "result": { "number": 17, "color": "RED" },
  "players": [ ... ]
}

// При RESULT — выплаты уже применены
{
  "type": "state",
  "phase": "RESULT",
  "timer": 5,
  "round_id": 42,
  "result": { "number": 17, "color": "RED" },
  "players": [
    { "id": "AA:BB:CC:DD:EE:FF", "balance": 1080, "bet": { "type": "RED", "amount": 50 }, "won": 100 }
  ]
}
```

**Адресные (только инициатору):**
```json
// Подтверждение join — игрок узнаёт свой баланс
{ "type": "welcome", "player_id": "AA:BB:CC:DD:EE:FF", "balance": 1000 }

// Подтверждение ставки
{ "type": "bet_accepted", "player_id": "AA:BB:CC:DD:EE:FF", "bet": { "type": "RED", "amount": 50 }, "balance": 950 }

// Ошибки
{ "type": "error", "player_id": "AA:BB", "code": "BET_TOO_LARGE", "message": "Bet exceeds balance" }
{ "type": "error", "player_id": "AA:BB", "code": "BET_TOO_SMALL", "message": "Min bet 10" }
{ "type": "error", "player_id": "AA:BB", "code": "WRONG_PHASE", "message": "Bets closed" }
{ "type": "error", "player_id": "AA:BB", "code": "INSUFFICIENT_FUNDS", "message": "Balance is 0" }
{ "type": "error", "player_id": "AA:BB", "code": "UNKNOWN_PLAYER", "message": "Send join first" }
```

---

## Сервер (FastAPI)

**Файловая структура:**
```
server/
  main.py          # FastAPI app, WS endpoint, lifespan, запуск GameLoop
  game.py          # GameLoop — state machine, asyncio task
  db.py            # SQLite: players, rounds (история)
  roulette.py      # spin logic, COLOR_MAP, payouts
  ws_manager.py    # ConnectionManager: список WS, broadcast, send_to
  models.py        # Pydantic-модели сообщений
  requirements.txt
  casino.db        # создаётся автоматически при первом запуске
```

### `roulette.py`
```python
RED   = {1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}
BLACK = {2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35}

def spin() -> int: return random.randint(0, 36)
def color_of(n: int) -> str: ...
def payout(bet_type, amount, number) -> int:
    # возвращает чистую дельту к балансу:
    # выигрыш RED со ставкой 50 на красное → +50 (ставка возвращена + столько же сверху)
    # проигрыш → -amount уже списан при принятии ставки, здесь 0
    # WIN  → +amount * (multiplier-1)  (т.к. сама ставка уже списана)
    # На самом деле при выигрыше отдаём +amount*multiplier (возврат + приз)
```

> **Соглашение по балансу:** при принятии ставки сразу списываем `amount`. В RESULT: если выиграл → начисляем `amount * multiplier` (вернули ставку + приз). Если проиграл → ничего не делаем.

### `game.py — GameLoop`
- `asyncio.Task`, стартует через FastAPI `lifespan`
- Состояние в памяти: `phase`, `timer`, `round_id`, `bets: dict[player_id, Bet]`, `last_result`
- Каждую секунду:
  1. `timer -= 1`
  2. Если `timer == 0` → переход в следующую фазу
  3. Broadcast `state` через `ws_manager`

**Переходы:**
- `BETTING → SPINNING`: вычисляем `result = spin()`, замораживаем `bets`, `timer = 4`
- `SPINNING → RESULT`: считаем выплаты, обновляем балансы в БД, рассылаем итоговый state, `timer = 6`
- `RESULT → BETTING`: `round_id += 1`, очищаем `bets`, `timer = 20`

### `db.py`
```python
# таблицы:
players(mac TEXT PRIMARY KEY, balance INTEGER, created_at TIMESTAMP)
rounds(id INTEGER PK, number INTEGER, color TEXT, played_at TIMESTAMP)
bets_history(round_id INTEGER, player_mac TEXT, bet_type TEXT, amount INTEGER, won INTEGER)

# методы:
async def get_or_create_player(mac) -> int  # возвращает balance
async def update_balance(mac, delta) -> int
async def record_round(number, color) -> int
async def record_bet(round_id, mac, bet_type, amount, won)
```

### `ws_manager.py`
```python
class ConnectionManager:
    connections: dict[WebSocket, str | None]  # ws → player_id (None до join)

    async def connect(ws): ...
    async def disconnect(ws): ...
    async def broadcast(message: dict): ...
    async def send_to(player_id, message): ...
    def online_players() -> set[str]
```

### `main.py`
- FastAPI app с `lifespan` → запускает `GameLoop`
- `@app.websocket("/ws")` — основная точка
- `GET /` — простая отладочная страничка / редирект на фронт
- `GET /players` — список игроков (для отладки)
- CORS открыт для `localhost:5173` (Vite dev server)

### Edge-cases на сервере
- **Игрок отключился во время BETTING** — ставка остаётся, выплата всё равно применится к балансу в БД
- **Игрок отключился до join** — игнорируем все сообщения от этого WS
- **Дублирующиеся join** (один MAC дважды) — старый WS закрываем, новый занимает место
- **Сообщение в неверной фазе** — возвращаем `WRONG_PHASE`
- **Сервер падает** — балансы в БД сохранены, текущий раунд теряется (это ок для локального проекта)

---

## Фронт (React + Vite)

**Структура:**
```
frontend/
  index.html
  vite.config.js
  package.json
  src/
    main.jsx
    App.jsx
    api/
      socket.js              # WS-клиент с reconnect
    hooks/
      useGameSocket.js       # подписка на сообщения, обновление стейта
    components/
      RouletteWheel.jsx      # SVG/CSS колесо с rotate-анимацией
      BettingBoard.jsx       # таблица: тип ставки → список игроков и сумм
      PlayerList.jsx         # все онлайн игроки + балансы
      PhaseTimer.jsx         # большой таймер + название фазы
      ResultBanner.jsx       # выпавшее число и цвет в фазе RESULT
      HistoryStrip.jsx       # последние 10 чисел (лента сверху)
    styles/
      app.css
```

### Анимация колеса
- 37 секторов (0-36), нарисованы SVG-ом
- В фазе `SPINNING`: `transform: rotate(<целевой угол + 5 * 360>deg)` с `transition: transform 4s cubic-bezier(.2,.8,.2,1)`
- Целевой угол вычисляется из `result.number` (известен в начале SPINNING благодаря `state` сообщению)
- В фазе `RESULT`: колесо стоит, подсвечивается сектор результата

### Поведение по фазам
| Фаза | UI |
|---|---|
| BETTING | колесо стоит, таймер обратного отсчёта, BettingBoard обновляется live |
| SPINNING | колесо крутится, BettingBoard заморожен, таймер 4с |
| RESULT | колесо остановилось на числе, ResultBanner большим планом, выигравшие подсвечены зелёным, проигравшие красным |

### `useGameSocket.js`
- Подключается к `ws://localhost:8000/ws`
- Шлёт `join` с `browser-<uuid>` из localStorage
- Хранит реактивный `gameState` (phase, timer, players, result, round_id, history)
- Reconnect с экспоненциальной задержкой при разрыве

---

## ESP8266 — раскладка кнопок и дисплей

**LED&KEY (TM1638) — 8 кнопок:**
| Кнопка | Действие |
|---|---|
| S1 | Выбрать тип ставки RED |
| S2 | Выбрать тип ставки BLACK |
| S3 | Выбрать тип ставки GREEN |
| S4 | Выбрать тип ставки EVEN |
| S5 | Выбрать тип ставки ODD |
| S6 | Сумма ставки +10 |
| S7 | Сумма ставки -10 |
| S8 (короткое нажатие <500мс) | ПОДТВЕРДИТЬ ставку |
| S8 (удержание ≥1.5с) | Показать баланс (5с, затем вернуться) |

> 8 кнопок хватает: баланс через long-press S8 — освобождает кнопку, не теряя функцию подтверждения.

**LED-индикаторы (8 LED над цифрами):**
- LED1–LED5 — горит LED выбранного типа ставки (только один одновременно)
- LED6 — мигает в фазе SPINNING
- LED7 — горит в RESULT если выиграл
- LED8 — горит в RESULT если проиграл (или нет ставки)

### Состояния прошивки (FSM)
```
BOOT → WIFI_CONNECTING → WS_CONNECTING → WAITING_JOIN_ACK
   → IDLE (фаза BETTING, ставка не выбрана)
   → BET_SELECTING (выбран тип, ввод суммы)
   → BET_SENT (ждём bet_accepted)
   → BET_PLACED (ставка принята, ждём конца раунда)
   → SPINNING (показываем анимацию)
   → SHOWING_RESULT
   → BALANCE_VIEW (временный, по long-press S8)
   → RECONNECTING
```

### 7-сегментный дисплей — все экраны
| Состояние | Дисплей | Пример |
|---|---|---|
| WiFi подключение | бегущая точка | `........` анимация |
| WiFi ошибка | `no UIFI ` | мигает |
| WS подключение | `ConnEct ` | |
| WS ок, ожидание welcome | `JoIn----` | |
| Готов (welcome получен) | `rEAdy   ` 1с | |
| WS разрыв / реконнект | `rEConn  ` мигает | |
| BETTING, ставка не выбрана | `bEt  XXX` (текущая сумма) | `bEt  050` |
| BETTING, тип выбран | аббревиатура + сумма | `rEd  050`, `bLA  100`, `grn   10`, `EUEn 020`, `odd  030` |
| Ставка слишком велика | `oUEr----` 1с → возврат | |
| Ставка слишком мала | `Lo Lo Lo` 1с → возврат | |
| Ставка отправлена, ждём ack | `Send... ` | |
| Ставка подтверждена | `SEnt OK ` 1с → BET_PLACED | |
| Показ баланса (long S8) | `bAL XXXX` 5с | `bAL  980` |
| SPINNING | бегущая `---SPIn-` | |
| RESULT (выигрыш) | `UIn XXXX` 6с | `UIn  100` |
| RESULT (проигрыш) | `LoSE  NN` (выпавший номер) | `LoSE  17` |
| RESULT (нет ставки) | `--  NN--` | `--  17--` |

> 7-сегментный индикатор не различает заглавные/строчные. Здесь нотация условная (как принято рисовать буквы на сегментах).

### Логика прошивки (псевдокод)
```
setup():
  Serial.begin(115200)
  tm.init()
  display("........")
  WiFi.begin(SSID, PASS)
  while WiFi not connected (timeout 20с): animate dots
  if fail: display("no UIFI"), halt
  display("ConnEct ")
  webSocket.begin(SERVER_IP, 8000, "/ws")
  webSocket.onEvent(wsEvent)
  webSocket.setReconnectInterval(3000)

loop():
  webSocket.loop()
  pollButtons()        // дебаунс 50мс, long-press 1500мс
  handleStateMachine()
  refreshDisplay()     // не чаще 10 раз/сек

wsEvent(type, payload):
  CONNECTED:
    sendJSON({type:"join", player_id: macAddress()})
    state = WAITING_JOIN_ACK
  DISCONNECTED:
    state = RECONNECTING
  TEXT:
    msg = parseJSON(payload)
    switch msg.type:
      "welcome":     balance = msg.balance; state = IDLE; display("rEAdy") for 1s
      "state":       updatePhase(msg.phase, msg.timer, msg.result)
                     updateMyData(msg.players)  // найти себя по MAC
      "bet_accepted": balance = msg.balance; state = BET_PLACED; display("SEnt OK") 1s
      "error":       handleError(msg.code)

handleButtons() в фазе BETTING:
  if any of S1..S5 pressed:
    selectedType = mapButtonToType(btn)
    if state == IDLE: betAmount = 10
    state = BET_SELECTING
    setBetLED(selectedType)
  S6: if (betAmount + 10 <= balance) betAmount += 10
      else display("oUEr----") 1s
  S7: if (betAmount > 10) betAmount -= 10
  S8 short:
    if state == BET_SELECTING and betAmount >= 10:
      sendJSON({type:"bet", player_id: mac, bet_type: selectedType, amount: betAmount})
      state = BET_SENT
      display("Send... ")
  S8 long (>=1500ms):
    previousScreen = currentScreen
    state = BALANCE_VIEW
    display("bAL " + balance)
    schedule(5s, () => state = previousScreenState)

handleError(code):
  BET_TOO_LARGE → display("oUEr----") 1s, state = BET_SELECTING
  BET_TOO_SMALL → display("Lo Lo Lo") 1s, state = BET_SELECTING
  WRONG_PHASE   → display("no bEt  ") 1s
  INSUFFICIENT_FUNDS → display("no Coin ") 2s
  UNKNOWN_PLAYER → отправить join повторно
```

### `config.h`
```cpp
#define WIFI_SSID     "YourSSID"
#define WIFI_PASS     "YourPass"
#define SERVER_HOST   "192.168.1.100"   // IP ноута в локалке
#define SERVER_PORT   8000
#define WS_PATH       "/ws"
```

---

## Файловая структура проекта
```
Casino_Y_Arseniya_Ivana_I_Konstantina/
  ROULETTE_PLAN.md
  README.md                  # гайд по сборке (см. ниже)
  server/
    main.py
    game.py
    db.py
    roulette.py
    ws_manager.py
    models.py
    requirements.txt
    .gitignore               # casino.db, __pycache__
  frontend/
    index.html
    vite.config.js
    package.json
    src/...
  esp8266/
    roulette_client/
      roulette_client.ino
      config.h.example
      config.h               # gitignored
```

---

## Гайдлайн: как всё собрать и запустить локально

### 0. Требования
- macOS / Linux / Windows
- Python 3.11+ (`python3 --version`)
- Node.js 18+ (`node --version`)
- Arduino IDE 2.x **или** PlatformIO (для прошивки ESP8266)
- ESP8266 NodeMCU + LED&KEY (TM1638) модуль + Micro-USB кабель
- Все устройства в одной Wi-Fi сети (ноут + ESP)

### 1. Узнать локальный IP ноута
```bash
# macOS / Linux
ipconfig getifaddr en0    # или ifconfig | grep "inet "
# Windows
ipconfig
```
Запомни (например `192.168.1.100`) — пойдёт в `config.h` для ESP и в `.env` фронта.

### 2. Сервер
```bash
cd server
python3 -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- `--host 0.0.0.0` — обязательно, чтобы ESP мог достучаться
- Открой `http://localhost:8000/docs` — должны быть видны эндпоинты
- БД `casino.db` создастся автоматически

**Тест WS вручную:**
```bash
pip install websockets
# или используй wscat
npx wscat -c ws://localhost:8000/ws
> {"type":"join","player_id":"TEST:01"}
# должен прийти welcome и каждую секунду — state
```

### 3. Фронт
```bash
cd frontend
npm install
# создай .env.local:
echo "VITE_WS_URL=ws://localhost:8000/ws" > .env.local
npm run dev
```
Открой `http://localhost:5173` — увидишь колесо и фазы.
Если запускаешь с другого устройства в сети — `npm run dev -- --host` и заходи на `http://<ip-ноута>:5173`.

### 4. ESP8266 (Arduino IDE)
1. **Поставить поддержку платы:** File → Preferences → Additional Boards Manager URLs → `http://arduino.esp8266.com/stable/package_esp8266com_index.json`. Tools → Board → Boards Manager → найти `esp8266`, установить.
2. **Выбрать плату:** Tools → Board → `NodeMCU 1.0 (ESP-12E Module)`, порт — твой `/dev/cu.usbserial-*` или `COM*`.
3. **Установить библиотеки:** Tools → Manage Libraries:
   - `WebSockets` by Markus Sattler (Links2004)
   - `TM1638plus` by gavlasa
   - `ArduinoJson` by Benoit Blanchon (для парсинга state)
4. **Подключить LED&KEY:**
   | TM1638 | NodeMCU |
   |---|---|
   | VCC | 3V3 |
   | GND | GND |
   | STB (strobe) | D4 (GPIO2) |
   | CLK | D5 (GPIO14) |
   | DIO | D6 (GPIO12) |
5. **Настроить config.h:** скопировать `config.h.example` → `config.h`, вписать SSID, пароль, IP ноута.
6. **Прошить:** открыть `roulette_client.ino`, Sketch → Upload. Открыть Serial Monitor (115200) — увидеть `WiFi connected`, `WS connected`, `welcome received, balance=1000`.

### 5. End-to-end проверка
1. Запущен сервер (`uvicorn` в одном терминале)
2. Запущен фронт (`npm run dev` в другом)
3. ESP включена, в Serial Monitor видно подключение
4. На фронте видна фаза BETTING с таймером
5. На ESP жмём S1 (RED), S6 три раза (сумма 40), S8 (подтвердить)
6. На дисплее ESP: `rEd  040` → `Send... ` → `SEnt OK`
7. На фронте в BettingBoard появляется ставка нашего MAC
8. Ждём конца BETTING → колесо крутится → выпадает число
9. Если выиграли — на ESP `UIn  080`, баланс обновился на фронте и при long-press S8 на железе

### 6. Troubleshooting
| Симптом | Причина | Решение |
|---|---|---|
| ESP не подключается к WS | сервер запущен на `127.0.0.1` | перезапустить с `--host 0.0.0.0` |
| ESP `no UIFI` | неверные SSID/пароль или 5GHz сеть | ESP8266 только 2.4GHz, проверь config.h |
| Фронт не видит сервер | CORS / неверный IP | проверь `VITE_WS_URL` и CORS в `main.py` |
| Дисплей пустой | неверная распайка пинов | проверь STB/CLK/DIO |
| Кнопки не работают | TM1638 не отвечает | проверь GND и питание 3V3 |

---

## Порядок реализации (рекомендуемый)
1. **Сервер skeleton**: `roulette.py` + `db.py` + `main.py` с заглушкой WS → проверить `/docs` и SQLite
2. **GameLoop**: state machine без выплат → подключиться через `wscat`, увидеть тики state
3. **Логика ставок и выплат** → юнит-тест на `payout()`, проверить через wscat
4. **Фронт**: подключение + PlayerList + PhaseTimer (без колеса)
5. **Колесо** с анимацией
6. **ESP**: WiFi + WS + welcome → дисплей показывает rEAdy
7. **ESP ставки**: S1-S8, отправка bet, обработка ответов
8. **ESP полный UX**: long-press, все экраны ошибок, индикация фаз
9. **Polishing**: HistoryStrip, ResultBanner, звуки/мигания
