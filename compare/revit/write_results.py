# -*- coding: utf-8 -*-
# pyRevit에서 결과를 부재에 기록하고 해체 경제성 비교 시트를 만든다.
# Revit 밖에서는 CSV·JSON 및 시트 문구의 셀프체크를 실행한다.
#
# 준비: 같은 폴더의 ReClaim_SharedParams.txt 를 쓴다 (스크립트가 자동으로 연결한다).
# 처음 쓸 때는 모델 사본에서 실행해 본다.
import io
import json
import re
import os
import base64
import tempfile
from collections import Counter
from math import ceil, isinf, isnan
from uuid import uuid4
from xml.sax.saxutils import escape

TEXT = ("RC_Waste", "RC_Method")
NUMBER = ("RC_Tons", "RC_DisposalCost", "RC_Revenue")
RUN_PARAMETER = "RC_ResultRun"
CRUSH_METHOD = "RC_CrushMethod"
CRUSH_DISPOSAL = "RC_CrushDisposalCost"
CRUSH_REVENUE = "RC_CrushRevenue"
CRUSH_NUMBER = (CRUSH_DISPOSAL, CRUSH_REVENUE)
SHEET_NUMBER = "RC-01"
SHEET_NAME = u"해체 경제성 비교"
VIEW_NAME = u"ReClaim - 해체 대상 3D"
SCHEDULE_NAME = u"ReClaim - 폐기물 성상별 집계 (전면 분별)"
DETAIL_NAME = u"ReClaim - 부재별 해체 결과 (전면 분별)"
SIMULATION_LABEL = u"설정 범위에서 분별 순비용이 낮은 시행 비율"
METHOD_LABEL = {"selective": u"전면 분별", "crush": u"일괄 압쇄", "tie": u"동일"}


def read_export_text(path):
    try:
        from System.IO import File
    except ImportError:
        with io.open(path, "r", encoding="utf-8-sig") as export:
            return export.read()
    # IronPython's io decoder can split a UTF-8 character across buffers.
    # Revit's .NET reader handles UTF-8, with or without a BOM.
    return File.ReadAllText(path)


def read_rows(path):
    """CSV → [{ElementId, RC_Waste, ...}]. 따옴표 없는 단순 CSV, BOM 허용."""
    lines = [line.strip() for line in read_export_text(path).splitlines() if line.strip()]
    head = lines[0].split(",")
    rows = []
    for line in lines[1:]:
        r = dict(zip(head, line.split(",")))
        for k in NUMBER:
            r[k] = float(r[k])
        rows.append(r)
    return rows


try:
    TEXT_TYPE = basestring  # IronPython 2: JSON strings may be str or unicode.
except NameError:
    TEXT_TYPE = str


def read_revit_export(path):
    payload = json.loads(read_export_text(path))
    if not isinstance(payload, dict) or payload.get("schema") != "reclaim-revit-v1":
        raise ValueError("Invalid ReClaim export schema")
    summary, rows = payload["summary"], payload["elements"]
    if not isinstance(rows, list) or not rows or not summary["source"]:
        raise ValueError("Missing ReClaim model or element results")
    for row in rows:
        if not all(isinstance(row[key], TEXT_TYPE) for key in ("ElementId", "Category") + TEXT):
            raise ValueError("Invalid ReClaim element fields")
        for key in NUMBER + CRUSH_NUMBER:
            if key not in row:
                continue   # 이전 버전 결과 파일에는 압쇄 부재별 금액이 없다
            value = float(row[key])
            if isinf(value) or isnan(value):
                raise ValueError("Invalid ReClaim numeric value")
            row[key] = value
    summary = dict(summary, scenario_costs=payload.get("scenario_costs", {}),
                   cost_chart_png=payload.get("cost_chart_png"),
                   unattributed=payload.get("unattributed"),
                   crush_amounts=all(CRUSH_DISPOSAL in r for r in rows if r.get("Category") != "adjustment"))
    return summary, rows


def summary_text(s):
    """요약 JSON → 프로젝트 정보에 넣을 한 줄."""
    return u"{} · 압쇄 {:,}원 / 분별 {:,}원 / 차이 {:,}원 / {} {} / 공법 권장 {}".format(
        comparison_heading(s), s["crush_total_won"], s["selective_total_won"], s["delta_won"],
        SIMULATION_LABEL, selective_share(s), comparison_result(s))


def comparison_review(s):
    review = s.get("comparison_review")
    if isinstance(review, list):
        return [item for item in review if isinstance(item, TEXT_TYPE) and item]
    # 이전 결과 파일에서도 이미 기록된 누락을 비교 범위에 반영한다.
    review = []
    if s.get("unpriced_concrete_cut"):
        review.append(u"콘크리트 절단·인양 견적 미입력")
    if any((s.get("unpriced_disposal") or {}).values()):
        review.append(u"일부 품목의 처리 견적 미입력")
    if ((s.get("steel_dismantling") or {}).get("applied") or {}).get("excluded"):
        review.append(u"철골 절단·인양비 미산정")
    transport = s.get("transport_input")
    if transport and any(value is None for value in transport.values()):
        review.append(u"운반비 비교 제외")
    if any(item.get("unverified") for item in (s.get("finish_takeoff") or {}).values()):
        review.append(u"미확인 마감재 물량")
    if s.get("plan_waste_reference"):
        review.append(u"계획서의 폐기물 물량과 별도 공종 검토 필요")
    if (s.get("plan_example") or {}).get("asbestos_cost_excluded"):
        review.append(u"석면 해체·처리비 별도")
    return review


def comparison_heading(s):
    return u"포함 비용 소계" if s.get("basis") or comparison_review(s) else u"순비용 비교"


def selective_share(s):
    value = s.get("p_selective_cheaper")
    return u"미산정" if value is None else u"{:.1%}".format(float(value))


def recommended_method(s):
    if s.get("basis") or comparison_review(s):
        return u"판정 보류"
    return METHOD_LABEL.get(s.get("recommended"), u"판정 보류")


def included_cost_result(s):
    method = METHOD_LABEL.get(s.get("included_cost_result", s.get("recommended")))
    if method == u"동일":
        return method
    return method + u" 낮음" if method else None


def comparison_result(s):
    recommended = recommended_method(s)
    included = included_cost_result(s)
    if included and (s.get("basis") or comparison_review(s)):
        return recommended + u" · 소계에서 " + included
    return recommended


def sheet_text(s, done, missing):
    area = s.get("area_m2")
    area_text = u"{:,.1f} ㎡".format(area) if area else u"미입력"
    lines = [u"", u"부재 결과 · {}개 기록 / {}개 매칭 또는 기록 실패".format(done, missing),
             u"부재별 결과는 RC-02 전면 분별과 RC-03 일괄 압쇄 시트에서 확인할 수 있습니다."]
    scope = s.get("comparison_scope")
    if scope:
        lines.append(u"해체 범위 · " + scope)
    schedule = (s.get("schedule_basis") or {}).get("label")
    if schedule:
        lines.append(u"공기 근거 · " + schedule)
    lines.extend(u"확인 필요 · " + reason for reason in comparison_review(s))
    return u"\n".join((
        SHEET_NAME,
        u"대상 {} / 연면적 {}".format(s.get("source") or u"IFC 모델", area_text),
        comparison_heading(s),
        u"압쇄해체 순비용    {:,} 원".format(s["crush_total_won"]),
        u"분별해체 순비용    {:,} 원".format(s["selective_total_won"]),
        u"순비용 차이(분별 − 압쇄)    {:+,} 원".format(s["delta_won"]),
        SIMULATION_LABEL + u"    " + selective_share(s),
        u"공법 권장    {}".format(comparison_result(s)),
    ) + tuple(lines))


def numeric_element_id(value, max_id):
    if not re.match(r"[0-9]+\Z", value):
        return None
    digits = value.lstrip("0")
    if not digits or len(digits) > 19:
        return None
    number = int(digits)
    return number if number <= max_id else None


def make_schedule(DB, doc, name, parameters, run_id, grouped):
    view = next((v for v in DB.FilteredElementCollector(doc).OfClass(DB.ViewSchedule)
                 if v.Name == name and not v.IsTemplate), None)
    if view is None:
        view = DB.ViewSchedule.CreateSchedule(doc, DB.ElementId.InvalidElementId)
        view.Name = name
    definition = view.Definition
    # Repair schedules created with the shared fields interpreted as Project Information.
    instance_ids = {definition.GetField(fid).ParameterId for fid in definition.GetFieldOrder()
                    if definition.GetField(fid).FieldType == DB.ScheduleFieldType.Instance}
    if not set(parameters.values()).issubset(instance_ids):
        definition.ClearFields()
        fields = {field.ParameterId: field for field in definition.GetSchedulableFields()
                  if field.FieldType == DB.ScheduleFieldType.Instance}
        columns = (
            ("RC_Waste", u"폐기물 성상", 0.23), ("RC_Method", u"부재 처리 방식", 0.17),
            ("RC_Tons", u"중량(t)", 0.19), ("RC_DisposalCost", u"처리비(원)", 0.24),
            ("RC_Revenue", u"매각수익(원)", 0.24), (RUN_PARAMETER, u"결과 ID", 0.16),
        )
        if not grouped:
            for key, heading, width in ((DB.BuiltInParameter.ELEM_CATEGORY_PARAM, u"범주", 0.23),
                                        (DB.BuiltInParameter.ELEM_FAMILY_AND_TYPE_PARAM, u"패밀리 및 유형", 0.38)):
                sid = DB.ElementId(key)
                if sid in fields:
                    field = definition.AddField(fields[sid])
                    field.ColumnHeading = heading
                    field.SheetColumnWidth = width
            definition.IsItemized = True
        else:
            definition.IsItemized = False
            definition.ShowGrandTotal = True
            definition.ShowGrandTotalCount = False
            definition.ShowGrandTotalTitle = True
            definition.GrandTotalTitle = u"합계"
        for key, heading, width in columns:
            if key not in parameters:
                continue
            field = definition.AddField(fields[parameters[key]])
            field.ColumnHeading = heading
            field.SheetColumnWidth = width
            field.IsHidden = key == RUN_PARAMETER
            if key in TEXT:
                definition.AddSortGroupField(DB.ScheduleSortGroupField(field.FieldId))
            if grouped and key in NUMBER:
                field.DisplayType = DB.ScheduleFieldDisplayType.Totals

    for fid in definition.GetFieldOrder():
        field = definition.GetField(fid)
        if field.ParameterId in (parameters.get("RC_DisposalCost"), parameters.get("RC_Revenue")):
            fmt = DB.FormatOptions(DB.UnitTypeId.Fixed)
            fmt.Accuracy = 1
            fmt.UseDigitGrouping = True
            field.SetFormatOptions(fmt)
            field.HorizontalAlignment = DB.ScheduleHorizontalAlignment.Right
        elif field.ParameterId == parameters["RC_Tons"]:
            field.HorizontalAlignment = DB.ScheduleHorizontalAlignment.Right
    run_field = next(definition.GetField(fid) for fid in definition.GetFieldOrder()
                     if definition.GetField(fid).ParameterId == parameters[RUN_PARAMETER])
    run_filter = DB.ScheduleFilter(run_field.FieldId, DB.ScheduleFilterType.Equal, run_id)
    index = next((idx for idx, flt in enumerate(definition.GetFilters())
                  if flt.FieldId == run_field.FieldId), None)
    if index is None:
        definition.AddFilter(run_filter)
    else:
        definition.SetFilter(index, run_filter)
    return view


def get_reclaim_sheet(DB, doc, number_prefix, name, legacy_name=None):
    sheet = next((v for v in DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet)
                  if v.SheetNumber == number_prefix and v.Name in (name, legacy_name)), None)
    if sheet is None:
        used_numbers = {v.SheetNumber for v in DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet)}
        sheet = next((v for v in DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet)
                      if v.Name in (name, legacy_name) and v.SheetNumber.startswith(number_prefix + "-")), None)
        if sheet is None:
            sheet = DB.ViewSheet.Create(doc, DB.ElementId.InvalidElementId)
            number = number_prefix
            suffix = 2
            while number in used_numbers:
                number = "{}-{}".format(number_prefix, suffix)
                suffix += 1
            sheet.SheetNumber = number
    sheet.Name = name

    return sheet


TITLE_BLOCK_LOGO = (
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMU"
    "FRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU"
    "FBQUFBQUFBT/wAARCADKAOgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF"
    "BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW"
    "V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi"
    "4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAEC"
    "AxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm"
    "Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq"
    "8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9SlxjA4ApcZPuaUHB6cUHpkCshjSMt64/SjqOad7HihBkc+vFAC4yfSgYI49aAcfjQeB1"
    "AFAg445/CkYH/JoBG7pwP1pT+tMAPQ0ZwvtTR05peSD6UgFDA4A/Shs4xmlBx6YpoO4kZ+tMAwCOnWjkkmgkYwMk4peehwBSGJjJ"
    "9MUcZz618++N/wBozX/DH7Vnhb4XW+labNomrQRSy3svmfaULLMSFw23/lkOo7mvoPHJroq0J0VFz+0rr0OaliKddzUPsuz9Rpz7"
    "07HfvSMeRQvJP865zoEbkjngUpXApH5PFOPXigBm44JIpBkAHGKcRlRmgnnA5zQMYxBOKMYBPU0oXH16kmg5J9eOlIBnLc+tCjaf"
    "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"
)


TITLE_BAND = 0.28         # 하단 표제란 높이 (ft)
GAP = 0.025
COLUMN_GAP = 0.14
COLUMN_HEIGHT = 1.35      # 이보다 길면 옆 열로 넘긴다
MAX_COLUMNS = 4
ORIGIN = (0.09, 0.99)     # 첫 열의 왼쪽 위


def column_count(total_height):
    return max(1, int(ceil(total_height / COLUMN_HEIGHT)))


def existing_method_pages(DB, doc, number, name):
    pattern = re.compile(r"^" + re.escape(number) + r"(?:-\d+)?(?:\((\d+)/(\d+)\))?$")
    pages = []
    for sheet in DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet):
        match = pattern.match(sheet.SheetNumber)
        if match and sheet.Name == name:
            pages.append((int(match.group(1) or 1), sheet))
    return [sheet for index, sheet in sorted(pages, key=lambda item: item[0])]


def schedule_width(schedule):
    widths = {u"범주": 0.13, u"패밀리 및 유형": 0.32, u"폐기물 성상": 0.14,
              u"부재 처리 방식": 0.15, u"중량(t)": 0.13, u"처리비(원)": 0.16,
              u"매각수익(원)": 0.16}
    for field_id in schedule.Definition.GetFieldOrder():
        field = schedule.Definition.GetField(field_id)
        if field.ColumnHeading in widths:
            field.SheetColumnWidth = widths[field.ColumnHeading]


def place_schedule_columns(DB, doc, number, name, schedule):
    pages = existing_method_pages(DB, doc, number, name)
    if not pages:
        pages.append(get_reclaim_sheet(DB, doc, number, name))
    sheet = pages[0]
    base = sheet.SheetNumber.split("(")[0]
    schedule_width(schedule)
    for instance in DB.FilteredElementCollector(doc).OfClass(DB.ScheduleSheetInstance).ToElements():
        if instance.ScheduleId == schedule.Id:
            doc.Delete(instance.Id)
    for index in range(schedule.GetSegmentCount() - 1, 0, -1):
        schedule.MergeSegments(index, index - 1)
    doc.Regenerate()
    origin = DB.XYZ(ORIGIN[0], ORIGIN[1], 0)
    whole = DB.ScheduleSheetInstance.Create(doc, sheet.Id, schedule.Id, origin)
    doc.Regenerate()
    box = whole.get_BoundingBox(sheet)
    columns = column_count(box.Max.Y - box.Min.Y)
    width = box.Max.X - box.Min.X
    if columns > 1:
        doc.Delete(whole.Id)
        doc.Regenerate()
        schedule.Split(columns)
        doc.Regenerate()
        columns = schedule.GetSegmentCount()

    count = (columns + MAX_COLUMNS - 1) // MAX_COLUMNS
    for old in pages[count:]:
        doc.Delete(old.Id)
    pages = pages[:count]
    while len(pages) < count:
        page = DB.ViewSheet.Create(doc, DB.ElementId.InvalidElementId)
        page.Name = name
        pages.append(page)
    groups = []
    for index, page in enumerate(pages):
        page.SheetNumber = base if count == 1 else "{}({}/{})".format(base, index + 1, count)
        groups.append((page, []))
    if columns == 1:
        groups[0][1].append(whole)
    else:
        for segment in range(columns):
            page_index, column = divmod(segment, MAX_COLUMNS)
            page, instances = groups[page_index]
            point = DB.XYZ(ORIGIN[0] + column * (width + COLUMN_GAP), ORIGIN[1], 0)
            instances.append(DB.ScheduleSheetInstance.Create(doc, page.Id, schedule.Id, point, segment))
    return groups


class SheetGrid(object):
    def __init__(self, DB, doc, sheet, prefix):
        self.DB, self.doc, self.sheet, self.prefix = DB, doc, sheet, prefix
        self.types = {DB.Element.Name.GetValue(t): t for t in
                      DB.FilteredElementCollector(doc).OfClass(DB.TextNoteType)}
        lines = doc.Settings.Categories.get_Item(DB.BuiltInCategory.OST_Lines)
        category = next((c for c in lines.SubCategories if c.Name == prefix), None)
        if category is None:
            category = doc.Settings.Categories.NewSubcategory(lines, prefix)
        self.style = category.GetGraphicsStyle(DB.GraphicsStyleType.Projection)
        for curve in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.CurveElement).ToElements():
            if curve.LineStyle and curve.LineStyle.Id == self.style.Id:
                doc.Delete(curve.Id)
        for note in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.TextNote).ToElements():
            if DB.Element.Name.GetValue(doc.GetElement(note.GetTypeId())).startswith(prefix + " "):
                doc.Delete(note.Id)
        self.edges = set()

    def line(self, x1, y1, x2, y2):
        edge = tuple(round(n, 8) for n in (x1, y1, x2, y2))
        if edge not in self.edges:
            DB = self.DB
            curve = DB.Line.CreateBound(DB.XYZ(x1, y1, 0), DB.XYZ(x2, y2, 0))
            self.doc.Create.NewDetailCurve(self.sheet, curve).LineStyle = self.style
            self.edges.add(edge)

    def text(self, x, y, value, size, bold, width):
        DB = self.DB
        key = "{} {} {}".format(self.prefix, size, int(bold))
        if key not in self.types:
            default = self.doc.GetDefaultElementTypeId(DB.ElementTypeGroup.TextNoteType)
            style = self.doc.GetElement(default).Duplicate(key)
            style.get_Parameter(DB.BuiltInParameter.TEXT_SIZE).Set(size / 304.8)
            style.get_Parameter(DB.BuiltInParameter.TEXT_STYLE_BOLD).Set(int(bold))
            self.types[key] = style
        return DB.TextNote.Create(self.doc, self.sheet.Id, DB.XYZ(x, y, 0), width,
                                  value, DB.TextNoteOptions(self.types[key].Id))

    def row(self, left, right, top, cells, height=0.10):
        bottom = top - height
        self.line(left, top, right, top)
        self.line(left, bottom, right, bottom)
        self.line(left, bottom, left, top)
        for end, value, size, bold in cells:
            self.text(left + 0.018, top - 0.014, value, size, bold, end - left - 0.036)
            self.line(end, bottom, end, top)
            left = end


def make_method_sheet(DB, doc, number, name, schedule, data, costs):
    pages = place_schedule_columns(DB, doc, number, name, schedule)
    for sheet, instances in pages:
        draw_method_page(DB, doc, sheet, number, name, instances, data, costs)
    return [sheet.SheetNumber for sheet, instances in pages]


def draw_method_page(DB, doc, sheet, number, name, instances, data, costs):
    doc.Regenerate()
    boxes = [i.get_BoundingBox(sheet) for i in instances]
    left = min(b.Min.X for b in boxes)
    right = max(b.Max.X for b in boxes)
    top = max(b.Max.Y for b in boxes) + GAP
    bottom = min(b.Min.Y for b in boxes) - GAP
    for note in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.TextNote).ToElements():
        if (note.Text.startswith(name + u"\r") or note.Text.startswith(name + u"\n")
                or note.Text.startswith(u"최종 합계 (건물 전체 순비용)")):
            doc.Delete(note.Id)
    grid = SheetGrid(DB, doc, sheet, "ReClaim Method")
    middle = (left + right) / 2
    grid.row(left, right, top + 0.49, [(right, name, 10, True)], 0.11)
    grid.row(left, right, top + 0.38, [(left + 0.32, u"대상 IFC", 5, True),
                                       (right, data["source"], 6, False)])
    amounts = [u"{:,}원".format(costs[key]) if costs else u"자료 없음" for key in ("disposal", "revenue")]
    grid.row(left, right, top + 0.28, [(middle, u"건물 전체 처리비", 5, True),
                                       (right, u"건물 전체 매각수익", 5, True)], 0.08)
    grid.row(left, right, top + 0.20, [(middle, amounts[0], 9, True),
                                       (right, amounts[1], 9, True)])
    scope = (u"전면 분별 시나리오에서도 콘크리트 구조체 등은 압쇄 처리할 수 있습니다."
             if number == "RC-02" else u"일괄 압쇄의 마감재 처리비에는 입력 조건에 따른 선철거와 반출 경로를 반영합니다.")
    grid.row(left, right, top + 0.10, [(right, scope, 5.5, False)])
    net = data["selective_total_won" if number == "RC-02" else "crush_total_won"]
    # 표 아래로 차례로 쌓는다: (미산정 안내) → (부재 미귀속) → 최종 합계
    if number == "RC-03" and not data.get("crush_amounts"):
        grid.row(left, right, bottom, [(right, u"부재별 처리비·매각수익: 미산정 (사이트에서 결과 파일을 다시 받으면 채워집니다)", 5.5, False)])
        bottom -= 0.10
    unattributed = (data.get("unattributed") or {}).get("selective" if number == "RC-02" else "crush")
    if unattributed:
        grid.row(left, right, bottom, [(middle, u"부재 미귀속 처리비 · 매각수익 (부재별 소계 + 미귀속 = 건물 전체)", 5, True),
                                       (right, u"처리비 {:,}원 · 매각수익 {:,}원".format(
                                           int(unattributed["disposal"]), int(unattributed["revenue"])), 6, False)])
        bottom -= 0.10
    net_label = (u"포함 범위의 순비용 소계 · RC-01 확인 사항 참조"
                 if data.get("basis") or comparison_review(data) else u"건물 전체 순비용")
    grid.row(left, right, bottom, [(middle, net_label, 7, True),
                                   (right, u"{:,}원".format(net), 10, True)], 0.12)
    draw_sheet_border(DB, doc, sheet, data)
    return sheet


def place_cost_chart(DB, doc, sheet, payload):
    if not payload:
        return
    if len(payload) > 3000000:
        raise ValueError("ReClaim chart is too large")
    png = base64.b64decode(payload)
    if not png.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("ReClaim chart must be PNG")
    place_sheet_image(DB, doc, sheet, png, "ReClaim_CostChart_", ".png",
                      DB.XYZ(1.00, 0.365, 0), 1.72)


def place_sheet_image(DB, doc, sheet, content, prefix, extension, point, width):
    previous = [im.Id for im in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.ImageInstance)
                if DB.Element.Name.GetValue(doc.GetElement(im.GetTypeId())).startswith(prefix)]
    path = os.path.join(tempfile.gettempdir(), prefix + uuid4().hex + extension)
    try:
        with open(path, "wb") as output:
            output.write(content)
        options = DB.ImageTypeOptions(path, False, DB.ImageTypeSource.Import)
        image_type = DB.ImageType.Create(doc, options)
        position = DB.ImagePlacementOptions(point, DB.BoxPlacement.Center)
        image = DB.ImageInstance.Create(doc, sheet, image_type.Id, position)
        image.LockProportions = True
        image.Width = width
        for old_id in previous:
            doc.Delete(old_id)
    finally:
        if os.path.isfile(path):
            os.remove(path)


def draw_sheet_border(DB, doc, sheet, data, frame=None):
    name = "ReClaim Sheet Border"
    lines = doc.Settings.Categories.get_Item(DB.BuiltInCategory.OST_Lines)
    category = next((item for item in lines.SubCategories if item.Name == name), None)
    if category is None:
        category = doc.Settings.Categories.NewSubcategory(lines, name)
        category.SetLineWeight(4, DB.GraphicsStyleType.Projection)
    style = category.GetGraphicsStyle(DB.GraphicsStyleType.Projection)
    curves = DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.CurveElement)
    old_ids = [curve.Id for curve in curves
               if curve.LineStyle is not None and curve.LineStyle.Id == style.Id]
    for element_id in old_ids:
        doc.Delete(element_id)

    block = SheetGrid(DB, doc, sheet, "ReClaim Cartouche")
    title_style_name = "ReClaim Title Block"
    title_style = next((item for item in DB.FilteredElementCollector(doc).OfClass(DB.TextNoteType)
                        if DB.Element.Name.GetValue(item) == title_style_name), None)
    if title_style is None:
        default_type = doc.GetDefaultElementTypeId(DB.ElementTypeGroup.TextNoteType)
        title_style = doc.GetElement(default_type).Duplicate(title_style_name)
        title_style.get_Parameter(DB.BuiltInParameter.TEXT_SIZE).Set(4.5 / 304.8)
    for note in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.TextNote).ToElements():
        if note.GetTypeId() == title_style.Id:
            doc.Delete(note.Id)

    doc.Regenerate()
    from System import DateTime
    if frame is not None:
        left, right, top, bottom = frame["left"], frame["right"], frame["top"], frame["bottom"]
        band_top = bottom + TITLE_BAND
    else:
        boxes = []
        for element_type in (DB.TextNote, DB.Viewport, DB.ImageInstance, DB.ScheduleSheetInstance, DB.CurveElement):
            for element in DB.FilteredElementCollector(doc, sheet.Id).OfClass(element_type):
                if element.OwnerViewId != sheet.Id:
                    continue
                if isinstance(element, DB.ImageInstance) and DB.Element.Name.GetValue(doc.GetElement(element.GetTypeId())).startswith("ReClaim_TitleLogo_"):
                    continue
                box = element.get_BoundingBox(sheet)
                if box is not None:
                    boxes.append(box)
        if not boxes:
            return
        margin = 0.045
        left = min(box.Min.X for box in boxes) - margin
        right = max(box.Max.X for box in boxes) + margin
        top = max(box.Max.Y for box in boxes) + margin
        band_top = min(box.Min.Y for box in boxes) - margin
    portrait = sheet.SheetNumber == "RC-01" or sheet.SheetNumber.startswith("RC-01-")
    if frame is None:
        ratio = 594.0 / 841.0 if portrait else 841.0 / 594.0
        bottom = band_top - TITLE_BAND
        width, height = right - left, top - bottom
        if width < height * ratio:
            extra = (height * ratio - width) / 2
            left -= extra
            right += extra
        else:
            extra = width / ratio - height
            top += extra / 2
            band_top -= extra / 2
            bottom -= extra / 2

    def rule(x1, y1, x2, y2):
        line = DB.Line.CreateBound(DB.XYZ(x1, y1, 0), DB.XYZ(x2, y2, 0))
        doc.Create.NewDetailCurve(sheet, line).LineStyle = style

    for inset in (0, 0.023):
        x1, x2, y1, y2 = left - inset, right + inset, bottom - inset, top + inset
        rule(x1, y1, x2, y1)
        rule(x2, y1, x2, y2)
        rule(x2, y2, x1, y2)
        rule(x1, y2, x1, y1)

    width = right - left
    logo_end, project_end, code_start = left + width * 0.33, left + width * 0.63, right - width * 0.13
    rule(left, band_top, right, band_top)
    for x in (logo_end, project_end, code_start):
        rule(x, bottom, x, band_top)

    heading = u"경제성 비교" if portrait else u"전면 분별" if sheet.SheetNumber.startswith("RC-02") else u"일괄 압쇄"
    source = os.path.splitext(os.path.basename(data.get("source") or ""))[0] or doc.Title
    split = band_top - 0.18
    label_bottom = band_top - 0.08
    rule(left, split, logo_end, split)
    rule(project_end, split, code_start, split)
    rule(project_end, label_bottom, code_start, label_bottom)
    def entry(x, end, y, value, size, bold=False):
        return block.text(x + 0.014, y - 0.012, value, size, bold, end - x - 0.028)
    place_sheet_image(DB, doc, sheet, base64.b64decode(TITLE_BLOCK_LOGO), "ReClaim_TitleLogo_", ".jpg",
                      DB.XYZ((left + logo_end) / 2, band_top - 0.09, 0), 0.18)
    entry(left, logo_end, split, u"https://mungim5556-ui.github.io/reclaim-compare/", 4)
    entry(logo_end, project_end, band_top, u"프로젝트 이름", 5)
    name_note = entry(logo_end, project_end, band_top - 0.06, source, 8, True)
    center_note(DB, doc, sheet, name_note, (logo_end + project_end) / 2, (band_top - 0.05 + bottom) / 2)
    entry(project_end, code_start, band_top, heading, 7, True)
    entry(project_end, code_start, label_bottom,
          u"생성 일시 (KST)  " + DateTime.UtcNow.AddHours(9).ToString("yyyy-MM-dd HH:mm:ss"), 5)
    entry(project_end, code_start, split, u"소유자", 5)
    entry(code_start, right, band_top - 0.075, sheet.SheetNumber, 9, True)


def center_note(DB, doc, sheet, note, x, y):
    """글상자 안에서 가운데 정렬하고, 상자 중심을 (x, y)에 맞춘다."""
    note.HorizontalAlignment = DB.HorizontalTextAlignment.Center
    doc.Regenerate()
    box = note.get_BoundingBox(sheet)
    if box is None:
        return
    offset = DB.XYZ(x - (box.Min.X + box.Max.X) / 2, y - (box.Min.Y + box.Max.Y) / 2, 0)
    DB.ElementTransformUtils.MoveElement(doc, note.Id, offset)


def draw_comparison_layout(DB, doc, sheet, data, done, missing):
    prefix = "ReClaim RC01 "
    line_name = prefix + "rules"
    lines = doc.Settings.Categories.get_Item(DB.BuiltInCategory.OST_Lines)
    category = next((item for item in lines.SubCategories if item.Name == line_name), None)
    if category is None:
        category = doc.Settings.Categories.NewSubcategory(lines, line_name)
        category.LineColor = DB.Color(110, 132, 155)
    line_style = category.GetGraphicsStyle(DB.GraphicsStyleType.Projection)
    old_notes = [note.Id for note in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.TextNote)
                 if DB.Element.Name.GetValue(doc.GetElement(note.GetTypeId())).startswith(prefix)
                 or note.Text.startswith(SHEET_NAME + u"\r")
                 or note.Text.startswith(SHEET_NAME + u"\n")
                 or note.Text.strip() == u"두 공법의 순비용 비교"]
    old_rules = [curve.Id for curve in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.CurveElement)
                 if curve.LineStyle is not None and curve.LineStyle.Id == line_style.Id]
    for element_id in old_notes + old_rules:
        doc.Delete(element_id)

    styles = {}
    for role, size, bold in (("Title", 10, True), ("Heading", 6, True), ("Body", 4.5, False),
                             ("Table", 7, False), ("Amount", 8, True)):
        name = prefix + role
        style = next((item for item in DB.FilteredElementCollector(doc).OfClass(DB.TextNoteType)
                      if DB.Element.Name.GetValue(item) == name), None)
        if style is None:
            default_id = doc.GetDefaultElementTypeId(DB.ElementTypeGroup.TextNoteType)
            style = doc.GetElement(default_id).Duplicate(name)
        style.get_Parameter(DB.BuiltInParameter.TEXT_SIZE).Set(size / 304.8)
        style.get_Parameter(DB.BuiltInParameter.TEXT_STYLE_BOLD).Set(int(bold))
        styles[role] = style.Id

    def rule(x1, y1, x2, y2):
        line = DB.Line.CreateBound(DB.XYZ(x1, y1, 0), DB.XYZ(x2, y2, 0))
        doc.Create.NewDetailCurve(sheet, line).LineStyle = line_style

    def frame(left, right, top, bottom, heading):
        rule(left, top, right, top)
        rule(left, bottom, right, bottom)
        rule(left, bottom, left, top)
        rule(right, bottom, right, top)
        rule(left, top - 0.09, right, top - 0.09)
        text(left + 0.035, top - 0.018, heading, "Heading")

    def text(x, y, value, role="Body", right=False):
        options = DB.TextNoteOptions(styles[role])
        if right:
            options.HorizontalAlignment = DB.HorizontalTextAlignment.Right
        DB.TextNote.Create(doc, sheet.Id, DB.XYZ(x, y, 0), value, options)

    text(0.135, 2.43, u"RC-01  해체 공법 경제성 비교", "Title")
    area = data.get("area_m2")
    area_text = u"{:,.1f} m\u00b2".format(float(area)) if area else u"미입력"
    text(0.135, 2.31, u"{}  ·  연면적 {}".format(data.get("source") or u"IFC 모델", area_text))
    if data.get("comparison_scope"):
        text(0.135, 2.275, u"해체 범위 · " + data["comparison_scope"])
    for y in (2.46, 2.34, 2.24):
        rule(0.10, y, 1.90, y)
    for x in (0.10, 1.90):
        rule(x, 2.24, x, 2.46)
    frame(0.10, 1.90, 2.21, 1.46, comparison_heading(data))
    frame(0.10, 1.90, 1.43, 0.71, u"해체 대상 3D")
    frame(0.10, 1.90, 0.68, 0.13, u"공법별 비용 구성")

    rows = (
        (u"항목", u"결과"),
        (u"일괄 압쇄", u"{:,}원".format(data["crush_total_won"])),
        (u"전면 분별", u"{:,}원".format(data["selective_total_won"])),
        (u"차액 (분별 − 압쇄)", u"{:+,}원".format(data["delta_won"])),
        (SIMULATION_LABEL, selective_share(data)),
        (u"공법 권장", comparison_result(data)),
    )
    for index, (label, value) in enumerate(rows):
        y = 2.12 - index * 0.087
        role = "Heading" if index in (0, 5) else "Body" if index == 4 else "Table"
        value_role = "Amount" if index in (1, 2, 3) else role
        text(0.135, y - 0.022, label, role)
        text(1.865, y - 0.022, value, value_role, right=True)
        rule(0.10, y - 0.087, 1.90, y - 0.087)
    rule(1.0, 2.12, 1.0, 2.12 - len(rows) * 0.087)
    text(0.135, 1.584, u"부재 {}개 기록 · 매칭 또는 기록 실패 {}개".format(done, missing))
    rule(0.10, 1.53, 1.90, 1.53)
    basis = (data.get("schedule_basis") or {}).get("label")
    text(0.135, 1.52, u"공기 근거 · " + basis if basis else u"부재별 결과는 RC-02 및 RC-03 참조")
    review = comparison_review(data)
    if data.get("basis") or review:
        if review:
            first = review[0].replace(u"\n", u" ")
            shown = first if len(first) <= 54 else first[:53] + u"…"
            notice = u"확인 사항 {}건 · {} · 전체는 실행 결과와 요약 JSON 참조".format(len(review), shown)
        else:
            notice = u"입력 조건의 소계"
        text(0.135, 0.105, notice)
    if not data.get("cost_chart_png"):
        text(0.135, 0.53, u"비용 그래프는 사이트에서 새로 받은 Revit용 결과에 포함됩니다.")


def make_comparison_sheet(DB, doc, data, parameters, run_id, done, missing):
    sheet = get_reclaim_sheet(DB, doc, SHEET_NUMBER, u"경제성 비교 · 일괄 압쇄 vs 전면 분별", SHEET_NAME)
    for instance in DB.FilteredElementCollector(doc, sheet.Id).OfClass(DB.ScheduleSheetInstance).ToElements():
        if doc.GetElement(instance.ScheduleId).Name == SCHEDULE_NAME:
            doc.Delete(instance.Id)

    draw_comparison_layout(DB, doc, sheet, data, done, missing)

    view = next((v for v in DB.FilteredElementCollector(doc).OfClass(DB.View3D)
                 if v.Name == VIEW_NAME and not v.IsTemplate), None)
    if view is None:
        view_type = next(t for t in DB.FilteredElementCollector(doc).OfClass(DB.ViewFamilyType)
                         if t.ViewFamily == DB.ViewFamily.ThreeDimensional)
        view = DB.View3D.CreateIsometric(doc, view_type.Id)
        view.Name = VIEW_NAME
    level_category = DB.ElementId(DB.BuiltInCategory.OST_Levels)
    if view.CanCategoryBeHidden(level_category):
        view.SetCategoryHidden(level_category, True)
    view.DisplayStyle = DB.DisplayStyle.ShadingWithEdges
    viewport = next((doc.GetElement(vid) for vid in sheet.GetAllViewports()
                     if doc.GetElement(vid).ViewId == view.Id), None)
    center = DB.XYZ(1.0, 1.025, 0)
    if viewport is None:
        if not DB.Viewport.CanAddViewToSheet(doc, sheet.Id, view.Id):
            raise ValueError(u"해체 대상 3D 뷰가 다른 시트에 배치되어 있습니다.")
        viewport = DB.Viewport.Create(doc, sheet.Id, view.Id, center)
    type_name = "ReClaim RC01 viewport"
    current = doc.GetElement(viewport.GetTypeId())
    viewport_type = next((doc.GetElement(tid) for tid in viewport.GetValidTypes()
                          if DB.Element.Name.GetValue(doc.GetElement(tid)) == type_name), None)
    if viewport_type is None:
        viewport_type = current.Duplicate(type_name)
    show_title = viewport_type.get_Parameter(DB.BuiltInParameter.VIEWPORT_ATTR_SHOW_LABEL)
    if show_title is not None and not show_title.IsReadOnly:
        show_title.Set(0)
    if viewport.GetTypeId() != viewport_type.Id:
        viewport.ChangeTypeId(viewport_type.Id)
    doc.Regenerate()
    outline = viewport.GetBoxOutline()
    size = outline.MaximumPoint - outline.MinimumPoint
    ratio = max(size.X / 1.65, size.Y / 0.48)
    if ratio > 1 or ratio < 0.75:
        view.Scale = max(1, int(ceil(view.Scale * ratio)))
        doc.Regenerate()
    viewport.SetBoxCenter(center)
    return sheet


def run_in_revit():
    from Autodesk.Revit import DB
    from pyrevit import forms, revit, script
    from System import Int64

    doc, app, out = revit.doc, revit.doc.Application, script.get_output()
    path = forms.pick_file(file_ext="json", title=u"사이트에서 받은 .reclaim.json 선택")
    if not path:
        return
    try:
        data, rows = read_revit_export(path)
        project_summary = summary_text(data)
    except (IOError, ValueError, KeyError, TypeError, AttributeError, OverflowError) as error:
        forms.alert(u"Revit용 결과를 읽지 못했습니다.\n{}\n\n오류: {}".format(os.path.basename(path), error))
        return
    supports_long_ids = int(app.VersionNumber) >= 2024
    max_id = 9223372036854775807 if supports_long_ids else 2147483647
    targets = [(row, numeric_element_id(row["ElementId"], max_id))
               for row in rows if row.get("Category") != "adjustment"]
    ids = Counter(number for _, number in targets if number is not None)
    unique_ids = sum(count == 1 for count in ids.values())
    if not unique_ids:
        forms.alert(u"이 결과에서 기록에 쓸 수 있는 고유한 숫자형 Revit ID가 없습니다.\n"
                    u"원본 Revit 모델에서 부재 ID가 포함된 IFC를 다시 내보내 분석하세요.")
        return
    if not forms.alert(
            u"분석 대상 · {}\n열린 Revit 모델 · {}\n고유한 숫자형 ID · {} / {}개\n\n이 모델에 결과를 적용하시겠습니까?".format(
                data["source"], doc.Title, unique_ids, len(targets)), yes=True, no=True):
        return
    run_id = uuid4().hex

    # 공유 매개변수를 모델 범주 전체와 프로젝트 정보에 인스턴스 매개변수로 연결
    here = os.path.dirname(__file__)
    old = app.SharedParametersFilename
    project_info = doc.Settings.Categories.get_Item(DB.BuiltInCategory.OST_ProjectInformation)
    cats = app.Create.NewCategorySet()
    for c in doc.Settings.Categories:
        if c.Id != project_info.Id and c.AllowsBoundParameters and c.CategoryType == DB.CategoryType.Model:
            cats.Insert(c)
    info = app.Create.NewCategorySet()
    info.Insert(project_info)

    sheet = None
    try:
        app.SharedParametersFilename = os.path.join(here, "ReClaim_SharedParams.txt")
        group = app.OpenSharedParameterFile().Groups.get_Item("ReClaim")
        definitions = {d.Name: d for d in group.Definitions}
        with revit.Transaction(u"ReClaim 결과 기록 및 비교 시트 작성"):
            for d in definitions.values():
                existing = DB.SharedParameterElement.Lookup(doc, d.GUID)
                binding = app.Create.NewInstanceBinding(info if d.Name == "RC_Summary" else cats)
                group_id = DB.GroupTypeId.Data if hasattr(DB, "GroupTypeId") else DB.BuiltInParameterGroup.PG_DATA
                if existing is None:
                    inserted = doc.ParameterBindings.Insert(d, binding, group_id)
                else:
                    internal = existing.GetDefinition()
                    current = doc.ParameterBindings.get_Item(internal)
                    if current is None:
                        inserted = doc.ParameterBindings.Insert(d, binding, group_id)
                    elif d.Name != "RC_Summary" and current.Categories.Contains(project_info):
                        inserted = doc.ParameterBindings.ReInsert(internal, binding, group_id)
                    else:
                        continue
                if not inserted:
                    raise ValueError(u"공유 매개변수를 연결하지 못했습니다: {}".format(d.Name))
            doc.Regenerate()

            done = 0
            failures = Counter()
            keys = TEXT + NUMBER + (RUN_PARAMETER,)
            for r, number in targets:
                if number is None:
                    failures[(u"숫자형 Revit ID 없음", r["Category"])] += 1
                    continue
                if ids[number] != 1:
                    failures[(u"IFC에 같은 Revit ID가 여러 번 기록됨", r["Category"])] += 1
                    continue
                el = doc.GetElement(DB.ElementId(Int64(number) if supports_long_ids else number))
                if el is None:
                    failures[(u"모델에 해당 ID 없음", r["Category"])] += 1
                    continue
                params = {k: el.get_Parameter(definitions[k].GUID) for k in keys}
                crush_method = el.get_Parameter(definitions[CRUSH_METHOD].GUID)
                crush_amounts = {k: el.get_Parameter(definitions[k].GUID) for k in CRUSH_NUMBER}
                if any(p is None or p.IsReadOnly for p in list(params.values()) + [crush_method] + list(crush_amounts.values())):
                    failures[(u"기록 가능한 매개변수 없음", el.Category.Name if el.Category else r["Category"])] += 1
                    continue
                for k in keys:
                    params[k].Set(run_id if k == RUN_PARAMETER else r[k])
                crush_method.Set(r.get(CRUSH_METHOD) or (u"제외" if r["RC_Method"] == u"제외" else u"압쇄 해체"))
                for k, parameter in crush_amounts.items():
                    if k in r:
                        parameter.Set(r[k])
                done += 1

            missing = sum(failures.values())
            if not done:
                raise ValueError(u"현재 모델과 일치하는 부재가 없습니다. 현재 모델과 같은 IFC에서 분석한 ReClaim 결과를 선택하세요.")
            doc.ProjectInformation.get_Parameter(definitions["RC_Summary"].GUID).Set(project_summary)
            parameter_ids = {k: DB.SharedParameterElement.Lookup(doc, definitions[k].GUID).Id for k in keys}
            sheet = make_comparison_sheet(DB, doc, data, parameter_ids, run_id, done, missing)
            place_cost_chart(DB, doc, sheet, data.get("cost_chart_png"))
            draw_sheet_border(DB, doc, sheet, data)
            selective = make_schedule(DB, doc, DETAIL_NAME, parameter_ids, run_id, grouped=False)
            crush_ids = {key: parameter_ids[key] for key in ("RC_Waste", "RC_Tons", RUN_PARAMETER)}
            for column, key in (("RC_Method", CRUSH_METHOD), ("RC_DisposalCost", CRUSH_DISPOSAL),
                                ("RC_Revenue", CRUSH_REVENUE)):
                crush_ids[column] = DB.SharedParameterElement.Lookup(doc, definitions[key].GUID).Id
            crush = make_schedule(DB, doc, u"ReClaim - 일괄 압쇄 부재별 처리 및 중량",
                                  crush_ids, run_id, grouped=False)
            costs = data.get("scenario_costs", {})
            page_numbers = make_method_sheet(DB, doc, "RC-02", u"전면 분별 · 부재별 해체 결과",
                              selective, data, costs.get("selective"))
            page_numbers += make_method_sheet(DB, doc, "RC-03", u"일괄 압쇄 · 부재별 처리 및 중량",
                              crush, data, costs.get("crush"))
    finally:
        app.SharedParametersFilename = old
    out.print_md(u"**{}개 부재에 기록했습니다.** 매칭 또는 기록 실패: {}개".format(done, missing))
    for (reason, category), count in sorted(failures.items()):
        out.print_md(u"- {} · {}: {}개".format(reason, category, count))
    for reason in comparison_review(data):
        out.print_md(u"- 확인 필요 · {}".format(escape(reason)))
    out.print_md(u"**시트 {} — {}** · 프로젝트 탐색기의 시트에서 확인하세요.".format(sheet.SheetNumber, sheet.Name))
    out.print_md(u"공법별 상세 시트: " + u", ".join(page_numbers))
    revit.uidoc.RequestViewChange(sheet)


if __name__ == "__main__":
    try:
        import Autodesk  # noqa: F401  Revit 안에서만 있다
    except ImportError:
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "t.csv")
            with io.open(p, "w", encoding="utf-8-sig") as f:
                f.write(u"GlobalId,ElementId,Category,Floor,RC_Waste,RC_Method,RC_Tons,RC_DisposalCost,RC_Revenue\n"
                        u"0abc,300014,window,1,glass,분별 해체,0.1080,5890,60750\n")
            r = read_rows(p)
            assert len(r) == 1 and r[0]["ElementId"] == "300014" and r[0]["RC_Method"] == u"분별 해체" and r[0]["RC_Tons"] == 0.108
        data = json.loads('{"crush_total_won": 10000, "selective_total_won": 8000, "delta_won": -2000, "p_selective_cheaper": 0.25, "recommended": "selective"}')
        assert u"25.0%" in summary_text(data)
        assert u"-2,000 원" in sheet_text(data, 8, 1)
        assert u"8개 기록 / 1개" in sheet_text(data, 8, 1)
        assert u"판정 보류" in sheet_text(dict(data, recommended=None), 8, 1)
        incomplete = dict(data, basis=u"포함 항목 기준", included_cost_result="selective",
                          comparison_scope=u"지하층", schedule_basis={"label": u"현장 공정표"},
                          comparison_review=[u"석면 해체비 미입력"])
        assert u"공법 권장 판정 보류" in summary_text(incomplete)
        assert u"소계에서 전면 분별 낮음" in summary_text(incomplete)
        assert u"확인 필요 · 석면 해체비 미입력" in sheet_text(incomplete, 8, 1)
        assert u"설정 범위에서 분별 순비용이 낮은 시행 비율" in sheet_text(incomplete, 8, 1)
        assert included_cost_result(incomplete) == u"전면 분별 낮음"
        assert recommended_method(dict(data, transport_input={"crush": 0, "selective": None})) == u"판정 보류"
        assert numeric_element_id(u"000123", 2147483647) == 123
        assert all(numeric_element_id(value, 2147483647) is None
                   for value in (u"", u"0", u"123\n", u"ID123", u"2147483648"))
        assert [column_count(h) for h in (0.5, 1.35, 2.0, 3.5, 5.0, 12.0)] == [1, 1, 2, 3, 4, 9]
        print("self-check ok: CSV parsing, comparison labels and schedule columns")
    else:
        run_in_revit()
