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
const FONT_FAMILY    = 'BIZ UDPGothic';
const LYRICS_FONT    = 'KazukiReiwa';

// BPM グリッチ設定
const GLITCH_CHANCE      = 0.035; // 各拍でグリッチが発動する確率
const GLITCH_DOWNBEAT    = 0.09;  // 強拍（1拍目）の発動確率
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
  const artBase = W < H ? 850 : 650;  // 縦画面では少し大きめ
  artSize = floor(artBase * s);
}

// ---------------------------------------------------------------
// 状態
// ---------------------------------------------------------------
let lineFbo;
let walkerPos;
let walkerPrev;
let walkerPrevPrev;   // 2フレーム前の位置（曲率計算用）
let walkerWeight = 0;  // 現在の線の太さ（スムージング用）
let walkerTime = 0;    // 可変速度の時間アキュムレータ
let walkerCurve = 0;   // スムージングされた曲率
let walkerOffsetX = 0; // テキスト回避オフセット
let walkerOffsetY = 0;
let walkerCharIdx = 0;      // 現在向かっている文字のインデックス
let walkerOrbitAngle = 0;
let walkerTargetX = 0;
let walkerTargetY = 0;
let walkerCharTime = 0;    // 現在の文字に向かい始めた時刻
let albumArt;
let lastArtUrl = '';
let artCanvas;
let artCtx;
let artIsDark = false;   // アルバムアートが暗いかどうか
let artColor = [0, 0, 0];   // ジャケットから抽出した線の色
let artPalette = [];         // ジャケットから抽出した複数色

let trackChars = [];
let lastTrack  = '';
let p5Font;              // loadFont で読み込んだフォント
let waveT = 0;           // 波アニメーション用の時間


// BPM グリッチ状態
let lastBeatTime = 0;
let beatCount    = 0;
let glitchActive = false;
let glitchStart  = 0;
let glitchType   = 0;    // 0: 縦線 1: 横線 2: RGBずれ
const SCAN_GRID = 4;  // グリッド分割数 (4×4 = 16ブロック)
let scanBlocks = [];  // エフェクト対象ブロックのインデックス

// 縦横スキャンの蓄積レイヤー
let scanFbo;
let scanFboActive = false; // スキャン蓄積中かどうか
let scanFadeAlpha = 255;   // フェードアウト用アルファ

// ---------------------------------------------------------------
// p5.js ライフサイクル
// ---------------------------------------------------------------
function preload() {
  p5Font = loadFont('assets/fonts/BIZUDPGothic-Bold.ttf');
}

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
    updateBeatGlitch();
  }

  background(255);

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

  // 7. 歌詞（ジャケット内にクリッピング）
  drawLyrics();

  // 8. アーティスト名（ジャケット下）
  drawArtistName();

  // 8. ログインボタン
  if (!Spotify.isLoggedIn()) {
    drawLoginButton();
  }
}

// ---------------------------------------------------------------
// Walker
// ---------------------------------------------------------------
function updateWalker() {
  const bpm = Spotify.getBPM() || 120;
  const bpmSpeed = bpm / 120;
  const dt = deltaTime / 1000.0;

  walkerPrevPrev = walkerPrev.copy();
  walkerPrev = walkerPos.copy();

  // 前フレームの曲率から速度を決定（曲がる→極端に減速、直線→やや速い）
  const curveMult = lerp(1.2, 0.03, walkerCurve);
  walkerTime += dt * bpmSpeed * curveMult;

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

  lineFbo.stroke(artColor[0], artColor[1], artColor[2]);
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
      const r = random();
      if (r < 0.45) glitchType = 0;       // 縦線 全体 45%
      else if (r < 0.90) glitchType = 1;  // 横線 全体 45%
      else if (r < 0.97) glitchType = 3;  // 部分ブロック 7%
      else glitchType = 2;                // RGBずれ 3%

      // 縦横スキャンのときは蓄積レイヤーを有効化
      if (glitchType <= 1 || glitchType === 3) {
        scanFbo.clear();
        scanFadeAlpha = 255;
        scanFboActive = true;

        if (glitchType === 3) {
          // 部分エフェクト: ブロック分割で 1/4 or 3/4
          glitchType = floor(random(2)); // 縦or横をランダム
          const total = SCAN_GRID * SCAN_GRID;
          const useCount = random() < 0.5 ? floor(total / 4) : floor(total * 3 / 4);
          const indices = Array.from({ length: total }, (_, i) => i);
          for (let k = indices.length - 1; k > 0; k--) {
            const j = floor(random(k + 1));
            [indices[k], indices[j]] = [indices[j], indices[k]];
          }
          scanBlocks = new Set(indices.slice(0, useCount));
        } else {
          // 全体エフェクト: 全ブロック有効
          const total = SCAN_GRID * SCAN_GRID;
          scanBlocks = new Set(Array.from({ length: total }, (_, i) => i));
        }
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
    walkerCharIdx = 0;
    walkerCharTime = millis();

    // 歌詞を取得
    const artist = Spotify.getArtistName();
    Lyrics.fetch(artist, currentTrack);
  }

  const artUrl = Spotify.getAlbumArtUrl();
  if (artUrl && artUrl !== lastArtUrl) {
    lastArtUrl = artUrl;
    loadImage(artUrl, img => {
      albumArt = img;
      img.loadPixels();
      let totalBr = 0;
      const step = 40;
      let count = 0;

      // 色のヒストグラムを簡易的に集計（彩度の高いピクセルを重視）
      let rSum = 0, gSum = 0, bSum = 0, cCount = 0;
      for (let i = 0; i < img.pixels.length; i += step * 4) {
        const r = img.pixels[i];
        const g = img.pixels[i + 1];
        const b = img.pixels[i + 2];
        totalBr += r * 0.299 + g * 0.587 + b * 0.114;
        count++;

        // 彩度が高いピクセルほど重みをつける
        const maxC = max(r, g, b);
        const minC = min(r, g, b);
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
        if (sat > 0.15) {
          const w = sat * sat;
          rSum += r * w;
          gSum += g * w;
          bSum += b * w;
          cCount += w;
        }
      }
      artIsDark = (totalBr / count) < 128;

      if (cCount > 0) {
        artColor = [floor(rSum / cCount), floor(gSum / cCount), floor(bSum / cCount)];
      } else {
        artColor = [0, 0, 0];
      }

      // パレット抽出: 画像の各領域から代表色を取得
      artPalette = [];
      const cols = 4, rows = 4;
      const pw = img.width / cols, ph = img.height / rows;
      const d = img.pixels.length > 100000 ? 20 : 4;
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          let pr = 0, pg = 0, pb = 0, pc = 0;
          for (let y = floor(gy * ph); y < floor((gy + 1) * ph); y += d) {
            for (let x = floor(gx * pw); x < floor((gx + 1) * pw); x += d) {
              const idx = (y * img.width + x) * 4;
              const cr = img.pixels[idx];
              const cg = img.pixels[idx + 1];
              const cb = img.pixels[idx + 2];
              // 白に近い色はスキップ
              if (cr > 220 && cg > 220 && cb > 220) continue;
              pr += cr;
              pg += cg;
              pb += cb;
              pc++;
            }
          }
          if (pc > 0) artPalette.push([floor(pr / pc), floor(pg / pc), floor(pb / pc)]);
        }
      }
      // 重複を減らして色のバリエーションを保つ
      if (artPalette.length === 0) artPalette.push(artColor);
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

  const cellSize = floor(artSize / SCAN_GRID);

  for (let q = 0; q < SCAN_GRID * SCAN_GRID; q++) {
    if (!scanBlocks.has(q)) continue;
    const col = q % SCAN_GRID;
    const row = floor(q / SCAN_GRID);
    const bx0 = col * cellSize;
    const bx1 = (col === SCAN_GRID - 1) ? artSize : bx0 + cellSize;
    const by0 = row * cellSize;
    const by1 = (row === SCAN_GRID - 1) ? artSize : by0 + cellSize;

    if (glitchType === 0) {
      for (let x = bx0; x < bx1; x++) {
        const ny = noise(fn * 0.01 + x * 0.01) * noiseStr;
        const sy = constrain(floor(ny), 0, artSize - 1);
        const idx = (sy * artSize + x) * 4;
        scanFbo.stroke(pixels[idx], pixels[idx+1], pixels[idx+2]);
        scanFbo.strokeWeight(1);
        scanFbo.line(vx + x, vy + by0, vx + x, vy + by1);
      }
    } else {
      for (let y = by0; y < by1; y++) {
        const nx = noise(fn * 0.01 + y * 0.01 + 500) * noiseStr;
        const sx = constrain(floor(nx), 0, artSize - 1);
        const idx = (y * artSize + sx) * 4;
        scanFbo.stroke(pixels[idx], pixels[idx+1], pixels[idx+2]);
        scanFbo.strokeWeight(1);
        scanFbo.line(vx + bx0, vy + y, vx + bx1, vy + y);
      }
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

  // ジャケットの領域（マージン付き）
  const margin = 20;
  const artLeft   = (W - artSize) / 2 - margin;
  const artRight  = (W + artSize) / 2 + margin;
  const artTop    = (H - artSize) / 2 - margin;
  const artBottom = (H + artSize) / 2 + margin;

  for (const ch of track) {
    const szMin = 32 * max(1, s * 1.2);
    const szMax = 120 * max(1, s * 1.2);
    const sz = random(szMin, szMax);
    textSize(sz);
    const cw = textWidth(ch);

    let x, y;
    let attempts = 0;
    do {
      x = random(cw, W - cw);
      y = random(sz, H - sz);
      attempts++;
    } while (
      attempts < 100 &&
      x + cw > artLeft && x - cw < artRight &&
      y + sz > artTop && y - sz < artBottom
    );

    trackChars.push({
      ch,
      x,
      y,
      angle: random(-PI / 4, PI / 4),
      size:  sz,
    });
  }

  waveT = 0;
}

// ---------------------------------------------------------------
// 文字エフェクトパターン
// ---------------------------------------------------------------
// パターン: 0=静止(輪郭のみ) 1=穏やかな波 2=激しい波 3=拡散 4=回転
const FONT_FX_PATTERNS = 5;
let fontFxPattern = 0;
let fontFxIntensity = 0;     // 0〜1 でスムージング
let fontFxTargetIntensity = 0;
let fontFxLastBeat = 0;

function updateFontFx() {
  const bpm = Spotify.getBPM();
  if (bpm <= 0) return;
  const now = millis();
  const beatInterval = 60000 / bpm;

  // 4拍ごとにパターンをランダム切り替え
  if (now - fontFxLastBeat >= beatInterval * 4) {
    fontFxLastBeat = now;
    fontFxPattern = floor(random(FONT_FX_PATTERNS));
    fontFxTargetIntensity = random(0.3, 1.0);
  }

  // BPMの拍に合わせてインテンシティをパルスさせる
  const beatPhase = ((now % beatInterval) / beatInterval); // 0〜1
  const pulse = pow(1 - beatPhase, 3); // 拍の頭で強く減衰
  fontFxIntensity = lerp(fontFxIntensity, fontFxTargetIntensity * (0.5 + pulse * 0.5), 0.1);
}

function drawTrackChars() {
  if (!p5Font || trackChars.length === 0) return;

  waveT += 0.02;
  updateFontFx();

  const intensity = fontFxIntensity;

  // 各文字ごとに点群とカラーを記録
  const charSegments = [];
  for (let ci = 0; ci < trackChars.length; ci++) {
    const c = trackChars[ci];
    const pts = p5Font.textToPoints(c.ch, 0, 0, c.size, { sampleFactor: 0.22 });
    if (pts.length === 0) continue;

    const bounds = p5Font.textBounds(c.ch, 0, 0, c.size);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;

    const worldPts = [];
    for (let j = 0; j < pts.length; j++) {
      let lx = pts[j].x - cx;
      let ly = pts[j].y - cy;

      // パターンごとのエフェクト適用
      let ox = 0, oy = 0;
      if (fontFxPattern === 1) {
        // 穏やかな波: ゆっくりうねる
        const wave = sin((j / 25) * PI * 2 + waveT) * 6 * intensity;
        ox = cos(ci * 0.5) * wave;
        oy = sin(ci * 0.5) * wave;
      } else if (fontFxPattern === 2) {
        // 激しい波: 高周波で複数の波が重なる
        const w1 = sin((j / 15) * PI * 4 + waveT * 2) * 10 * intensity;
        const w2 = sin((j / 10) * PI * 6 + waveT * 3) * 5 * intensity;
        ox = cos(ci * 0.3) * (w1 + w2);
        oy = sin(ci * 0.3) * (w1 + w2);
      } else if (fontFxPattern === 3) {
        // 拡散: 中心から外側に膨らむ
        const dist = sqrt(lx * lx + ly * ly);
        const expand = sin(waveT * 1.5 + dist * 0.05) * 8 * intensity;
        const angle = atan2(ly, lx);
        ox = cos(angle) * expand;
        oy = sin(angle) * expand;
      } else if (fontFxPattern === 4) {
        // 回転: 点が中心周りに微かに回る
        const rotAmt = sin(waveT) * 0.15 * intensity;
        const cosR = cos(rotAmt);
        const sinR = sin(rotAmt);
        const rlx = lx * cosR - ly * sinR;
        const rly = lx * sinR + ly * cosR;
        ox = rlx - lx;
        oy = rly - ly;
      }
      // パターン0: ox=0, oy=0（静止）

      const cosA = cos(c.angle);
      const sinA = sin(c.angle);
      const flx = lx + ox;
      const fly = ly + oy;
      worldPts.push({
        x: c.x + flx * cosA - fly * sinA,
        y: c.y + flx * sinA + fly * cosA,
      });
    }

    const col = artPalette.length > 0
      ? artPalette[ci % artPalette.length]
      : artColor;

    charSegments.push({ points: worldPts, color: col });
  }

  if (charSegments.length === 0) return;

  // 波の本数: パターンに応じて変える
  const numLines = fontFxPattern === 0 ? 2
    : fontFxPattern === 2 ? floor(3 + intensity * 4)
    : floor(2 + intensity * 3);

  push();
  noFill();
  strokeWeight(1.5 * s);

  // 線が増えたときだけうねりが出る
  const waveLoose = max(0, numLines - 2) * 5 * s;

  for (let n = 0; n < numLines; n++) {
    // n 番目の線の基本オフセット
    const baseOff = (n - (numLines - 1) / 2) * 2 * s;

    for (let si = 0; si < charSegments.length; si++) {
      const seg = charSegments[si];
      const nextSeg = charSegments[(si + 1) % charSegments.length];
      const c1 = seg.color;
      const c2 = nextSeg.color;

      const pts = seg.points;

      // curveVertex で滑らかな曲線として描画
      const mr = lerp(c1[0], c2[0], 0.5);
      const mg = lerp(c1[1], c2[1], 0.5);
      const mb = lerp(c1[2], c2[2], 0.5);
      stroke(mr, mg, mb, 140 + n * 15);

      beginShape();
      for (let j = 0; j < pts.length; j++) {
        const wave1 = sin((j / 15) * PI + waveT + n * 0.8) * waveLoose;
        const wave2 = sin((j / 9) * PI * 0.7 + waveT * 0.6 + n) * waveLoose * 0.5;
        const wx = wave1 + wave2;
        const wy = cos((j / 12) * PI + waveT + n * 0.6) * waveLoose * 0.8;

        curveVertex(pts[j].x + baseOff + wx, pts[j].y + baseOff + wy);
      }
      endShape();

      // 次の文字への接続線
      if (charSegments.length > 1 && pts.length > 0 && nextSeg.points.length > 0) {
        const from = pts[pts.length - 1];
        const to = nextSeg.points[0];
        const steps = 20;
        for (let j = 0; j < steps; j++) {
          const t = j / steps;
          const r = lerp(c1[0], c2[0], t);
          const g = lerp(c1[1], c2[1], t);
          const b = lerp(c1[2], c2[2], t);
          stroke(r, g, b, (140 + n * 15) * (1 - t * 0.5));
          const connWave = sin((j / 5) * PI + waveT + n * 0.8) * waveLoose;
          const x1 = lerp(from.x, to.x, t) + baseOff + connWave;
          const y1 = lerp(from.y, to.y, t) + baseOff;
          const x2 = lerp(from.x, to.x, (j + 1) / steps) + baseOff + connWave;
          const y2 = lerp(from.y, to.y, (j + 1) / steps) + baseOff;
          line(x1, y1, x2, y2);
        }
      }
    }
  }

  pop();
}

// ---------------------------------------------------------------
// アーティスト名（ジャケット下・中央）
// ---------------------------------------------------------------
function drawArtistName() {
  const artist = Spotify.getArtistName();
  if (!artist) return;

  push();
  textFont(LYRICS_FONT);
  textSize(FONT_MEDIUM);
  textAlign(CENTER, TOP);
  fill(0);
  noStroke();
  const ty = (H + artSize) / 2 + 20;
  text(artist, W / 2, ty);
  pop();

  return ty + FONT_MEDIUM + 10; // 歌詞の開始Y位置を返す
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
  if (currentIdx < 0) return;

  if (currentIdx !== lyricsPrevIdx) {
    lyricsTransAt = millis();
    lyricsPrevIdx = currentIdx;
  }

  const currentText = lines[currentIdx].text;
  const maxLyricsW = artSize * 0.85;

  // フェードイン
  const t = constrain((millis() - lyricsTransAt) / LYRICS_FADE_MS, 0, 1);
  const easedT = t * t * (3 - 2 * t);

  // ジャケット中央に大きく表示
  let sz = 72 * s;

  // ジャケット矩形でクリッピング
  const artLeft = (W - artSize) / 2;
  const artTop = (H - artSize) / 2;
  const ctx = drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.rect(artLeft, artTop, artSize, artSize);
  ctx.clip();

  push();
  textFont(LYRICS_FONT);
  textSize(sz);
  noStroke();

  // 1行に収まらなければ2行に分割（中央付近で単語・文字境界を探す）
  const lineTexts = [];
  if (textWidth(currentText) <= maxLyricsW) {
    lineTexts.push(currentText);
  } else {
    const mid = Math.floor(currentText.length / 2);
    let splitIdx = -1;
    for (let offset = 0; offset <= currentText.length; offset++) {
      const l = mid - offset, r = mid + offset;
      if (l > 0 && currentText[l] === ' ') { splitIdx = l; break; }
      if (r < currentText.length && currentText[r] === ' ') { splitIdx = r; break; }
    }
    if (splitIdx < 0) splitIdx = mid;
    const line1 = currentText.slice(0, splitIdx).trim();
    const line2 = currentText.slice(splitIdx).trim();
    lineTexts.push(line1, line2);
    const widest = Math.max(textWidth(line1), textWidth(line2));
    if (widest > maxLyricsW) {
      sz *= maxLyricsW / widest;
      textSize(sz);
    }
  }

  // 文字ごとに背景明るさをサンプリングして白/黒を決定
  loadPixels();
  const d = pixelDensity();
  const alpha = lerp(0, 255, easedT);
  const lineH = sz * 1.15;
  const totalH = lineH * lineTexts.length;
  const startY = H / 2 - totalH / 2 + lineH / 2;

  textAlign(LEFT, CENTER);
  for (let li = 0; li < lineTexts.length; li++) {
    const lineText = lineTexts[li];
    const lineY = startY + li * lineH;
    const sampleY = constrain(floor(lineY), 0, H - 1);
    const totalW = textWidth(lineText);
    let cursorX = W / 2 - totalW / 2;

    for (const ch of lineText) {
      const chW = textWidth(ch);
      const centerX = cursorX + chW / 2;
      const sx = constrain(floor(centerX), 0, W - 1);
      const pi = 4 * ((sampleY * d) * (W * d) + (sx * d));
      const brightness = (pixels[pi] + pixels[pi + 1] + pixels[pi + 2]) / 3;
      const textColor = brightness < 160 ? 255 : 0;
      fill(textColor, alpha);
      text(ch, cursorX, lineY);
      cursorX += chW;
    }
  }
  pop();

  ctx.restore();
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
  // クリック後にキャンバスのフォーカスを外してテキスト入力を無効化
  if (document.activeElement) document.activeElement.blur();

  if (!Spotify.isLoggedIn()) {
    const bx = W / 2, by = H / 2 + artSize / 2 + 50;
    if (abs(mouseX - bx) < 110 && abs(mouseY - by) < 26) {
      Spotify.login();
    }
  }
}

function keyPressed() {
  if (key === 'f' || key === 'F') {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } else if (key === 'r' || key === 'R') {
    const track = Spotify.getTrackName();
    if (track) generateTrackChars(track);
  }
  return false;
}
