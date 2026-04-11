// spotify.js — Spotify Web API + OAuth 2.0 PKCE フロー
// Client ID は取得後にここへ貼り付ける

const Spotify = (() => {
  // ---------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------
  const CLIENT_ID = '3bc5ba6756a64cf8a6275e18dd3b306d'; // ← Spotify Developer Dashboard から取得
  const REDIRECT_URI = 'http://127.0.0.1:8888/';
  const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
  const POLL_INTERVAL_MS = 5000;

  // ---------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------
  let accessToken = null;
  let tokenExpires = 0;
  let trackName = '';
  let artistName = '';
  let albumArtUrl = '';
  let bpm = 0;
  let isPlaying = false;
  let shuffleState = false;
  let repeatState = 'off'; // 'off' | 'context' | 'track'

  // ---------------------------------------------------------------
  // PKCE ユーティリティ
  // ---------------------------------------------------------------
  function generateCodeVerifier(length = 128) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values).map(v => chars[v % chars.length]).join('');
  }

  async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  // ---------------------------------------------------------------
  // 認証フロー
  // ---------------------------------------------------------------
  async function login() {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    sessionStorage.setItem('pkce_verifier', verifier);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });

    window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString();
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return false;

    const verifier = sessionStorage.getItem('pkce_verifier');
    if (!verifier) return false;

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    });

    if (!res.ok) {
      console.error('Token exchange failed:', await res.text());
      return false;
    }

    const data = await res.json();
    saveToken(data.access_token, data.expires_in);

    // URL から code を消す
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  }

  function saveToken(token, expiresInSec) {
    accessToken = token;
    tokenExpires = Date.now() + expiresInSec * 1000;
    localStorage.setItem('spotify_token', token);
    localStorage.setItem('spotify_token_expires', tokenExpires);
  }

  function loadStoredToken() {
    const token = localStorage.getItem('spotify_token');
    const expires = parseInt(localStorage.getItem('spotify_token_expires') || '0', 10);
    if (token && Date.now() < expires - 60000) { // 60秒余裕を持つ
      accessToken = token;
      tokenExpires = expires;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------
  // API 呼び出し
  // ---------------------------------------------------------------
  async function fetchCurrentTrack() {
    if (!accessToken) return;

    try {
      // /me/player で再生状態（shuffle, repeat）も取得
      const res = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });

      if (res.status === 401) {
        accessToken = null;
        localStorage.removeItem('spotify_token');
        return;
      }
      if (res.status === 204 || !res.ok) return; // 再生なし

      const data = await res.json();

      // 再生状態の更新
      isPlaying = data.is_playing || false;
      shuffleState = data.shuffle_state || false;
      repeatState = data.repeat_state || 'off';

      if (data.item) {
        const newTrack = data.item.name;
        const newArtist = data.item.artists.map(a => a.name).join(', ');

        if (newTrack !== trackName) {
          trackName = newTrack;
          artistName = newArtist;
          const images = data.item.album.images;
          albumArtUrl = images.length > 0 ? images[0].url : '';
          await fetchAudioFeatures(data.item.id);
        }
      }
    } catch (e) {
      console.warn('Spotify fetch error:', e);
    }
  }

  async function fetchAudioFeatures(trackId) {
    try {
      const res = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (!res.ok) return;
      const data = await res.json();
      bpm = data.tempo || 0;
    } catch (e) {
      // BPM 取得失敗は無視
    }
  }

  // ---------------------------------------------------------------
  // 再生コントロール
  // ---------------------------------------------------------------
  async function togglePlay() {
    if (!accessToken) return;
    const endpoint = isPlaying ? 'pause' : 'play';
    try {
      await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      isPlaying = !isPlaying;
    } catch (e) { console.warn('togglePlay error:', e); }
  }

  async function skipNext() {
    if (!accessToken) return;
    try {
      await fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
      });
    } catch (e) { console.warn('skipNext error:', e); }
  }

  async function skipPrev() {
    if (!accessToken) return;
    try {
      await fetch('https://api.spotify.com/v1/me/player/previous', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
      });
    } catch (e) { console.warn('skipPrev error:', e); }
  }

  async function toggleShuffle() {
    if (!accessToken) return;
    const next = !shuffleState;
    try {
      await fetch(`https://api.spotify.com/v1/me/player/shuffle?state=${next}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      shuffleState = next;
    } catch (e) { console.warn('toggleShuffle error:', e); }
  }

  async function cycleRepeat() {
    if (!accessToken) return;
    // off → context → track → off
    const order = ['off', 'context', 'track'];
    const idx = (order.indexOf(repeatState) + 1) % order.length;
    const next = order[idx];
    try {
      await fetch(`https://api.spotify.com/v1/me/player/repeat?state=${next}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      repeatState = next;
    } catch (e) { console.warn('cycleRepeat error:', e); }
  }

  // ---------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------
  async function init() {
    // 保存済みトークンを試みる
    loadStoredToken();

    // OAuth コールバックを処理
    if (window.location.search.includes('code=')) {
      await handleCallback();
    }

    if (accessToken) {
      await fetchCurrentTrack();
      setInterval(fetchCurrentTrack, POLL_INTERVAL_MS);
    }
  }

  // ---------------------------------------------------------------
  // 公開 API
  // ---------------------------------------------------------------
  function getTrackName()    { return trackName; }
  function getArtistName()   { return artistName; }
  function getAlbumArtUrl()  { return albumArtUrl; }
  function getBPM()          { return bpm; }
  function getIsPlaying()    { return isPlaying; }
  function getShuffleState() { return shuffleState; }
  function getRepeatState()  { return repeatState; }
  function isLoggedIn()      { return !!accessToken; }

  return {
    init, login,
    getTrackName, getArtistName, getAlbumArtUrl, getBPM,
    getIsPlaying, getShuffleState, getRepeatState,
    isLoggedIn,
    togglePlay, skipNext, skipPrev, toggleShuffle, cycleRepeat,
  };
})();
