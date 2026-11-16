# -*- coding: utf-8 -*-
# ReClaim Compare 결과(CSV)를 Revit 부재의 공유 매개변수에 기록한다.
# Revit 안에서 실행: pyRevit 스크립트 또는 Dynamo "Python Script" 노드.
# Revit 밖에서(python write_results.py) 실행하면 CSV 읽기 셀프체크만 한다.
#
# 준비: 같은 폴더의 ReClaim_SharedParams.txt 를 쓴다 (스크립트가 자동으로 연결한다).
# 주의: Revit API 부분은 Revit 없이 시험하지 못했다. Revit 2022~2025 API 기준으로 썼으며,
#       처음 쓸 때는 모델 사본에서 실행해 본다.
import io
import json
import os

TEXT = ("RC_Waste", "RC_Method")
NUMBER = ("RC_Tons", "RC_DisposalCost", "RC_Revenue")


def read_rows(path):
    """CSV → [{ElementId, RC_Waste, ...}]. 따옴표 없는 단순 CSV, BOM 허용."""
    with io.open(path, "r", encoding="utf-8-sig") as f:
        lines = [l.strip() for l in f if l.strip()]
    head = lines[0].split(",")
    rows = []
    for line in lines[1:]:
        r = dict(zip(head, line.split(",")))
        for k in NUMBER:
            r[k] = float(r[k])
        rows.append(r)
    return rows


def summary_text(path):
    """요약 JSON → 프로젝트 정보에 넣을 한 줄"""
    with io.open(path, "r", encoding="utf-8-sig") as f:
        s = json.load(f)
    return u"압쇄 {:,}원 / 분별 {:,}원 / 차이 {:,}원 / 분별이 더 쌀 확률 {:.1%} / 권장 {}".format(
        s["crush_total_won"], s["selective_total_won"], s["delta_won"], s["p_selective_cheaper"], s["recommended"])


def run_in_revit():
    from Autodesk.Revit import DB
    from pyrevit import forms, revit, script

    doc, app, out = revit.doc, revit.doc.Application, script.get_output()
    csv_path = forms.pick_file(file_ext="csv", title="reclaim_elements.csv 고르기")
    if not csv_path:
        return
    rows = read_rows(csv_path)
    json_path = os.path.join(os.path.dirname(csv_path), "reclaim_summary.json")

    # 공유 매개변수를 모델 범주 전체와 프로젝트 정보에 인스턴스 매개변수로 연결
    here = os.path.dirname(__file__)
    old = app.SharedParametersFilename
    app.SharedParametersFilename = os.path.join(here, "ReClaim_SharedParams.txt")
    group = app.OpenSharedParameterFile().Groups.get_Item("ReClaim")
    cats = app.Create.NewCategorySet()
    for c in doc.Settings.Categories:
        if c.AllowsBoundParameters and c.CategoryType == DB.CategoryType.Model:
            cats.Insert(c)
    info = app.Create.NewCategorySet()
    info.Insert(doc.Settings.Categories.get_Item(DB.BuiltInCategory.OST_ProjectInformation))

    with revit.Transaction("ReClaim 결과 기록"):
        for d in group.Definitions:
            if doc.ParameterBindings.Contains(d):
                continue
            binding = app.Create.NewInstanceBinding(info if d.Name == "RC_Summary" else cats)
            try:  # Revit 2024 이상
                doc.ParameterBindings.Insert(d, binding, DB.GroupTypeId.Data)
            except AttributeError:  # Revit 2023 이하
                doc.ParameterBindings.Insert(d, binding, DB.BuiltInParameterGroup.PG_DATA)

        done, missing = 0, 0
        for r in rows:
            el = doc.GetElement(DB.ElementId(int(r["ElementId"]))) if r["ElementId"].isdigit() else None
            if el is None:
                missing += 1
                continue
            for k in TEXT + NUMBER:
                p = el.LookupParameter(k)
                if p and not p.IsReadOnly:
                    p.Set(r[k])
            done += 1
        if os.path.exists(json_path):
            p = doc.ProjectInformation.LookupParameter("RC_Summary")
            if p:
                p.Set(summary_text(json_path))
    app.SharedParametersFilename = old
    out.print_md(u"**{}개 부재에 기록했습니다.** 찾지 못한 부재: {}개".format(done, missing))


if __name__ == "__main__":
    try:
        import Autodesk  # noqa: F401  Revit 안에서만 있다
    except ImportError:
        import tempfile
        d = tempfile.mkdtemp()
        p = os.path.join(d, "t.csv")
        with io.open(p, "w", encoding="utf-8") as f:
            f.write(u"﻿GlobalId,ElementId,Category,Floor,RC_Waste,RC_Method,RC_Tons,RC_DisposalCost,RC_Revenue\n"
                    u"0abc,300014,window,1,glass,분별,0.1080,5890,60750\n")
        r = read_rows(p)
        assert len(r) == 1 and r[0]["ElementId"] == "300014" and r[0]["RC_Method"] == u"분별" and r[0]["RC_Tons"] == 0.108
        j = os.path.join(d, "s.json")
        with io.open(j, "w", encoding="utf-8") as f:
            f.write(u'{"crush_total_won": 10, "selective_total_won": 8, "delta_won": -2, "p_selective_cheaper": 0.25, "recommended": "selective"}')
        assert u"25.0%" in summary_text(j)
        print("self-check ok (Revit 밖: CSV·JSON 읽기만 확인)")
    else:
        run_in_revit()
