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
  // 接続ボタンを画面に追加
  // ---------------------------------------------------------------
  function createButton() {
    connectBtn = document.createElement('button');
    connectBtn.id = 'serial-connect-btn';
    connectBtn.textContent = '🔌 Arduino接続';
    Object.assign(connectBtn.style, {
      position:     'fixed',
      bottom:       '20px',
      right:        '20px',
      zIndex:       '9999',
      padding:      '10px 18px',
      fontSize:     '14px',
      fontFamily:   'sans-serif',
      background:   'rgba(0,0,0,0.7)',
      color:        '#fff',
      border:       '1px solid #fff',
      borderRadius: '6px',
      cursor:       'pointer',
    });
    connectBtn.addEventListener('click', connect);
    document.body.appendChild(connectBtn);
  }

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

      connectBtn.textContent = '✅ Arduino接続済み';
      connectBtn.style.borderColor = '#4caf50';
      connectBtn.style.color = '#4caf50';
      connectBtn.removeEventListener('click', connect);

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
  // 初期化
  // ---------------------------------------------------------------
  function init() {
    createButton();
  }

  return { init };
})();

SerialControl.init();
