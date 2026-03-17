"""
Этап 3 плана ML: обучение XGBoost на подготовленных фичах.
Загружает train/val из ml_prepare_features, обучает классификатор, сохраняет модель.
"""
import argparse
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import xgboost as xgb

from ml_features import FEATURE_NAMES


def _data_root() -> Path:
    root = Path(__file__).resolve().parent
    if (root / "data").is_dir():
        return root / "data"
    return root.parent / "data"


def run_train(
    symbol: str = "BTCUSDT",
    timeframe: str = "1",
    max_depth: int = 6,
    n_estimators: int = 100,
    learning_rate: float = 0.1,
    out_path: Optional[Path] = None,
) -> dict:
    """
    Обучить XGBoost. Возвращает { "ok": bool, "path": str, "accuracyTrain": float, "accuracyVal": float?, "error": str? }.
    """
    try:
        data_root = _data_root()
        feat_dir = data_root / "ml_features"
        model_dir = data_root / "models"
        model_dir.mkdir(parents=True, exist_ok=True)
        train_path = feat_dir / f"{symbol.upper()}_{timeframe}_train.csv"
        if not train_path.exists():
            return {"ok": False, "path": "", "accuracyTrain": 0, "accuracyVal": None, "error": "Файл train не найден. Сначала выполните «Подготовить фичи»."}

        train_df = pd.read_csv(train_path)
        for c in FEATURE_NAMES:
            if c not in train_df.columns:
                return {"ok": False, "path": "", "accuracyTrain": 0, "accuracyVal": None, "error": f"Нет колонки: {c}"}
        # Убираем строки с NaN/inf в target или невалидным классом (иначе astype(int) падает)
        train_df = train_df.replace([np.inf, -np.inf], np.nan)
        train_df = train_df.dropna(subset=FEATURE_NAMES + ["target"])
        train_df = train_df[train_df["target"].isin([-1, 0, 1])]
        if len(train_df) < 50:
            return {"ok": False, "path": "", "accuracyTrain": 0, "accuracyVal": None, "error": "Слишком мало строк после очистки (NA/inf или неверный target)."}
        X_train = train_df[FEATURE_NAMES].astype(float)
        y_raw = train_df["target"]
        y_train = y_raw.map({-1: 0, 0: 1, 1: 2}).astype(int)

        val_path = train_path.parent / (train_path.stem.replace("_train", "_val") + ".csv")
        if val_path.exists():
            val_df = pd.read_csv(val_path).replace([np.inf, -np.inf], np.nan).dropna(subset=FEATURE_NAMES + ["target"])
            val_df = val_df[val_df["target"].isin([-1, 0, 1])]
            if len(val_df) > 0:
                X_val = val_df[FEATURE_NAMES].astype(float)
                y_val = val_df["target"].map({-1: 0, 0: 1, 1: 2}).astype(int)
            else:
                X_val = None
                y_val = None
        else:
            X_val = None
            y_val = None
        if val_path.exists() and X_val is not None and y_val is not None:
            eval_set = [(X_train, y_train), (X_val, y_val)]
        else:
            eval_set = [(X_train, y_train)]
            y_val = None

        model = xgb.XGBClassifier(
            max_depth=max_depth,
            n_estimators=n_estimators,
            learning_rate=learning_rate,
            objective="multi:softprob",
            num_class=3,
            random_state=42,
            eval_metric="mlogloss",
        )
        model.fit(X_train, y_train, eval_set=eval_set, verbose=0)

        pred_train = model.predict(X_train)
        acc_train = float((pred_train == y_train).mean())
        acc_val = None
        if val_path.exists() and y_val is not None:
            pred_val = model.predict(X_val)
            acc_val = float((pred_val == y_val).mean())

        base = train_path.stem.replace("_train", "")
        out = out_path or (model_dir / f"{base}_xgb.json")
        model.save_model(str(out))
        return {"ok": True, "path": str(out), "accuracyTrain": acc_train, "accuracyVal": acc_val, "error": None}
    except Exception as e:
        return {"ok": False, "path": "", "accuracyTrain": 0, "accuracyVal": None, "error": str(e)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train XGBoost on prepared features")
    parser.add_argument("--train", default=None, help="Train CSV (default: data/ml_features/SYMBOL_TF_train.csv)")
    parser.add_argument("--symbol", default="BTCUSDT", help="Symbol for default path")
    parser.add_argument("--timeframe", default="1", help="Timeframe for default path")
    parser.add_argument("--max-depth", type=int, default=6, help="XGBoost max_depth")
    parser.add_argument("--n-estimators", type=int, default=100, help="XGBoost n_estimators")
    parser.add_argument("--learning-rate", type=float, default=0.1, help="XGBoost learning_rate")
    parser.add_argument("--out", default=None, help="Model output path (default: data/models/SYMBOL_TF_xgb.json)")
    args = parser.parse_args()

    train_path = Path(args.train) if args.train else None
    out_path = Path(args.out) if args.out else None
    res = run_train(
        symbol=args.symbol,
        timeframe=args.timeframe,
        max_depth=args.max_depth,
        n_estimators=args.n_estimators,
        learning_rate=args.learning_rate,
        out_path=out_path,
    )
    if not res["ok"]:
        print(res["error"])
        return
    print(f"Train accuracy: {res['accuracyTrain']:.4f}")
    if res.get("accuracyVal") is not None:
        print(f"Val   accuracy: {res['accuracyVal']:.4f}")
    print(f"Model saved: {res['path']}")


if __name__ == "__main__":
    main()
