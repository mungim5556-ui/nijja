# -*- coding: utf-8 -*-
"""ReClaim 계산 엔진 (Python). 일괄 압쇄(general) vs 전면 분별해체(selective).

assets/js/bim/cost.js와 같은 계산을 한다. 단가는 rates.json(catalog.js에서 자동 생성)을 읽는다.
Revit 밖에서도 돌아가며 IronPython 2.7과 CPython 3 모두에서 동작하도록 썼다.

    item = {"id", "category", "area", "tons": {재료키: t}, "work": [품 항목] 또는 None, "separable", "hazard"}
    ctx  = {"gfa": 연면적, "use": 원단위 용도}

명령행 점검: python reclaim_engine.py --fixture ../../../scripts/fixtures/takeoff.json
"""
from __future__ import division
import io
import json
import os
import re
import copy

HERE = os.path.dirname(os.path.abspath(__file__))
TRADE_KEYS = ["carpenter", "laborer", "roofer", "mason"]
RECYCLABLE = ["wood", "resin"]


def load_rates(path=None):
    with io.open(path or os.path.join(HERE, "rates.json"), "r", encoding="utf-8") as f:
        return json.load(f)


RATES = load_rates()


def merge_params(p=None, rates=RATES):
    p = p or {}
    base = rates["presets"].get(p.get("preset") or rates["defaultPreset"])
    out = copy.deepcopy(base)
    for k, v in p.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def productivity(key, method, p, rates=RATES):
    item = rates["workItems"].get(key)
    if not item:
        return {}
    if method == "general":
        return item["general"]
    if p.get("table4") == "aligned" and item.get("selectiveAligned"):
        return item["selectiveAligned"]
    return item["selective"]


def work_for(category, mats, rates=RATES):
    keys = [m for m, t in mats.items() if t > 0]
    out = []
    only_hit = False
    for r in rates["workRules"]:
        if r["category"] != category or not r.get("only"):
            continue
        if keys and all(m in r["mats"] for m in keys):
            out.extend(r["work"])
            only_hit = True
    for r in rates["workRules"]:
        if r["category"] != category or r.get("only"):
            continue
        if r.get("any"):
            if not only_hit:
                out.extend(r["work"])
            continue
        if any(m in keys for m in r["mats"]):
            out.extend(r["work"])
    seen = []
    for w in out:
        if w not in seen:
            seen.append(w)
    return seen


def classify_material(name, rates=RATES, extra=None):
    """재료 이름 → 재료 키. extra는 사용자가 지정한 {이름: 키}."""
    if extra and name in extra:
        return extra[name]
    for key, pattern in rates["materialKeywords"]:
        if re.search(pattern, name or "", re.I):
            return key
    return None


def is_eligible(item, rates=RATES):
    if item.get("hazard") and item["hazard"] != "none":
        return False
    if not item.get("work"):
        return False
    try:
        sep = float(item.get("separable") or 4)
    except (TypeError, ValueError):
        sep = 4
    return sep >= rates["separableMin"]


def residual_mixed_tons(items, ctx, p, rates=RATES):
    if p.get("residualMixed") is False:
        return 0.0
    unit = rates["wasteUnit"].get(ctx.get("use") or "", {}).get("mixed")
    if not unit:
        return 0.0
    modeled = 0.0
    for it in items:
        for m, t in it["tons"].items():
            w = rates["materials"].get(m, {}).get("waste")
            if w in ("glass", "board", "tile", "wallpaper"):
                modeled += t
    return max(0.0, unit * (ctx.get("gfa") or 0) - modeled)


def item_cost(item, method, scenario, p, rates=RATES):
    r = {"manDays": 0.0, "labor": {}, "laborCost": 0.0, "disposal": {}, "disposalCost": 0.0, "revenue": {}, "revenueTotal": 0.0}
    wf = p.get("wageFactor") or 1
    lf = (p.get("selectiveLaborFactor") or 1) if method == "selective" else 1

    def add_labor(trade, days):
        if not days > 0:
            return
        r["labor"][trade] = r["labor"].get(trade, 0) + days
        r["manDays"] += days
        r["laborCost"] += days * (p["wage"].get(trade) or 0) * wf

    for key in item.get("work") or []:
        for trade, rate in productivity(key, method, p, rates).items():
            add_labor(trade, rate * (item.get("area") or 0) * lf)
    brick = item["tons"].get("brick", 0)
    if method == "selective" and brick > 0:
        vol = brick / rates["materials"]["brick"]["density"]
        add_labor("mason", vol * p["masonry"]["mason"] * lf)
        add_labor("laborer", vol * p["masonry"]["laborer"] * lf)

    def put(stream, t, price):
        if not t > 0:
            return
        s = r["disposal"].setdefault(stream, {"t": 0.0, "cost": 0.0})
        s["t"] += t
        s["cost"] += t * price
        r["disposalCost"] += t * price

    def earn(key, t, price):
        if not t > 0 or not price:
            return
        r["revenue"][key] = r["revenue"].get(key, 0) + t * price
        r["revenueTotal"] += t * price

    d = p["disposal"]
    mixed_here = d["mixedSelective"] if scenario == "selective" else d["mixedGeneral"]
    for m, t in item["tons"].items():
        if not t > 0:
            continue
        w = rates["materials"].get(m, {}).get("waste", "mixed")
        if w == "concrete":
            if m in rates["inertMats"]:
                put("inert", t, d["inert"] if method == "selective" else d["concreteGeneral"])
            else:
                put("concrete", t, d["concreteSelective"] if scenario == "selective" else d["concreteGeneral"])
            continue
        if w == "metal":
            key = rates["metalPriceKey"].get(m, "steel")
            if method == "selective" or key in p["generalRecovers"]:
                earn(key, t, p["revenue"].get(key))
            else:
                put("mixed", t, mixed_here)
            continue
        if method == "general":
            put("mixed", t, mixed_here)
            continue
        if w == "tile":
            put("inert", t, d["inert"])
            continue
        if w in RECYCLABLE:
            put(w, t * p["recovery"], d[w])
            earn(w, t * p["recovery"], p["revenue"].get(w))
            if p["recovery"] < 1:
                put("mixed", t * (1 - p["recovery"]), mixed_here)
            continue
        put("mixed", t, mixed_here)
    r["net"] = r["laborCost"] + r["disposalCost"] - r["revenueTotal"]
    return r


def _add_into(res, c, p):
    for trade, days in c["labor"].items():
        L = res["labor"].setdefault(trade, {"days": 0.0, "cost": 0.0})
        L["days"] += days
        L["cost"] += days * (p["wage"].get(trade) or 0) * (p.get("wageFactor") or 1)
    res["laborCost"] += c["laborCost"]
    res["interiorManDays"] += c["manDays"]
    for s, v in c["disposal"].items():
        dd = res["disposal"].setdefault(s, {"t": 0.0, "cost": 0.0})
        dd["t"] += v["t"]
        dd["cost"] += v["cost"]
    res["disposalCost"] += c["disposalCost"]
    for k, v in c["revenue"].items():
        res["revenue"][k] = res["revenue"].get(k, 0) + v
    res["revenueTotal"] += c["revenueTotal"]


def scenario_cost(items, ctx, params, scenario, rates=RATES):
    p = merge_params(params, rates)
    res = {"scenario": scenario, "labor": {}, "laborCost": 0.0, "interiorManDays": 0.0, "disposal": {}, "disposalCost": 0.0,
           "revenue": {}, "revenueTotal": 0.0, "equip": {}, "equipCost": 0.0, "haulCost": 0.0, "trips": 0.0,
           "days": 0.0, "interiorDays": 0.0, "structDays": 0.0, "indirect": 0.0, "total": 0.0,
           "perItem": {}, "hazardItems": []}
    any_sel = False
    for it in items:
        if it.get("hazard") and it["hazard"] != "none":
            res["hazardItems"].append(it["id"])
            res["perItem"][it["id"]] = {"method": "hazard", "net": 0.0}
            continue
        method = "selective" if scenario == "selective" and is_eligible(it, rates) else "general"
        if method == "selective":
            any_sel = True
        c = item_cost(it, method, scenario, p, rates)
        res["perItem"][it["id"]] = {"method": method, "net": c["net"]}
        _add_into(res, c, p)
    if any_sel:
        c = item_cost({"id": "sorting", "tons": {}, "work": ["sorting"], "area": ctx.get("gfa") or 0}, "selective", scenario, p, rates)
        res["sorting"] = c
        _add_into(res, c, p)
    rt = residual_mixed_tons(items, ctx, p, rates)
    if rt > 0:
        price = p["disposal"]["mixedSelective"] if scenario == "selective" else p["disposal"]["mixedGeneral"]
        dd = res["disposal"].setdefault("residual", {"t": 0.0, "cost": 0.0})
        dd["t"] += rt
        dd["cost"] += rt * price
        res["disposalCost"] += rt * price
        res["residual"] = {"t": rt, "price": price}
    res["interiorDays"] = res["interiorManDays"] / max(1, p["crewSize"])
    H = p["hoursPerDay"]
    ef = p.get("equipFactor") or 1
    if p["includeStructure"]:
        vol = 0.0
        for it in items:
            if it.get("hazard") and it["hazard"] != "none":
                continue
            for m in rates["crushMats"]:
                if it["tons"].get(m, 0) > 0:
                    vol += it["tons"][m] / rates["materials"][m]["density"]
        res["crushVolume"] = vol
        res["structDays"] = vol / max(0.1, p["crushProd"] * (p.get("crushFactor") or 1))
        res["equip"]["excavatorLarge"] = res["structDays"] * H * p["equipment"]["excavatorLarge"] * ef
        crew_days = res["structDays"] * p["structCrew"]
        wage = p["wage"]["laborer"] * (p.get("wageFactor") or 1)
        L = res["labor"].setdefault("laborer", {"days": 0.0, "cost": 0.0})
        L["days"] += crew_days
        L["cost"] += crew_days * wage
        res["laborCost"] += crew_days * wage
    if scenario == "selective" and any_sel and p["selectiveEquip"]:
        res["equip"]["excavatorSmall"] = res["interiorDays"] * H * p["equipment"]["excavatorSmall"] * ef
        res["equip"]["cutter"] = res["interiorDays"] * H * p["equipment"]["cutter"] * ef
    res["equipCost"] = sum(res["equip"].values())
    if p["haul"]["on"]:
        t = sum(v["t"] for v in res["disposal"].values())
        for k, won in res["revenue"].items():
            price = p["revenue"].get(k)
            if price:
                t += won / price
        res["trips"] = t / max(0.1, p["haul"]["truckLoad"])
        res["haulCost"] = res["trips"] * p["haul"]["hoursPerTrip"] * p["equipment"]["dump"] * ef
    res["days"] = res["interiorDays"] + res["structDays"]
    res["indirect"] = res["days"] * (p.get("indirectPerDay") or 0)
    res["total"] = res["laborCost"] + res["equipCost"] + res["disposalCost"] + res["haulCost"] + res["indirect"] - res["revenueTotal"]
    return res


def compare_items(items, ctx, params=None, rates=RATES):
    return {"general": scenario_cost(items, ctx, params, "general", rates),
            "selective": scenario_cost(items, ctx, params, "selective", rates)}


def item_deltas(items, ctx, params=None, rates=RATES):
    p = merge_params(params, rates)
    out = {}
    for it in items:
        if it.get("hazard") and it["hazard"] != "none":
            out[it["id"]] = {"method": "hazard", "delta": 0.0}
            continue
        g = item_cost(it, "general", "general", p, rates)
        elig = is_eligible(it, rates)
        s = item_cost(it, "selective" if elig else "general", "selective", p, rates)
        out[it["id"]] = {"method": "selective" if elig else "general", "delta": s["net"] - g["net"]}
    return out


def dominant_waste(tons, rates=RATES):
    best, mx = None, 0.0
    by = {}
    for m, t in tons.items():
        w = rates["materials"].get(m, {}).get("waste", "mixed")
        by[w] = by.get(w, 0) + t
    for w, t in by.items():
        if w != "concrete" and t > mx:
            best, mx = w, t
    if not best and by.get("concrete"):
        best = "concrete"
    return best or "mixed"


if __name__ == "__main__":
    import sys
    if "--fixture" in sys.argv:
        path = sys.argv[sys.argv.index("--fixture") + 1]
        with io.open(path, "r", encoding="utf-8") as f:
            fx = json.load(f)
        r = compare_items(fx["items"], fx["ctx"], fx.get("params"))
        keys = ["laborCost", "equipCost", "haulCost", "disposalCost", "revenueTotal", "days", "total"]
        print(json.dumps({s: dict((k, r[s][k]) for k in keys) for s in r}))
    else:
        # 자체 점검: 재료 분류와 작업 규칙
        assert classify_material(u"콘크리트 - 현장타설") == "rc"
        assert classify_material("Gypsum Wall Board") == "gypsum"
        assert work_for("ceiling", {"plaster": 1.0}) == ["ceiling.mortar"]
        assert work_for("ceiling", {"lumber": 1.0, "tex": 1.0}) == ["ceiling.rafter", "ceiling.tex"]
        print("self-check ok")
