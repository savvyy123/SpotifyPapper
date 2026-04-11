// sketch.js — WalkPaper メイン p5.js スケッチ
// oF 版 (ofApp.cpp) を忠実に Web に移植
//
// 描画レイヤー構成:
//   1. lineFbo  … 単一ウォーカーの黒線を蓄積（曲変更でクリア）
//   2. Canvas   … 白背景 → lineFbo → 動画(+グリッチ) → テキスト

// ---------------------------------------------------------------
// 定数（oF 版の固定パラメータに対応）
// ---------------------------------------------------------------
const W = 1920;
const H = 1080;
const LINE_WIDTH   = 4;
const LINE_SPEED   = 0.5;
const THRESHOLD    = 0.01;   // グリッチ発動閾値 (scaledVol)
const VOL_SCALE    = 30.0;   // smoothedVol → scaledVol 係数
const VIDEO_SIZE   = 400;
const NOISE_STRENGTH = 200.0; // グリッチのノイズ振幅
const FONT_FAMILY  = 'Noto Sans JP';
const FONT_LARGE   = 72;
const FONT_MEDIUM  = 32;

// ---------------------------------------------------------------
// 状態
// ---------------------------------------------------------------
let lineFbo;        // p5.Graphics — 線を蓄積するオフスクリーン
let walkerPos;      // 現在位置
let walkerPrev;     // 前フレーム位置
let video;          // HTML video 要素
let videoCanvas;    // 動画ピクセル読み取り用オフスクリーン canvas
let videoCtx;

let trackChars = [];   // {ch, x, y, angle}
let lastTrack  = '';

let typedText = '';    // キー入力テキスト

// ---------------------------------------------------------------
// p5.js ライフサイクル
// ---------------------------------------------------------------
function setup() {
  createCanvas(W, H);
  textFont(FONT_FAMILY);
  frameRate(60);

  // 線の蓄積レイヤー（白背景・透明クリア → oF の ofClear(255,255,255,0) に対応）
  lineFbo = createGraphics(W, H);
  lineFbo.clear();
  lineFbo.strokeWeight(LINE_WIDTH);
  lineFbo.stroke(0);
  lineFbo.noFill();

  // ウォーカー初期位置
  walkerPos  = createVector(random(W), random(H));
  walkerPrev = walkerPos.copy();

  // 動画要素
  video = document.getElementById('walkVideo');
  video.play().catch(() => {
    document.addEventListener('click', () => video.play(), { once: true });
  });

  // 動画ピクセル読み取り用の小さな canvas
  videoCanvas = document.createElement('canvas');
  videoCanvas.width  = VIDEO_SIZE;
  videoCanvas.height = VIDEO_SIZE;
  videoCtx = videoCanvas.getContext('2d', { willReadFrequently: true });

  // マイク + Spotify 初期化
  Audio.init().catch(e => console.warn('Audio init failed:', e));
  Spotify.init();
}

function draw() {
  // ---- update ----
  updateSpotifyTrack();
  updateWalker();

  // 音量スケーリング（oF: scaledVol = clamp(smoothedVol * 30, 0, 1)）
  const rms = Audio.getRMS();
  const scaledVol = constrain(rms * VOL_SCALE, 0, 1);

  // ---- draw ----
  background(255); // 白背景

  // 1. 背景の線（蓄積レイヤー）
  image(lineFbo, 0, 0);

  // 2. 動画（中央 400×400）
  if (scaledVol < THRESHOLD) {
    drawVideoNormal();
  } else {
    drawVideoGlitch();
  }

  // 3. 曲名（1文字ずつランダム配置・回転）
  drawTrackChars();

  // 4. アーティスト名（右上）
  drawArtistName();

  // 5. 入力テキスト（中央・白文字）
  drawTypedText();

  // 6. 音量バー（左下・デバッグ用）
  drawVolumeBar(scaledVol);

  // 7. 未ログイン時にログインボタン
  if (!Spotify.isLoggedIn()) {
    drawLoginButton();
  }
}

// ---------------------------------------------------------------
// Walker（単一・Perlin ノイズで座標マッピング）
// ---------------------------------------------------------------
function updateWalker() {
  walkerPrev = walkerPos.copy();

  // oF: ofNoise(t * lineSpeed) → 0〜1 をウィンドウ幅にマップ
  const t = millis() / 1000.0; // ofGetElapsedTimef() 相当
  walkerPos.x = map(noise(t * LINE_SPEED),         0, 1, 0, W);
  walkerPos.y = map(noise(t * LINE_SPEED + 1000),   0, 1, 0, H);

  // 線を蓄積レイヤーに描画
  lineFbo.stroke(0);
  lineFbo.strokeWeight(LINE_WIDTH);
  lineFbo.line(walkerPrev.x, walkerPrev.y, walkerPos.x, walkerPos.y);
}

// ---------------------------------------------------------------
// Spotify 曲情報の監視
// ---------------------------------------------------------------
function updateSpotifyTrack() {
  const currentTrack = Spotify.getTrackName();
  if (currentTrack && currentTrack !== lastTrack) {
    lastTrack = currentTrack;
    generateTrackChars(currentTrack);

    // 曲が変わったら線をリセット（oF: lineFbo.begin(); ofClear(...); lineFbo.end();）
    lineFbo.clear();
  }
}

// ---------------------------------------------------------------
// 動画描画（通常）
// ---------------------------------------------------------------
function drawVideoNormal() {
  if (!video || video.readyState < 2) return;
  const vx = (W - VIDEO_SIZE) / 2;
  const vy = (H - VIDEO_SIZE) / 2;
  drawingContext.drawImage(video, vx, vy, VIDEO_SIZE, VIDEO_SIZE);
}

// ---------------------------------------------------------------
// 動画描画（グリッチ — oF 版の縦線スキャン＋ノイズ Y）
// ---------------------------------------------------------------
function drawVideoGlitch() {
  if (!video || video.readyState < 2) return;

  const vx = (W - VIDEO_SIZE) / 2;
  const vy = (H - VIDEO_SIZE) / 2;

  // 動画をオフスクリーン canvas に描画してピクセルを読み取る
  videoCtx.drawImage(video, 0, 0, VIDEO_SIZE, VIDEO_SIZE);
  const imageData = videoCtx.getImageData(0, 0, VIDEO_SIZE, VIDEO_SIZE);
  const pixels = imageData.data;

  const fn = frameCount; // oF: ofGetFrameNum()

  for (let x = 0; x < VIDEO_SIZE; x++) {
    // oF: float y = ofNoise(ofGetFrameNum()*0.01 + x*0.01) * noiseStrength
    const ny = noise(fn * 0.01 + x * 0.01) * NOISE_STRENGTH;
    const sy = constrain(floor(ny), 0, VIDEO_SIZE - 1);
    const sx = constrain(x, 0, VIDEO_SIZE - 1);

    // ピクセルカラー取得
    const idx = (sy * VIDEO_SIZE + sx) * 4;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];

    // 縦線を描画
    drawingContext.strokeStyle = `rgb(${r},${g},${b})`;
    drawingContext.lineWidth = 1;
    drawingContext.beginPath();
    drawingContext.moveTo(vx + x, vy);
    drawingContext.lineTo(vx + x, vy + VIDEO_SIZE);
    drawingContext.stroke();
  }
}

// ---------------------------------------------------------------
// 曲名テキスト（1文字ずつランダム配置・回転）
// ---------------------------------------------------------------
function generateTrackChars(track) {
  trackChars = [];
  textSize(FONT_LARGE);

  for (const ch of track) {
    // oF ではスペースも含めて配置している
    const cw = textWidth(ch);
    const ch2 = FONT_LARGE; // 概算の文字高さ

    trackChars.push({
      ch,
      x:     random(cw, W - cw),
      y:     random(ch2, H - ch2),
      angle: random(-PI / 4, PI / 4), // oF: ofRandom(-45, 45) → deg → rad
    });
  }
}

function drawTrackChars() {
  for (const c of trackChars) {
    push();
    translate(c.x, c.y);
    rotate(c.angle);
    textSize(FONT_LARGE);
    textAlign(CENTER, CENTER);
    fill(0); // oF: ofSetColor(0) → 黒
    noStroke();
    text(c.ch, 0, 0);
    pop();
  }
}

// ---------------------------------------------------------------
// アーティスト名（右上・中サイズ）
// ---------------------------------------------------------------
function drawArtistName() {
  const artist = Spotify.getArtistName();
  if (!artist) return;

  push();
  textSize(FONT_MEDIUM);
  textAlign(RIGHT, TOP);
  fill(0); // 黒
  noStroke();
  // oF: x = width - bounds.width - 20, y = 60
  text(artist, W - 20, 60);
  pop();
}

// ---------------------------------------------------------------
// 入力テキスト（中央・白・大サイズ）
// ---------------------------------------------------------------
function drawTypedText() {
  if (!typedText) return;

  push();
  textSize(FONT_LARGE);
  textAlign(CENTER, CENTER);
  fill(255); // oF: ofSetColor(255) → 白
  noStroke();
  text(typedText, W / 2, H / 2);
  pop();
}

// ---------------------------------------------------------------
// 音量バー（左下・デバッグ用）
// ---------------------------------------------------------------
function drawVolumeBar(scaledVol) {
  const barW = 200;
  const barH = 20;
  const filled = barW * scaledVol;

  push();
  fill(0);
  noStroke();
  rect(20, H - 40, filled, barH);
  pop();
}

// ---------------------------------------------------------------
// Spotify ログインボタン
// ---------------------------------------------------------------
function drawLoginButton() {
  const bw = 220, bh = 52;
  const bx = W / 2, by = H / 2 + 250; // 動画の下あたり

  push();
  rectMode(CENTER);
  fill(30, 215, 96); // Spotify グリーン
  noStroke();
  rect(bx, by, bw, bh, 26);

  fill(255);
  textSize(18);
  textAlign(CENTER, CENTER);
  text('Spotify に接続', bx, by);
  pop();
}

// ---------------------------------------------------------------
// インタラクション
// ---------------------------------------------------------------
function mousePressed() {
  if (!Spotify.isLoggedIn()) {
    const bx = W / 2, by = H / 2 + 250;
    if (abs(mouseX - bx) < 110 && abs(mouseY - by) < 26) {
      Spotify.login();
    }
  }
}

function keyPressed() {
  if (keyCode === ESCAPE) {
    // oF: ofToggleFullscreen()
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    return false; // ESC のデフォルト動作を抑止
  } else if (keyCode === BACKSPACE) {
    // oF: typedText.pop_back()
    typedText = typedText.slice(0, -1);
    return false;
  } else if (keyCode === ENTER || keyCode === RETURN) {
    // oF: typedText.clear()
    typedText = '';
    return false;
  } else if (key.length === 1) {
    typedText += key;
  }
}
