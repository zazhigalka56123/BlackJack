# Сборка аппаратной части — ESP8266 + LED&KEY (TM1638)

## Что нужно

- NodeMCU ESP8266 (v2 или v3)
- Модуль LED&KEY на чипе TM1638 (8 цифр + 8 LED + 8 кнопок)
- 5 проводов «мама-мама» (или папа-мама, в зависимости от пинов)
- USB кабель для прошивки

---

## Шаг 1 — Подключение проводов

TM1638 имеет 5 контактов: `VCC`, `GND`, `STB`, `CLK`, `DIO`.

### Схема подключения

```
LED&KEY          NodeMCU
─────────        ───────
VCC       →      3V3  (или VIN для 5V, надёжнее)
GND       →      GND
STB       →      D8   (GPIO15)
CLK       →      D7   (GPIO13)
DIO       →      D6   (GPIO12)
```

### Визуально (NodeMCU вид сверху)

```
                    [ USB ]
               ┌────────────┐
          3V3  │ o        o │ GND
          GND  │ o        o │ D8  ← STB
          RST  │ o        o │ D7  ← CLK
           A0  │ o        o │ D6  ← DIO
          D0   │ o        o │ D5
          D1   │ o        o │ D4
          D2   │ o        o │ D3
     3V3 → VCC │ o        o │ D2
               └────────────┘
```

> **Совет:** Если дисплей работает нестабильно — подключи VCC к VIN (5V) вместо 3V3. Данные (STB/CLK/DIO) оставь на 3.3V пинах, ESP8266 толерантен.

---

## Шаг 2 — Установка Arduino IDE

1. Скачай Arduino IDE 2.x: https://www.arduino.cc/en/software
2. Установи, запусти.

---

## Шаг 3 — Добавить поддержку ESP8266

1. Открой `File → Preferences` (или `Ctrl+,`)
2. В поле **Additional boards manager URLs** вставь:
   ```
   https://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
3. Нажми OK
4. Открой `Tools → Board → Boards Manager`
5. Найди **esp8266 by ESP8266 Community**, нажми **Install** (~150 МБ)
6. После установки: `Tools → Board → ESP8266 Boards → NodeMCU 1.0 (ESP-12E Module)`

---

## Шаг 4 — Установить библиотеки

Открой `Tools → Manage Libraries` (или `Ctrl+Shift+I`), найди и установи каждую:

| Библиотека | Автор | Для чего |
|---|---|---|
| `TM1638plus` | Gavin Lyons | Дисплей + кнопки LED&KEY |
| `WebSockets` | Markus Sattler (arduinoWebSockets) | WebSocket клиент |
| `ArduinoJson` | Benoit Blanchon | Парсинг JSON |

> Ищи именно такие названия. Для WebSockets выбери версию **2.x** от Markus Sattler.

---

## Шаг 5 — Создать скетч

Создай новую папку `esp8266/` в проекте. Внутри два файла:

### `config.h`

```cpp
#pragma once

// WiFi
#define WIFI_SSID     "ИМЯ_ВАШЕЙ_СЕТИ"
#define WIFI_PASSWORD "ПАРОЛЬ_СЕТИ"

// Адрес сервера (IP компьютера в локальной сети, порт 8000)
#define WS_HOST "192.168.1.100"
#define WS_PORT 8000

// Пины TM1638
#define TM_STB D8
#define TM_CLK D7
#define TM_DIO D6
```

> **Как узнать IP компьютера:** в терминале выполни `ipconfig` (Windows) или `ifconfig` (Mac/Linux) — ищи строку IPv4, например `192.168.1.100`.

### `roulette_client.ino`

```cpp
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <TM1638plus.h>
#include "config.h"

// ─── Железо ────────────────────────────────────────────────
TM1638plus tm(TM_STB, TM_CLK, TM_DIO, true);
WebSocketsClient webSocket;

// ─── Состояние игры ────────────────────────────────────────
String gamePhase = "CONNECTING";
int  playerBalance = 1000;
String selectedBetType = "";   // "RED","BLACK","GREEN","EVEN","ODD"
int  betAmount = 10;
bool betSent = false;
int  lastResultNumber = -1;

// ─── Long-press S8 ─────────────────────────────────────────
unsigned long s8PressedAt = 0;
bool s8IsDown = false;
bool showingBalance = false;
unsigned long showBalanceUntil = 0;

// ─── LED маска по типу ставки ──────────────────────────────
// LEDs: позиции 0-7 над кнопками S1-S8
void setLEDForBet(String bet) {
  tm.setLEDs(0x0000);  // все выкл
  if      (bet == "RED")   tm.setLED(0, 1);
  else if (bet == "BLACK") tm.setLED(1, 1);
  else if (bet == "GREEN") tm.setLED(2, 1);
  else if (bet == "EVEN")  tm.setLED(3, 1);
  else if (bet == "ODD")   tm.setLED(4, 1);
}

// ─── Вспомогательные функции дисплея ──────────────────────
void showText(const char* text) {
  tm.displayText(text);
}

// Показать число с лейблом, например "bAL  980"
void showLabelNum(const char* label, int num) {
  char buf[9];
  // label — 3 символа, число — до 4 цифр, пробелы между
  snprintf(buf, sizeof(buf), "%-3s %4d", label, num);
  tm.displayText(buf);
}

// Бегущая анимация точек для WiFi
void wifiAnimation() {
  const char* frames[] = {
    ".       ", " .      ", "  .     ", "   .    ",
    "    .   ", "     .  ", "      . ", "       ."
  };
  for (int i = 0; i < 8; i++) {
    tm.displayText(frames[i]);
    delay(100);
  }
}

// ─── Обновление дисплея по текущему состоянию ──────────────
void updateDisplay() {
  // Баланс по long-press S8
  if (showingBalance) {
    if (millis() < showBalanceUntil) {
      showLabelNum("bAL", playerBalance);
      return;
    }
    showingBalance = false;
  }

  if (gamePhase == "BETTING") {
    if (selectedBetType == "") {
      showLabelNum("bEt", betAmount);
    } else {
      // Первые 3 символа — тип ставки
      char typeLabel[4];
      if      (selectedBetType == "RED")   strncpy(typeLabel, "rEd", 4);
      else if (selectedBetType == "BLACK") strncpy(typeLabel, "bLC", 4);
      else if (selectedBetType == "GREEN") strncpy(typeLabel, "Grn", 4);
      else if (selectedBetType == "EVEN")  strncpy(typeLabel, "EVn", 4);
      else if (selectedBetType == "ODD")   strncpy(typeLabel, "Odd", 4);
      showLabelNum(typeLabel, betAmount);
    }
  }
  else if (gamePhase == "SPINNING") {
    // Мигаем "SPIN----"
    static unsigned long lastFlip = 0;
    static bool flip = false;
    if (millis() - lastFlip > 400) {
      flip = !flip;
      lastFlip = millis();
    }
    showText(flip ? "SPIN----" : "--------");
  }
  else if (gamePhase == "RESULT") {
    // результат показывается снаружи через resultDisplay()
  }
}

// Вызывается один раз при получении RESULT от сервера
void showResult(int number, String color, bool hadBet) {
  if (!hadBet) {
    // Просто показываем выпавший номер
    char buf[9];
    snprintf(buf, sizeof(buf), "-- %2d --", number);
    tm.displayText(buf);
    return;
  }

  // Вычисляем выигрыш/проигрыш
  bool won = false;
  if      (selectedBetType == "RED"   && color == "RED")   won = true;
  else if (selectedBetType == "BLACK" && color == "BLACK")  won = true;
  else if (selectedBetType == "GREEN" && color == "GREEN")  won = true;
  else if (selectedBetType == "EVEN"  && number != 0 && number % 2 == 0) won = true;
  else if (selectedBetType == "ODD"   && number % 2 == 1)  won = true;

  if (won) {
    int payout = (selectedBetType == "GREEN") ? 14 : 2;
    int winAmount = betAmount * (payout - 1);
    showLabelNum("uIn", winAmount);
  } else {
    showText("LoSE----");
  }
}

// ─── Кнопки ────────────────────────────────────────────────
void handleButtons() {
  if (gamePhase != "BETTING") return;

  uint8_t keys = tm.readButtons();
  if (keys == 0) {
    // S8 отпущена
    if (s8IsDown) {
      unsigned long held = millis() - s8PressedAt;
      if (held < 1500) {
        // Короткое нажатие → отправить ставку
        if (selectedBetType != "" && !betSent) {
          sendBet();
        }
      }
      s8IsDown = false;
    }
    return;
  }

  // S1 — RED
  if (keys & 0x01) { selectedBetType = "RED";   setLEDForBet("RED");   betSent = false; delay(200); }
  // S2 — BLACK
  if (keys & 0x02) { selectedBetType = "BLACK"; setLEDForBet("BLACK"); betSent = false; delay(200); }
  // S3 — GREEN
  if (keys & 0x04) { selectedBetType = "GREEN"; setLEDForBet("GREEN"); betSent = false; delay(200); }
  // S4 — EVEN
  if (keys & 0x08) { selectedBetType = "EVEN";  setLEDForBet("EVEN");  betSent = false; delay(200); }
  // S5 — ODD
  if (keys & 0x10) { selectedBetType = "ODD";   setLEDForBet("ODD");   betSent = false; delay(200); }

  // S6 — +10
  if (keys & 0x20) {
    if (betAmount + 10 <= playerBalance) {
      betAmount += 10;
    } else {
      showText("oUEr----");
      delay(800);
    }
    delay(150);
  }

  // S7 — -10
  if (keys & 0x40) {
    if (betAmount > 10) betAmount -= 10;
    delay(150);
  }

  // S8 — confirm / long-press balance
  if (keys & 0x80) {
    if (!s8IsDown) {
      s8IsDown = true;
      s8PressedAt = millis();
    } else {
      // Удержание > 1500мс → показать баланс
      if (millis() - s8PressedAt > 1500 && !showingBalance) {
        showingBalance = true;
        showBalanceUntil = millis() + 5000;
      }
    }
  }
}

// ─── Отправка ставки ───────────────────────────────────────
void sendBet() {
  StaticJsonDocument<128> doc;
  doc["type"]       = "bet";
  doc["player_id"]  = WiFi.macAddress();
  doc["bet_type"]   = selectedBetType;
  doc["amount"]     = betAmount;

  String msg;
  serializeJson(doc, msg);
  webSocket.sendTXT(msg);

  showText("SEnt----");
  delay(800);
  betSent = true;
}

// ─── WebSocket события ─────────────────────────────────────
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      showText("rEAdy   ");
      delay(1000);

      // Отправить join с MAC
      StaticJsonDocument<128> doc;
      doc["type"]      = "join";
      doc["player_id"] = WiFi.macAddress();
      String msg;
      serializeJson(doc, msg);
      webSocket.sendTXT(msg);
      break;
    }

    case WStype_DISCONNECTED: {
      gamePhase = "CONNECTING";
      showText("rEConn  ");
      break;
    }

    case WStype_TEXT: {
      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) return;

      String msgType = doc["type"].as<String>();

      if (msgType == "joined") {
        playerBalance = doc["balance"] | 1000;
        gamePhase = "BETTING";
        selectedBetType = "";
        betAmount = 10;
        betSent = false;
        tm.setLEDs(0x0000);
      }

      else if (msgType == "state") {
        String newPhase = doc["phase"].as<String>();

        // Переход в BETTING — сброс ставки
        if (newPhase == "BETTING" && gamePhase != "BETTING") {
          selectedBetType = "";
          betAmount = 10;
          betSent = false;
          tm.setLEDs(0x0000);
        }

        // Переход в RESULT — показать результат
        if (newPhase == "RESULT" && gamePhase != "RESULT") {
          int number = doc["number"] | 0;
          String color = doc["color"].as<String>();

          // Обновить баланс из players
          JsonArray players = doc["players"].as<JsonArray>();
          String myMac = WiFi.macAddress();
          for (JsonObject p : players) {
            if (p["id"].as<String>() == myMac) {
              playerBalance = p["balance"] | playerBalance;
              break;
            }
          }

          showResult(number, color, betSent);
        }

        gamePhase = newPhase;
      }

      else if (msgType == "error") {
        String code = doc["code"].as<String>();
        if (code == "BET_TOO_LARGE") {
          showText("oUEr----");
          delay(1000);
        } else if (code == "WRONG_PHASE") {
          showText("no  bEt ");
          delay(1000);
        }
      }

      break;
    }

    default: break;
  }
}

// ─── Setup / Loop ──────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  tm.displayBegin();
  tm.setLEDs(0x0000);

  // WiFi анимация
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    wifiAnimation();
    attempts++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    showText("no uIFI ");
    Serial.println("WiFi failed");
    while (true) delay(1000);
  }

  Serial.print("WiFi OK, IP: ");
  Serial.println(WiFi.localIP());

  showText("ConnnEct");

  webSocket.begin(WS_HOST, WS_PORT, "/ws");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
}

void loop() {
  webSocket.loop();
  handleButtons();

  // Обновляем дисплей только вне RESULT (там уже показан результат)
  if (gamePhase != "RESULT" || showingBalance) {
    updateDisplay();
  }
}
```

---

## Шаг 6 — Настройки перед загрузкой

В `Tools` выставь:

| Параметр | Значение |
|---|---|
| Board | NodeMCU 1.0 (ESP-12E Module) |
| Upload Speed | 115200 |
| CPU Frequency | 80 MHz |
| Flash Size | 4MB (FS:2MB, OTA:~1019KB) |
| Port | COMx (Windows) или /dev/cu.usbserial-... (Mac) |

---

## Шаг 7 — Загрузка

1. Подключи NodeMCU через USB
2. Открой `roulette_client.ino` в Arduino IDE
3. Нажми кнопку **Upload** (→)
4. Открой Serial Monitor (`Tools → Serial Monitor`), скорость **115200**
5. Нажми кнопку **RST** на плате
6. Должно появиться: `WiFi OK, IP: 192.168.1.xxx`

---

## Раскладка кнопок (памятка)

```
┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│ S1  │ S2  │ S3  │ S4  │ S5  │ S6  │ S7  │ S8  │
│ RED │BLK  │GRN  │EVEN │ ODD │ +10 │ -10 │ OK  │
│     │     │     │     │     │     │     │hold=│
│     │     │     │     │     │     │     │ BAL │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘
```

---

## Возможные проблемы

| Проблема | Решение |
|---|---|
| Дисплей не показывает ничего | Проверь пины STB/CLK/DIO, попробуй VCC → VIN (5V) |
| `WiFi failed` на дисплее | Проверь SSID/PASSWORD в config.h, ESP8266 работает только на 2.4 ГГц |
| Кнопки срабатывают дважды | Увеличь `delay(200)` после обработки кнопки |
| `no uIFI` и завис | Сначала запусти сервер, только потом прошивай ESP |
| Порт не определяется | Установи драйвер CH340: https://www.wch.cn/downloads/CH341SER_ZIP.html |
