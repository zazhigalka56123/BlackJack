# IoT Roulette — план реализации

## Контекст
IoT-проект: веб-рулетка (React + FastAPI) + аппаратные клиенты на ESP8266 NodeMCU с панелью LED&KEY (TM1638: 8 цифр 7-сегмент + 8 LED + 8 кнопок). Ставки делаются с железа, рулетка крутится на сервере, результат отображается везде.

---

## Стек
| Уровень | Технологии |
|---|---|
| Сервер | Python 3.11, FastAPI, `websockets`, SQLite (через `aiosqlite`) |
| Фронт | React 18, Vite, CSS-анимация колеса |
| ESP8266 | Arduino C++, `arduinoWebSockets`, `TM1638` библиотека |

---

## Игровая механика

**Тайминг одного раунда:**
```
BETTING (20с) → SPINNING (4с) → RESULT (6с) → BETTING ...
```

**Ставки и выплаты:**
| Тип | Описание | Выплата |
|---|---|---|
| RED | числа красного цвета (1-36) | x2 |
| BLACK | числа чёрного цвета (1-36) | x2 |
| GREEN | только 0 | x14 |
| EVEN | чётные 2,4,...36 | x2 |
| ODD | нечётные 1,3,...35 | x2 |

Результат — случайное число 0–36. Цвет определяется стандартной европейской раскладкой.

**Баланс:** новый игрок (новый MAC) → 1000 монет автоматически. Хранится в SQLite на сервере.

---

## Архитектура WebSocket

Один WS-endpoint `/ws` — общий и для ESP, и для браузера.

### Сообщения сервер → клиент (broadcast)
```json
{ "type": "state", "phase": "BETTING", "timer": 18, "players": [{"id":"AA:BB", "balance":980, "bet":{"type":"RED","amount":50}}] }
{ "type": "state", "phase": "SPINNING", "timer": 3 }
{ "type": "state", "phase": "RESULT", "number": 17, "color": "RED", "timer": 5 }
```

### Сообщения клиент → сервер
```json
{ "type": "join", "player_id": "AA:BB:CC:DD:EE:FF" }
{ "type": "bet", "player_id": "AA:BB:CC:DD:EE:FF", "bet_type": "RED", "amount": 50 }
```

---

## Сервер (FastAPI)

**Файловая структура:**
```
server/
  main.py          # FastAPI app, WS endpoint
  game.py          # GameLoop — state machine, asyncio task
  db.py            # SQLite: players, balance
  roulette.py      # spin logic, color map 0-36
```

**game.py — state machine:**
- `asyncio` задача, крутится бесконечно
- Фазы: `BETTING → SPINNING → RESULT → BETTING`
- В `RESULT` считает выигрыши, обновляет баланс в БД
- После каждого тика шлёт `state` broadcast всем WS-клиентам

**db.py:**
- `get_or_create_player(mac)` → возвращает баланс (1000 если новый)
- `update_balance(mac, delta)`

**REST (опционально):**
- `GET /players` — список игроков с балансами (для отладки)

---

## Фронт (React)

**Структура:**
```
frontend/
  src/
    App.jsx
    components/
      RouletteWheel.jsx   # CSS-анимированное колесо
      BettingBoard.jsx    # таблица ставок игроков
      PlayerList.jsx      # список подключённых с балансами
      PhaseTimer.jsx      # таймер фазы
    hooks/
      useGameSocket.js    # WS подключение, стейт игры
```

**Отображение по фазам:**
- `BETTING` — колесо стоит, таблица принимает ставки (только отображение, ставки с ESP)
- `SPINNING` — CSS spin-анимация колеса
- `RESULT` — колесо останавливается на числе, подсвечиваются выигравшие ставки, +/- баланс

---

## ESP8266 — раскладка кнопок и дисплей

**LED&KEY (TM1638) — 8 кнопок:**
| Кнопка | Действие |
|---|---|
| S1 | Ставка RED |
| S2 | Ставка BLACK |
| S3 | Ставка GREEN |
| S4 | Ставка EVEN |
| S5 | Ставка ODD |
| S6 | Сумма ставки +10 |
| S7 | Сумма ставки -10 |
| S8 (короткое нажатие) | ПОДТВЕРДИТЬ ставку |
| S8 (удержание 1.5с) | Показать баланс (5с, затем вернуться) |

> 8 кнопок хватает: баланс через long-press S8 — освобождает кнопку, не теряя функцию.

**LED-индикаторы** (над кнопками S1–S5): горит LED выбранного типа ставки.

**7-сегментный дисплей (8 цифр) — все состояния:**
| Состояние | Дисплей | Пример |
|---|---|---|
| WiFi подключение | бегущая точка | `........` анимация |
| WiFi ошибка | `no uIFI` | |
| WS подключение | `ConnnEct` | |
| WS ок, ожидание join | `JoIn----` | |
| Готов (join получен) | `rEAdy` на 1с | |
| WS разрыв / реконнект | `rEConn` + мигание | |
| BETTING (нет ставки) | `bEt XXXX` (сумма) | `bEt  050` |
| BETTING (тип выбран) | аббревиатура + сумма | `rEd  050` |
| BETTING (ставка слишком велика) | `oUEr---` 1с → сброс | |
| BETTING (ставка подтверждена) | `SEnt---` на 1с | |
| BETTING (показ баланса, S8 hold) | `bAL XXXX` 5с | `bAL  980` |
| SPINNING | бегущая строка `--------SPIN` | |
| RESULT (выигрыш) | `uIn XXXX` (сумма выигрыша) | `uIn  150` |
| RESULT (проигрыш) | `LoSE----` | |
| RESULT (нет ставки) | `-- XX --` (выпавший номер) | `-- 17 --` |

**Серверный ответ на ставку (`error`):**
```json
{ "type": "error", "player_id": "AA:BB", "code": "BET_TOO_LARGE", "message": "..." }
{ "type": "error", "player_id": "AA:BB", "code": "WRONG_PHASE", "message": "..." }
```
ESP показывает `oUEr---` при `BET_TOO_LARGE` и `no bEt` при `WRONG_PHASE`.

**Логика прошивки (Arduino):**
```
setup():
  display("........")           // WiFi анимация
  WiFi.begin(SSID, PASS)
  если WiFi fail → display("no uIFI"), halt
  display("ConnnEct")
  webSocket.begin(SERVER_IP, PORT, "/ws")
  webSocket.onEvent(wsEventHandler)
  tm.init()

loop():
  webSocket.loop()
  checkReconnect()     // если WS упал — display("rEConn"), reconnect
  readButtons()        // дебаунс 50мс, long-press 1500мс
  updateDisplay()      // по текущему deviceState

wsEventHandler():
  WS_EVT_CONNECTED → отправить join(MAC), display("rEAdy")
  WS_EVT_DISCONNECTED → deviceState = RECONNECTING
  WS_EVT_DATA →
    type=state → обновить gamePhase, playerBalance, playerBet
    type=error → показать соответствующий экран ошибки

readButtons() во время BETTING:
  S1-S5 → выбрать тип ставки, зажечь LED, сбросить сумму если тип изменился
  S6 → betAmount += 10 (не превышать баланс, иначе display("oUEr---"))
  S7 → betAmount -= 10 (мин 10)
  S8 короткое → отправить bet; ждать confirm или error от сервера
  S8 удержание 1.5с → display("bAL XXXX") на 5с
```

---

## Файловая структура проекта
```
casino/
  server/
    main.py
    game.py
    db.py
    roulette.py
    requirements.txt
  frontend/
    src/...
    package.json
  esp8266/
    roulette_client.ino
    config.h          # SSID, PASS, SERVER_IP
```

---

## Верификация (как тестировать)

1. **Сервер**: `uvicorn main:app --reload` → открыть `/docs`, проверить `/players`
2. **WS вручную**: подключиться через `wscat -c ws://localhost:8000/ws`, отправить `join`, получать `state` каждую секунду
3. **Фронт**: `npm run dev` → видеть крутящееся колесо и смену фаз
4. **ESP**: прошить, открыть Serial Monitor → видеть подключение к WiFi, получение state; нажать S1 → LED загорается, S8 → в Serial "bet sent"
5. **E2E**: ESP делает ставку → на фронте в BettingBoard появляется ставка → RESULT приходит → баланс обновляется на дисплее и в браузере
