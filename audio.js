// audio.js — マイク入力 + RMS 計算
// Web Audio API を使ってマイク音量を取得する
// スムージング係数 0.93 (元の oF 版と同じ)

const Audio = (() => {
  const SMOOTHING = 0.93;

  let analyser = null;
  let dataArray = null;
  let smoothedRMS = 0;
  let initialized = false;

  async function init() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0; // 自前でスムージングする
      source.connect(analyser);

      dataArray = new Float32Array(analyser.fftSize);
      initialized = true;
    } catch (e) {
      console.warn('マイクへのアクセスが拒否されました:', e);
    }
  }

  // 呼ぶたびに最新の RMS を返す（スムージング済み）
  function getRMS() {
    if (!initialized) return 0;

    analyser.getFloatTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    smoothedRMS = SMOOTHING * smoothedRMS + (1 - SMOOTHING) * rms;
    return smoothedRMS;
  }

  function isReady() {
    return initialized;
  }

  return { init, getRMS, isReady };
})();
