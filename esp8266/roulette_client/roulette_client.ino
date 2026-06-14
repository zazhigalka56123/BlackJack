// ============================================================================
// IoT Roulette Client (ESP8266 NodeMCU + LED&KEY TM1638)
// Архитектура — см. ../../ROULETTE_PLAN.md
// ----------------------------------------------------------------------------
// Кнопки:
//   S1..S5         — выбор типа ставки: RED, BLACK, GREEN, EVEN, ODD
//   S6 / S7        — сумма ставки +/- BET_STEP
//   S8 (short)     — подтвердить ставку (отправить серверу)
//   S8 (long 1.5s) — показать баланс на 5 секунд
// LEDы:
//   LED1..LED5     — индикация выбранного типа ставки
//   LED6           — мигает в SPINNING
//   LED7           — горит при выигрыше в RESULT
//   LED8           — горит при проигрыше в RESULT
// ============================================================================

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <TM1638plus.h>

#include "config.h"

// ---- Hardware ---------------------------------------------------------------
TM1638plus tm(PIN_STB, PIN_CLK, PIN_DIO, false /* high-frequency mode off */);
WebSocketsClient ws;

// ---- Bet types --------------------------------------------------------------
const char* BET_TYPES[5] = {"RED", "BLACK", "GREEN", "EVEN", "ODD"};
const char* BET_LABELS[5] = {"rEd ", "bLA ", "GRn ", "EUEn", "odd "};  // 4 символа, дополним суммой

// ---- Device FSM -------------------------------------------------------------
enum DeviceState {
  DS_BOOT,
  DS_WIFI_CONNECTING,
  DS_WIFI_FAILED,
  DS_WS_CONNECTING,
  DS_WAITING_WELCOME,
  DS_IDLE,           // BETTING, тип не выбран
  DS_BET_SELECTING,  // BETTING, тип выбран — ввод суммы
  DS_BET_SENT,       // ждём bet_accepted
  DS_BET_PLACED,     // ставка в игре, ждём конца раунда
  DS_SPINNING,       // фаза SPINNING
  DS_RESULT,         // фаза RESULT — показываем итог
  DS_BALANCE_VIEW,   // long-press S8 — показ баланса
  DS_RECONNECTING,
};

DeviceState deviceState = DS_BOOT;
DeviceState stateBeforeBalanceView = DS_IDLE;

// ---- Game state (из server `state`) ----------------------------------------
String currentPhase = "BETTING";
int    phaseTimer  = 20;
int    roundId     = 0;
int    lastResultNumber = -1;
int    lastWonAmount    = 0;
bool   hadBetThisRound  = false;

// ---- Player state -----------------------------------------------------------
String macAddress;
int    balance        = 0;
int    betAmount      = MIN_BET;
int    selectedTypeIdx = -1;   // -1 — не выбран

// ---- Buttons ----------------------------------------------------------------
uint8_t lastButtons      = 0;
unsigned long s8PressedAt = 0;
bool s8LongHandled       = false;

// ---- Display helpers --------------------------------------------------------
unsigned long transientUntil = 0;     // ms; пока > millis() — показывается transient
unsigned long balanceViewUntil = 0;
unsigned long spinAnimTick   = 0;
int spinAnimOffset = 0;

// ---- LEDs -------------------------------------------------------------------
unsigned long ledBlinkTick = 0;
bool ledBlinkState = false;

// ============================================================================
// FORWARD DECLARATIONS
// ============================================================================
void showText(const char* text);          // text 8 символов (можно меньше — допишем пробелы)
void showTextFor(const char* text, unsigned long ms);
void renderDisplay();
void renderLeds();
void connectWiFi();
void wsEvent(WStype_t type, uint8_t* payload, size_t length);
void onWelcome(JsonDocument& doc);
void onState(JsonDocument& doc);
void onBetAccepted(JsonDocument& doc);
void onError(JsonDocument& doc);
void sendJoin();
void sendBet();
void handleButtons();
void updateFsmFromPhase();

// ============================================================================
// SETUP / LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.println();
  Serial.println("=== Roulette client booting ===");

  tm.displayBegin();
  tm.reset();
  showText("        ");

  macAddress = WiFi.macAddress();
  Serial.print("MAC: ");
  Serial.println(macAddress);

  deviceState = DS_WIFI_CONNECTING;
  connectWiFi();

  if (deviceState == DS_WIFI_FAILED) {
    showText("no UIFI ");
    Serial.println("WiFi failed; halting WS connect");
    return;  // в loop() будем висеть и пытаться переподключиться
  }

  Serial.printf("Connecting WS to %s:%d%s\n", SERVER_HOST, SERVER_PORT, WS_PATH);
  ws.begin(SERVER_HOST, SERVER_PORT, WS_PATH);
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(3000);
  deviceState = DS_WS_CONNECTING;
  showText("ConnEct ");
}

void loop() {
  // если Wi-Fi отвалился — попробуем подключиться заново
  if (WiFi.status() != WL_CONNECTED) {
    if (deviceState != DS_WIFI_CONNECTING && deviceState != DS_WIFI_FAILED) {
      Serial.println("WiFi lost, reconnecting...");
      deviceState = DS_WIFI_CONNECTING;
      showText("no UIFI ");
    }
    connectWiFi();
    if (deviceState == DS_WIFI_FAILED) {
      delay(2000);
      return;
    }
    // после успешного wifi reconnect — wsclient сам поднимет соединение
    if (deviceState == DS_WIFI_CONNECTING) {
      deviceState = DS_WS_CONNECTING;
      showText("ConnEct ");
    }
  }

  ws.loop();
  handleButtons();
  renderDisplay();
  renderLeds();

  // выход из balance-view по таймауту
  if (deviceState == DS_BALANCE_VIEW && millis() >= balanceViewUntil) {
    deviceState = stateBeforeBalanceView;
  }
}

// ============================================================================
// WiFi
// ============================================================================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  int dots = 0;
  Serial.print("WiFi connecting");
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 20000) {
      Serial.println(" -> FAILED");
      deviceState = DS_WIFI_FAILED;
      return;
    }
    // анимация бегущей точки
    char buf[9] = "        ";
    buf[dots % 8] = '.';
    tm.displayText(buf);
    delay(250);
    dots++;
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi OK, IP: ");
  Serial.println(WiFi.localIP());
}

// ============================================================================
// WebSocket
// ============================================================================
void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      Serial.printf("WS connected to %s\n", payload);
      deviceState = DS_WAITING_WELCOME;
      showText("JoIn----");
      sendJoin();
      break;
    }
    case WStype_DISCONNECTED: {
      Serial.println("WS disconnected");
      deviceState = DS_RECONNECTING;
      showText("rEConn  ");
      // выбранный тип ставки сбрасываем
      selectedTypeIdx = -1;
      break;
    }
    case WStype_TEXT: {
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        Serial.printf("JSON parse error: %s\n", err.c_str());
        return;
      }
      const char* msgType = doc["type"] | "";
      if (strcmp(msgType, "welcome") == 0)        onWelcome(doc);
      else if (strcmp(msgType, "state") == 0)     onState(doc);
      else if (strcmp(msgType, "bet_accepted") == 0) onBetAccepted(doc);
      else if (strcmp(msgType, "error") == 0)     onError(doc);
      else Serial.printf("Unknown msg type: %s\n", msgType);
      break;
    }
    default:
      break;
  }
}

void sendJoin() {
  JsonDocument doc;
  doc["type"] = "join";
  doc["player_id"] = macAddress;
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
  Serial.printf("-> join %s\n", macAddress.c_str());
}

void sendBet() {
  if (selectedTypeIdx < 0) return;
  JsonDocument doc;
  doc["type"] = "bet";
  doc["player_id"] = macAddress;
  doc["bet_type"] = BET_TYPES[selectedTypeIdx];
  doc["amount"] = betAmount;
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
  Serial.printf("-> bet %s %d\n", BET_TYPES[selectedTypeIdx], betAmount);
  deviceState = DS_BET_SENT;
  showTextFor("Send... ", 800);
}

// ============================================================================
// WS handlers
// ============================================================================
void onWelcome(JsonDocument& doc) {
  balance = doc["balance"] | 0;
  Serial.printf("welcome: balance=%d\n", balance);
  showTextFor("rEAdy   ", 1000);
  deviceState = DS_IDLE;
  selectedTypeIdx = -1;
  betAmount = MIN_BET;
}

void onState(JsonDocument& doc) {
  const char* phase = doc["phase"] | "BETTING";
  phaseTimer = doc["timer"] | 0;
  roundId    = doc["round_id"] | 0;

  // ищем себя в players, обновляем баланс
  for (JsonObject p : doc["players"].as<JsonArray>()) {
    const char* pid = p["id"] | "";
    if (macAddress.equals(pid)) {
      if (!p["balance"].isNull()) balance = p["balance"].as<int>();
      if (!p["won"].isNull())     lastWonAmount = p["won"].as<int>();
      if (!p["bet"].isNull())     hadBetThisRound = true;
      break;
    }
  }

  // результат для отображения
  if (!doc["result"].isNull()) {
    lastResultNumber = doc["result"]["number"].as<int>();
  } else if (strcmp(phase, "BETTING") == 0) {
    lastResultNumber = -1;
  }

  // обработка перехода фаз
  String newPhase = String(phase);
  if (newPhase != currentPhase) {
    currentPhase = newPhase;
    if (newPhase == "BETTING") {
      // новый раунд — сбрасываем локальное состояние ввода
      selectedTypeIdx = -1;
      betAmount = MIN_BET;
      hadBetThisRound = false;
      lastWonAmount = 0;
      if (deviceState != DS_BALANCE_VIEW) deviceState = DS_IDLE;
    } else if (newPhase == "SPINNING") {
      if (deviceState != DS_BALANCE_VIEW) deviceState = DS_SPINNING;
    } else if (newPhase == "RESULT") {
      if (deviceState != DS_BALANCE_VIEW) deviceState = DS_RESULT;
    }
  }
}

void onBetAccepted(JsonDocument& doc) {
  balance = doc["balance"] | balance;
  int amount = doc["amount"] | 0;
  Serial.printf("bet_accepted: balance=%d amount=%d\n", balance, amount);
  if (amount == 0) {
    // отмена ставки
    deviceState = DS_IDLE;
    selectedTypeIdx = -1;
  } else {
    deviceState = DS_BET_PLACED;
    hadBetThisRound = true;
    showTextFor("donE    ", 800);
  }
}

void onError(JsonDocument& doc) {
  const char* code = doc["code"] | "";
  Serial.printf("error: %s\n", code);
  if (strcmp(code, "BET_TOO_LARGE") == 0) {
    showTextFor("oUEr----", 1200);
    if (deviceState == DS_BET_SENT) deviceState = DS_BET_SELECTING;
  } else if (strcmp(code, "BET_TOO_SMALL") == 0) {
    showTextFor("Lo Lo Lo", 1200);
    if (deviceState == DS_BET_SENT) deviceState = DS_BET_SELECTING;
  } else if (strcmp(code, "WRONG_PHASE") == 0) {
    showTextFor("no bEt  ", 1200);
    if (deviceState == DS_BET_SENT) deviceState = DS_BET_SELECTING;
  } else if (strcmp(code, "INSUFFICIENT_FUNDS") == 0) {
    showTextFor("no CoIn ", 2000);
    if (deviceState == DS_BET_SENT) deviceState = DS_IDLE;
  } else if (strcmp(code, "UNKNOWN_PLAYER") == 0) {
    sendJoin();
  } else {
    showTextFor("Err     ", 1000);
  }
}

// ============================================================================
// Buttons (debounce + long press for S8)
// ============================================================================
void handleButtons() {
  uint8_t btns = tm.readButtons();
  uint8_t pressed = btns & ~lastButtons;   // фронт нажатия (rising edge)
  uint8_t released = lastButtons & ~btns;  // фронт отпускания

  // long-press S8 — bit 7
  if (btns & 0x80) {
    if (s8PressedAt == 0) {
      s8PressedAt = millis();
      s8LongHandled = false;
    } else if (!s8LongHandled && millis() - s8PressedAt >= 1500) {
      // long press fires
      s8LongHandled = true;
      stateBeforeBalanceView = deviceState;
      deviceState = DS_BALANCE_VIEW;
      balanceViewUntil = millis() + 5000;
    }
  } else {
    // released
    if ((released & 0x80) && !s8LongHandled) {
      // короткое нажатие S8 — подтвердить ставку
      onShortS8();
    }
    s8PressedAt = 0;
    s8LongHandled = false;
  }

  // S1..S5 — выбор типа ставки (в фазе BETTING)
  bool inBetting = (currentPhase == "BETTING") &&
                   (deviceState == DS_IDLE ||
                    deviceState == DS_BET_SELECTING ||
                    deviceState == DS_BET_PLACED);
  if (inBetting && balance > 0) {
    for (int i = 0; i < 5; i++) {
      if (pressed & (1 << i)) {
        selectedTypeIdx = i;
        if (deviceState == DS_IDLE) betAmount = MIN_BET;
        // GREEN ограничим балансом, остальные тоже
        if (betAmount > balance) betAmount = balance - (balance % BET_STEP);
        if (betAmount < MIN_BET) betAmount = MIN_BET;
        deviceState = DS_BET_SELECTING;
        Serial.printf("type=%s amount=%d\n", BET_TYPES[i], betAmount);
      }
    }
    // S6 +BET_STEP, S7 -BET_STEP
    if ((pressed & 0x20) && deviceState == DS_BET_SELECTING) {
      if (betAmount + BET_STEP <= balance) {
        betAmount += BET_STEP;
      } else {
        showTextFor("oUEr----", 800);
      }
    }
    if ((pressed & 0x40) && deviceState == DS_BET_SELECTING) {
      if (betAmount - BET_STEP >= MIN_BET) {
        betAmount -= BET_STEP;
      }
    }
  }

  lastButtons = btns;
}

void onShortS8() {
  if (deviceState == DS_BET_SELECTING && selectedTypeIdx >= 0 &&
      betAmount >= MIN_BET && betAmount <= balance &&
      currentPhase == "BETTING") {
    sendBet();
  }
}

// ============================================================================
// Display rendering
// ============================================================================
void showText(const char* text) {
  char buf[9];
  for (int i = 0; i < 8; i++) {
    buf[i] = text[i] ? text[i] : ' ';
    if (!text[i]) {
      for (int j = i + 1; j < 8; j++) buf[j] = ' ';
      break;
    }
  }
  buf[8] = '\0';
  tm.displayText(buf);
}

void showTextFor(const char* text, unsigned long ms) {
  showText(text);
  transientUntil = millis() + ms;
}

// формирует строку из 8 символов: prefix (≤5) + правовыровненное число
static void formatLine(char* out, const char* prefix, int value) {
  int prefLen = strlen(prefix);
  if (prefLen > 5) prefLen = 5;
  for (int i = 0; i < prefLen; i++) out[i] = prefix[i];
  for (int i = prefLen; i < 8; i++) out[i] = ' ';
  // число справа
  char numbuf[6];
  snprintf(numbuf, sizeof(numbuf), "%d", value);
  int nlen = strlen(numbuf);
  if (nlen > 5) nlen = 5;
  for (int i = 0; i < nlen; i++) out[8 - nlen + i] = numbuf[i];
  out[8] = '\0';
}

void renderDisplay() {
  // transient screens имеют приоритет
  if (millis() < transientUntil) return;

  char buf[9];
  switch (deviceState) {
    case DS_BOOT:
      showText("        ");
      break;
    case DS_WIFI_CONNECTING:
      // анимация делается прямо в connectWiFi()
      break;
    case DS_WIFI_FAILED:
      showText("no UIFI ");
      break;
    case DS_WS_CONNECTING:
      showText("ConnEct ");
      break;
    case DS_WAITING_WELCOME:
      showText("JoIn----");
      break;
    case DS_RECONNECTING:
      showText("rEConn  ");
      break;
    case DS_IDLE:
      // bEt   050  — сумма по умолчанию
      formatLine(buf, "bEt", betAmount);
      tm.displayText(buf);
      break;
    case DS_BET_SELECTING: {
      // префикс — лейбл типа, значение — сумма
      char line[9];
      const char* lbl = BET_LABELS[selectedTypeIdx >= 0 ? selectedTypeIdx : 0];
      formatLine(line, lbl, betAmount);
      tm.displayText(line);
      break;
    }
    case DS_BET_SENT:
      showText("Send... ");
      break;
    case DS_BET_PLACED: {
      // показываем подтверждённую ставку + оставшееся время
      char line[9];
      const char* lbl = BET_LABELS[selectedTypeIdx >= 0 ? selectedTypeIdx : 0];
      formatLine(line, lbl, betAmount);
      tm.displayText(line);
      break;
    }
    case DS_SPINNING: {
      // бегущая строка "---SPIn-"
      const char base[] = "---SPIn-";
      if (millis() - spinAnimTick > 200) {
        spinAnimTick = millis();
        spinAnimOffset = (spinAnimOffset + 1) % 8;
      }
      char line[9];
      for (int i = 0; i < 8; i++) line[i] = base[(i + spinAnimOffset) % 8];
      line[8] = '\0';
      tm.displayText(line);
      break;
    }
    case DS_RESULT: {
      char line[9];
      if (!hadBetThisRound) {
        // нет ставки — просто номер
        snprintf(line, sizeof(line), "--  %02d--", lastResultNumber >= 0 ? lastResultNumber : 0);
        tm.displayText(line);
      } else if (lastWonAmount > 0) {
        formatLine(line, "uIn", lastWonAmount);
        tm.displayText(line);
      } else {
        snprintf(line, sizeof(line), "LoSE  %02d", lastResultNumber >= 0 ? lastResultNumber : 0);
        tm.displayText(line);
      }
      break;
    }
    case DS_BALANCE_VIEW: {
      char line[9];
      formatLine(line, "bAL", balance);
      tm.displayText(line);
      break;
    }
  }
}

// ============================================================================
// LED rendering
// ============================================================================
void renderLeds() {
  // LED1..LED5 — выбранный тип
  for (int i = 0; i < 5; i++) {
    tm.setLED(i, (selectedTypeIdx == i) ? 1 : 0);
  }
  // LED6 (idx=5) — мигает в SPINNING
  if (deviceState == DS_SPINNING) {
    if (millis() - ledBlinkTick > 250) {
      ledBlinkTick = millis();
      ledBlinkState = !ledBlinkState;
    }
    tm.setLED(5, ledBlinkState ? 1 : 0);
  } else {
    tm.setLED(5, 0);
  }
  // LED7 (idx=6) — выигрыш в RESULT
  tm.setLED(6, (deviceState == DS_RESULT && lastWonAmount > 0) ? 1 : 0);
  // LED8 (idx=7) — проигрыш в RESULT (только если была ставка)
  tm.setLED(7, (deviceState == DS_RESULT && hadBetThisRound && lastWonAmount == 0) ? 1 : 0);
}
