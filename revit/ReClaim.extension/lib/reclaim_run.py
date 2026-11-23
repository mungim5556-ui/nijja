# -*- coding: utf-8 -*-
"""해체 분석 한 번: Revit 물량 읽기 → 결과 서버(공법 비교 엔진)가 계산 → (선택) RC_* 매개변수·색 뷰.

비용은 Revit 안에서 계산하지 않는다. 공법 비교 화면과 같은 엔진(reclaim-compare pipeline.js)을
결과 서버(Cloudflare Worker)가 돌린다. 리본의 '해체 분석' 버튼과 무인 일괄 실행이 같이 쓴다.
"""
from __future__ import division
import io
import json
import os

from Autodesk.Revit.DB import Transaction

import reclaim_quantities as Q
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


def analyze(doc, app, ext_folder, use, gfa=None, write_params=True, upload=None, inputs=None):
    """물량만 읽어 결과 서버에 올리고, 서버가 공법 비교 엔진으로 계산한 결과를 받는다.

    upload: {"url":..., "token":...}. 토큰이 없으면 물량 묶음만 만든다 (비용 계산 없음).
    write_params: 결과가 있으면 부재마다 RC_* 매개변수와 'ReClaim 결과' 3D 뷰를 만든다.
    돌려주는 값: {bundle, record(파일로 저장할 묶음 + 결과), result, entry(서버 목록 항목), error, view, written}"""
    raw, levels = R.collect_raw(doc)
    bundle = Q.build_bundle(raw, levels, doc.Title, use, gfa, inputs)
    entry, result, error = None, None, None
    up = upload or {}
    if up.get("token"):
        try:
            import reclaim_upload as UP
            entry = UP.upload(bundle, up.get("url"), up.get("token"))
            result = entry.get("result")
            error = entry.get("resultError") or entry.get("error")
        except Exception as e:
            error = u"결과 서버 전송 실패: %s" % e
    else:
        error = u"결과 서버 토큰이 없어 비용을 계산하지 않았습니다 (~/reclaim_config.json의 upload.token)."
    view, written = None, 0
    if write_params and result and result.get("elementRows"):
        t = Transaction(doc, u"ReClaim 분석")
        t.Start()
        try:
            guids = R.ensure_shared_params(doc, app, ext_folder)
            written = R.write_rows(doc, Q.param_rows(result))
            view = R.result_view(doc, guids)
            t.Commit()
        except Exception:
            t.RollBack()
            raise
    record = dict(bundle)
    record["result"] = result
    record["resultError"] = error
    record["serverId"] = entry.get("id") if entry else None
    return {"bundle": bundle, "record": record, "result": result, "entry": entry, "error": error, "view": view, "written": written}


def summary_path(doc, folder=None):
    if not folder:
        folder = os.path.dirname(doc.PathName) if doc.PathName else os.path.join(os.path.expanduser("~"), "Documents")
    return os.path.join(folder, u"%s.reclaim.json" % doc.Title)


def table_rows(result):
    """서버 결과 → 보고 표 (백만원)."""
    c, s_ = result["crush"], result["selective"]
    m = lambda v: u"{:,.1f}".format((v or 0) / 1e6)
    rows = [[u"인건비", "labor"], [u"장비비", "equipment"], [u"처리비", "disposal"], [u"운반비", "transport"], [u"간접비", "indirect"]]
    out = [[label, m(c.get(k)), m(s_.get(k))] for label, k in rows]
    out.append([u"매각 수익", u"−" + m(c.get("revenue")), u"−" + m(s_.get("revenue"))])
    out.append([u"순비용 (백만원)", m(c.get("total")), m(s_.get("total"))])
    out.append([u"공기 (일)", u"%.1f" % (c.get("days") or 0), u"%.1f" % (s_.get("days") or 0)])
    return out
