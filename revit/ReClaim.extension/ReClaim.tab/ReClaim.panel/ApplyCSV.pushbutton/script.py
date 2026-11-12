# -*- coding: utf-8 -*-
"""웹(IFC 계산)에서 내려받은 결과 CSV를 찾아 부재에 매개변수와 색을 넣는다."""
__title__ = u"CSV\n적용"
__doc__ = u"다운로드 폴더의 최신 *.reclaim.csv → RC_* 매개변수 + 'ReClaim 결과' 3D 뷰"

import os

from Autodesk.Revit.DB import BuiltInParameter, ElementId, FilteredElementCollector, Transaction
from pyrevit import forms, script

import reclaim_io as IO
import reclaim_revit as R

doc = __revit__.ActiveUIDocument.Document
uidoc = __revit__.ActiveUIDocument
app = __revit__.Application
out = script.get_output()
EXT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

path = IO.latest_csv()
if path and not forms.alert(u"이 파일을 적용할까요?\n{}".format(path), yes=True, no=True):
    path = None
if not path:
    path = forms.pick_file(file_ext="csv")
if not path:
    script.exit()

rows = IO.read_results_csv(path)
guid_index = None


def find(row):
    global guid_index
    if row["element_id"] is not None:
        el = doc.GetElement(ElementId(int(row["element_id"])))
        if el is not None:
            return el
    if row["ifc_guid"]:
        if guid_index is None:
            guid_index = {}
            for e in FilteredElementCollector(doc).WhereElementIsNotElementType():
                p = e.get_Parameter(BuiltInParameter.IFC_GUID)
                if p and p.HasValue:
                    guid_index[p.AsString()] = e
        return guid_index.get(row["ifc_guid"])
    return None


done, missing = 0, 0
t = Transaction(doc, u"ReClaim CSV 적용")
t.Start()
try:
    guids = R.ensure_shared_params(doc, app, EXT)
    for row in rows:
        el = find(row)
        if el is None:
            missing += 1
            continue
        R.write_result(el, row["waste"], row["tons"], row["method"], row["recyclable"], row["delta_k"])
        done += 1
    view = R.result_view(doc, guids)
    t.Commit()
except Exception:
    t.RollBack()
    raise
uidoc.ActiveView = view
out.print_md(u"## ReClaim CSV 적용\n`{}`\n\n부재 {}개에 결과를 넣었습니다. 찾지 못한 행 {}개.".format(path, done, missing))
if missing:
    out.print_md(u"찾지 못한 행은 다른 모델에서 내보낸 IFC이거나, IFC 내보내기 때 ElementId(Tag)가 빠진 경우입니다.")
