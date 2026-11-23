# -*- coding: utf-8 -*-
"""무인 일괄 실행: pyrevit run 으로 Revit을 띄워 inbox의 모델마다 해체 분석 → 요약 JSON → 결과 서버 전송.

    pyrevit run reclaim_batch.py --revit=2027

모델 목록은 pyrevit에 넘기지 않고 이 스크립트가 설정의 inbox 폴더를 직접 읽는다
(목록 파일로 넘기면 한글 파일 이름이 깨진다). 성공한 모델은 inbox/done, 실패한 모델은 inbox/failed 로 옮긴다.
대화 상자를 띄우지 않는다. 설정은 ~/reclaim_config.json (예시: reclaim_config.example.json).
원본 모델은 바꾸지 않는다: 매개변수를 쓰는 설정이면 결과가 들어간 사본을 out_dir에 따로 저장한다.
로그: <out_dir>/reclaim_batch.log
"""
from __future__ import division
import io
import os
import sys
import traceback
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
LIB = os.path.normpath(os.path.join(HERE, "..", "ReClaim.extension", "lib"))
if LIB not in sys.path:
    sys.path.append(LIB)
EXT = os.path.dirname(LIB)

import reclaim_io as IO  # noqa: E402
import reclaim_run as RUN  # noqa: E402

cfg = RUN.load_config()
out_dir = cfg.get("out_dir") or os.path.join(os.path.expanduser("~"), "Documents", "ReClaim")
if not os.path.isdir(out_dir):
    os.makedirs(out_dir)
log_path = os.path.join(out_dir, "reclaim_batch.log")


def log(msg):
    line = u"[%s] %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    with io.open(log_path, "a", encoding="utf-8") as f:
        f.write(line + u"\n")
    try:
        print(line)
    except Exception:
        pass


# pyRevit runner는 __revit__·__models__를 builtins에 넣는다 (globals()에는 없다)
try:
    uiapp = __revit__  # noqa: F821
except NameError:
    uiapp = None
app = getattr(uiapp, "Application", uiapp)
try:
    passed = list(__models__)  # noqa: F821
except NameError:
    passed = []

inbox = cfg.get("inbox") or u"C:\\ReClaim\\inbox"
models = []
if os.path.isdir(inbox):
    for name in sorted(os.listdir(inbox)):
        if name.lower().endswith(".rvt") and os.path.isfile(os.path.join(inbox, name)):
            models.append(os.path.join(inbox, name))
models += [m for m in passed if m not in models]
log(u"시작: 모델 %d개 (inbox %s), Revit %s, 설정 %s" % (len(models), inbox, getattr(app, "VersionNumber", "?"), RUN.CONFIG_PATH))


def move_to(path, sub):
    """inbox 안의 모델을 inbox/<sub> 로 옮긴다 (같은 이름이 있으면 덮어쓴다)."""
    if os.path.dirname(os.path.abspath(path)).lower() != os.path.abspath(inbox).lower():
        return
    dest_dir = os.path.join(inbox, sub)
    if not os.path.isdir(dest_dir):
        os.makedirs(dest_dir)
    dest = os.path.join(dest_dir, os.path.basename(path))
    try:
        if os.path.exists(dest):
            os.remove(dest)
        os.rename(path, dest)
    except Exception as e:
        log(u"옮기기 실패: %s (%s)" % (path, e))

use = cfg.get("use") or u"주거 공동주택"
write_params = bool(cfg.get("write_params", False))
up = cfg.get("upload") or {}

done = 0
for path in models:
    doc = None
    ok = False
    try:
        log(u"열기: %s" % path)
        doc = app.OpenDocumentFile(path)
        # 모델별 설정: "models": {"파일 이름 일부": {"use": "비주거 RC", "gfa": 1500}}
        m_use, m_gfa = use, cfg.get("gfa")
        for key, mc in (cfg.get("models") or {}).items():
            if key in os.path.basename(path):
                m_use, m_gfa = mc.get("use") or m_use, mc.get("gfa") or m_gfa
        # 물량만 읽어 결과 서버에 올리고, 서버(공법 비교 엔진)가 계산한 결과를 받는다
        r = RUN.analyze(doc, app, EXT, m_use, m_gfa, write_params=write_params, upload=up)
        sp = RUN.summary_path(doc, out_dir)
        IO.write_json(sp, r["record"])
        m = r["bundle"]["model"]
        res = r["result"]
        if res and res.get("crush"):
            log(u"분석: 부재 %d, 연면적 %.0f㎡(%s), 일괄 %.1f / 분별 %.1f 백만원, 공기 %.1f / %.1f일 → %s" % (
                len(m["elements"]), res["inputs"]["area"] or 0, m["gross"]["basis"], res["crush"]["total"] / 1e6,
                res["selective"]["total"] / 1e6, res["crush"]["days"], res["selective"]["days"], sp))
        else:
            log(u"물량만 저장: 부재 %d, 연면적 %.0f㎡ → %s" % (len(m["elements"]), m["gross"]["area"], sp))
        if r["error"]:
            log(u"계산 안내: %s" % r["error"])
        for w in (res or {}).get("review") or []:
            log(u"확인 필요: %s" % w)
        for line in RUN.material_notes(res):
            log(line)
        if r["entry"]:
            log(u"전송: %s (엔진 %s)" % (r["entry"].get("id"), (r["entry"].get("engine") or u"")[:7]))
        if r["written"]:
            log(u"RC_* 매개변수: 부재 %d개" % r["written"])
        if write_params:
            from Autodesk.Revit.DB import SaveAsOptions
            opt = SaveAsOptions()
            opt.OverwriteExistingFile = True
            copy_path = os.path.join(out_dir, u"%s_ReClaim.rvt" % doc.Title)
            doc.SaveAs(copy_path, opt)
            # 같은 이름으로 다시 저장할 때마다 Revit이 <이름>.0001.rvt 백업을 남긴다 → 지운다
            stem = os.path.splitext(os.path.basename(copy_path))[0]
            for f in os.listdir(out_dir):
                if f.startswith(stem + u".") and f.lower().endswith(".rvt") and f[len(stem) + 1:-4].isdigit():
                    try:
                        os.remove(os.path.join(out_dir, f))
                    except Exception:
                        pass
            log(u"결과 사본 저장: %s" % copy_path)
        done += 1
        ok = True
    except Exception:
        log(u"실패: %s\n%s" % (path, traceback.format_exc()))
    finally:
        if doc is not None:
            try:
                doc.Close(False)
            except Exception:
                pass
        move_to(path, "done" if ok else "failed")

log(u"끝: %d/%d 성공" % (done, len(models)))
