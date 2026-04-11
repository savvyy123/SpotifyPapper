// sketch.js — WalkPaper メイン p5.js スケッチ
// oF 版 (ofApp.cpp) を忠実に Web に移植
//
// 描画レイヤー構成:
//   1. lineFbo  … 単一ウォーカーの黒線を蓄積（曲変更でクリア）
//   2. Canvas   … 白背景 → lineFbo → アルバムアート(+グリッチ) → テキスト

// ---------------------------------------------------------------
// 定数
// ---------------------------------------------------------------
const LINE_WIDTH     = 4;
const LINE_SPEED     = 0.5;
const NOISE_STRENGTH = 200.0;
const FONT_FAMILY    = 'Noto Sans JP';

// BPM グリッチ設定
const GLITCH_CHANCE      = 0.30;  // 各拍でグリッチが発動する確率
const GLITCH_DOWNBEAT    = 0.60;  // 強拍（1拍目）の発動確率
const GLITCH_DURATION_MS = 120;   // グリッチ表示の持続時間 (ms)

// 基準解像度（スケール計算用）
const BASE_W = 1920;
const BASE_H = 1080;

// ---------------------------------------------------------------
// 動的サイズ（ウィンドウに追従）
// ---------------------------------------------------------------
let W, H;           // 現在のキャンバスサイズ
let s;              // スケール係数（min(W/1920, H/1080)）
let artSize;        // アルバムアート表示サイズ
const FONT_LARGE  = 72;  // 固定フォントサイズ
const FONT_MEDIUM = 32;

function updateSizes() {
  W = windowWidth;
  H = windowHeight;
  s = min(W / BASE_W, H / BASE_H);
  artSize = floor(400 * s);
}

// ---------------------------------------------------------------
// 状態
// ---------------------------------------------------------------
let lineFbo;
let walkerPos;
let walkerPrev;
let albumArt;
let lastArtUrl = '';
let artCanvas;
let artCtx;

let trackChars = [];
let lastTrack  = '';

let typedText = '';

// BPM グリッチ状態
let lastBeatTime = 0;   // 前回の拍タイミング (ms)
let beatCount    = 0;    // 拍カウンター（強拍判定用）
let glitchActive = false;
let glitchStart  = 0;    // グリッチ開始時刻 (ms)

// ---------------------------------------------------------------
// p5.js ライフサイクル
// ---------------------------------------------------------------
function setup() {
  updateSizes();
  createCanvas(W, H);
  textFont(FONT_FAMILY);
  frameRate(60);

  initLineFbo();

  walkerPos  = createVector(random(W), random(H));
  walkerPrev = walkerPos.copy();

  artCanvas = document.createElement('canvas');
  artCtx = artCanvas.getContext('2d', { willReadFrequently: true });

  Spotify.init();
}

function initLineFbo() {
  lineFbo = createGraphics(W, H);
  lineFbo.clear();
  lineFbo.strokeWeight(LINE_WIDTH * s);
  lineFbo.stroke(0);
  lineFbo.noFill();
}

function windowResized() {
  const oldW = W, oldH = H;
  updateSizes();
  resizeCanvas(W, H);

  // 蓄積した線を新しいサイズに引き伸ばしてコピー
  const oldFbo = lineFbo;
  initLineFbo();
  lineFbo.image(oldFbo, 0, 0, W, H);

  // ウォーカー位置をリマップ
  walkerPos.x = walkerPos.x / oldW * W;
  walkerPos.y = walkerPos.y / oldH * H;
  walkerPrev = walkerPos.copy();

  // 文字位置をリマップ
  for (const c of trackChars) {
    c.x = c.x / oldW * W;
    c.y = c.y / oldH * H;
  }
}

function draw() {
  updateSpotifyTrack();
  if (Spotify.getIsPlaying()) {
    updateWalker();
    updateBeatGlitch();
  }

  background(255);

  // 1. 背景の線
  image(lineFbo, 0, 0);

  // 2. アルバムアート（中央）
  if (glitchActive) {
    drawArtGlitch();
  } else {
    drawArtNormal();
  }

  // 3. 曲名
  drawTrackChars();

  // 4. アーティスト名
  drawArtistName();

  // 5. 入力テキスト
  drawTypedText();

  // 6. ログインボタン
  if (!Spotify.isLoggedIn()) {
    drawLoginButton();
  }
}

// ---------------------------------------------------------------
// Walker
// ---------------------------------------------------------------
function updateWalker() {
  walkerPrev = walkerPos.copy();

  const t = millis() / 1000.0;
  walkerPos.x = map(noise(t * LINE_SPEED),       0, 1, 0, W);
  walkerPos.y = map(noise(t * LINE_SPEED + 1000), 0, 1, 0, H);

  lineFbo.stroke(0);
  lineFbo.strokeWeight(LINE_WIDTH * s);
  lineFbo.line(walkerPrev.x, walkerPrev.y, walkerPos.x, walkerPos.y);
}

// ---------------------------------------------------------------
// BPM ベースのグリッチ判定
// ---------------------------------------------------------------
function updateBeatGlitch() {
  const bpm = Spotify.getBPM();
  if (bpm <= 0) return;

  const now = millis();
  const beatInterval = 60000 / bpm; // 1拍の長さ (ms)

  // グリッチの持続時間が過ぎたら解除
  if (glitchActive && now - glitchStart > GLITCH_DURATION_MS) {
    glitchActive = false;
  }

  // 次の拍タイミングに達したか判定
  if (now - lastBeatTime >= beatInterval) {
    lastBeatTime = now;
    beatCount++;

    // 4拍で1小節、1拍目（強拍）は発動確率を上げる
    const isDownbeat = (beatCount % 4 === 0);
    const chance = isDownbeat ? GLITCH_DOWNBEAT : GLITCH_CHANCE;

    if (random() < chance) {
      glitchActive = true;
      glitchStart = now;
    }
  }
}

// ---------------------------------------------------------------
// Spotify 曲情報の監視
// ---------------------------------------------------------------
function updateSpotifyTrack() {
  const currentTrack = Spotify.getTrackName();
  if (currentTrack && currentTrack !== lastTrack) {
    lastTrack = currentTrack;
    generateTrackChars(currentTrack);
    lineFbo.clear();
  }

  const artUrl = Spotify.getAlbumArtUrl();
  if (artUrl && artUrl !== lastArtUrl) {
    lastArtUrl = artUrl;
    loadImage(artUrl, img => { albumArt = img; }, () => { albumArt = null; });
  }
}

// ---------------------------------------------------------------
// アルバムアート描画（通常）
// ---------------------------------------------------------------
function drawArtNormal() {
  if (!albumArt) return;
  const vx = (W - artSize) / 2;
  const vy = (H - artSize) / 2;
  image(albumArt, vx, vy, artSize, artSize);
}

// ---------------------------------------------------------------
// アルバムアート描画（グリッチ）
// ---------------------------------------------------------------
function drawArtGlitch() {
  if (!albumArt) return;

  const vx = (W - artSize) / 2;
  const vy = (H - artSize) / 2;

  // オフスクリーン canvas をアートサイズに合わせる
  if (artCanvas.width !== artSize || artCanvas.height !== artSize) {
    artCanvas.width  = artSize;
    artCanvas.height = artSize;
  }

  artCtx.drawImage(albumArt.canvas, 0, 0, artSize, artSize);
  const imageData = artCtx.getImageData(0, 0, artSize, artSize);
  const pixels = imageData.data;

  const noiseStr = NOISE_STRENGTH * s;
  const fn = frameCount;

  for (let x = 0; x < artSize; x++) {
    const ny = noise(fn * 0.01 + x * 0.01) * noiseStr;
    const sy = constrain(floor(ny), 0, artSize - 1);

    const idx = (sy * artSize + x) * 4;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];

    drawingContext.strokeStyle = `rgb(${r},${g},${b})`;
    drawingContext.lineWidth = 1;
    drawingContext.beginPath();
    drawingContext.moveTo(vx + x, vy);
    drawingContext.lineTo(vx + x, vy + artSize);
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
    const cw = textWidth(ch);
    const ch2 = FONT_LARGE;

    trackChars.push({
      ch,
      x:     random(cw, W - cw),
      y:     random(ch2, H - ch2),
      angle: random(-PI / 4, PI / 4),
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
    fill(0);
    noStroke();
    text(c.ch, 0, 0);
    pop();
  }
}

// ---------------------------------------------------------------
// アーティスト名（右上）
// ---------------------------------------------------------------
function drawArtistName() {
  const artist = Spotify.getArtistName();
  if (!artist) return;

  push();
  textSize(FONT_MEDIUM);
  textAlign(RIGHT, TOP);
  fill(0);
  noStroke();
  text(artist, W - 20, 60);
  pop();
}

// ---------------------------------------------------------------
// 入力テキスト（中央・白）
// ---------------------------------------------------------------
function drawTypedText() {
  if (!typedText) return;

  push();
  textSize(FONT_LARGE);
  textAlign(CENTER, CENTER);
  fill(255);
  noStroke();
  text(typedText, W / 2, H / 2);
  pop();
}

// ---------------------------------------------------------------
// Spotify ログインボタン
// ---------------------------------------------------------------
function drawLoginButton() {
  const bw = 220, bh = 52;
  const bx = W / 2, by = H / 2 + artSize / 2 + 50;

  push();
  rectMode(CENTER);
  fill(30, 215, 96);
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
    const bx = W / 2, by = H / 2 + artSize / 2 + 50;
    if (abs(mouseX - bx) < 110 && abs(mouseY - by) < 26) {
      Spotify.login();
    }
  }
}

function keyPressed() {
  if (keyCode === ESCAPE) {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    return false;
  } else if (keyCode === BACKSPACE) {
    typedText = typedText.slice(0, -1);
    return false;
  } else if (keyCode === ENTER || keyCode === RETURN) {
    typedText = '';
    return false;
  } else if (key.length === 1) {
    typedText += key;
  }
}
