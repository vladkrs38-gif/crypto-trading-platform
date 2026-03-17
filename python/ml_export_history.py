"""
Этап 1 плана ML: выгрузка истории по паре/таймфрейму в CSV для обучения.
Использует уже загруженные данные (после «Начать загрузку истории»).
Запуск: python ml_export_history.py --exchange binance --symbol BTCUSDT --timeframe 1
"""
import csv
from pathlib import Path
from typing import Optional

from lab_history import load_candles_from_history


def _data_root() -> Path:
    root = Path(__file__).resolve().parent
    if (root / "data").is_dir():
        return root / "data"
    return root.parent / "data"


def run_export(exchange: str = "binance", symbol: str = "", timeframe: str = "1", out_dir: Optional[Path] = None) -> dict:
    """
    Выполнить экспорт истории в CSV. Возвращает { "ok": bool, "rows": int, "path": str, "error": str? }.
    """
    if not symbol:
        return {"ok": False, "rows": 0, "path": "", "error": "symbol required"}
    try:
        candles = load_candles_from_history(exchange, symbol, timeframe)
        if not candles:
            return {"ok": False, "rows": 0, "path": "", "error": "Нет данных. Сначала нажмите «Начать загрузку истории» для этой пары/таймфрейма."}
        out = out_dir or (_data_root() / "ml_export")
        out.mkdir(parents=True, exist_ok=True)
        out_path = out / f"{symbol.upper()}_{timeframe}.csv"
        with open(out_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["time", "open", "high", "low", "close", "volume"])
            for c in candles:
                w.writerow([c[0], c[1], c[2], c[3], c[4], c[5]])
        return {"ok": True, "rows": len(candles), "path": str(out_path), "error": None}
    except Exception as e:
        return {"ok": False, "rows": 0, "path": "", "error": str(e)}


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Export candle history to CSV for ML")
    parser.add_argument("--exchange", default="binance", help="Exchange id")
    parser.add_argument("--symbol", required=True, help="Symbol e.g. BTCUSDT")
    parser.add_argument("--timeframe", default="1", help="Timeframe (1, 5, 15, 60, etc.)")
    parser.add_argument("--out-dir", default=None, help="Output directory (default: data/ml_export)")
    args = parser.parse_args()

    res = run_export(args.exchange, args.symbol, args.timeframe, Path(args.out_dir) if args.out_dir else None)
    if not res["ok"]:
        print(res["error"])
        return
    print(f"Exported {res['rows']} rows to {res['path']}")


if __name__ == "__main__":
    main()
