// serial.js — Arduino とのWeb Serial API 通信
// タップ数を受け取り Spotify を操作する
//
// 1回 → togglePlay()   再生/一時停止
// 2回 → skipNext()     次の曲
// 3回 → skipPrev()     前の曲

const SerialControl = (() => {
  let port = null;
  let reader = null;
  let connectBtn = null;


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


      readLoop();
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
        buffer = lines.pop(); // 未完了の行を次回に持ち越す

        for (const line of lines) {
          handleTap(parseInt(line.trim(), 10));
        }
      }
    } catch (e) {
      console.warn('Serial read error:', e);
      connectBtn.textContent = '🔌 Arduino接続';
      connectBtn.style.borderColor = '#fff';
      connectBtn.style.color = '#fff';
      connectBtn.addEventListener('click', connect);
    }
  }

  // ---------------------------------------------------------------
  // タップ数に応じた操作
  // ---------------------------------------------------------------
  function handleTap(count) {
    if (isNaN(count)) return;
    switch (count) {
      case 1: Spotify.togglePlay(); break; // 再生/一時停止
      case 2: Spotify.skipNext();   break; // 次の曲
      case 3: Spotify.skipPrev();   break; // 前の曲
    }
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

  return { init };
})();

SerialControl.init();
