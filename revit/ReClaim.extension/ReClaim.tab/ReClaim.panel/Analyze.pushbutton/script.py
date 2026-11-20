# -*- coding: utf-8 -*-
"""열린 모델의 물량을 읽어 일괄 압쇄 vs 전면 분별해체를 계산하고, 부재마다 결과 매개변수와 색 뷰를 만든다."""
__title__ = u"해체\n분석"
__doc__ = u"모델 물량 → 일괄 압쇄 vs 전면 분별해체 비용·공기 → RC_* 매개변수 + 'ReClaim 결과' 3D 뷰 (+ 설정 시 결과 서버로 전송)"

import os

from pyrevit import forms, script

import reclaim_engine as E
import reclaim_io as IO
import reclaim_revit as R
import reclaim_run as RUN

doc = __revit__.ActiveUIDocument.Document
uidoc = __revit__.ActiveUIDocument
app = __revit__.Application
out = script.get_output()
EXT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
cfg = RUN.load_config()

# 1) 용도 (모델 밖 혼합폐기물 원단위 기준)
uses = sorted(E.RATES["wasteUnit"].keys())
use = forms.SelectFromList.show(uses, title=u"건물 용도·구조 (폐기물 원단위)", multiselect=False) or cfg.get("use") or u"주거 공동주택"

# 2) 미분류 재료 지정 (한 번 고르면 ~/reclaim_material_map.json에 저장)
mapping = RUN.load_map()
_, unknown, gfa = R.collect_items(doc, mapping)
if unknown:
    keys = sorted(E.RATES["materials"].keys())
    labels = [u"%s (%s)" % (k, E.RATES["materials"][k]["label"]) for k in keys]
    for name in sorted(unknown, key=lambda n: -unknown[n])[:15]:
        pick = forms.SelectFromList.show([u"건너뛰기"] + labels, title=u"재료 '%s' (%.1f㎥)는 무엇인가요?" % (name, unknown[name]), multiselect=False)
        if pick and pick != u"건너뛰기":
            mapping[name] = keys[labels.index(pick)]
    RUN.save_map(mapping)

gfa_fallback = None
if gfa <= 0:
    s = forms.ask_for_string(default="2400", prompt=u"연면적(㎡)을 찾지 못했습니다. 직접 입력해 주세요.", title="ReClaim")
    try:
        gfa_fallback = float(s)
    except (TypeError, ValueError):
        gfa_fallback = None

# 3) 계산 + 매개변수·색 뷰
r = RUN.analyze(doc, app, EXT, use, mapping, gfa_fallback, write_params=True, params=cfg.get("params"))
if r["view"] is not None:
    uidoc.ActiveView = r["view"]

# 4) 요약 파일 (웹 bim.html → '결과·모델 열기')
summary_path = RUN.summary_path(doc)
IO.write_json(summary_path, r["summary"])

# 5) 보고
res = r["res"]
out.print_md(u"## ReClaim 해체 분석 — {}".format(doc.Title))
out.print_md(u"연면적 {:,.0f}㎡ · 부재 {}개 · 용도 {}".format(r["gfa"], len(r["items"]), use))
out.print_table(RUN.table_rows(res), columns=[u"항목", u"일괄 압쇄", u"전면 분별해체"])
d = res["selective"]["total"] - res["general"]["total"]
for w in r["summary"].get("warnings") or []:
    out.print_md(u"**⚠ {}** 이 결과로 공법을 판단하지 마세요.".format(w))
out.print_md(u"**결론**: 분별해체가 {} {:,.1f}백만원".format(u"더 비쌈" if d > 0 else u"더 저렴", abs(d) / 1e6))
if r["summary"]["fallbackElements"]:
    out.print_md(u"재료가 지정되지 않았거나 재료 물량이 없는 부재 {}개는 부재 부피에 기본 재료(벽·바닥·기둥·보 = 철근콘크리트, 천장 = 석고보드)를 넣어 계산했습니다. 실제 재료는 도면·해체계획서로 확인하세요.".format(r["summary"]["fallbackElements"]))
if r["unknown"]:
    out.print_md(u"미분류 재료 {}개는 구조 부재면 콘크리트로, 아니면 제외했습니다: {}".format(len(r["unknown"]), u", ".join(sorted(r["unknown"]))))
out.print_md(u"요약 파일: `{}` — 웹 BIM 편집기의 '결과·모델 열기'로 불확실성 분석을 볼 수 있습니다.".format(summary_path))

# 6) 결과 서버로 보내기 (~/reclaim_config.json 의 upload.auto 가 true 일 때)
up = cfg.get("upload") or {}
if up.get("auto") and up.get("token"):
    try:
        import reclaim_upload as UP
        entry = UP.upload(r["summary"], up.get("url"), up.get("token"))
        out.print_md(u"결과 서버에 올렸습니다: `{}` — 사이트 BIM 편집기의 '서버 결과'에서 열 수 있습니다.".format(entry.get("id")))
    except Exception as e:
        out.print_md(u"결과 서버 전송 실패: {}".format(e))
