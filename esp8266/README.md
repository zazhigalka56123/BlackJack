# ESP8266 Roulette Client

Прошивка для NodeMCU ESP8266 + LED&KEY (TM1638).

## Что понадобится
- **Железо**: NodeMCU ESP8266 (ESP-12E) + модуль LED&KEY (TM1638) + 5 проводов "мама-мама" + Micro-USB кабель данных (НЕ "только зарядка")
- **Софт**: Arduino IDE 2.x (или PlatformIO)
- **Сеть**: ESP и ноут в одной Wi-Fi 2.4 GHz сети (5 GHz ESP8266 не умеет)

## Настройка Arduino IDE

1. **Поддержка ESP8266**:
   - Arduino IDE → Settings → "Additional Boards Manager URLs":
     `http://arduino.esp8266.com/stable/package_esp8266com_index.json`
   - Tools → Board → Boards Manager → найти `esp8266` (by ESP8266 Community) → Install
   - Tools → Board → ESP8266 Boards → **NodeMCU 1.0 (ESP-12E Module)**

2. **Библиотеки** (Sketch → Include Library → Manage Libraries):
   - `WebSockets` by Markus Sattler (Links2004 / arduinoWebSockets)
   - `ArduinoJson` by Benoit Blanchon (v7.x)
   - `TM1638plus` by Gavin Lyons

## Распайка LED&KEY → NodeMCU

| TM1638 | NodeMCU | GPIO |
|---|---|---|
| VCC | 3V3 | — |
| GND | GND | — |
| STB | D4 | GPIO2 |
| CLK | D5 | GPIO14 |
| DIO | D6 | GPIO12 |

Пины меняются в `config.h` (макросы `PIN_STB / PIN_CLK / PIN_DIO`).

## Конфигурация

1. Скопируй шаблон:
   ```bash
   cp roulette_client/config.h.example roulette_client/config.h
   ```
   (или сделай это руками в проводнике).

2. Открой `config.h` и впиши:
   - `WIFI_SSID`, `WIFI_PASS` — твоя сеть
   - `SERVER_HOST` — IP ноута в локалке (`ipconfig getifaddr en0` на маке)
   - `SERVER_PORT` — обычно 8000

`config.h` в git **не коммитится** (см. `.gitignore`).

## Прошивка

1. Открой `roulette_client/roulette_client.ino` в Arduino IDE
2. Подключи NodeMCU по USB
3. Tools → Port → выбрать `/dev/cu.usbserial-*` (mac) или `COM*` (Windows)
4. Sketch → Upload (или ⌘+U / Ctrl+U)
5. Открой Serial Monitor на **115200 baud**

## Что должно появиться в Serial Monitor

```
=== Roulette client booting ===
MAC: A4:CF:12:XX:YY:ZZ
WiFi connecting....
WiFi OK, IP: 192.168.1.42
Connecting WS to 192.168.1.100:8000/ws
WS connected to ws://192.168.1.100:8000/ws
-> join A4:CF:12:XX:YY:ZZ
welcome: balance=1000
```

И на дисплее по очереди: `........` → `ConnEct ` → `JoIn----` → `rEAdy   ` → `bEt   10`.

## Управление

| Кнопка | Действие |
|---|---|
| S1 | Выбрать RED |
| S2 | Выбрать BLACK |
| S3 | Выбрать GREEN (0) |
| S4 | Выбрать EVEN |
| S5 | Выбрать ODD |
| S6 | Сумма ставки +10 |
| S7 | Сумма ставки -10 |
| S8 короткое | Подтвердить ставку |
| S8 длинное (1.5с) | Показать баланс на 5с |

LED1–LED5 — индикация выбранного типа.
LED6 — мигает в SPINNING.
LED7 — горит при выигрыше.
LED8 — горит при проигрыше.

## Типичные ошибки

| Симптом | Причина | Решение |
|---|---|---|
| `no UIFI` мигает | неверный SSID/пароль или 5GHz сеть | проверить config.h, использовать 2.4 GHz |
| `ConnEct ` бесконечно | сервер не запущен или неверный IP | поднять uvicorn с `--host 0.0.0.0`, проверить `SERVER_HOST` |
| `rEConn  ` периодически | сервер падает / роутер режет соединения | посмотреть лог сервера |
| Дисплей пустой / мусор | неверная распайка | проверить STB/CLK/DIO и питание 3V3 |
| Кнопки не реагируют | TM1638 не отвечает | проверить GND |
| `oUEr----` при +10 | баланс кончился | дождаться выигрыша или раунда без ставки |

## Архитектура

См. [../ROULETTE_PLAN.md](../ROULETTE_PLAN.md) — там полное описание FSM, экранов и логики WS-протокола.
