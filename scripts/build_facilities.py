"""행정안전부 건설폐기물처리업 인허가 CSV에서 영업 중인 중간처분업체만 골라 assets/data/facilities.json으로 저장한다.

순환골재를 만드는 곳은 "중간처분업(건설폐기물)"으로 허가받으므로, 이 업체들을 순환골재 처리장과
혼합 건설폐기물 처리장 후보로 함께 쓴다. 수집운반업은 처리장이 아니라 뺀다.

갱신: https://www.data.go.kr/data/15045064/fileData.do 에서 CSV를 받아 scripts/에 두고
      `python scripts/build_facilities.py` (pyproj 필요: pip install pyproj)
"""
import csv, json, pathlib
from pyproj import Transformer

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "자원환경_건설폐기물처리업.csv"
OUT = HERE.parent / "assets" / "data" / "facilities.json"

# 파일 설명: 보정계수 안 들어간 Bessel 중부원점 TM(EPSG:5174)
to_wgs84 = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True)

rows = list(csv.DictReader(SRC.open(encoding="cp949")))
out, no_xy, seen = [], 0, set()
for r in rows:
    if r["영업상태코드"] != "01" or r["폐기물처리업구분명"] != "중간처분업(건설폐기물)":
        continue
    key = (r["사업장명"].strip(), r["좌표정보(X)"].strip())  # 한 업체가 허가를 여러 건 가진 경우
    if key in seen:
        continue
    seen.add(key)
    x, y = r["좌표정보(X)"].strip(), r["좌표정보(Y)"].strip()
    if not (x and y):
        no_xy += 1  # ponytail: 좌표 없는 업체는 뺀다. 필요하면 주소를 지오코딩해 채울 것
        continue
    lon, lat = to_wgs84.transform(float(x), float(y))
    out.append({"name": r["사업장명"].strip(), "addr": (r["도로명주소"] or r["지번주소"]).strip(),
                "lat": round(lat, 6), "lon": round(lon, 6), "kinds": ["recycle", "landfill"], "date": r["데이터갱신시점"][:10]})

assert all(33 < f["lat"] < 39 and 124 < f["lon"] < 132 for f in out), "좌표 변환 결과가 한국 밖입니다"
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(rows)} rows -> {len(out)} active mid-treatment facilities ({no_xy} without coordinates skipped) -> {OUT}")
