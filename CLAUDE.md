# WalkPaper – Project Context

## 概要
openFrameworks で作った Spotify ビジュアライザーを **Web（ブラウザ）** に移植するプロジェクト。

---

## 元の oF プロジェクトの機能

| 機能 | 内容 |
|------|------|
| Spotify情報取得 | OSC経由（Python bridgeから）でトラック名・アーティスト名を受信 |
| 背景描画 | Perlinノイズウォーカーが線をFBOに蓄積 |
| 動画再生 | `walk.mov` を中央に400×400で表示 |
| グリッチエフェクト | マイク音量が閾値を超えたとき、動画にノイズエフェクト |
| テキスト描画 | 曲名を1文字ずつランダム配置・回転（日本語対応） |
| アーティスト名 | 右上に中サイズで表示 |
| 音量取得 | マイク入力のRMS、スムージングあり（係数0.93） |
| キー入力 | ESCでフルスクリーン切替、テキスト入力機能 |

---

## Web移植方針

### 技術スタック
- **描画**: p5.js または素の Canvas API
- **音声**: Web Audio API（マイク入力・RMS・AnalyserNode）
- **Spotify連携**: Spotify Web API（OAuth 2.0 PKCE フロー）
  - 現在再生中の曲名・アーティスト名・BPMを取得
  - OSCブリッジは不要になる

### できること・できないこと
| | oF版 | Web版 |
|---|---|---|
| Perlinノイズウォーカー | ✅ | ✅ p5.noise() |
| 動画再生 | ✅ | ✅ `<video>` + Canvas |
| マイク音量 | ✅ | ✅ Web Audio API |
| Spotify曲名取得 | ✅ OSC | ✅ Spotify Web API |
| exeの自動起動 | ✅ | ❌ 不可 |
| ローカルファイル直参照 | ✅ | ❌ URL or アップロードに変更 |

---

## ファイル構成（予定）

```
C:\WalkPaper\
├── CLAUDE.md
├── index.html
├── style.css
├── sketch.js        # メインのp5.jsスケッチ
├── spotify.js       # Spotify Web API / OAuth処理
├── audio.js         # Web Audio API（マイク入力）
└── assets/
    └── walk.mp4     # 動画ファイル（mov→mp4に変換推奨）
```

---

## Spotify API セットアップ（未完了）
- [ ] [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリ登録
- [ ] `Client ID` を取得
- [ ] Redirect URI を `http://localhost:xxxx/callback` に設定
- [ ] OAuth 2.0 PKCE フローで認証実装

---

## 開発メモ
- ウィンドウサイズ: 1920×1080（フルスクリーン想定）
- フレームレート: 60fps
- 音量閾値 `threshold = 0.01`、スケール係数 `30.0`
- 線の太さ `lineWidth = 4`、速度 `lineSpeed = 0.5`
- フォント: NotoSansJP-Medium（日本語対応必須）
