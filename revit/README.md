# Revit → ReClaim

1. Revit에서 모델을 연다. 새로 만들 때는 `apartment_plan.py`를 pyRevit이나 Dynamo Python 노드로 실행한다.
2. **파일 > 내보내기 > IFC**를 누르고 IFC2x3 또는 IFC4로 저장한다. 기본 설정 그대로 두면 된다.
3. 앱의 **현장 사진·자재 → IFC 가져오기**에서 `.ifc` 파일을 고른다.
   - 벽·슬래브·보·기둥·기초가 자재 목록에 들어간다. 종류·부재·층·구역·재료가 같은 것끼리 한 줄로 묶이고, 톤수는 부피 × 밀도로 계산한다.
   - 해체 계획·3D 화면에는 실제 모델 형상이 표시된다. 부재를 클릭하면 해당 자재 정보가 나온다.
   - 상태, 손상, 사진은 IFC에 들어 있지 않으므로 가져온 뒤 자재의 **수정** 화면에서 입력한다.

재료는 이름으로 구분한다. 재료 이름에 `Steel`, `강재`, `철골`, `SS275` 같은 말이 들어 있으면 구조용 강재로, 그 밖의 재료는 모두 콘크리트로 처리한다.
Revit 기본 재료(Generic 등)도 콘크리트로 처리되므로, 정확하게 가져오려면 재료 이름을 바꿔 둔다.

---

# ReClaim 해체 분석 (pyRevit 확장)

열린 Revit 모델에서 **일괄 압쇄 vs 전면 분별해체**의 비용·공기를 계산하고, 결과를 부재 매개변수와 색 뷰로 모델에 넣습니다. 결과를 넣은 뒤 저장하면 그대로 제출용 `.rvt`가 됩니다.

## 설치 (처음 한 번)

1. [pyRevit](https://github.com/pyrevitlabs/pyRevit/releases)의 최신 설치 파일(`pyRevit_..._signed.exe`)을 받아 설치하고 Revit을 다시 켭니다. 리본에 **pyRevit** 탭이 생깁니다.
2. 이 저장소를 내려받습니다(`git clone` 또는 GitHub의 Code → Download ZIP).
3. Revit에서 **pyRevit 탭 → Settings → Custom Extension Directories → Add folder**를 누르고, 저장소의 `revit` 폴더를 고릅니다. **Save Settings and Reload**를 누르면 리본에 **ReClaim** 탭이 생깁니다.

## 사용 A — Revit 안에서 한 번에 (해체 분석)

1. 해체할 건물 모델을 엽니다.
2. **ReClaim 탭 → 해체 분석**을 누릅니다.
3. 건물 용도·구조를 고릅니다 (모델에 없는 혼합폐기물을 논문 원단위로 보정할 때 씁니다).
4. 이름으로 분류하지 못한 재료가 있으면 무엇인지 물어봅니다. 한 번 고르면 `~/reclaim_material_map.json`에 저장되어 다음부터 자동으로 쓰입니다.
5. 끝나면:
   - 모든 대상 부재에 `RC_성상`, `RC_톤`, `RC_처리`(분별 회수 / 일괄 처리 / 압쇄(공통) / 석면 별도), `RC_재활용`, `RC_비용차`(천원, 음수면 분별이 이득)가 들어갑니다.
   - **ReClaim 결과** 3D 뷰가 열립니다. 분별 회수는 초록, 일괄 처리는 회색, 구조체 압쇄(공통)는 갈회색, 석면은 빨강입니다.
   - 출력 창에 두 방식의 인건비·장비비·반출비·처리비·매각 수익·공기 표가 나옵니다.
   - 모델 옆에 `<모델 이름>.reclaim.json`이 저장됩니다. 웹 BIM 편집기(`bim.html`)의 **결과 열기**로 불러오면 불확실성 분석(몬테카를로·토네이도)을 볼 수 있습니다.
6. 모델을 저장합니다.

### 해체 정보 넣기 (선택)

분석을 한 번 돌리면 `RC_시공성`(논문 표 1의 6점 척도, 3점 미만은 분별 대상에서 제외)과 `RC_유해물질`(`석면 의심` / `석면 확인`) 매개변수가 생깁니다. 값을 넣고 다시 분석하면 반영됩니다. 비워 두면 구조 부재 2점, 그 밖의 부재 5점으로 계산합니다.

## 사용 B — IFC만 있을 때 (CSV 적용)

1. 웹 BIM 편집기에서 IFC를 불러와 계산하고 **Revit용 CSV**를 내려받습니다 (`*.reclaim.csv`).
2. 같은 모델을 Revit에서 열고 **ReClaim 탭 → CSV 적용**을 누릅니다. 다운로드 폴더에서 가장 최근 CSV를 자동으로 찾습니다.
3. ElementId(IFC의 Tag)로 부재를 찾고, 없으면 IfcGUID로 찾습니다. 결과 매개변수와 색 뷰는 사용 A와 같습니다.

IFC를 내보낼 때 **수정 설정 → 속성 세트 → 사용자 정의 속성 세트 내보내기**에 `revit/ReClaim_IFC_Pset.txt`를 지정하면 `RC_시공성`·`RC_유해물질`도 IFC에 실려 웹에서 읽힙니다.

## 계산 기준

- 물량: 부재마다 `GetMaterialIds` + `GetMaterialVolume`으로 재료별 부피를 읽고 밀도로 톤을 냅니다. 재료 물량이 없는 창·문은 크기 × 기본 단위 질량(창 PVC 9 + 유리 20 kg/㎡, 문 18 kg/㎡)을 씁니다.
- 단가·품·밀도는 `ReClaim.extension/lib/rates.json`이며, 웹의 `assets/js/bim/catalog.js`에서 자동 생성됩니다(`node scripts/export_rates.mjs`). 웹과 Revit 계산이 같은지는 `node scripts/test_engines.mjs`로 확인합니다.
- Revit 밖에서 계산부만 점검: `python3 revit/ReClaim.extension/lib/reclaim_engine.py`
