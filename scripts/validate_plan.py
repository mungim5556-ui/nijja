# -*- coding: utf-8 -*-
"""Revit 자동 분석 결과(.reclaim.json)를 해체계획서 값과 대조한다.

python scripts/validate_plan.py <결과 폴더> <계획서 값.json> [--out 보고서.md] [--tol 20]

계획서 값 형식은 scripts/fixtures/plans.example.json 참고. 모델은 "match" 문자열이
결과 파일의 name에 들어 있으면 짝지어진다. 계획서에 없는 항목은 건너뛴다.
"""
from __future__ import print_function, division
import glob
import io
import json
import os
import sys

# 계획서 성상 이름 → 엔진 성상
WASTE_ALIAS = {
    u"콘크리트": "concrete", u"폐콘크리트": "concrete", u"건설폐재류": "concrete", "concrete": "concrete",
    u"혼합": "mixed", u"혼합건설폐기물": "mixed", "mixed": "mixed",
    u"고철": "metal", u"금속": "metal", u"폐금속": "metal", "metal": "metal",
    u"목재": "wood", u"폐목재": "wood", "wood": "wood",
    u"보드": "board", u"석고보드": "board", "board": "board",
    u"합성수지": "resin", u"폐합성수지": "resin", "resin": "resin",
    u"유리": "glass", "glass": "glass", u"타일": "tile", "tile": "tile", u"벽지": "wallpaper", "wallpaper": "wallpaper",
}
# 엔진 쪽 혼합 = 모델 밖 원단위 잔여 + 모델의 혼합 성상
MIXED_PARTS = ("mixed", "glass", "board", "tile", "wallpaper", "resin")


def load(path):
    with io.open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def err(model, plan):
    if plan in (None, 0) or model is None:
        return None
    return (model - plan) / plan * 100.0


def rows_for_result(summary, plan):
    """새 형식: 결과 서버(공법 비교 엔진)가 계산한 result. 계획서 scenario general → 일괄 압쇄(crush)."""
    r = summary.get("result")
    if not r or not r.get("crush"):
        raise ValueError(u"%s: 서버 계산 결과가 없습니다 (%s)" % (summary.get("name"), summary.get("resultError") or u"이유 미상"))
    sc = r["crush"] if plan.get("scenario", "general") in ("general", "crush") else r["selective"]
    t = dict(r.get("tons") or {})
    rows = []

    def add(label, model, planv, unit):
        rows.append({"item": label, "model": model, "plan": planv, "unit": unit, "err": err(model, planv)})

    add(u"연면적", (r.get("inputs") or {}).get("area"), plan.get("gfa"), u"㎡")
    tons = {}
    for k, v in (plan.get("tons") or {}).items():
        key = WASTE_ALIAS.get(k, k)
        tons[key] = tons.get(key, 0) + v
    total = sum(v for v in t.values() if isinstance(v, (int, float)))
    for key in sorted(tons):
        if key == "total":
            continue
        model = t.get("mixed", 0.0) + t.get("board", 0.0) + t.get("tile", 0.0) + t.get("glass", 0.0) if key == "mixed" else \
            t.get("concrete", 0.0) + t.get("masonry", 0.0) if key == "concrete" else t.get(key, 0.0)
        add(u"폐기물 %s" % key, round(model, 1), tons[key], "t")
    if tons:
        add(u"폐기물 합계", round(total, 1), tons.get("total", sum(v for k, v in tons.items() if k != "total")), "t")
    if plan.get("concreteM3"):
        add(u"콘크리트 부피", r.get("concreteM3"), plan["concreteM3"], u"㎥")
    add(u"공기", round(sc.get("days") or 0, 1), plan.get("days"), u"일")
    return [x for x in rows if x["plan"] not in (None, "")]


def rows_for(summary, plan):
    if summary.get("schema") == "reclaim-quantities/1":
        return rows_for_result(summary, plan)
    c = summary.get("check")
    if not c:
        raise ValueError(u"%s: check 항목이 없습니다 (최신 저장소로 다시 분석하세요)" % summary.get("name"))
    sc = c["scenarios"][plan.get("scenario", "general")]
    tw = dict(c["tonsByWaste"])
    rows = []

    def add(label, model, planv, unit):
        rows.append({"item": label, "model": model, "plan": planv, "unit": unit, "err": err(model, planv)})

    add(u"연면적", c.get("gfa"), plan.get("gfa"), u"㎡")
    tons = {}
    for k, v in (plan.get("tons") or {}).items():
        key = WASTE_ALIAS.get(k, k)
        tons[key] = tons.get(key, 0) + v
    mixed_model = c["residualMixedT"] + sum(tw.get(k, 0) for k in MIXED_PARTS)
    for key in sorted(tons):
        if key == "total":
            continue
        if key == "mixed" and plan.get("mixedIncludesFinishes", True):
            model = mixed_model
        elif key == "metal":
            model = tw.get("metal", 0.0) + c.get("rebarT", 0.0)  # 계획서 고철 = 철근 + 철물
        else:
            model = tw.get(key, 0.0)
        add(u"폐기물 %s" % key, round(model, 1), tons[key], "t")
    if "total" in tons or tons:
        add(u"폐기물 합계", c["totalT"], tons.get("total", sum(v for k, v in tons.items() if k != "total")), "t")
    if plan.get("concreteM3"):
        add(u"콘크리트 부피", c["concreteM3"], plan["concreteM3"], u"㎥")
    add(u"연인원", sc["manDays"], plan.get("manDays"), u"인·일")
    add(u"일 최대 인원", sc["peakCrew"], plan.get("peakCrew"), u"인")
    add(u"공기", sc["days"], plan.get("days"), u"일")
    if plan.get("excavatorHours"):
        add(u"대형 굴착기", sc["equipHours"].get("excavatorLarge", 0), plan["excavatorHours"], "h")
    return [r for r in rows if r["plan"] not in (None, "")]


def fmt(v):
    if v is None:
        return u"–"
    return u"{:,.1f}".format(v) if isinstance(v, float) else u"{:,}".format(v)


def main(argv):
    args = list(argv)
    out = None
    tol = 20.0
    if "--out" in args:
        i = args.index("--out"); out = args[i + 1]; del args[i:i + 2]
    if "--tol" in args:
        i = args.index("--tol"); tol = float(args[i + 1]); del args[i:i + 2]
    if len(args) < 2:
        print(__doc__)
        return 2
    folder, plan_path = args[0], args[1]
    plans = load(plan_path)["models"]
    summaries = [load(p) for p in sorted(glob.glob(os.path.join(folder, "*.reclaim.json")))]
    lines = [u"# 해체계획서 대조 (허용 오차 ±%g%%)" % tol, u""]
    overview = [u"| 모델 | 대조 항목 | 범위 안 | 벗어난 항목 |", u"|---|---|---|---|"]
    detail = []
    for plan in plans:
        hit = [s for s in summaries if plan["match"] in (s.get("name") or "")]
        if not hit:
            overview.append(u"| %s | 결과 없음 | – | – |" % plan["match"])
            continue
        s = hit[-1]
        rows = rows_for(s, plan)
        bad = [r["item"] for r in rows if r["err"] is not None and abs(r["err"]) > tol]
        n = len([r for r in rows if r["err"] is not None])
        overview.append(u"| %s | %d | %d | %s |" % (s["name"], n, n - len(bad), u", ".join(bad) or u"–"))
        detail += [u"", u"## %s" % s["name"], u"",
                   u"계획서 비교 시나리오: %s · 용도 %s" % (plan.get("scenario", "general"), s.get("use")), u"",
                   u"| 항목 | 모델 | 계획서 | 단위 | 오차 |", u"|---|---:|---:|---|---:|"]
        for r in rows:
            e = u"–" if r["err"] is None else (u"%+.1f%%%s" % (r["err"], u" ⚠" if abs(r["err"]) > tol else u""))
            detail.append(u"| %s | %s | %s | %s | %s |" % (r["item"], fmt(r["model"]), fmt(r["plan"]), r["unit"], e))
        if s.get("unknownMaterials"):
            detail.append(u"")
            detail.append(u"미분류 재료: " + u", ".join(u"%s %.1f㎥" % kv for kv in sorted(s["unknownMaterials"].items())))
    text = u"\n".join(lines + overview + detail) + u"\n"
    if out:
        with io.open(out, "w", encoding="utf-8") as f:
            f.write(text)
    if sys.version_info[0] >= 3:
        try:  # Windows 콘솔(cp949)에서 '–'·'⚠'로 멈추지 않게
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
        sys.stdout.write(text)
    else:
        sys.stdout.write(text.encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
