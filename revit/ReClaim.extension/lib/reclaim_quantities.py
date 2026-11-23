# -*- coding: utf-8 -*-
"""Revit에서 읽은 부재 → 공법 비교 엔진(reclaim-compare pipeline.js)의 물량 묶음.

비용은 여기서 계산하지 않는다. 묶음을 결과 서버(Cloudflare Worker)에 올리면 서버가
공법 비교 화면과 같은 엔진으로 계산해 돌려준다. 이 모듈은 Revit API를 쓰지 않아
일반 Python으로 테스트할 수 있다 (python reclaim_quantities.py).

부재 원자료(raw) 한 개:
  {globalId, tag, name, category(Revit 범주: wall|floor|ceiling|roof|column|beam|foundation|stair|window|door),
   level: 레벨 이름, volume(㎥), area(㎡), top(m, 형상 꼭대기 높이 또는 None),
   layers: [{name: 재료 이름, category: 재료 분류(MaterialClass), thickness: 그 재료의 부피(㎥)}]}
레벨: [{name, elevation(m)}]
"""
from __future__ import division
import json
import re

SCHEMA = "reclaim-quantities/1"

# Revit 범주 → 공법 비교(IFC) 범주
CATEGORY = {"wall": "wall", "floor": "slab", "ceiling": "covering", "roof": "roof", "column": "column",
            "beam": "beam", "foundation": "footing", "stair": "stair", "window": "window", "door": "door"}

# 예전 Revit 용도 이름 → 공법 비교 용도 이름
USAGE = {u"주거 공동주택": u"공동주택", u"주거 단독주택": u"단독주택", u"공동주택": u"공동주택", u"단독주택": u"단독주택",
         u"비주거 RC": u"비주거 RC", u"비주거 철골": u"비주거 철골", u"비주거 SRC": u"비주거 SRC"}

BASEMENT_NAME = re.compile(u"^(?:(?:level|floor|fl)\\s*)?(?:B\\s*\\d+|지하|basement|underground)", re.I | re.U)
ROOF_NAME = re.compile(u"roof|지붕|옥상|옥탑|pit", re.I | re.U)

# 결과 성상 → Revit RC_성상 글자
STREAM_LABEL = {"concrete": u"폐콘크리트", "masonry": u"폐벽돌·블록", "metal": u"고철", "wood": u"폐목재", "resin": u"폐합성수지",
                "glass": u"폐유리", "tile": u"폐타일", "panel": u"패널", "board": u"폐보드", "mixed": u"혼합폐기물",
                "copper": u"동", "aluminum": u"알루미늄", "excluded": u"제외"}
# 결과 처리 방식(분별안 기준) → Revit RC_처리 방식 키 (reclaim_revit.method_label)
METHOD = {u"분별": "selective", u"압쇄": "general", u"제외": None}


def usage_name(use):
    return USAGE.get(use or u"", use or u"공동주택")


def _levels_by_elevation(levels):
    return sorted(levels, key=lambda l: l.get("elevation") or 0.0)


def _is_basement(level):
    return (level.get("elevation") or 0.0) < -0.5 or bool(BASEMENT_NAME.search(level.get("name") or u""))


def _gross(elements):
    """reclaim-compare ifc.js grossArea와 같은 규칙: 벽·기둥이 있는 층의 바닥 슬래브 면적 합."""
    vertical = set(e["floor"] for e in elements if e["category"] in ("wall", "column"))
    slabs = [e for e in elements if e["category"] == "slab" and e["floor"] in vertical]
    if not slabs:
        slabs = [e for e in elements if e["category"] == "slab"]
    area = sum(e.get("area") or 0.0 for e in slabs)
    return {"area": round(area, 2), "basis": "slab" if area > 0 else "bbox"}


def build_model(raw, levels, name=u"", usage=None):
    """Revit 원자료 → pipeline.js가 읽는 model (ifc.js parseIfc와 같은 모양)."""
    by_name = dict((l["name"], l) for l in levels)
    used = [by_name[r["level"]] for r in raw if r.get("level") in by_name]
    ordered = _levels_by_elevation(list(dict((l["name"], l) for l in used).values()))
    floor_of = dict((l["name"], i + 1) for i, l in enumerate(ordered))
    basement_names = set(l["name"] for l in ordered if _is_basement(l))
    ground = [l for l in ordered if l["name"] not in basement_names]
    ground_floor = floor_of[ground[0]["name"]] if ground and basement_names else None
    ground_elev = ground[0]["elevation"] if ground else 0.0

    elements = []
    for r in raw:
        cat = CATEGORY.get(r["category"], "other")
        lv = r.get("level")
        floor = 0 if cat == "footing" else floor_of.get(lv, 1)
        el = {
            "globalId": r.get("globalId") or u"", "tag": str(r.get("tag") or u""), "name": r.get("name") or u"",
            "category": cat, "predefined": u"",
            "basement": lv in basement_names,
            "basementCap": bool(ground_floor) and floor == ground_floor and cat in ("slab", "roof"),
            "roofLevel": bool(lv and ROOF_NAME.search(lv)),
            "floor": floor,
            "volume": round(r.get("volume") or 0.0, 6), "volumeSource": "revit",
            "area": round(r.get("area") or 0.0, 4),
            "joinedCut": bool(r.get("joined")),
            "joinResidual": r.get("joinResidual"),
            "layers": [{"name": l.get("name") or u"", "category": l.get("category") or u"", "thickness": round(l.get("thickness") or 0.0, 6)}
                       for l in (r.get("layers") or [])],
        }
        elements.append(el)

    occupied = [e for e in elements if e["category"] not in ("other", "footing") and (e["volume"] > 0 or e["area"] > 0)]
    below = [e for e in occupied if e["basement"]]
    above = [e for e in occupied if not e["basement"] and not e["roofLevel"]]
    basement_only = bool(below) and not any(not e["basementCap"] for e in above)
    above_ground = [] if basement_only else above
    tops = [r["top"] for r in raw if r.get("top") is not None and r.get("level") not in basement_names]
    model = {
        "name": name, "elements": elements, "services": [],
        "floors": len(set(e["floor"] for e in elements if e["category"] != "footing")) or 1,
        "aboveFloors": len(set(e["floor"] for e in above_ground)),
        "basementFloors": len(set(e["floor"] for e in below)),
        "basementCapCount": len([e for e in above if e["basementCap"]]),
        "basementOnlyCandidate": basement_only,
        "gross": _gross(elements),
        "usage": usage_name(usage),
        "source": "revit",
    }
    up, down = _gross(above_ground), _gross(below)
    model.update({"aboveArea": up["area"], "aboveBasis": up["basis"] if above_ground else "none",
                  "basementArea": down["area"], "basementBasis": down["basis"] if below else "none"})
    if tops:
        model["aboveHeight_m"] = round(max(tops) - ground_elev, 2)
        model["aboveHeightBasis"] = "revit-geometry"
    return model


def build_bundle(raw, levels, name, usage=None, area=None, inputs=None):
    """서버에 올릴 물량 묶음. area를 주면 연면적을 확인된 값으로 쓴다."""
    model = build_model(raw, levels, name, usage)
    ins = dict(inputs or {})
    ins["usage"] = model["usage"]
    if area:
        ins["area"] = float(area)
    return {"schema": SCHEMA, "name": name, "source": "revit", "model": model, "inputs": ins}


def param_rows(result):
    """서버 결과의 부재별 행 → {ElementId 문자열: RC_* 값}. 분별안 기준. 제외 부재는 뺀다."""
    out = {}
    for row in (result or {}).get("elementRows") or []:
        tag = str(row.get("tag") or u"")
        method = METHOD.get(row.get("method"), "general")
        if not tag.isdigit() or method is None:
            continue
        cur = out.get(tag)
        if cur is None:
            cur = out[tag] = {"waste": STREAM_LABEL.get(row.get("stream"), row.get("stream") or u""), "tons": 0.0,
                              "method": method, "disposal": 0.0, "revenue": 0.0}
        cur["tons"] += row.get("tons") or 0.0
        cur["disposal"] += row.get("disposal") or 0.0
        cur["revenue"] += row.get("revenue") or 0.0
        if method == "selective":
            cur["method"] = "selective"
    return out


if __name__ == "__main__":
    import sys
    if "--fixture" in sys.argv:
        # scripts/test_revit_quantities.mjs가 부른다: 가짜 Revit 원자료 → 묶음 JSON
        src = json.load(open(sys.argv[sys.argv.index("--fixture") + 1]))
        bundle = build_bundle(src["raw"], src["levels"], src["name"], src.get("usage"), src.get("area"))
        sys.stdout.write(json.dumps(bundle, ensure_ascii=False))
    else:
        levels = [{"name": u"B1", "elevation": -3.5}, {"name": u"1F", "elevation": 0.0}, {"name": u"2F", "elevation": 3.3}, {"name": u"Roof", "elevation": 6.6}]
        raw = [
            {"tag": 1, "category": "floor", "level": u"1F", "volume": 20, "area": 100, "layers": [{"name": u"콘크리트", "thickness": 20}]},
            {"tag": 2, "category": "wall", "level": u"1F", "volume": 6, "area": 30, "layers": [{"name": u"콘크리트", "thickness": 5.6}, {"name": u"석고보드", "thickness": 0.4}], "top": 3.3},
            {"tag": 3, "category": "floor", "level": u"2F", "volume": 20, "area": 100, "layers": []},
            {"tag": 4, "category": "wall", "level": u"2F", "volume": 6, "area": 30, "layers": [], "top": 6.6},
            {"tag": 5, "category": "wall", "level": u"B1", "volume": 8, "area": 40, "layers": []},
            {"tag": 6, "category": "foundation", "level": u"B1", "volume": 30, "area": 0, "layers": []},
        ]
        m = build_model(raw, levels, u"t", u"주거 공동주택")
        assert m["usage"] == u"공동주택"
        assert m["basementFloors"] == 1 and m["aboveFloors"] == 2, (m["basementFloors"], m["aboveFloors"])
        assert m["gross"] == {"area": 200.0, "basis": "slab"}, m["gross"]
        assert [e["floor"] for e in m["elements"]] == [2, 2, 3, 3, 1, 0]
        assert m["elements"][0]["basementCap"] is True and m["elements"][2]["basementCap"] is False
        assert m["aboveHeight_m"] == 6.6
        rows = param_rows({"elementRows": [{"tag": "2", "stream": "concrete", "method": u"압쇄", "tons": 13.7, "disposal": 1, "revenue": 0},
                                            {"tag": "2", "stream": "board", "method": u"분별", "tons": 0.3, "disposal": 2, "revenue": 0},
                                            {"tag": "", "category": "adjustment", "method": u"보정", "tons": 1}]})
        assert rows["2"]["method"] == "selective" and abs(rows["2"]["tons"] - 14.0) < 1e-9 and rows["2"]["disposal"] == 3
        print("self-check ok")
