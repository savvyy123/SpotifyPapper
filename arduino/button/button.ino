// button.ino — タクトスイッチ + SSD1306 OLED (Arduino Pro Micro)
//
// スイッチ (PIN 7 ↔ GND, INPUT_PULLUP):
//   1回押し → Serial送信: "1"  → 再生/一時停止
//   2回押し → Serial送信: "2"  → 次の曲
//   3回押し → Serial送信: "3"  → 前の曲
//
// OLED (SSD1306 128x64, I2C 0x3C, SDA=2 / SCL=3):
//   PCから "T:<曲名>\n" を受信 → 画面に曲名を表示
//
// 必要ライブラリ: Adafruit_GFX, Adafruit_SSD1306

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ---- OLED ----
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define OLED_ADDR   0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ---- ボタン ----
const int BUTTON_PIN = 4;
const unsigned long DEBOUNCE_MS   = 50;
const unsigned long TAP_WINDOW_MS = 400;

int  tapCount         = 0;
unsigned long lastTapTime      = 0;
unsigned long lastDebounceTime = 0;
bool lastReading = HIGH;
bool buttonState = HIGH;

// ---- シリアル受信 ----
String rxBuffer = "";
String currentTrack = "No Track";

void showTrack(const String& name) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Now Playing:");
  display.drawFastHLine(0, 10, 128, SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(0, 18);
  // 長い曲名は自動で折り返される（setTextWrap はデフォルトtrue）
  display.println(name);
  display.display();
}

void setup() {
  Serial.begin(9600);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Wire.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    // OLEDが無くてもボタンは動くので無限ループは避ける
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("WalkPaper");
  display.println("Waiting...");
  display.display();
}

void loop() {
  // --- ボタン処理 ---
  bool reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) {
    lastDebounceTime = millis();
  }
  lastReading = reading;

  if (millis() - lastDebounceTime > DEBOUNCE_MS) {
    if (reading != buttonState) {
      buttonState = reading;
      if (buttonState == LOW) {
        tapCount++;
        lastTapTime = millis();
      }
    }
  }

  if (tapCount > 0 && millis() - lastTapTime > TAP_WINDOW_MS) {
    if (tapCount > 3) tapCount = 3;
    Serial.println(tapCount);
    tapCount = 0;
  }

  // --- シリアル受信 ("T:<曲名>\n") ---
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      if (rxBuffer.startsWith("T:")) {
        currentTrack = rxBuffer.substring(2);
        showTrack(currentTrack);
      }
      rxBuffer = "";
    } else if (c != '\r') {
      rxBuffer += c;
      if (rxBuffer.length() > 120) rxBuffer = ""; // 暴走防止
    }
  }
}
