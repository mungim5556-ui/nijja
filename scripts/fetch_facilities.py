"""전국폐기물처리업소표준데이터에서 건설폐기물을 처리하는 업소만 골라 assets/data/facilities.json으로 저장한다.

데이터는 1년 단위로 갱신돼 사이트가 매번 API를 부르지 않고 이 파일을 쓴다.
실행: DATA_GO_KR_KEY 환경변수를 둔 채로 `python scripts/fetch_facilities.py`
"""
import json, os, pathlib, re, time, urllib.parse, urllib.request

URL = "https://api.data.go.kr/openapi/tn_pubr_public_tret_was_api"
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "data" / "facilities.json"


def page(n):
    q = urllib.parse.urlencode({"serviceKey": os.environ["DATA_GO_KR_KEY"], "pageNo": n, "numOfRows": 1000, "type": "json"})
    for _ in range(3):  # 공공데이터포털이 가끔 503을 돌려준다
        try:
            return json.load(urllib.request.urlopen(f"{URL}?{q}", timeout=60))["body"]
        except Exception:
            time.sleep(2)
    raise RuntimeError(f"page {n} failed")


rows, n = [], 1
while True:
    body = page(n)
    rows += body["items"]["item"]
    if len(rows) >= int(body["totalCount"]):
        break
    n += 1

# 건설폐기물 분류번호 40-xx. 40-01-01 폐콘크리트를 받는 곳은 순환골재 처리장 후보,
# 처분업(중간·종합·최종)은 혼합 건설폐기물 처리장 후보로 본다.
out = []
for r in rows:
    codes = r["tretWasInf"] or ""
    if "수집" in r["busNm"] or not re.search(r"\b40-", codes) or not (r["lat"] and r["lot"]):
        continue
    kinds = [k for k, ok in (("recycle", "40-01-01" in codes), ("landfill", "처분" in r["busNm"])) if ok]
    if kinds:
        out.append({"name": r["flctNm"], "addr": r["lctnRoadNmAddr"] or r["lctnLotnoAddr"], "lat": float(r["lat"]),
                    "lon": float(r["lot"]), "kinds": kinds, "date": r["crtrYmd"]})

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(rows)} rows -> {len(out)} facilities ({sum('recycle' in f['kinds'] for f in out)} recycle, "
      f"{sum('landfill' in f['kinds'] for f in out)} landfill) -> {OUT}")
