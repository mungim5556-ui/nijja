# -*- coding: utf-8 -*-
"""열린 모델의 물량을 읽어 일괄 압쇄 vs 전면 분별해체를 계산하고, 부재마다 결과 매개변수와 색 뷰를 만든다."""
__title__ = u"해체\n분석"
__doc__ = u"모델 물량 → 일괄 압쇄 vs 전면 분별해체 비용·공기 → RC_* 매개변수 + 'ReClaim 결과' 3D 뷰"

import io
import json
import os

from Autodesk.Revit.DB import ElementId, Transaction
from pyrevit import forms, script

import reclaim_engine as E
import reclaim_io as IO
import reclaim_revit as R

doc = __revit__.ActiveUIDocument.Document
uidoc = __revit__.ActiveUIDocument
app = __revit__.Application
out = script.get_output()
EXT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
MAP_PATH = os.path.join(os.path.expanduser("~"), "reclaim_material_map.json")


def load_map():
    try:
        with io.open(MAP_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_map(m):
    with io.open(MAP_PATH, "w", encoding="utf-8") as f:
        f.write(json.dumps(m, ensure_ascii=False, indent=1))


# 1) 용도 (모델 밖 혼합폐기물 원단위 기준)
uses = sorted(E.RATES["wasteUnit"].keys())
use = forms.SelectFromList.show(uses, title=u"건물 용도·구조 (폐기물 원단위)", multiselect=False) or u"주거 공동주택"

# 2) 물량 읽기 + 미분류 재료 지정
mapping = load_map()
items, unknown, gfa = R.collect_items(doc, mapping)
if unknown:
    keys = sorted(E.RATES["materials"].keys())
    labels = [u"%s (%s)" % (k, E.RATES["materials"][k]["label"]) for k in keys]
    for name in sorted(unknown, key=lambda n: -unknown[n])[:15]:
        pick = forms.SelectFromList.show([u"건너뛰기"] + labels, title=u"재료 '%s' (%.1f㎥)는 무엇인가요?" % (name, unknown[name]), multiselect=False)
        if pick and pick != u"건너뛰기":
            mapping[name] = keys[labels.index(pick)]
    save_map(mapping)
    items, unknown, gfa = R.collect_items(doc, mapping)

if gfa <= 0:
    s = forms.ask_for_string(default="2400", prompt=u"연면적(㎡)을 찾지 못했습니다. 직접 입력해 주세요.", title="ReClaim")
    try:
        gfa = float(s)
    except (TypeError, ValueError):
        gfa = 0.0

ctx = {"gfa": gfa, "use": use}
res = E.compare_items(items, ctx, {})
deltas = E.item_deltas(items, ctx, {})

# 3) 매개변수·색 뷰
t = Transaction(doc, u"ReClaim 분석")
t.Start()
try:
    guids = R.ensure_shared_params(doc, app, EXT)
    for it in items:
        el = doc.GetElement(ElementId(int(it["id"])))
        if el is None:
            continue
        waste = E.dominant_waste(it["tons"])
        method = deltas[it["id"]]["method"]
        R.write_result(el, E.RATES["waste"].get(waste, {}).get("label", waste), sum(it["tons"].values()),
                       method, method == "selective", deltas[it["id"]]["delta"] / 1000.0)
    view = R.result_view(doc, guids)
    t.Commit()
except Exception:
    t.RollBack()
    raise
uidoc.ActiveView = view

# 4) 요약 파일 (웹 bim.html → '결과 열기')
folder = os.path.dirname(doc.PathName) if doc.PathName else os.path.join(os.path.expanduser("~"), "Documents")
summary_path = os.path.join(folder, u"%s.reclaim.json" % doc.Title)
IO.write_json(summary_path, IO.summary_json(doc.Title, ctx, items, res))

# 5) 보고
g, s = res["general"], res["selective"]
m = lambda v: u"{:,.1f}".format(v / 1e6)
out.print_md(u"## ReClaim 해체 분석 — {}".format(doc.Title))
out.print_md(u"연면적 {:,.0f}㎡ · 부재 {}개 · 용도 {}".format(gfa, len(items), use))
out.print_table(
    [[u"인건비", m(g["laborCost"]), m(s["laborCost"])], [u"장비비", m(g["equipCost"]), m(s["equipCost"])],
     [u"반출비", m(g["haulCost"]), m(s["haulCost"])], [u"처리비", m(g["disposalCost"]), m(s["disposalCost"])],
     [u"매각 수익", u"−" + m(g["revenueTotal"]), u"−" + m(s["revenueTotal"])],
     [u"합계 (백만원)", m(g["total"]), m(s["total"])], [u"공기 (일)", u"%.1f" % g["days"], u"%.1f" % s["days"]]],
    columns=[u"항목", u"일괄 압쇄", u"전면 분별해체"])
d = s["total"] - g["total"]
out.print_md(u"**{}**: 분별해체가 {} {}백만원".format(u"결론", u"더 비쌈" if d > 0 else u"더 저렴", m(abs(d))))
if unknown:
    out.print_md(u"미분류 재료 {}개는 구조 부재면 콘크리트로, 아니면 제외했습니다: {}".format(len(unknown), u", ".join(sorted(unknown))))
out.print_md(u"요약 파일: `{}` — 웹 BIM 편집기의 '결과 열기'로 불확실성 분석을 볼 수 있습니다.".format(summary_path))
