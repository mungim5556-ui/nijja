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
    StorageType, Options, Solid, GeometryInstance,
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

OUT_PARAMS = [  # 이름, 숫자 여부. RC_비용차는 예전 Python 엔진 결과(CSV 적용 버튼이 계속 쓴다)
    (u"RC_성상", False), (u"RC_톤", True), (u"RC_처리", False), (u"RC_재활용", False), (u"RC_비용차", True),
    (u"RC_처리비", True), (u"RC_매각", True),
]
IN_PARAMS = [(u"RC_시공성", True), (u"RC_유해물질", False)]
HAZARD_TEXT = {u"석면 의심": "suspected", u"석면 확인": "confirmed", u"suspected": "suspected", u"confirmed": "confirmed"}


def element_id(n):
    """정수 → ElementId. Revit 2024+는 Int64 생성자가 있어 IronPython이 int만으로는 오버로드를 못 고른다."""
    try:
        from System import Int64
        return ElementId(Int64(int(n)))
    except Exception:
        return ElementId(int(n))


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


# 재료가 지정되지 않은 부재의 기본 재료 (도면·해체계획서 확인 전 가정)
# 재료를 알 수 없을 때의 범주 기본재료 (웹 IFC와 공통, catalog.js → rates.json)
CATEGORY_DEFAULT = E.RATES.get("categoryDefault") or {"wall": "rc", "floor": "rc", "roof": "rc", "column": "rc", "beam": "rc", "foundation": "rc", "stair": "rc", "ceiling": "gypsum"}


def _solid_volume(el):
    """형상에서 솔리드 부피 합 (ft³). DirectShape나 재료 물량이 없는 부재용."""
    total = [0.0]

    def walk(geo):
        if geo is None:
            return
        for g in geo:
            if isinstance(g, Solid):
                try:
                    total[0] += abs(g.Volume)
                except Exception:
                    pass
            elif isinstance(g, GeometryInstance):
                walk(g.GetInstanceGeometry())

    try:
        walk(el.get_Geometry(Options()))
    except Exception:
        pass
    return total[0]


def _element_volume(el):
    """부재 부피 (m³): 매개변수 → 형상 순으로 읽는다."""
    for bip in (BuiltInParameter.HOST_VOLUME_COMPUTED,):
        try:
            p = el.get_Parameter(bip)
        except Exception:
            p = None
        if p and p.HasValue and p.AsDouble() > 0:
            return p.AsDouble() * FT3
    return _solid_volume(el) * FT3


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
                    key = CATEGORY_DEFAULT.get(cat)
                if key:
                    tons[key] = tons.get(key, 0) + vol * E.RATES["materials"][key]["density"]
            # 재료가 없거나 재료 물량이 0이면 부재 부피 × (지정 재료 또는 범주 기본 재료)
            fallback = False
            if not tons and cat not in ("window", "door"):
                vol = _element_volume(el)
                key = None
                for mid in mids:
                    mat = doc.GetElement(mid)
                    key = E.classify_material(mat.Name if mat else "", extra=mapping)
                    if key:
                        break
                key = key or CATEGORY_DEFAULT.get(cat)
                if vol > 0 and key:
                    tons[key] = vol * E.RATES["materials"][key]["density"]
                    fallback = True
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
                "name": el.Name, "level": _level_name(doc, el), "fallback": fallback,
            })
    return items, unknown, gfa


# ---------- 물량만 읽기 (비용은 결과 서버가 공법 비교 엔진으로 계산) ----------

def _levels(doc):
    from Autodesk.Revit.DB import Level
    return [{"name": l.Name, "elevation": l.Elevation * FT} for l in FilteredElementCollector(doc).OfClass(Level)]


def _level_of(doc, el, levels):
    """부재의 기준 레벨 이름. 레벨 매개변수가 없으면 형상 바닥 높이 아래의 가장 가까운 레벨."""
    names = []
    lid = getattr(el, "LevelId", None)
    if lid and lid != ElementId.InvalidElementId:
        names.append(lid)
    for bip_name in ("FAMILY_BASE_LEVEL_PARAM", "INSTANCE_REFERENCE_LEVEL_PARAM", "WALL_BASE_CONSTRAINT", "STAIRS_BASE_LEVEL_PARAM", "SCHEDULE_LEVEL_PARAM"):
        bip = getattr(BuiltInParameter, bip_name, None)
        if bip is None:
            continue
        try:
            p = el.get_Parameter(bip)
        except Exception:
            p = None
        if p and p.HasValue:
            try:
                names.append(p.AsElementId())
            except Exception:
                pass
    for i in names:
        if i and i != ElementId.InvalidElementId:
            lv = doc.GetElement(i)
            if lv is not None and hasattr(lv, "Elevation"):
                return lv.Name
    bb = el.get_BoundingBox(None)
    if bb and levels:
        z = bb.Min.Z * FT + 0.05
        below = [l for l in levels if l["elevation"] <= z]
        pick = max(below, key=lambda l: l["elevation"]) if below else min(levels, key=lambda l: l["elevation"])
        return pick["name"]
    return None


def _global_id(el):
    try:
        p = el.get_Parameter(BuiltInParameter.IFC_GUID)
        if p and p.HasValue and p.AsString():
            return p.AsString()
    except Exception:
        pass
    return el.UniqueId or u""


def collect_raw(doc):
    """모델 → (부재 원자료 목록, 레벨 목록). reclaim_quantities.build_bundle의 입력.

    재료 이름과 재료별 부피를 그대로 넘긴다 (분류·톤 환산은 서버의 공법 비교 엔진이 한다).
    재료 물량이 없는 부재는 재료 이름만(부피 0) 넘기고 부재 부피를 쓴다."""
    levels = _levels(doc)
    raw = []
    seen = set()
    for bic, cat in CATEGORIES:
        for el in FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType():
            eid = el.Id.IntegerValue if hasattr(el.Id, "IntegerValue") else el.Id.Value
            if eid in seen:
                continue
            seen.add(eid)
            try:
                mids = list(el.GetMaterialIds(False))
            except Exception:
                mids = []
            layers, total = [], 0.0
            for mid in mids:
                mat = doc.GetElement(mid)
                try:
                    vol = el.GetMaterialVolume(mid) * FT3
                except Exception:
                    vol = 0.0
                layers.append({"name": mat.Name if mat else u"", "category": (getattr(mat, "MaterialClass", u"") or u"") if mat else u"",
                               "thickness": max(vol, 0.0)})
                total += max(vol, 0.0)
            volume = total if total > 0 else _element_volume(el)
            joined = False
            if volume <= 0:
                # 결합(join)된 벽·기둥에 완전히 깎이면 부피가 0이 된다. 그 콘크리트는 상대 부재 부피에 이미 들어 있으므로
                # 길이×단면으로 되살리지 않는다 (중복 계상). 안내만 한다.
                try:
                    from Autodesk.Revit.DB import JoinGeometryUtils
                    joined = JoinGeometryUtils.GetJoinedElements(doc, el).Count > 0
                except Exception:
                    joined = False
            if cat in ("window", "door"):
                area = _opening_area(doc, el)
            elif cat in STRUCTURAL:
                area = 0.0
            else:
                area = _host_area(el)
            bb = el.get_BoundingBox(None)
            raw.append({
                "globalId": _global_id(el), "tag": eid, "name": el.Name, "category": cat,
                "level": _level_of(doc, el, levels), "volume": volume, "area": area, "layers": layers,
                "top": bb.Max.Z * FT if bb else None, "joined": joined,
            })
    return raw, levels


def write_rows(doc, rows):
    """서버 결과(reclaim_quantities.param_rows) → 부재마다 RC_* 매개변수 (트랜잭션 안에서 호출). 쓴 부재 수를 돌려준다."""
    n = 0
    for tag, v in rows.items():
        el = doc.GetElement(element_id(tag))
        if el is None:
            continue
        set_param(el, u"RC_성상", v["waste"])
        set_param(el, u"RC_톤", round(v["tons"], 3))
        set_param(el, u"RC_처리", method_label(v["method"]))
        set_param(el, u"RC_재활용", u"예" if v["method"] == "selective" else u"아니오")
        set_param(el, u"RC_처리비", round(v["disposal"]))
        set_param(el, u"RC_매각", round(v["revenue"]))
        n += 1
    return n


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
