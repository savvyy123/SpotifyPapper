// button.ino — タクトスイッチのマルチタップ検出
// 1回押し → Serial送信: "1"  → 再生/一時停止
// 2回押し → Serial送信: "2"  → 次の曲
// 3回押し → Serial送信: "3"  → 前の曲

const int    BUTTON_PIN      = 2;
const unsigned long DEBOUNCE_MS   = 50;   // チャタリング防止 (ms)
const unsigned long TAP_WINDOW_MS = 400;  // 連打をまとめて判定する時間 (ms)

int  tapCount         = 0;
unsigned long lastTapTime      = 0;
unsigned long lastDebounceTime = 0;
bool lastReading      = HIGH;
bool buttonState      = HIGH;

void setup() {
  Serial.begin(9600);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  // 配線: GND → スイッチ → ピン2
  // INPUT_PULLUP を使うので抵抗不要
}

void loop() {
  bool reading = digitalRead(BUTTON_PIN);

  // チャタリング除去
  if (reading != lastReading) {
    lastDebounceTime = millis();
  }
  lastReading = reading;

  if (millis() - lastDebounceTime > DEBOUNCE_MS) {
    if (reading != buttonState) {
      buttonState = reading;

      if (buttonState == LOW) {  // 押された瞬間
        tapCount++;
        lastTapTime = millis();
      }
    }
  }

  // TAP_WINDOW_MS 経過後にタップ数を送信
  if (tapCount > 0 && millis() - lastTapTime > TAP_WINDOW_MS) {
    if (tapCount > 3) tapCount = 3;  // 最大3回まで
    Serial.println(tapCount);
    tapCount = 0;
  }
}
