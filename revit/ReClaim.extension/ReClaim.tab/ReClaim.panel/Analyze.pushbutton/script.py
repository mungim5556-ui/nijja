# -*- coding: utf-8 -*-
"""열린 모델의 물량을 결과 서버에 올려 일괄 압쇄 vs 전면 분별해체를 계산하고, 부재마다 결과 매개변수와 색 뷰를 만든다.

비용 계산은 공법 비교 화면과 같은 엔진(reclaim-compare)을 결과 서버가 돌린다. 인터넷 연결과
~/reclaim_config.json의 upload.token이 필요하다 (revit/batch/reclaim_config.example.json 참고)."""
__title__ = u"해체\n분석"
__doc__ = u"모델 물량 → 결과 서버(공법 비교 엔진)가 일괄 압쇄 vs 전면 분별해체 비용·공기 계산 → RC_* 매개변수 + 'ReClaim 결과' 3D 뷰"

import os

from pyrevit import forms, script

import reclaim_io as IO
import reclaim_quantities as Q
import reclaim_run as RUN

doc = __revit__.ActiveUIDocument.Document
uidoc = __revit__.ActiveUIDocument
app = __revit__.Application
out = script.get_output()
EXT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
cfg = RUN.load_config()
up = cfg.get("upload") or {}

if not up.get("token"):
    forms.alert(u"결과 서버 토큰이 없습니다.\n~/reclaim_config.json의 upload.token을 넣어 주세요.\n(비용은 결과 서버가 공법 비교 엔진으로 계산합니다)", exitscript=True)

# 1) 용도 (공법 비교의 원단위·창틀 기본 재질 기준)
uses = [u"공동주택", u"단독주택", u"비주거 RC", u"비주거 철골", u"비주거 SRC"]
default_use = Q.usage_name(cfg.get("use"))
use = forms.SelectFromList.show(uses, title=u"건물 용도·구조", multiselect=False) or default_use

# 2) 연면적: 바닥 슬래브로 정해지지 않으면 직접 입력
gfa = cfg.get("gfa")
s = forms.ask_for_string(default=str(gfa or u""), prompt=u"해체 대상 연면적(㎡). 비우면 모델의 바닥 슬래브 면적을 씁니다.", title="ReClaim")
try:
    gfa = float(s) if s else None
except (TypeError, ValueError):
    gfa = None

# 3) 물량 → 서버 계산 → 매개변수·색 뷰
with forms.ProgressBar(title=u"물량을 읽고 결과 서버에서 계산하는 중…", indeterminate=True):
    r = RUN.analyze(doc, app, EXT, use, gfa, write_params=True, upload=up)
if r["view"] is not None:
    uidoc.ActiveView = r["view"]

# 4) 결과 파일 (물량 묶음 + 결과)
path = RUN.summary_path(doc)
IO.write_json(path, r["record"])

# 5) 보고
m = r["bundle"]["model"]
res = r["result"]
out.print_md(u"## ReClaim 해체 분석 — {}".format(doc.Title))
out.print_md(u"부재 {}개 · 용도 {} · 계산 엔진: 공법 비교(reclaim-compare {})".format(
    len(m["elements"]), use, ((r["entry"] or {}).get("engine") or u"?")[:7]))
if res and res.get("crush"):
    out.print_md(u"연면적 {:,.1f}㎡ · 범위 {}".format(res["inputs"]["area"] or 0, res["inputs"]["scope"]))
    out.print_table(RUN.table_rows(res), columns=[u"항목", u"일괄 압쇄", u"전면 분별해체"])
    d = res["selective"]["total"] - res["crush"]["total"]
    out.print_md(u"**결론**: 분별해체가 {} {:,.1f}백만원".format(u"더 비쌈" if d > 0 else u"더 저렴", abs(d) / 1e6))
    if r["written"]:
        out.print_md(u"부재 {}개에 RC_* 매개변수를 썼습니다 ('ReClaim 결과' 3D 뷰).".format(r["written"]))
    for w in res.get("review") or []:
        out.print_md(u"- 확인 필요: {}".format(w))
if r["error"]:
    out.print_md(u"**계산 안내**: {}".format(r["error"]))
if r["entry"]:
    out.print_md(u"결과 서버: `{}` — 사이트의 '서버 결과'에서 열 수 있습니다.".format(r["entry"].get("id")))
out.print_md(u"결과 파일: `{}`".format(path))
