# -*- coding: utf-8 -*-
"""Revit API 도우미: 부재 물량 읽기, 공유 매개변수 만들기·쓰기, 결과 색 뷰 만들기.

pyRevit 버튼(분석, CSV 적용)이 함께 쓴다. Revit 2021~2026에서 API 이름이 바뀐 곳은
try/except로 두 가지를 모두 시도한다.
"""
from __future__ import division
import os

from Autodesk.Revit.DB import (
    BuiltInCategory, BuiltInParameter, FilteredElementCollector, ElementId, Transaction,
    CategorySet, InstanceBinding, ExternalDefinitionCreationOptions, SharedParameterElement,
    ParameterFilterElement, ParameterFilterRuleFactory, ElementParameterFilter, LogicalOrFilter,
    OverrideGraphicSettings, Color, FillPatternElement, FillPatternTarget, View3D, ViewFamilyType, ViewFamily,
    StorageType,
)
from System.Collections.Generic import List

import reclaim_engine as E

FT3 = 0.028316846592  # ft³ → m³
FT2 = 0.09290304      # ft² → m²
FT = 0.3048           # ft → m

# Revit 범주 → 엔진 범주
CATEGORIES = [
    (BuiltInCategory.OST_Walls, "wall"),
    (BuiltInCategory.OST_Floors, "floor"),
    (BuiltInCategory.OST_Ceilings, "ceiling"),
    (BuiltInCategory.OST_Roofs, "roof"),
    (BuiltInCategory.OST_StructuralColumns, "column"),
    (BuiltInCategory.OST_Columns, "column"),
    (BuiltInCategory.OST_StructuralFraming, "beam"),
    (BuiltInCategory.OST_StructuralFoundation, "foundation"),
    (BuiltInCategory.OST_Stairs, "stair"),
    (BuiltInCategory.OST_Windows, "window"),
    (BuiltInCategory.OST_Doors, "door"),
]
STRUCTURAL = ("column", "beam", "foundation", "stair")

# 재료 물량이 없을 때 개구부 면적당 질량 (kg/㎡) — 편집기 ASSEMBLIES와 같은 가정값
OPENING_DEFAULT = {"window": {"pvcFrame": 9.0, "glass": 20.0}, "door": {"woodDoor": 18.0}}

OUT_PARAMS = [  # 이름, 숫자 여부
    (u"RC_성상", False), (u"RC_톤", True), (u"RC_처리", False), (u"RC_재활용", False), (u"RC_비용차", True),
]
IN_PARAMS = [(u"RC_시공성", True), (u"RC_유해물질", False)]
HAZARD_TEXT = {u"석면 의심": "suspected", u"석면 확인": "confirmed", u"suspected": "suspected", u"confirmed": "confirmed"}


def _param_value(el, name):
    p = el.LookupParameter(name)
    if not p or not p.HasValue:
        return None
    if p.StorageType == StorageType.Double:
        return p.AsDouble()
    if p.StorageType == StorageType.Integer:
        return p.AsInteger()
    return p.AsString()


def _host_area(el):
    p = el.get_Parameter(BuiltInParameter.HOST_AREA_COMPUTED)
    return p.AsDouble() * FT2 if p and p.HasValue else 0.0


def _opening_area(doc, el):
    sym = doc.GetElement(el.GetTypeId())
    w = h = None
    for src in (el, sym):
        if src is None:
            continue
        for bip in (BuiltInParameter.FAMILY_WIDTH_PARAM, BuiltInParameter.WINDOW_WIDTH, BuiltInParameter.DOOR_WIDTH):
            try:
                p = src.get_Parameter(bip)
            except Exception:
                p = None
            if p and p.HasValue and p.AsDouble() > 0:
                w = w or p.AsDouble()
        for bip in (BuiltInParameter.FAMILY_HEIGHT_PARAM, BuiltInParameter.WINDOW_HEIGHT, BuiltInParameter.DOOR_HEIGHT):
            try:
                p = src.get_Parameter(bip)
            except Exception:
                p = None
            if p and p.HasValue and p.AsDouble() > 0:
                h = h or p.AsDouble()
    if w and h:
        return w * h * FT2
    bb = el.get_BoundingBox(None)
    if bb:
        dx, dy, dz = (bb.Max.X - bb.Min.X), (bb.Max.Y - bb.Min.Y), (bb.Max.Z - bb.Min.Z)
        return max(dx, dy) * dz * FT2
    return 0.0


def _level_name(doc, el):
    lid = getattr(el, "LevelId", None)
    if lid and lid != ElementId.InvalidElementId:
        lv = doc.GetElement(lid)
        if lv:
            return lv.Name
    return "L?"


def collect_items(doc, mapping=None):
    """모델에서 엔진 입력(items)과 미분류 재료 목록, 연면적을 만든다."""
    items, unknown = [], {}
    gfa = 0.0
    seen = set()
    for bic, cat in CATEGORIES:
        for el in FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType():
            eid = el.Id.IntegerValue if hasattr(el.Id, "IntegerValue") else el.Id.Value
            if eid in seen:
                continue
            seen.add(eid)
            tons = {}
            try:
                mids = list(el.GetMaterialIds(False))
            except Exception:
                mids = []
            for mid in mids:
                try:
                    vol = el.GetMaterialVolume(mid) * FT3
                except Exception:
                    vol = 0.0
                if vol <= 0:
                    continue
                mat = doc.GetElement(mid)
                name = mat.Name if mat else ""
                key = E.classify_material(name, extra=mapping)
                if not key and mat is not None:
                    key = E.classify_material(getattr(mat, "MaterialClass", "") or "", extra=mapping)
                if not key:
                    unknown[name] = unknown.get(name, 0) + vol
                    key = "rc" if cat in STRUCTURAL + ("wall", "floor", "roof") else None
                if key:
                    tons[key] = tons.get(key, 0) + vol * E.RATES["materials"][key]["density"]
            if cat in ("window", "door"):
                area = _opening_area(doc, el)
                if not tons:
                    for m, kg in OPENING_DEFAULT[cat].items():
                        tons[m] = area * kg / 1000.0
            elif cat in STRUCTURAL:
                area = 0.0
            else:
                area = _host_area(el)
            if cat == "floor" and tons.get("rc", 0) > 0:
                gfa += _host_area(el)
            sep = _param_value(el, u"RC_시공성")
            haz = _param_value(el, u"RC_유해물질")
            items.append({
                "id": str(eid), "category": cat, "area": area, "tons": tons,
                "work": E.work_for(cat, tons),
                "separable": sep if sep else (2 if cat in STRUCTURAL else 5),
                "hazard": HAZARD_TEXT.get(haz or "", "none"),
                "name": el.Name, "level": _level_name(doc, el),
            })
    return items, unknown, gfa


# ---------- 공유 매개변수 ----------

def _spec(is_number):
    try:
        from Autodesk.Revit.DB import SpecTypeId
        return SpecTypeId.Number if is_number else SpecTypeId.String.Text
    except Exception:
        from Autodesk.Revit.DB import ParameterType
        return ParameterType.Number if is_number else ParameterType.Text


def _group():
    try:
        from Autodesk.Revit.DB import GroupTypeId
        return GroupTypeId.Data
    except Exception:
        from Autodesk.Revit.DB import BuiltInParameterGroup
        return BuiltInParameterGroup.PG_DATA


def ensure_shared_params(doc, app, folder):
    """RC_* 매개변수가 없으면 만들어 범주에 묶는다. 이름 → GUID를 돌려준다 (트랜잭션 안에서 호출)."""
    original = app.SharedParametersFilename
    path = os.path.join(folder, "ReClaim_SharedParams.txt")
    if not os.path.exists(path):
        open(path, "a").close()
    app.SharedParametersFilename = path
    try:
        dfile = app.OpenSharedParameterFile()
        group = dfile.Groups.get_Item("ReClaim") or dfile.Groups.Create("ReClaim")
        cats = CategorySet()
        for bic, _ in CATEGORIES:
            c = doc.Settings.Categories.get_Item(bic)
            if c is not None and c.AllowsBoundParameters:
                cats.Insert(c)
        guids = {}
        for name, is_num in OUT_PARAMS + IN_PARAMS:
            d = group.Definitions.get_Item(name)
            if d is None:
                opt = ExternalDefinitionCreationOptions(name, _spec(is_num))
                d = group.Definitions.Create(opt)
            guids[name] = d.GUID
            if SharedParameterElement.Lookup(doc, d.GUID) is None:
                binding = app.Create.NewInstanceBinding(cats)
                if not doc.ParameterBindings.Insert(d, binding, _group()):
                    doc.ParameterBindings.ReInsert(d, binding, _group())
        return guids
    finally:
        if original:
            app.SharedParametersFilename = original


def set_param(el, name, value):
    p = el.LookupParameter(name)
    if p is None or p.IsReadOnly:
        return False
    if p.StorageType == StorageType.Double:
        return p.Set(float(value))
    if p.StorageType == StorageType.Integer:
        return p.Set(int(value))
    return p.Set(u"%s" % value)


def write_result(el, waste_label, tons, method, recyclable, delta_k):
    set_param(el, u"RC_성상", waste_label)
    set_param(el, u"RC_톤", round(tons, 3))
    set_param(el, u"RC_처리", method_label(method))
    set_param(el, u"RC_재활용", u"예" if recyclable else u"아니오")
    set_param(el, u"RC_비용차", round(delta_k, 1))


def method_label(method):
    return {"selective": u"분별 회수", "general": u"일괄 처리", "structure": u"압쇄(공통)", "hazard": u"석면 별도"}.get(method, method)


# ---------- 결과 색 뷰 ----------

def _equals_rule(param_id, text):
    try:
        return ParameterFilterRuleFactory.CreateEqualsRule(param_id, text)
    except Exception:
        return ParameterFilterRuleFactory.CreateEqualsRule(param_id, text, True)


def _solid_fill(doc):
    for fp in FilteredElementCollector(doc).OfClass(FillPatternElement):
        pat = fp.GetFillPattern()
        if pat.IsSolidFill and pat.Target == FillPatternTarget.Drafting:
            return fp.Id
    return None


def result_view(doc, guids, name=u"ReClaim 결과"):
    """3D 뷰를 만들고(있으면 재사용) RC_처리 값에 따라 색을 입힌다 (트랜잭션 안에서 호출)."""
    view = None
    for v in FilteredElementCollector(doc).OfClass(View3D):
        if not v.IsTemplate and v.Name == name:
            view = v
            break
    if view is None:
        vft = [t for t in FilteredElementCollector(doc).OfClass(ViewFamilyType) if t.ViewFamily == ViewFamily.ThreeDimensional][0]
        view = View3D.CreateIsometric(doc, vft.Id)
        view.Name = name
    pid = SharedParameterElement.Lookup(doc, guids[u"RC_처리"]).Id
    cat_ids = List[ElementId]()
    for bic, _ in CATEGORIES:
        c = doc.Settings.Categories.get_Item(bic)
        if c is not None and c.AllowsBoundParameters:
            cat_ids.Add(c.Id)
    solid = _solid_fill(doc)
    colors = [(u"분별 회수", Color(27, 175, 122)), (u"일괄 처리", Color(178, 171, 161)), (u"압쇄(공통)", Color(156, 144, 132)), (u"석면 별도", Color(180, 35, 24))]
    existing = dict((f.Name, f) for f in FilteredElementCollector(doc).OfClass(ParameterFilterElement))
    for label, color in colors:
        fname = u"ReClaim - " + label
        filt = ElementParameterFilter(_equals_rule(pid, label))
        pf = existing.get(fname)
        if pf is None:
            pf = ParameterFilterElement.Create(doc, fname, cat_ids, filt)
        else:
            pf.SetElementFilter(filt)
        if not view.IsFilterApplied(pf.Id):
            view.AddFilter(pf.Id)
        ogs = OverrideGraphicSettings()
        if solid is not None:
            ogs.SetSurfaceForegroundPatternId(solid)
        ogs.SetSurfaceForegroundPatternColor(color)
        ogs.SetProjectionLineColor(color)
        view.SetFilterOverrides(pf.Id, ogs)
    return view
