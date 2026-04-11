// lyrics.js — LRCLIB API から歌詞を取得・LRC パース・現在行の追跡

const Lyrics = (() => {
  let lines = [];        // [{time: ms, text: string}, ...]
  let lastQuery = '';     // 重複リクエスト防止用
  let loading = false;

  // ---------------------------------------------------------------
  // LRCLIB API からタイムスタンプ付き歌詞を取得
  // ---------------------------------------------------------------
  async function fetch(artist, track) {
    const query = `${artist}::${track}`;
    if (query === lastQuery || loading) return;
    lastQuery = query;
    loading = true;
    lines = [];

    try {
      const params = new URLSearchParams({
        artist_name: artist,
        track_name: track,
      });
      const res = await window.fetch(`https://lrclib.net/api/get?${params}`);

      if (!res.ok) {
        console.warn('LRCLIB: 歌詞が見つかりません');
        loading = false;
        return;
      }

      const data = await res.json();

      if (data.syncedLyrics) {
        lines = parseLRC(data.syncedLyrics);
      } else if (data.plainLyrics) {
        // タイムスタンプなし → 均等割り
        const plainLines = data.plainLyrics.split('\n').filter(l => l.trim());
        const interval = (data.duration * 1000) / plainLines.length;
        lines = plainLines.map((text, i) => ({ time: i * interval, text }));
      }
    } catch (e) {
      console.warn('LRCLIB fetch error:', e);
    }

    loading = false;
  }

  // ---------------------------------------------------------------
  // LRC 形式のパース: "[MM:SS.xx] テキスト" → {time, text}
  // ---------------------------------------------------------------
  function parseLRC(lrc) {
    const result = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/;

    for (const line of lrc.split('\n')) {
      const m = line.match(regex);
      if (!m) continue;

      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      let ms  = parseInt(m[3], 10);
      if (m[3].length === 2) ms *= 10; // "xx" → "xx0"

      const time = min * 60000 + sec * 1000 + ms;
      const text = m[4].trim();
      if (text) result.push({ time, text });
    }

    return result;
  }

  // ---------------------------------------------------------------
  // 現在の再生位置に対応する歌詞行を返す
  // ---------------------------------------------------------------
  function getCurrentLine(progressMs) {
    if (lines.length === 0) return '';

    let current = '';
    for (const line of lines) {
      if (line.time <= progressMs) {
        current = line.text;
      } else {
        break;
      }
    }
    return current;
  }

  // ---------------------------------------------------------------
  // 歌詞が取得済みかどうか
  // ---------------------------------------------------------------
  function hasLyrics() {
    return lines.length > 0;
  }

  function getLines() {
    return lines;
  }

  // 現在の再生位置に対応する行インデックスを返す
  function getCurrentIndex(progressMs) {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= progressMs) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }

  function reset() {
    lines = [];
    lastQuery = '';
  }

  return { fetch, getCurrentLine, getLines, getCurrentIndex, hasLyrics, reset };
})();
