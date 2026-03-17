# Crypto Trading Platform

Real-time cryptocurrency trading platform for market microstructure analysis. Built for finding actionable trading patterns through order flow, tape reading, and anomaly detection — not just chart visualization.

**Live:** [proplatforma.ru](https://proplatforma.ru)

## What it does

This is a full-stack platform that connects to Binance and Bybit via REST + WebSocket APIs and provides tools that go beyond standard technical analysis:

### Core Trading Terminal
- Candlestick charts with infinite scroll history (1m to 1M timeframes)
- 20-tick chart with **order book imbalance** overlay and cumulative delta
- **Tape acceleration indicator** — measures speed of trades (tug-of-war between buyers and sellers), not just volume
- Price levels with snap-to-high/low, audio alerts when price approaches within 0.45%
- Drawing tools for manual analysis
- Delta visualization (cumulative, per-candle, trend)

### Density Map
- Real-time scanning of order book walls across all trading pairs
- Visual map with circles sized by wall erosion time
- Distance zones from current price
- Touch detection — tracks when price reaches a density level

### Screener
- **Big Orders Screener** — finds order book levels where size ≥ avg × multiplier across Binance + Bybit
- **Pre-Pump Scanner** — composite score based on volume ratio, price position, taker buy %, price change, and BTC correlation breakdown
- Mini-charts with level visualization and bounce/break status tracking

### Analytics
- Top pairs by growth, volume, and trade count (24h)
- BTC correlation analysis (1h candles) — identifies when an altcoin decouples from Bitcoin
- Sortable tables with one-click navigation to charts

### Backtesting Lab
- **Apex strategy**: Z-score anomaly detection for entries with grid/martingale position management
- **Parameter optimization**: brute-force search over Sigma, Alpha, Length, Grid parameters
- Equity curve with drawdown chart, PnL, Max DD, Winrate, Profit Factor metrics
- History download from Binance (stored as gzip for efficiency)
- **ML pipeline**: XGBoost filter trained on historical features to improve entry quality

### Background Monitoring
- WebSocket price monitoring across all saved levels on all pairs
- Audio alerts via Web Audio API (price levels, imbalance ≥70%, pre-pump signals)
- Telegram notifications for density events

## Architecture

```
┌─────────────────────────────────────────────┐
│              Next.js Frontend               │
│  React 18 · TypeScript · Zustand · LWC      │
├──────────┬──────────────┬───────────────────┤
│  Binance │    Bybit     │  Python Backend   │
│ REST+WS  │   REST+WS    │  FastAPI :8765    │
└──────────┴──────────────┴───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
         Density           Screener          Lab
         Tracker          (Big Orders      (Backtester
        (WebSocket)       + Pre-Pump)      + ML Pipeline)
              │                                │
           SQLite                          XGBoost
         densities.db                    trained model
```

### Frontend
- **Next.js 14** with App Router
- **TypeScript** throughout
- **Zustand** for state management (persisted to localStorage where needed)
- **Lightweight Charts** (TradingView) for all chart rendering
- **Web Audio API** for real-time audio alerts
- Direct WebSocket connections to Binance and Bybit for trades, klines, and order book depth

### Backend
- **Python / FastAPI** — REST API for screeners, lab, density data
- **aiohttp + websockets** — async connections to exchange WebSocket streams
- **SQLite** — storage for density tracking data
- **XGBoost** — ML model for trade entry filtering
- **Telegram Bot API** — push notifications

### Key Technical Decisions
- 20-tick candles are built client-side from raw trade stream — no server dependency for real-time data
- Order book imbalance is calculated per-tick, not per-candle, for higher granularity
- Density tracker runs as a persistent process, scanning 100+ pairs simultaneously
- Backtester uses the same Apex logic as live execution (single source of truth in `lab_history.py`)
- High-precision decimals for all price/size calculations to avoid floating point errors

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Next.js 14, React 18, TypeScript, Zustand, Lightweight Charts, Axios |
| Backend | Python 3, FastAPI, aiohttp, websockets, SQLite |
| ML | XGBoost, NumPy, pandas |
| APIs | Binance REST + WebSocket, Bybit REST + WebSocket |
| Alerts | Web Audio API, Telegram Bot API |
| Deploy | Nginx, PM2, VDS (Ubuntu) |

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main trading terminal with charts, tape speed, levels, alerts |
| `/screener` | Big orders screener across Binance + Bybit |
| `/screener/monitor` | Single-pair monitoring with level tracking |
| `/pre-pump` | Pre-pump signal scanner |
| `/density-map` | Visual order book density map |
| `/analytics` | Market analytics — top movers, volume, BTC correlation |
| `/dom-surface` | Backtesting lab — Apex strategy, optimization, ML |
| `/dom-surface/equity` | Equity curve report with trade-level metrics |

## Local Development

```bash
# Frontend
npm install
npm run dev          # http://localhost:3000

# Backend
cd python
pip install -r requirements.txt
python api_server.py # http://localhost:8765
```

## Project Structure

```
app/                  # Next.js pages (App Router)
src/
  components/         # React components
    density-map/      # Density map visualization
    dom-surface/      # DOM surface / backtester UI
    pre-pump/         # Pre-pump scanner components
    screener/         # Screener components
  lib/                # API clients, utilities
  store/              # Zustand state management
  styles/             # Global CSS
  types/              # TypeScript type definitions
python/
  api_server.py       # FastAPI backend
  lab_history.py      # Backtester + optimizer + ML pipeline
  tracker.py          # Real-time density tracker
  big_orders_screener.py
  pre_pump_screener.py
  telegram_notifier.py
```

## License

This project is for portfolio/demonstration purposes.
