// serial.js — Arduino とのWeb Serial API 通信
// 受信: ボタンのタップ数 (1/2/3) → Spotifyを操作
// 送信: 曲名 "T:<trackName>\n" → ArduinoのOLEDに表示
//
// 1回 → togglePlay()   再生/一時停止
// 2回 → skipNext()     次の曲
// 3回 → skipPrev()     前の曲

const SerialControl = (() => {
  let port = null;
  let reader = null;
  let writer = null;
  let connectBtn = null;
  let lastSentTrack = '';

  // ---------------------------------------------------------------
  // Web Serial 接続
  // ---------------------------------------------------------------
  async function connect() {
    if (!('serial' in navigator)) {
      alert('Web Serial API は Chrome / Edge でのみ動作します。');
      return;
    }

    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });

      // 送信用 writer を準備（ASCIIのみ送る想定）
      const encoder = new TextEncoderStream();
      encoder.readable.pipeTo(port.writable);
      writer = encoder.writable.getWriter();

      console.log('[Serial] connected');
      readLoop();
      startTrackSync();

      // 接続確認用: 即OLEDに"Connected"を表示
      await sendTrack('Connected');
    } catch (e) {
      console.warn('Serial connect error:', e);
    }
  }

  // ---------------------------------------------------------------
  // 受信ループ
  // ---------------------------------------------------------------
  async function readLoop() {
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    reader = decoder.readable.getReader();

    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          handleTap(parseInt(line.trim(), 10));
        }
      }
    } catch (e) {
      console.warn('Serial read error:', e);
      if (connectBtn) {
        connectBtn.textContent = '🔌 Arduino接続';
        connectBtn.style.borderColor = '#fff';
        connectBtn.style.color = '#fff';
        connectBtn.addEventListener('click', connect);
      }
    }
  }

  // ---------------------------------------------------------------
  // タップ数に応じた操作
  // ---------------------------------------------------------------
  function handleTap(count) {
    if (isNaN(count)) return;
    switch (count) {
      case 1: Spotify.togglePlay(); break;
      case 2: Spotify.skipNext();   break;
      case 3: Spotify.skipPrev();   break;
    }
  }

  // ---------------------------------------------------------------
  // 曲名の送信（OLED表示用）
  // ASCII以外の文字はOLEDで表示できないので除去する
  // ---------------------------------------------------------------
  function toAscii(s) {
    return s.replace(/[^\x20-\x7E]/g, '').trim();
  }

  async function sendTrack(name) {
    if (!writer) return;
    const ascii = toAscii(name || '');
    const payload = ascii.length > 0 ? ascii : 'No Track';
    try {
      await writer.write('T:' + payload + '\n');
      console.log('[Serial] sent:', payload);
    } catch (e) {
      console.warn('Serial write error:', e);
    }
  }

  // Spotifyの曲名変化を監視して自動送信
  function startTrackSync() {
    setInterval(() => {
      if (!writer) return;
      const name = (typeof Spotify !== 'undefined' && Spotify.getTrackName)
        ? Spotify.getTrackName() : '';
      if (name !== lastSentTrack) {
        lastSentTrack = name;
        sendTrack(name);
      }
    }, 1000);
  }

  // ---------------------------------------------------------------
  // キーボードショートカット（Aキーで接続）
  // ---------------------------------------------------------------
  function setupKeyListener() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'a' || e.key === 'A') {
        if (!port) connect();
      }
    });
  }

  // ---------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------
  function init() {
    setupKeyListener();
  }

  return { init, sendTrack };
})();

SerialControl.init();
