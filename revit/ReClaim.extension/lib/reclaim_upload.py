# -*- coding: utf-8 -*-
"""해체 분석 요약(.reclaim.json)을 ReClaim Worker 결과 저장소로 보낸다.

Revit(IronPython)에서는 .NET WebClient를, 일반 Python에서는 urllib을 쓴다.
명령행: python reclaim_upload.py <요약.json> [--url URL] [--token TOKEN]
        (--url·--token을 빼면 ~/reclaim_config.json의 upload 값을 쓴다)
"""
from __future__ import print_function
import io
import json
import os
import sys

DEFAULT_URL = "https://nijja-api.mungim5556.workers.dev/results"


def _post_dotnet(url, token, body):
    import clr  # noqa: F401  (IronPython 전용)
    from System.Net import WebClient, ServicePointManager, SecurityProtocolType, WebException
    from System.Text import Encoding
    ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12
    wc = WebClient()
    wc.Encoding = Encoding.UTF8
    wc.Headers.Add("Authorization", "Bearer " + token)
    wc.Headers.Add("Content-Type", "application/json; charset=utf-8")
    try:
        return 201, wc.UploadString(url, "POST", body)
    except WebException as e:
        resp = e.Response
        if resp is None:
            raise
        from System.IO import StreamReader
        return int(resp.StatusCode), StreamReader(resp.GetResponseStream()).ReadToEnd()


def _post_urllib(url, token, body):
    try:
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
    except ImportError:  # Python 2
        from urllib2 import Request, urlopen, HTTPError
    req = Request(url, data=body.encode("utf-8"), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json; charset=utf-8"})
    try:
        r = urlopen(req, timeout=60)
        return r.getcode(), r.read().decode("utf-8")
    except HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def upload(summary, url=None, token=None):
    """summary: dict 또는 JSON 문자열. 성공하면 Worker가 돌려준 목록 항목(dict)을 돌려준다."""
    if not token:
        raise ValueError("upload token is empty (set upload.token in ~/reclaim_config.json)")
    body = summary if isinstance(summary, (str, type(u""))) else json.dumps(summary, ensure_ascii=False)
    try:
        status, text = _post_dotnet(url or DEFAULT_URL, token, body)
    except ImportError:
        status, text = _post_urllib(url or DEFAULT_URL, token, body)
    if status != 201:
        raise RuntimeError("upload failed: HTTP %s %s" % (status, text[:300]))
    return json.loads(text)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    def opt(name):
        if name in args:
            i = args.index(name)
            v = args[i + 1]
            del args[i:i + 2]
            return v
        return None
    url, token = opt("--url"), opt("--token")
    if not (url and token):
        cfg = {}
        try:
            with io.open(os.path.join(os.path.expanduser("~"), "reclaim_config.json"), "r", encoding="utf-8-sig") as f:
                cfg = json.load(f).get("upload", {})
        except Exception:
            pass
        url, token = url or cfg.get("url"), token or cfg.get("token")
    with io.open(args[0], "r", encoding="utf-8-sig") as f:
        text = f.read()
    print(json.dumps(upload(text, url, token), ensure_ascii=False, indent=1))
