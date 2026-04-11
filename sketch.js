// sketch.js — WalkPaper メイン p5.js スケッチ
// 元の oF 版の動作を Web に移植
//
// 描画レイヤー構成:
//   1. bgLayer  … Perlin ノイズウォーカーが線を蓄積（永続）
//   2. Canvas   … bgLayer をコピー → 動画 → グリッチ → テキスト

// ---------------------------------------------------------------
// 定数
// ---------------------------------------------------------------
const W = 1920;
const H = 1080;
const NUM_WALKERS  = 60;
const LINE_WIDTH   = 4;
const LINE_SPEED   = 0.5;
const THRESHOLD    = 0.01;   // グリッチ発動の音量閾値
const SCALE        = 30.0;   // 音量 → グリッチ強度の係数
const VIDEO_SIZE   = 400;    // 動画の表示サイズ (px)
const FONT_FAMILY  = 'Noto Sans JP';

// ---------------------------------------------------------------
// 状態
// ---------------------------------------------------------------
let bgLayer;    // p5.Graphics — ウォーカーの線を蓄積するオフスクリーン
let walkers = [];
let video;

let trackChars = []; // {ch, x, y, angle, size, alpha}
let lastTrack  = '';

// ---------------------------------------------------------------
// p5.js ライフサイクル
// ---------------------------------------------------------------
function setup() {
  createCanvas(W, H);
  textFont(FONT_FAMILY);
  frameRate(60);

  // オフスクリーンレイヤー（背景の線を蓄積する）
  bgLayer = createGraphics(W, H);
  bgLayer.background(0);
  bgLayer.strokeWeight(LINE_WIDTH);
  bgLayer.noFill();

  // ウォーカー初期化
  for (let i = 0; i < NUM_WALKERS; i++) {
    walkers.push({
      x: random(W),
      y: random(H),
      t: random(1000), // ノイズの時間オフセット
    });
  }

  // 動画要素
  video = document.getElementById('walkVideo');
  video.play().catch(() => {
    // 自動再生がブロックされた場合はクリックで再生
    document.addEventListener('click', () => video.play(), { once: true });
  });

  // マイク + Spotify 初期化
  Audio.init().catch(e => console.warn('Audio init failed:', e));
  Spotify.init();
}

function draw() {
  // 1. ウォーカーを bgLayer に描画（蓄積）
  updateWalkers();

  // 2. bgLayer をキャンバスに転写
  image(bgLayer, 0, 0);

  // 3. 動画を中央に描画
  drawVideo();

  // 4. マイク音量でグリッチ
  const rms = Audio.getRMS();
  if (rms > THRESHOLD) {
    applyGlitch(rms);
  }

  // 5. 曲名テキスト（1文字ずつランダム配置）
  const currentTrack = Spotify.getTrackName();
  if (currentTrack && currentTrack !== lastTrack) {
    lastTrack = currentTrack;
    generateTrackChars(currentTrack);
  }
  drawTrackChars();

  // 6. アーティスト名（右上）
  drawArtistName();

  // 7. 未ログイン時にログインボタン
  if (!Spotify.isLoggedIn()) {
    drawLoginButton();
  }
}

// ---------------------------------------------------------------
// Perlin ノイズウォーカー
// ---------------------------------------------------------------
function updateWalkers() {
  for (const w of walkers) {
    // ノイズ場から進行方向を決定
    const angle = noise(w.x * 0.003, w.y * 0.003, w.t * 0.01) * TWO_PI * 4;
    const nx = w.x + cos(angle) * LINE_SPEED;
    const ny = w.y + sin(angle) * LINE_SPEED;

    // 色: 青〜紫系、低アルファで蓄積効果
    const r = noise(w.t * 0.008)             * 80  + 20;
    const g = noise(w.t * 0.008 + 100)       * 60  + 20;
    const b = noise(w.t * 0.008 + 200)       * 200 + 55;
    bgLayer.stroke(r, g, b, 35);
    bgLayer.line(w.x, w.y, nx, ny);

    w.x = nx;
    w.y = ny;
    w.t += 0.5;

    // 画面端でループ
    if (w.x < 0)  w.x = W;
    if (w.x > W)  w.x = 0;
    if (w.y < 0)  w.y = H;
    if (w.y > H)  w.y = 0;
  }
}

// ---------------------------------------------------------------
// 動画描画
// ---------------------------------------------------------------
function drawVideo() {
  if (!video || video.readyState < 2) return;

  const vx = (W - VIDEO_SIZE) / 2;
  const vy = (H - VIDEO_SIZE) / 2;
  drawingContext.drawImage(video, vx, vy, VIDEO_SIZE, VIDEO_SIZE);
}

// ---------------------------------------------------------------
// グリッチエフェクト（動画エリアのみ）
// ---------------------------------------------------------------
function applyGlitch(rms) {
  if (!video || video.readyState < 2) return;

  const vx = (W - VIDEO_SIZE) / 2;
  const vy = (H - VIDEO_SIZE) / 2;

  // 音量に応じてスライス数を増やす
  const sliceCount = floor(min((rms - THRESHOLD) * SCALE * 500, 25));

  for (let i = 0; i < sliceCount; i++) {
    const sliceY  = floor(random(VIDEO_SIZE));
    const sliceH  = floor(random(2, 18));
    const shiftX  = floor(random(-40, 40));
    const srcX    = max(0, -shiftX);   // クリッピング
    const dstX    = max(0,  shiftX);
    const copyW   = VIDEO_SIZE - abs(shiftX);

    if (copyW <= 0) continue;

    // キャンバス上の該当スライスを横ずれさせて再描画
    drawingContext.drawImage(
      drawingContext.canvas,
      vx + srcX,          vy + sliceY, copyW, sliceH, // src
      vx + dstX,          vy + sliceY, copyW, sliceH  // dst
    );

    // ランダムに色チャンネルをずらす（RGBずらし）
    if (random() < 0.3) {
      drawingContext.globalCompositeOperation = 'screen';
      drawingContext.fillStyle = `rgba(255,0,0,0.15)`;
      drawingContext.fillRect(vx + dstX + random(-5, 5), vy + sliceY, copyW, sliceH);
      drawingContext.globalCompositeOperation = 'source-over';
    }
  }
}

// ---------------------------------------------------------------
// 曲名テキスト（1文字ずつランダム配置・回転）
// ---------------------------------------------------------------
function generateTrackChars(track) {
  trackChars = [];
  for (const ch of track) {
    if (ch === ' ') continue; // スペースはスキップ
    trackChars.push({
      ch,
      x:     random(W),
      y:     random(H),
      angle: random(-PI / 4, PI / 4),
      size:  random(32, 90),
      alpha: random(140, 255),
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
    fill(255, 255, 255, c.alpha);
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
  textSize(28);
  textAlign(RIGHT, TOP);
  fill(255, 255, 255, 200);
  noStroke();
  text(artist, W - 32, 32);
  pop();
}

// ---------------------------------------------------------------
// Spotify ログインボタン
// ---------------------------------------------------------------
function drawLoginButton() {
  const bw = 220, bh = 52;
  const bx = W / 2, by = H / 2;

  push();
  rectMode(CENTER);
  fill(30, 215, 96); // Spotify グリーン
  noStroke();
  rect(bx, by, bw, bh, 26);

  fill(0);
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
    if (abs(mouseX - W / 2) < 110 && abs(mouseY - H / 2) < 26) {
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
  }
}
