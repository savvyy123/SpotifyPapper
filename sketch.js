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
let albumArt;       // p5.Image — アルバムジャケット画像
let lastArtUrl = '';// 前回のアルバムアートURL（重複ロード防止）
let artCanvas;      // ピクセル読み取り用オフスクリーン canvas
let artCtx;

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

  // アルバムアート ピクセル読み取り用オフスクリーン canvas
  artCanvas = document.createElement('canvas');
  artCanvas.width  = VIDEO_SIZE;
  artCanvas.height = VIDEO_SIZE;
  artCtx = artCanvas.getContext('2d', { willReadFrequently: true });

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

  // 2. アルバムアート（中央 400×400）
  if (scaledVol < THRESHOLD) {
    drawArtNormal();
  } else {
    drawArtGlitch();
  }

  // 3. 曲名（1文字ずつランダム配置・回転）
  drawTrackChars();

  // 4. アーティスト名（右上）
  drawArtistName();

  // 5. 入力テキスト（中央・白文字）
  drawTypedText();

  // 6. 再生コントロール or ログインボタン
  if (Spotify.isLoggedIn()) {
    drawControls();
  } else {
    drawLoginButton();
  }

  // 7. 音量バー（左下・デバッグ用）
  drawVolumeBar(scaledVol);
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

  // アルバムアート画像の読み込み（URL が変わったときだけ）
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
  const vx = (W - VIDEO_SIZE) / 2;
  const vy = (H - VIDEO_SIZE) / 2;
  image(albumArt, vx, vy, VIDEO_SIZE, VIDEO_SIZE);
}

// ---------------------------------------------------------------
// アルバムアート描画（グリッチ — oF 版の縦線スキャン＋ノイズ Y）
// ---------------------------------------------------------------
function drawArtGlitch() {
  if (!albumArt) return;

  const vx = (W - VIDEO_SIZE) / 2;
  const vy = (H - VIDEO_SIZE) / 2;

  // アルバムアートをオフスクリーン canvas に描画してピクセルを読み取る
  artCtx.drawImage(albumArt.canvas, 0, 0, VIDEO_SIZE, VIDEO_SIZE);
  const imageData = artCtx.getImageData(0, 0, VIDEO_SIZE, VIDEO_SIZE);
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
// 再生コントロール（Spotify 風）
// ---------------------------------------------------------------
// ボタン配置定数
const CTRL_Y     = H / 2 + VIDEO_SIZE / 2 + 50; // アルバムアートの下
const CTRL_CX    = W / 2;                        // 中央 X
const BTN_GAP    = 64;                            // ボタン間隔
const PLAY_R     = 24;                            // 再生ボタン半径
const SMALL_R    = 14;                            // 小ボタン半径
const SPOTIFY_GREEN = [30, 215, 96];

function drawControls() {
  if (!Spotify.isLoggedIn()) return;

  const shuffleOn = Spotify.getShuffleState();
  const repeatMode = Spotify.getRepeatState();
  const playing = Spotify.getIsPlaying();

  // --- シャッフル ---
  drawShuffleIcon(CTRL_CX - BTN_GAP * 2, CTRL_Y, shuffleOn);

  // --- 前の曲 ---
  drawPrevIcon(CTRL_CX - BTN_GAP, CTRL_Y);

  // --- 再生 / 一時停止 ---
  drawPlayPauseIcon(CTRL_CX, CTRL_Y, playing);

  // --- 次の曲 ---
  drawNextIcon(CTRL_CX + BTN_GAP, CTRL_Y);

  // --- リピート ---
  drawRepeatIcon(CTRL_CX + BTN_GAP * 2, CTRL_Y, repeatMode);
}

function drawPlayPauseIcon(cx, cy, playing) {
  push();
  // 背景の丸
  fill(0);
  noStroke();
  ellipse(cx, cy, PLAY_R * 2);

  fill(255);
  if (playing) {
    // 一時停止 ❚❚
    const bw = 5, bh = 16, gap = 4;
    rectMode(CENTER);
    rect(cx - gap - bw / 2 + gap, cy, bw, bh, 1);
    rect(cx + gap + bw / 2 - gap, cy, bw, bh, 1);
  } else {
    // 再生 ▶
    triangle(cx - 7, cy - 10, cx - 7, cy + 10, cx + 11, cy);
  }
  pop();
}

function drawPrevIcon(cx, cy) {
  push();
  fill(0);
  noStroke();
  // |◁
  const s = SMALL_R * 0.7;
  rect(cx - s - 2, cy - s, 3, s * 2);
  triangle(cx + s, cy - s, cx + s, cy + s, cx - s, cy);
  pop();
}

function drawNextIcon(cx, cy) {
  push();
  fill(0);
  noStroke();
  // ▷|
  const s = SMALL_R * 0.7;
  rect(cx + s - 1, cy - s, 3, s * 2);
  triangle(cx - s, cy - s, cx - s, cy + s, cx + s, cy);
  pop();
}

function drawShuffleIcon(cx, cy, active) {
  push();
  stroke(active ? SPOTIFY_GREEN : 0);
  strokeWeight(2.5);
  noFill();
  const s = 8;
  // 交差する2本の矢印線
  line(cx - s, cy - s, cx + s, cy + s);
  line(cx - s, cy + s, cx + s, cy - s);
  // 矢印先端（右上）
  line(cx + s, cy - s, cx + s - 4, cy - s);
  line(cx + s, cy - s, cx + s, cy - s + 4);
  // 矢印先端（右下）
  line(cx + s, cy + s, cx + s - 4, cy + s);
  line(cx + s, cy + s, cx + s, cy + s - 4);

  // ON のとき下にドット
  if (active) {
    noStroke();
    fill(SPOTIFY_GREEN);
    ellipse(cx, cy + s + 8, 5, 5);
  }
  pop();
}

function drawRepeatIcon(cx, cy, mode) {
  const active = mode !== 'off';
  push();
  stroke(active ? SPOTIFY_GREEN : 0);
  strokeWeight(2.5);
  noFill();
  const s = 9;
  // 丸い矢印（簡易的な四角ループ）
  beginShape();
  vertex(cx - s, cy - s);
  vertex(cx + s, cy - s);
  vertex(cx + s, cy + s);
  vertex(cx - s, cy + s);
  endShape(CLOSE);
  // 右上に矢印
  line(cx + s, cy - s, cx + s - 4, cy - s - 4);
  line(cx + s, cy - s, cx + s + 4, cy - s - 4);
  // 左下に矢印
  line(cx - s, cy + s, cx - s - 4, cy + s + 4);
  line(cx - s, cy + s, cx - s + 4, cy + s + 4);

  // track repeat のとき "1" を表示
  if (mode === 'track') {
    noStroke();
    fill(SPOTIFY_GREEN);
    textSize(11);
    textAlign(CENTER, CENTER);
    text('1', cx, cy);
  }

  // active のとき下にドット
  if (active) {
    noStroke();
    fill(SPOTIFY_GREEN);
    ellipse(cx, cy + s + 10, 5, 5);
  }
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
  const bx = W / 2, by = CTRL_Y;

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
    // ログインボタン
    if (abs(mouseX - CTRL_CX) < 110 && abs(mouseY - CTRL_Y) < 26) {
      Spotify.login();
    }
    return;
  }

  // 再生コントロールのクリック判定
  const hitR = 22; // クリック判定半径

  if (dist(mouseX, mouseY, CTRL_CX, CTRL_Y) < PLAY_R + 4) {
    // 再生 / 一時停止
    Spotify.togglePlay();
  } else if (dist(mouseX, mouseY, CTRL_CX - BTN_GAP, CTRL_Y) < hitR) {
    // 前の曲
    Spotify.skipPrev();
  } else if (dist(mouseX, mouseY, CTRL_CX + BTN_GAP, CTRL_Y) < hitR) {
    // 次の曲
    Spotify.skipNext();
  } else if (dist(mouseX, mouseY, CTRL_CX - BTN_GAP * 2, CTRL_Y) < hitR) {
    // シャッフル
    Spotify.toggleShuffle();
  } else if (dist(mouseX, mouseY, CTRL_CX + BTN_GAP * 2, CTRL_Y) < hitR) {
    // リピート
    Spotify.cycleRepeat();
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
