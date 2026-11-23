# AI(ChatGPT 등)에게 저장소 보여 주기

ChatGPT 같은 AI에는 **아래 raw 링크**를 붙여 넣으세요.
- github.com 화면 링크(`/blob/...`)는 화면을 그리는 페이지라 AI가 본문을 못 읽는 경우가 많습니다.
- 한글 파일 이름도 아래처럼 인코딩된 링크를 써야 열립니다.
- 링크는 `main` 브랜치 기준입니다. main에 합쳐지지 않은 수정은 보이지 않습니다.

그래도 안 열리면:
1. ChatGPT 설정 → 커넥터(Apps)에서 **GitHub**를 연결합니다. 저장소에 초대된 본인 계정이어야 합니다.
2. 또는 저장소 **Code → Download ZIP**으로 받아 필요한 파일(.md, .js, .py, .json)만 대화에 올립니다.

> 이 파일은 `node scripts/ai_links.mjs`로 만듭니다. 손으로 고치지 마세요.

## 개요·사용법

- **README.md** — 저장소 전체 개요, BIM 편집기·공법 비교·검증 방법
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/README.md
- **revit/README.md** — Revit(pyRevit) 확장 설치·사용, 무인 일괄 실행, 해체계획서 대조
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/revit/README.md

## 연구 노트 (Obsidian)

- **docs/obsidian/분별해체 경제성 BIM 구현 계획.md** — 논문 기반 구현 계획, 단가 출처, 철골 품 근거, 재현성 수정
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/docs/obsidian/%EB%B6%84%EB%B3%84%ED%95%B4%EC%B2%B4%20%EA%B2%BD%EC%A0%9C%EC%84%B1%20BIM%20%EA%B5%AC%ED%98%84%20%EA%B3%84%ED%9A%8D.md
- **docs/obsidian/해체계획서 대조 검증.md** — 7개 모델 검증, 천마산 나라장터 내역서 대조
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/docs/obsidian/%ED%95%B4%EC%B2%B4%EA%B3%84%ED%9A%8D%EC%84%9C%20%EB%8C%80%EC%A1%B0%20%EA%B2%80%EC%A6%9D.md

## 계산 엔진 (웹)

- **assets/js/bim/catalog.js** — 재료·폐기물·품·단가 프리셋·재료 키워드 (단가 원본)
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/assets/js/bim/catalog.js
- **assets/js/bim/cost.js** — 일괄 압쇄 vs 전면 분별해체 비용·공기 계산
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/assets/js/bim/cost.js
- **assets/js/bim/scenario.js** — 물량 산출, 연면적, 불확실성 분석
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/assets/js/bim/scenario.js
- **assets/js/bim/ifc-import.js** — IFC → 부재별 재료 톤 (미분류 재료 규칙)
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/assets/js/bim/ifc-import.js

## 계산 엔진 (Revit)

- **revit/ReClaim.extension/lib/reclaim_engine.py** — 웹 엔진과 같은 계산의 Python 판
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/revit/ReClaim.extension/lib/reclaim_engine.py
- **revit/ReClaim.extension/lib/rates.json** — catalog.js에서 내보낸 단가 (자동 생성)
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/revit/ReClaim.extension/lib/rates.json

## 공법 비교 탭·검증 도구

- **compare/assets/data/rates.json** — 공법 비교 탭 변수와 출처·범위
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/compare/assets/data/rates.json
- **scripts/validate_plan.py** — Revit 분석 결과 ↔ 해체계획서 값 대조
  https://raw.githubusercontent.com/mungim5556-ui/nijja/main/scripts/validate_plan.py
