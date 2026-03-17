# Crypto Trading Platform

Full-stack real-time cryptocurrency trading platform for market microstructure analysis. Connects to Binance and Bybit via REST + WebSocket APIs. Built for finding actionable trading patterns through order flow, tape reading, and anomaly detection.

**Live:** [proplatforma.ru](https://proplatforma.ru)

---

## Features

### Trading Terminal
- Candlestick charts (1m → 1M) with infinite scroll history, cumulative delta, and per-bar delta visualization
- **20-tick chart** — aggregated from raw trade stream with order book imbalance overlay, liquidity imbalance, and big order detection
- **Tape acceleration indicator** — measures buy/sell pressure velocity across 15-minute blocks (not just volume, but rate of change)
- Price levels with snap-to-high/low, real-time audio alerts (Web Audio API) when price approaches within configurable distance
- Drawing tools (horizontal lines, rays) persisted per symbol
- Dual chart mode — standard + tick chart side by side
- Supports both **Binance** and **Bybit** exchanges with automatic pair merging

### Density Map
- Real-time scanning of order book walls across 100+ USDT pairs simultaneously
- Visual scatter map with circles sized by wall erosion time (how long it would take average volume to eat through the wall)
- Distance zone filtering, type filtering (buy/sell walls)
- Touch detection — tracks when price reaches a density level
- SQLite persistence with automatic cleanup of stale data

### Screener System
- **Big Orders Screener** — scans Binance + Bybit order books for levels where size ≥ average × multiplier (configurable, default 5×). Bounce/break detection, level expiry, cooldown logic
- **Pre-Pump Scanner** — composite scoring: volume ratio, price position relative to 24h range, taker buy percentage, price change momentum, and BTC correlation breakdown
- **Monitor mode** — single-pair deep view with chart, real-time level status, and level panel
- Mini-charts with level visualization in screener cards

### Analytics Dashboard
- Top pairs by 24h growth, volume, and trade count
- **BTC correlation analysis** — Pearson correlation on 1h candles to identify when an altcoin decouples from Bitcoin
- Sortable tables with one-click navigation to trading terminal

### Backtesting Lab (Apex Strategy)
- **Z-score anomaly detection** for entries: Z = (Current_Drop − Mean_R) / (StdDev_R × √(L/R))
- Configurable parameters: Scanner Sigma (S), Drop Length (L), Retrospective (R)
- **Grid/Martingale** position management with dynamic average price recalculation
- **Take-profit offset**: P_take = P_avg + (P_drop_avg − P_avg) × alpha
- OBI (Order Book Imbalance) filter for entry quality
- Trend filter (EMA), ATR regime filter, cooldown bars, exposure caps
- **Parameter optimization** — brute-force grid search over Sigma, Alpha, Length, Grid Legs, Grid Step ranges with real-time progress tracking
- Equity curve + drawdown chart with full metrics: Net PnL, Max Drawdown, Recovery Factor, Profit Factor, Win Rate
- History download from Binance (gzip-compressed local storage)
- Long + Short signal support

### ML Pipeline (XGBoost)
- **Export** — history candles to CSV with OHLCV data
- **Feature engineering** — returns (1/5/10 bar), volume MA ratio, volume Z-score, EMA crossovers (20/50), ATR-normalized range, high-low range
- **Train/Val/Test split** with configurable ratios
- **XGBoost classifier** (3 classes: down/flat/up) for entry direction filtering
- Model persistence and status tracking per symbol/timeframe
- Integrated into backtester as optional ML filter for entries

### VPN Management System
- **Xray VLESS Reality** protocol — modern censorship-resistant VPN
- Web dashboard (`/vpn/`) for user management: create, toggle, delete users
- Auto-generation of VLESS connection URIs with QR-compatible links
- Per-user traffic statistics via Xray gRPC Stats API
- Connection tracking (last seen, last IP, connection count) from access logs
- Real-time network throughput monitoring (RX/TX Mbps) via `/proc/net/dev`
- **Shadowsocks** fallback configuration
- Subscription endpoint (`/sub/`) for client auto-configuration

### Binance API Proxy
- Server-side proxy for Binance REST API through **Cloudflare WARP** VPN tunnel
- Bypasses geo-restrictions (418 bans) and CORS issues for browser clients
- Whitelisted endpoints: ticker, exchangeInfo, klines, depth, ping
- Transparent to frontend — same API interface, routed through server

### Notifications & Alerts
- **Web Audio API** — synthesized alert sounds for price levels, imbalance spikes (≥70%), pre-pump signals
- **Telegram Bot** — push notifications for density events with configurable distance threshold and cooldown
- **Screener notifications** — toast alerts when new coins with large order levels are detected
- Background WebSocket monitoring across all saved levels on all pairs

### X5 Bakery Scanner
- OCR-based table recognition for bakery production tracking
- Image analysis via **Google Gemini API** (multi-model fallback: 2.0-flash → 1.5-flash → 1.5-pro)
- JSON extraction of PLU, plan, and sales data from photos

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Next.js 14 Frontend                    │
│        React 18 · TypeScript · Zustand · LWC             │
├──────────┬──────────────┬────────────────────────────────┤
│  Binance │    Bybit     │        Python Backend          │
│ REST+WS  │   REST+WS    │     FastAPI on port 8765       │
└──────────┴──────────────┴────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
     Density Tracker      Screeners             Lab Engine
     (100+ pairs WS)    (Big Orders +         (Backtester +
          │              Pre-Pump)            ML Pipeline)
          │                                       │
       SQLite                                  XGBoost
     densities.db                           trained models
          │
     Telegram Bot ──── push notifications
          │
     VPN Manager ──── Xray VLESS Reality
                      Shadowsocks
                      WARP Proxy
```

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Next.js 14, React 18, TypeScript, Zustand, Lightweight Charts (TradingView), Axios |
| Backend | Python 3, FastAPI, aiohttp, uvicorn, SQLite |
| ML | XGBoost, scikit-learn, NumPy, pandas |
| Exchange APIs | Binance REST v3 + WebSocket, Bybit REST v5 + WebSocket |
| VPN | Xray (VLESS Reality), Shadowsocks, Cloudflare WARP |
| AI/OCR | Google Gemini API (multi-model) |
| Alerts | Web Audio API, Telegram Bot API |
| Deploy | Nginx, PM2, Ubuntu VDS, SCP-based deployment |

---

## API Endpoints (34 total)

<details>
<summary>Click to expand full API reference</summary>

| Group | Endpoint | Method | Description |
|-------|----------|--------|-------------|
| **Core** | `/api/densities` | GET | Active order book densities with filters |
| | `/api/densities/{id}` | GET | Density details + price touch history |
| | `/api/stats` | GET | Tracker statistics |
| | `/api/coins` | GET | Currently tracked coins |
| | `/api/cleanup` | POST | Cleanup old density records |
| **Proxy** | `/api/binance-proxy/{path}` | GET | Binance API proxy via WARP VPN |
| **Screener** | `/api/screener/big-orders` | GET | Big order levels across exchanges |
| | `/api/screener/pre-pump` | GET | Pre-pump composite signals |
| **Lab** | `/api/lab/history-status` | GET | Check local history availability |
| | `/api/lab/download-history` | POST | Start background history download |
| | `/api/lab/download-status` | GET | Download progress |
| | `/api/lab/history-candles` | GET | Candles from local history |
| | `/api/lab/optimize` | POST | Run parameter optimization |
| | `/api/lab/optimize-progress` | GET | Optimization progress |
| | `/api/lab/equity-curve` | POST | Calculate equity + drawdown curves |
| **ML** | `/api/lab/ml-export` | POST | Export history to CSV |
| | `/api/lab/ml-prepare` | POST | Feature engineering + train/test split |
| | `/api/lab/ml-train` | POST | Train XGBoost model |
| | `/api/lab/ml-model-status` | GET | Check trained model availability |
| **VPN** | `/api/vpn/users` | GET | List VPN users with VLESS URIs |
| | `/api/vpn/users` | POST | Create new VPN user |
| | `/api/vpn/users/{id}/toggle` | POST | Enable/disable user |
| | `/api/vpn/users/{id}` | DELETE | Remove user |
| | `/api/vpn/stats` | GET | Per-user traffic + connection stats |
| | `/api/vpn/net` | GET | Network interface throughput |
| **Telegram** | `/api/telegram/settings` | GET/POST | Notification settings |
| | `/api/telegram/test` | POST | Send test message |
| **X5** | `/api/x5/analyze` | POST | OCR bakery table via Gemini |

</details>

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Trading terminal — charts, tape speed, delta, price levels, alerts |
| `/analytics` | Market analytics — top movers, BTC correlation |
| `/screener` | Big orders screener with mini-charts |
| `/screener/monitor` | Single-pair level monitoring |
| `/pre-pump` | Pre-pump signal scanner |
| `/density-map` | Visual order book density map |
| `/dom-surface` | Backtesting lab — Apex strategy, optimization, ML pipeline |
| `/dom-surface/equity` | Equity curve report with trade-level breakdown |
| `/vpn/` | VPN user management dashboard |
| `/x5/` | Bakery production scanner |

---

## State Management (Zustand)

| Store | Responsibility |
|-------|---------------|
| `useTradingStore` | Selected pair, chart data, timeframe, chart mode, delta indicators, sidebar state |
| `usePriceLevelsStore` | Price levels per symbol (persisted to localStorage) |
| `useActiveAlertsStore` | Currently triggered price alerts |
| `useScreenerStore` | Screener symbols, multiplier, notifications |
| `useDomSurfaceStore` | Lab mode, bot parameters (Apex/Kanal), trades, equity data |
| `useDensityMapStore` | Density data, zoom, settings, blacklist |
| `usePrePumpStore` | Pre-pump signals, ideal symbol detection |

---

## Local Development

```bash
# Frontend
npm install
npm run dev              # http://localhost:3000

# Backend
cd python
pip install -r requirements.txt
python api_server.py     # http://localhost:8765
```

---

## Project Structure

```
app/                      # Next.js App Router pages
src/
  components/             # React components
    density-map/          #   density map visualization
    dom-surface/          #   backtester / lab UI
    pre-pump/             #   pre-pump scanner
    screener/             #   big orders screener
  lib/                    # API clients and utilities
    binance.ts            #   Binance REST + WebSocket + proxy
    bybit.ts              #   Bybit REST + WebSocket
    densityApi.ts         #   density tracker client
    labApi.ts             #   backtester API client
    screenerApi.ts        #   screener API client
    correlation.ts        #   BTC correlation analysis
  store/                  # Zustand state stores
  types/                  # TypeScript definitions
public/
  vpn/                    # VPN management dashboard
  x5/                     # Bakery scanner UI
  sub/                    # VPN subscription endpoints
python/
  api_server.py           # FastAPI backend (34 endpoints)
  tracker.py              # Real-time density tracker (100+ pairs)
  lab_history.py          # Backtester + optimizer engine
  big_orders_screener.py  # Big orders detection
  pre_pump_screener.py    # Pre-pump signal scoring
  telegram_notifier.py    # Telegram push notifications
  ml_*.py                 # ML pipeline (export → features → train)
  config.py               # Centralized configuration
  database.py             # SQLite ORM for densities
deploy/
  nginx-proplatforma.conf # Nginx configuration
```

---

## Key Technical Decisions

- **20-tick candles** are built client-side from raw WebSocket trade stream — zero server dependency for real-time chart data
- **Order book imbalance** is calculated per-tick for higher granularity than per-candle analysis
- **Density tracker** runs as a persistent async process, scanning 100+ pairs simultaneously via WebSocket
- **Backtester uses identical logic to live execution** — single source of truth in `lab_history.py`
- **Binance API proxy** routes through Cloudflare WARP to bypass geo-restrictions without requiring client-side VPN
- **High-precision decimals** for all price/size calculations to prevent floating-point rounding errors in financial math
- All WebSocket connections implement **exponential backoff reconnection** (up to 5 retries)
- REST API calls include **15s timeouts** and **retry with backoff** for resilience

---

## License

This project is for portfolio/demonstration purposes.
