// sketch.js — WalkPaper メイン p5.js スケッチ
// oF 版 (ofApp.cpp) を忠実に Web に移植
//
// 描画レイヤー構成:
//   1. lineFbo  … 単一ウォーカーの黒線を蓄積（曲変更でクリア）
//   2. Canvas   … 白背景 → lineFbo → アルバムアート(+グリッチ) → テキスト

// ---------------------------------------------------------------
// 定数
// ---------------------------------------------------------------
const LINE_WIDTH     = 7;
const LINE_SPEED     = 0.5;
const NOISE_STRENGTH = 200.0;
const FONT_FAMILY    = 'Noto Sans JP';

// BPM グリッチ設定
const GLITCH_CHANCE      = 0.15;  // 各拍でグリッチが発動する確率
const GLITCH_DOWNBEAT    = 0.35;  // 強拍（1拍目）の発動確率
const GLITCH_DURATION_MS = 180;   // グリッチ表示の持続時間 (ms)

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
  artSize = floor(650 * s);
}

// ---------------------------------------------------------------
// 状態
// ---------------------------------------------------------------
let lineFbo;
let walkerPos;
let walkerPrev;
let walkerPrevPrev;   // 2フレーム前の位置（曲率計算用）
let walkerWeight = 0; // 現在の線の太さ（スムージング用）
let walkerTime = 0;   // 可変速度の時間アキュムレータ
let walkerCurve = 0;  // スムージングされた曲率
let albumArt;
let lastArtUrl = '';
let artCanvas;
let artCtx;
let artIsDark = false; // アルバムアートが暗いかどうか

let trackChars = [];
let lastTrack  = '';

let typedText = '';

// BPM グリッチ状態
let lastBeatTime = 0;
let beatCount    = 0;
let glitchActive = false;
let glitchStart  = 0;
let glitchType   = 0;    // 0: 縦線 1: 横線 2: RGBずれ

// 縦横スキャンの蓄積レイヤー
let scanFbo;
let scanFboActive = false; // スキャン蓄積中かどうか
let scanFadeAlpha = 255;   // フェードアウト用アルファ

// ---------------------------------------------------------------
// p5.js ライフサイクル
// ---------------------------------------------------------------
function setup() {
  updateSizes();
  createCanvas(W, H);
  textFont(FONT_FAMILY);
  frameRate(60);

  initLineFbo();

  walkerPos      = createVector(random(W), random(H));
  walkerPrev     = walkerPos.copy();
  walkerPrevPrev = walkerPos.copy();

  artCanvas = document.createElement('canvas');
  artCtx = artCanvas.getContext('2d', { willReadFrequently: true });

  scanFbo = createGraphics(W, H);
  scanFbo.clear();

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

  scanFbo = createGraphics(W, H);
  scanFbo.clear();
}

function draw() {
  updateSpotifyTrack();
  if (Spotify.getIsPlaying()) {
    updateWalker();
    updateBeatGlitch();
  }

  background(255);

  // 1. 背景の線（Perlin noise で描画位置を微かに揺らす）
  const nt = millis() / 1000.0;
  const shiftX = (noise(nt * 0.3, 0) - 0.5) * 6 * s;
  const shiftY = (noise(0, nt * 0.3) - 0.5) * 6 * s;
  image(lineFbo, shiftX, shiftY);

  // 2. アルバムアート（中央）
  drawArtNormal();

  // 3. スキャンエフェクトの蓄積レイヤー（ゆっくりフェードアウト）
  if (scanFboActive) {
    scanFadeAlpha = max(scanFadeAlpha - 3.5, 0); // 約1.2秒でフェードアウト
    if (scanFadeAlpha <= 0) {
      scanFboActive = false;
      scanFbo.clear();
    }
  }
  if (scanFboActive) {
    tint(255, scanFadeAlpha);
    image(scanFbo, 0, 0);
    noTint();
  }

  // 4. グリッチ発動中の処理
  if (glitchActive) {
    if (glitchType <= 1) {
      // 縦横スキャン → scanFbo に描き込む（蓄積）
      drawScanGlitch();
    } else {
      // RGBずれ → 瞬間的にキャンバスに直接
      const vx = (W - artSize) / 2;
      const vy = (H - artSize) / 2;
      glitchRGBShift(vx, vy);
    }
  }

  // 6. 曲名
  drawTrackChars();

  // 7. 歌詞（最前面）
  drawLyrics();

  // 8. アーティスト名
  drawArtistName();

  // 9. 入力テキスト
  drawTypedText();

  // 8. ログインボタン
  if (!Spotify.isLoggedIn()) {
    drawLoginButton();
  }
}

// ---------------------------------------------------------------
// Walker
// ---------------------------------------------------------------
function updateWalker() {
  // 前フレームの曲率から速度を決定（曲がる→極端に減速、直線→やや速い）
  const speedMult = lerp(1.2, 0.03, walkerCurve);
  walkerTime += (deltaTime / 1000.0) * speedMult;

  walkerPrevPrev = walkerPrev.copy();
  walkerPrev = walkerPos.copy();

  walkerPos.x = map(noise(walkerTime * LINE_SPEED),       0, 1, 0, W);
  walkerPos.y = map(noise(walkerTime * LINE_SPEED + 1000), 0, 1, 0, H);

  // 曲率を計算してスムージング
  const d1 = p5.Vector.sub(walkerPrev, walkerPrevPrev);
  const d2 = p5.Vector.sub(walkerPos, walkerPrev);
  const len1 = d1.mag();
  const len2 = d2.mag();
  let rawCurve = 0;
  if (len1 > 0.1 && len2 > 0.1) {
    const dot = d1.dot(d2) / (len1 * len2);
    rawCurve = acos(constrain(dot, -1, 1)) / PI;
  }
  walkerCurve = lerp(walkerCurve, rawCurve, 0.12);

  // 太さ: 減速(曲がり)で太く、加速(直線)で細く
  const targetWeight = lerp(LINE_WIDTH * 0.2, LINE_WIDTH * 3.0, walkerCurve) * s;
  walkerWeight = lerp(walkerWeight, targetWeight, 0.15);
  const weight = walkerWeight;

  lineFbo.stroke(0);
  lineFbo.strokeWeight(weight);
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
      // 縦横スキャンが多め、RGBずれはたまに
      const r = random();
      if (r < 0.45) glitchType = 0;       // 縦線 45%
      else if (r < 0.90) glitchType = 1;  // 横線 45%
      else glitchType = 2;                // RGBずれ 10%

      // 縦横スキャンのときは蓄積レイヤーを有効化
      if (glitchType <= 1) {
        scanFbo.clear();
        scanFadeAlpha = 255;
        scanFboActive = true;
      }
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

    // 歌詞を取得
    const artist = Spotify.getArtistName();
    Lyrics.fetch(artist, currentTrack);
  }

  const artUrl = Spotify.getAlbumArtUrl();
  if (artUrl && artUrl !== lastArtUrl) {
    lastArtUrl = artUrl;
    loadImage(artUrl, img => {
      albumArt = img;
      // 平均輝度を計算してアートが暗いか判定
      img.loadPixels();
      let totalBr = 0;
      const step = 40; // サンプリング間隔（全ピクセルは重いので間引く）
      let count = 0;
      for (let i = 0; i < img.pixels.length; i += step * 4) {
        totalBr += img.pixels[i] * 0.299 + img.pixels[i+1] * 0.587 + img.pixels[i+2] * 0.114;
        count++;
      }
      artIsDark = (totalBr / count) < 128;
    }, () => { albumArt = null; });
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
// スキャンエフェクト（縦/横を scanFbo に蓄積 → フェードアウト）
// ---------------------------------------------------------------
function drawScanGlitch() {
  if (!albumArt) return;

  const vx = (W - artSize) / 2;
  const vy = (H - artSize) / 2;

  if (artCanvas.width !== artSize || artCanvas.height !== artSize) {
    artCanvas.width  = artSize;
    artCanvas.height = artSize;
  }

  artCtx.drawImage(albumArt.canvas, 0, 0, artSize, artSize);
  const imageData = artCtx.getImageData(0, 0, artSize, artSize);
  const pixels = imageData.data;
  const noiseStr = NOISE_STRENGTH * s;
  const fn = frameCount;

  if (glitchType === 0) {
    // 縦線スキャン → scanFbo に描き込む
    for (let x = 0; x < artSize; x++) {
      const ny = noise(fn * 0.01 + x * 0.01) * noiseStr;
      const sy = constrain(floor(ny), 0, artSize - 1);
      const idx = (sy * artSize + x) * 4;
      scanFbo.stroke(pixels[idx], pixels[idx+1], pixels[idx+2]);
      scanFbo.strokeWeight(1);
      scanFbo.line(vx + x, vy, vx + x, vy + artSize);
    }
  } else {
    // 横線スキャン → scanFbo に描き込む
    for (let y = 0; y < artSize; y++) {
      const nx = noise(fn * 0.01 + y * 0.01 + 500) * noiseStr;
      const sx = constrain(floor(nx), 0, artSize - 1);
      const idx = (y * artSize + sx) * 4;
      scanFbo.stroke(pixels[idx], pixels[idx+1], pixels[idx+2]);
      scanFbo.strokeWeight(1);
      scanFbo.line(vx, vy + y, vx + artSize, vy + y);
    }
  }
}

// RGB チャンネルずれ（赤・青を別方向にずらして重ねる）
function glitchRGBShift(vx, vy) {
  const ctx = drawingContext;
  const shiftX = floor(random(5, 15) * s);
  const shiftY = floor(random(-5, 5) * s);

  // 赤チャンネルをずらして合成
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(vx, vy, artSize, artSize);

  // 赤方向
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(
    ctx.canvas,
    vx, vy, artSize, artSize,
    vx + shiftX, vy + shiftY, artSize, artSize
  );

  // 青方向（反対にずらす）
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = `rgba(0,0,255,0.12)`;
  ctx.fillRect(vx - shiftX, vy - shiftY, artSize, artSize);

  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------
// 曲名テキスト（1文字ずつランダム配置・回転）
// ---------------------------------------------------------------
function generateTrackChars(track) {
  trackChars = [];

  for (const ch of track) {
    const sz = random(32, 120);
    textSize(sz);
    const cw = textWidth(ch);

    trackChars.push({
      ch,
      x:     random(cw, W - cw),
      y:     random(sz, H - sz),
      angle: random(-PI / 4, PI / 4),
      size:  sz,
    });
  }
}

function drawTrackChars() {
  for (const c of trackChars) {
    push();
    translate(c.x, c.y);
    rotate(c.angle);
    textSize(c.size);
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
  const tx = W - 20;
  const ty = 60;
  text(artist, tx, ty);

  // 下線
  const tw = textWidth(artist);
  stroke(0);
  strokeWeight(4);
  strokeCap(PROJECT); // 先端90度
  const underY = ty + FONT_MEDIUM + 4;
  line(tx - tw, underY, tx, underY);
  pop();
}

// ---------------------------------------------------------------
// 歌詞表示（全歌詞を背景に敷き詰め、現在行を黒く）
// ---------------------------------------------------------------
const LYRICS_ALPHA = 30;      // 通常行の薄さ
const LYRICS_FADE_MS = 400;   // 現在行フェードインの時間 (ms)
let lyricsPrevIdx = -1;       // 前フレームの現在行インデックス
let lyricsTransAt = 0;        // 行が切り替わった時刻 (ms)

function drawLyrics() {
  if (!Lyrics.hasLyrics()) return;

  const lines = Lyrics.getLines();
  const progressMs = Spotify.getProgressMs();
  const currentIdx = Lyrics.getCurrentIndex(progressMs);

  // 行が切り替わったらタイムスタンプを記録
  if (currentIdx !== lyricsPrevIdx) {
    lyricsTransAt = millis();
    lyricsPrevIdx = currentIdx;
  }

  const margin = 30;
  const availH = H - margin * 2;
  const lineCount = lines.length;

  // 全行が画面に収まるように行間を計算し、フォントサイズも調整
  const leading = min(34, availH / max(lineCount, 1));
  const sz = min(24, leading * 0.75);

  // 全体の高さから開始Y位置を算出して上下中央揃え
  const totalH = lineCount * leading;
  const startY = (H - totalH) / 2;

  push();
  textAlign(CENTER, TOP);
  noStroke();

  for (let i = 0; i < lineCount; i++) {
    const y = startY + i * leading;
    if (y > H - margin) break;

    // 背景の明るさをサンプリングして白黒を決定
    const sampleY = constrain(floor(y + sz / 2), 0, H - 1);
    let brightnessSum = 0;
    const sampleCount = 7;
    for (let j = 0; j < sampleCount; j++) {
      const sx = constrain(floor(W / 2 + (j - 3) * 50), 0, W - 1);
      const c = get(sx, sampleY);
      brightnessSum += (c[0] + c[1] + c[2]) / 3;
    }
    const avgBrightness = brightnessSum / sampleCount;
    const textColor = avgBrightness < 128 ? 255 : 0;

    if (i === currentIdx) {
      const t = constrain((millis() - lyricsTransAt) / LYRICS_FADE_MS, 0, 1);
      const easedT = t * t * (3 - 2 * t);  // smoothstep
      textSize(sz * 1.6);
      fill(textColor, lerp(LYRICS_ALPHA, 255, easedT));
    } else {
      textSize(sz);
      fill(textColor, LYRICS_ALPHA);
    }

    text(lines[i].text, W / 2, y);
  }

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
