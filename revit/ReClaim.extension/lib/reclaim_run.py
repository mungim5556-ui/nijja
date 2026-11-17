# -*- coding: utf-8 -*-
"""해체 분석 한 번: 물량 읽기 → 2안 계산 → (선택) RC_* 매개변수·색 뷰 → 요약 JSON.

리본의 '해체 분석' 버튼과 무인 일괄 실행(revit/batch/reclaim_batch.py)이 같이 쓴다.
대화 상자는 띄우지 않는다. 용도·재료 지정은 호출하는 쪽이 넘긴다.
"""
from __future__ import division
import io
import json
import os

from Autodesk.Revit.DB import Transaction

import reclaim_engine as E
import reclaim_io as IO
import reclaim_revit as R

MAP_PATH = os.path.join(os.path.expanduser("~"), "reclaim_material_map.json")
CONFIG_PATH = os.path.join(os.path.expanduser("~"), "reclaim_config.json")


def load_json(path, default):
    try:
        with io.open(path, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return default


def save_map(m):
    with io.open(MAP_PATH, "w", encoding="utf-8") as f:
        f.write(json.dumps(m, ensure_ascii=False, indent=1))


def load_map():
    return load_json(MAP_PATH, {})


def load_config():
    """~/reclaim_config.json (없으면 빈 설정). 형식은 revit/batch/reclaim_config.example.json 참고."""
    return load_json(CONFIG_PATH, {})


def write_results(doc, app, ext_folder, items, deltas):
    """부재마다 RC_* 매개변수를 쓰고 'ReClaim 결과' 3D 뷰를 만든다. 뷰를 돌려준다."""
    t = Transaction(doc, u"ReClaim 분석")
    t.Start()
    try:
        guids = R.ensure_shared_params(doc, app, ext_folder)
        for it in items:
            el = doc.GetElement(R.element_id(it["id"]))
            if el is None:
                continue
            waste = E.dominant_waste(it["tons"])
            method = deltas[it["id"]]["method"]
            R.write_result(el, E.RATES["waste"].get(waste, {}).get("label", waste), sum(it["tons"].values()),
                           method, method == "selective", deltas[it["id"]]["delta"] / 1000.0)
        view = R.result_view(doc, guids)
        t.Commit()
        return view
    except Exception:
        t.RollBack()
        raise


def analyze(doc, app, ext_folder, use, mapping=None, gfa_fallback=None, write_params=True, params=None):
    items, unknown, gfa = R.collect_items(doc, mapping or {})
    if gfa <= 0 and gfa_fallback:
        gfa = float(gfa_fallback)
    ctx = {"gfa": gfa, "use": use}
    res = E.compare_items(items, ctx, params or {})
    deltas = E.item_deltas(items, ctx, params or {})
    view = write_results(doc, app, ext_folder, items, deltas) if write_params else None
    summary = IO.summary_json(doc.Title, ctx, items, res, params)
    summary["source"] = "revit"
    summary["unknownMaterials"] = dict((k, round(v, 3)) for k, v in unknown.items())
    summary["fallbackElements"] = len([it for it in items if it.get("fallback")])
    summary["check"] = E.check_block(items, ctx, res, params)
    return {"items": items, "unknown": unknown, "gfa": gfa, "ctx": ctx, "res": res, "deltas": deltas, "view": view, "summary": summary}


def summary_path(doc, folder=None):
    if not folder:
        folder = os.path.dirname(doc.PathName) if doc.PathName else os.path.join(os.path.expanduser("~"), "Documents")
    return os.path.join(folder, u"%s.reclaim.json" % doc.Title)


def table_rows(res):
    g, s = res["general"], res["selective"]
    m = lambda v: u"{:,.1f}".format(v / 1e6)
    return [[u"인건비", m(g["laborCost"]), m(s["laborCost"])], [u"장비비", m(g["equipCost"]), m(s["equipCost"])],
            [u"반출비", m(g["haulCost"]), m(s["haulCost"])], [u"처리비", m(g["disposalCost"]), m(s["disposalCost"])],
            [u"공기 간접비", m(g["indirect"]), m(s["indirect"])],
            [u"매각 수익", u"−" + m(g["revenueTotal"]), u"−" + m(s["revenueTotal"])],
            [u"합계 (백만원)", m(g["total"]), m(s["total"])], [u"공기 (일)", u"%.1f" % g["days"], u"%.1f" % s["days"]]]
