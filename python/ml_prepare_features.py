"""
Этап 2 плана ML: подготовка фичей и целевой переменной из экспорта свечей.
Вход: CSV из ml_export_history (time, open, high, low, close, volume).
Выход: CSV с фичами и target, опционально разбитые train/val/test по времени.
"""
import argparse
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from ml_features import FEATURE_NAMES


def _data_root() -> Path:
    root = Path(__file__).resolve().parent
    return root / "data" if (root / "data").is_dir() else root.parent / "data"


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int) -> pd.Series:
    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def run_prepare(
    symbol: str = "BTCUSDT",
    timeframe: str = "1",
    forward_bars: int = 5,
    threshold_pct: float = 0.1,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    out_dir: Optional[Path] = None,
    in_path: Optional[Path] = None,
) -> dict:
    """
    Подготовить фичи и target. Возвращает { "ok": bool, "trainRows": int, "valRows": int, "testRows": int, "error": str? }.
    """
    try:
        data_root = _data_root()
        in_dir = data_root / "ml_export"
        out = out_dir or (data_root / "ml_features")
        out.mkdir(parents=True, exist_ok=True)
        path = in_path or (in_dir / f"{symbol.upper()}_{timeframe}.csv")
        if not path.exists():
            return {"ok": False, "trainRows": 0, "valRows": 0, "testRows": 0, "error": f"Файл не найден: {path}. Сначала выполните «Экспорт для ML»."}

        df = pd.read_csv(path)
    except Exception as e:
        return {"ok": False, "trainRows": 0, "valRows": 0, "testRows": 0, "error": str(e)}

    if df.empty or len(df) < 60:
        return {"ok": False, "trainRows": 0, "valRows": 0, "testRows": 0, "error": "Недостаточно строк в CSV."}

    for c in ["open", "high", "low", "close", "volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["close", "volume"])
    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]
    n = forward_bars
    x_pct = threshold_pct / 100.0

    df["return_1"] = close.pct_change(1)
    df["return_5"] = close.pct_change(5)
    df["return_10"] = close.pct_change(10)
    vol_ma = volume.rolling(20).mean()
    df["volume_ma_ratio"] = volume / vol_ma.replace(0, np.nan)
    vol_std = volume.rolling(50).std()
    vol_mean = volume.rolling(50).mean()
    df["volume_z"] = (volume - vol_mean) / vol_std.replace(0, np.nan)
    ema20 = ema(close, 20)
    ema50 = ema(close, 50)
    df["close_vs_ema20"] = (close / ema20) - 1
    df["close_vs_ema50"] = (close / ema50) - 1
    df["range_hl"] = (high - low) / close.replace(0, np.nan)
    atr14 = atr(high, low, close, 14)
    df["atr14_close"] = atr14 / close.replace(0, np.nan)
    forward_return = close.shift(-n) / close - 1
    target_class = np.zeros(len(df), dtype=int)
    target_class[forward_return > x_pct] = 1
    target_class[forward_return < -x_pct] = -1
    df["forward_return"] = forward_return
    df["target"] = target_class
    feature_cols = FEATURE_NAMES
    # Убираем inf (иначе при обучении будет ошибка "non-finite to integer")
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.dropna(subset=feature_cols + ["target"])
    if len(df) < 100:
        return {"ok": False, "trainRows": 0, "valRows": 0, "testRows": 0, "error": "Слишком мало строк после расчёта фичей."}

    t = len(df)
    train_end = int(t * train_ratio)
    val_end = int(t * (train_ratio + val_ratio))
    train_df = df.iloc[:train_end]
    val_df = df.iloc[train_end:val_end]
    test_df = df.iloc[val_end:]
    base = path.stem
    cols_out = ["time"] + feature_cols + ["forward_return", "target"]
    train_df[cols_out].to_csv(out / f"{base}_train.csv", index=False)
    val_df[cols_out].to_csv(out / f"{base}_val.csv", index=False)
    test_df[cols_out].to_csv(out / f"{base}_test.csv", index=False)
    df[cols_out].to_csv(out / f"{base}_features.csv", index=False)
    return {"ok": True, "trainRows": len(train_df), "valRows": len(val_df), "testRows": len(test_df), "error": None}


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare ML features and target from candle CSV")
    parser.add_argument("input", nargs="?", default=None, help="Input CSV (default: data/ml_export/SYMBOL_TF.csv)")
    parser.add_argument("--symbol", default="BTCUSDT", help="Symbol for default path")
    parser.add_argument("--timeframe", default="1", help="Timeframe for default path")
    parser.add_argument("--forward-bars", type=int, default=5, help="N bars for forward return (target)")
    parser.add_argument("--threshold-pct", type=float, default=0.1, help="X%%: return > X -> 1, < -X -> -1 else 0")
    parser.add_argument("--train-ratio", type=float, default=0.7, help="Train fraction (time-ordered)")
    parser.add_argument("--val-ratio", type=float, default=0.15, help="Val fraction")
    parser.add_argument("--out-dir", default=None, help="Output dir (default: data/ml_features)")
    args = parser.parse_args()

    in_path = Path(args.input) if args.input else None
    out_dir = Path(args.out_dir) if args.out_dir else None
    res = run_prepare(
        symbol=args.symbol,
        timeframe=args.timeframe,
        forward_bars=args.forward_bars,
        threshold_pct=args.threshold_pct,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        out_dir=out_dir,
        in_path=in_path,
    )
    if not res["ok"]:
        print(res["error"])
        return
    print(f"Train {res['trainRows']} Val {res['valRows']} Test {res['testRows']}")


if __name__ == "__main__":
    main()
