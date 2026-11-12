# -*- coding: utf-8 -*-
"""Revit 밖에서도 돌아가는 입출력 도우미: 결과 CSV 찾기·읽기, 결과 요약 JSON 만들기.

CSV 열 (웹 bim.html의 'Revit용 CSV'가 이 형식으로 내보낸다):
    element_id, ifc_guid, category, waste, tons, method, recyclable, delta_k
    method: selective(분별 회수) | general(일괄 처리) | hazard(석면 별도)
    delta_k: 부재 하나를 분별했을 때 비용 차이(천원, 음수면 분별이 이득)
"""
from __future__ import division
import io
import os
import glob
import json
import csv

CSV_COLUMNS = ["element_id", "ifc_guid", "category", "waste", "tons", "method", "recyclable", "delta_k"]
METHOD_LABEL = {"selective": u"분별 회수", "general": u"일괄 처리", "hazard": u"석면 별도"}


def downloads_dir():
    home = os.path.expanduser("~")
    for name in ("Downloads", u"다운로드"):
        d = os.path.join(home, name)
        if os.path.isdir(d):
            return d
    return home


def latest_csv(folder=None, pattern="*.reclaim.csv"):
    files = glob.glob(os.path.join(folder or downloads_dir(), pattern))
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def read_results_csv(path):
    """CSV → [{element_id:int|None, ifc_guid, waste, tons, method, recyclable(bool), delta_k}]"""
    rows = []
    with io.open(path, "r", encoding="utf-8-sig") as f:
        text = f.read()
    lines = text.splitlines()
    reader = csv.reader(lines)
    header = None
    for rec in reader:
        if not rec or not any(c.strip() for c in rec):
            continue
        if header is None:
            header = [h.strip() for h in rec]
            continue
        row = dict(zip(header, [c.strip() for c in rec]))
        try:
            eid = int(float(row.get("element_id") or ""))
        except ValueError:
            eid = None
        def num(k):
            try:
                return float(row.get(k) or 0)
            except ValueError:
                return 0.0
        rows.append({
            "element_id": eid,
            "ifc_guid": row.get("ifc_guid") or "",
            "category": row.get("category") or "",
            "waste": row.get("waste") or "",
            "tons": num("tons"),
            "method": row.get("method") or "general",
            "recyclable": (row.get("recyclable") or "").lower() in ("1", "true", "yes", u"예"),
            "delta_k": num("delta_k"),
        })
    return rows


def summary_json(model_name, ctx, items, result, params=None):
    """웹 bim.html의 '결과 열기'로 읽는 요약 파일 내용."""
    elements = []
    for it in items:
        elements.append({
            "id": it["id"], "source": "ifc", "name": it.get("name", ""), "category": it["category"],
            "area": it.get("area", 0), "mats": it["tons"], "work": it.get("work") or [],
            "separable": it.get("separable"), "hazard": it.get("hazard", "none"), "levelId": it.get("level", "L1"),
        })
    levels = sorted(set(e["levelId"] for e in elements)) or ["L1"]
    return {
        "version": 1, "name": model_name, "use": ctx.get("use"), "gfa": ctx.get("gfa"),
        "levels": [{"id": l, "name": l, "elevation": 0, "height": 3} for l in levels],
        "elements": elements, "params": params or {},
        "revit": {"general_total": result["general"]["total"], "selective_total": result["selective"]["total"]},
    }


def write_json(path, data):
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    import tempfile
    d = tempfile.mkdtemp()
    p = os.path.join(d, "a.reclaim.csv")
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(u"﻿element_id,ifc_guid,category,waste,tons,method,recyclable,delta_k\n")
        f.write(u"12345,2xS3BCk0f8$9...,wall,wood,1.25,selective,1,-12.5\n")
        f.write(u",3abc,window,glass,0.3,general,0,4\n")
    rows = read_results_csv(p)
    assert rows[0]["element_id"] == 12345 and rows[0]["recyclable"] and rows[0]["delta_k"] == -12.5
    assert rows[1]["element_id"] is None and rows[1]["ifc_guid"] == "3abc"
    assert latest_csv(d) == p
    print("self-check ok")
