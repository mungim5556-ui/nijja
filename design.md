# Design System — AI 기반 건물 해체 및 재사용 자재 계획 시스템

레퍼런스 이미지 5장에서 색과 타이포그래피를 뽑아 정리한 디자인 기준입니다.
색상 값은 이미지에서 실제로 추출한 색을 바탕으로, 화면에서 읽기 쉽도록(WCAG 대비) 조금 다듬었습니다.

---

## 1. 레퍼런스 분석

| # | 레퍼런스 | 추출한 대표 색 | 가져올 요소 |
|---|---|---|---|
| 1 | 실내 공사 현장 (경량철골 천장, 석고보드) | `#E2E2DC` `#B2ABA1` `#827C73` `#312D29` `#171614` | 콘크리트·석고·아연도 강재의 **따뜻한 회색 계열** → 배경과 중립색 |
| 2 | 벽돌 벽 해체 | `#E9D4BE` `#CBA37B` `#AB7C57` `#552C12` `#29160E` | **벽돌·흙 계열 주황갈색** → 포인트 색, 해체 작업의 질감 |
| 3 | SmartSolar 웹사이트 | `#FFFFFF` `#EBECF1` `#C4D5E3` `#323334` `#1E3A8A`(버튼) | 넓은 여백, 큰 사진 히어로, 숫자 강조 통계, 둥근 카드, **네이비 버튼** |
| 4 | STACORE 건축 웹사이트 | `#2B2C35` `#E2E2EA` `#F8F8FA` 주황 버튼 `#F08A2E` 부근 | **어두운 차콜 카드 + 주황 포인트**, 굵은 한글 헤드라인, 원형 통계 배지 |
| 5 | 공사 현장 실루엣 (노을) | `#070507` `#622309` `#9C3901` `#F8CD98` `#455FA2` `#7494BE` | **주황↔파랑 대비**, 강렬한 히어로 분위기, 안전모·철근의 산업적 인상 |

**정리한 방향**
- **분위기**: 산업적이고 믿음직한 느낌. 콘크리트 회색 바탕 위에 차콜 텍스트, **안전 주황**을 포인트로 씁니다.
- **보조 색**: 레퍼런스 3·5의 **네이비·스틸 블루**를 정보·신뢰(분석 결과, 링크, 물류 경로)에 씁니다.
- **레이아웃**: 레퍼런스 3처럼 넓은 여백과 큰 사진 히어로, 레퍼런스 3·4처럼 **큰 숫자 통계**를 강조합니다.

---

## 2. 색상 팔레트

### 2.1 브랜드 색

| 토큰 | 값 | 출처 | 용도 |
|---|---|---|---|
| `--color-primary` | `#E8742A` | 벽돌(2), 노을(5), STACORE 버튼(4) | 포인트 면, 아이콘, 강조선, 3D 모델의 "선택" 상태 |
| `--color-primary-strong` | `#B4530F` | 위 색을 어둡게 | **흰 글자가 올라가는 버튼**, 주황 텍스트 링크 |
| `--color-primary-soft` | `#FBE9DC` | 벽돌 밝은 톤 `#E9D4BE` | 주황 배지 배경, 선택된 행 배경 |
| `--color-secondary` | `#1E3A8A` | SmartSolar 버튼(3), 노을 하늘(5) | 보조 버튼, 링크, VRP 운송 경로 |
| `--color-secondary-soft` | `#E6ECF7` | 하늘 `#C4D5E3` | 정보 배너, 보조 배지 배경 |

### 2.2 중립색 (콘크리트 계열)

레퍼런스 1의 따뜻한 회색에서 가져왔습니다. 순수 회색이 아니라 **약간 노란 기운**이 있는 것이 특징입니다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--gray-0` | `#FFFFFF` | 카드 배경 |
| `--gray-50` | `#F7F6F3` | 페이지 배경 |
| `--gray-100` | `#EDEBE7` | 구분 영역, 입력창 배경 |
| `--gray-200` | `#DEDBD5` | 테두리 |
| `--gray-400` | `#B2ABA1` | 비활성 아이콘, 플레이스홀더 |
| `--gray-600` | `#6B6560` | 보조 텍스트 |
| `--gray-800` | `#312D29` | 제목 보조, 어두운 카드 테두리 |
| `--gray-900` | `#1C1D22` | 본문 텍스트, 어두운 카드(STACORE 스타일) |
| `--gray-950` | `#16171B` | 다크 모드 배경, 푸터 |

### 2.3 상태 색

| 토큰 | 값 | 의미 (이 서비스에서) |
|---|---|---|
| `--color-success` | `#2F7D4F` | 재사용 가능, 승인됨 |
| `--color-warning` | `#A15C07` | 추가 검토 필요, 신뢰도 낮음 |
| `--color-danger` | `#B42318` | 폐기 대상, 반려, 안전 경고 |
| `--color-info` | `#1E3A8A` | 분석 중, 참고 정보 (보조 색과 같음) |

### 2.4 도메인 색 (자재·평가 결과)

3D 블록 모델, 차트, 자재 목록에서 같은 의미에 같은 색을 씁니다.

| 의미 | 값 | 비고 |
|---|---|---|
| 콘크리트·골재 | `#9C9084` | 레퍼런스 1의 콘크리트 톤 |
| 구조용 강재 | `#4A6FA5` | 아연도 강재의 푸른 회색 |
| 재사용 대상 | `#2F7D4F` | 성공 색과 같음 |
| 일반 처리(폐기) 대상 | `#B2ABA1` | 흐린 회색으로 뒤로 물러나게 |
| 검토 필요 | `#D9B23A` | 머스터드 노랑 + 빗금 패턴 병행 (현재 단계 주황과 구분) |
| 현재 해체 단계 | `#E8742A` | 주 색 |
| 운송 경로 (VRP) | `#1E3A8A` | 차량별로는 채도·명도 단계를 나눠 사용 |

> 색만으로 상태를 구분하지 않습니다. 배지에는 텍스트를, 3D 블록에는 패턴(빗금·점선 테두리)을 함께 씁니다.

### 2.5 대비 검증 (WCAG)

| 글자 / 배경 | 대비 | 결과 |
|---|---|---|
| `#1C1D22` / `#F7F6F3` (본문) | 15.6 : 1 | AAA |
| `#6B6560` / `#F7F6F3` (보조 텍스트) | 5.3 : 1 | AA |
| `#FFFFFF` / `#B4530F` (주황 버튼) | 5.0 : 1 | AA |
| `#1C1D22` / `#E8742A` (주황 면 위 어두운 글자) | 5.6 : 1 | AA |
| `#FFFFFF` / `#1E3A8A` (네이비 버튼) | 10.4 : 1 | AAA |
| `#FFFFFF` / `#E8742A` | **3.0 : 1** | ❌ 본문 글자로 사용 금지 (큰 제목·아이콘만) |

> 레퍼런스 4처럼 "밝은 주황 + 흰 글자" 버튼은 대비가 부족합니다. 흰 글자 버튼은 `--color-primary-strong`을 쓰세요.

### 2.6 다크 모드

| 토큰 | 라이트 | 다크 |
|---|---|---|
| 페이지 배경 | `#F7F6F3` | `#16171B` |
| 카드 배경 | `#FFFFFF` | `#1F2026` |
| 테두리 | `#DEDBD5` | `#33343C` |
| 본문 텍스트 | `#1C1D22` | `#EDEBE7` |
| 보조 텍스트 | `#6B6560` | `#9C9A96` |
| 주 색 (포인트) | `#E8742A` | `#F29A4A` |
| 보조 색 | `#1E3A8A` | `#6FA8FF` |
| 성공 | `#2F7D4F` | `#5FBF86` |

---

## 3. 타이포그래피

레퍼런스 3은 기하학적인 산세리프(굵고 넓은 영문 헤드라인), 레퍼런스 4는 굵은 한글 고딕 헤드라인을 씁니다. 둘을 합쳐 다음과 같이 정합니다.

| 역할 | 폰트 | 이유 |
|---|---|---|
| 한글 전체 (제목·본문) | **Pretendard** | 굵기 단계가 많고 화면에서 선명함. 레퍼런스 4의 굵은 고딕 헤드라인 느낌 |
| 영문·숫자 제목, 통계 숫자 | **Sora** | 레퍼런스 3의 "10+ / 500+" 같은 기하학적 숫자 스타일 |
| 수치 데이터 (표, 비용, 물량) | **JetBrains Mono** 또는 Pretendard `tabular-nums` | 숫자 폭을 맞춰 표에서 자릿수 정렬 |

```css
@import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css");
@import url("https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap");

--font-sans: "Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
--font-display: "Sora", "Pretendard Variable", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;
```

### 3.1 글자 크기 단계

| 토큰 | 크기 / 줄 간격 | 굵기 | 용도 |
|---|---|---|---|
| `display` | 56px / 1.1 | 700 | 랜딩 히어로 제목 ("건강한 건축문화 집단" 크기) |
| `h1` | 40px / 1.2 | 700 | 페이지 제목 |
| `h2` | 30px / 1.3 | 700 | 섹션 제목 ("Why Switch to Solar?" 크기) |
| `h3` | 22px / 1.4 | 600 | 카드 제목 |
| `h4` | 18px / 1.4 | 600 | 소제목, 표 제목 |
| `body-lg` | 17px / 1.7 | 400 | 소개 문단 |
| `body` | 15px / 1.6 | 400 | 기본 본문 |
| `caption` | 13px / 1.5 | 500 | 보조 설명, 라벨 |
| `stat` | 48px / 1.0 | 600 (Sora) | 통계 숫자 ("2,680+", "50%") |

- 한글 제목은 자간을 `-0.02em`, 본문은 `-0.01em`으로 조금 좁힙니다.
- 모바일에서는 `display` 36px, `h1` 30px, `h2` 24px로 줄입니다.
- 한글 줄바꿈은 `word-break: keep-all`을 씁니다.

---

## 4. 레이아웃·간격

| 항목 | 값 |
|---|---|
| 간격 단위 | 4px 기준: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96` |
| 콘텐츠 최대 폭 | 1200px (앱 대시보드는 1440px) |
| 그리드 | 12열, 열 간격 24px (모바일 4열, 16px) |
| 좌우 여백 | 데스크톱 32px, 모바일 16px |
| 섹션 간격 | 랜딩 96px, 앱 화면 48px |

---

## 5. 모양과 깊이

| 토큰 | 값 | 용도 |
|---|---|---|
| `--radius-sm` | 6px | 입력창, 배지 |
| `--radius-md` | 10px | 버튼, 작은 카드 |
| `--radius-lg` | 16px | 카드, 모달 |
| `--radius-xl` | 24px | 히어로 이미지 (레퍼런스 3의 둥근 히어로) |
| `--radius-full` | 999px | 필(pill) 버튼, 원형 통계 배지 (레퍼런스 3·4) |
| `--shadow-sm` | `0 1px 2px rgba(28,29,34,.06)` | 카드 기본 |
| `--shadow-md` | `0 8px 24px rgba(28,29,34,.08)` | 떠 있는 카드, 드롭다운 |
| `--shadow-lg` | `0 16px 48px rgba(28,29,34,.14)` | 모달 |

그림자는 약하게, 대신 `1px` 테두리(`--gray-200`)로 영역을 나눕니다.

---

## 6. 컴포넌트 기준

### 버튼
| 종류 | 배경 | 글자 | 비고 |
|---|---|---|---|
| Primary | `#B4530F` | `#FFFFFF` | 주요 행동 ("분석 시작", "보고서 내보내기") |
| Secondary | `#1E3A8A` | `#FFFFFF` | 보조 행동, 레퍼런스 3의 "Contact Us" 스타일 |
| Outline | 투명 + `#DEDBD5` 테두리 | `#1C1D22` | 취소, 부가 행동 |
| Ghost | 투명 | `#B4530F` | 텍스트형 링크 버튼 |

- 높이 44px(모바일 터치 기준), 좌우 패딩 20px, `--radius-md`
- 히어로 CTA는 레퍼런스 3처럼 **pill 모양 + 오른쪽 원형 화살표 아이콘**

### 카드
- 기본: 흰 배경, `--radius-lg`, 테두리 `--gray-200`, 패딩 24px
- 강조(어두운) 카드: 레퍼런스 4처럼 `#1C1D22` 배경 + 흰 글자 + 주황 포인트 버튼. 대시보드의 요약 통계에 사용

### 통계 블록 (레퍼런스 3·4)
- 큰 숫자(`stat`, Sora) + 아래 작은 라벨(`caption`, `--gray-600`)
- 예: `50%` 계획 수립 시간 단축 · `70%` 전문가 승인율 · `15%` 운송비 절감

### 배지 (자재 평가 결과)
- 필 모양, 13px, 연한 배경 + 진한 글자
- `재사용 가능`(초록), `검토 필요`(노란 주황), `폐기 대상`(빨강), `신뢰도 낮음`(회색 + 경고 아이콘)

### 면책 배너
PRD에 따라 모든 결과 화면에 표시합니다.
- 배경 `#FBE9DC`, 왼쪽 4px `#E8742A` 선, 경고 아이콘
- 문구 예: "이 결과는 전문가 검토용 1차 스크리닝 자료이며, 최종 해체 지시가 아닙니다."

---

## 7. 이미지·아이콘

- **사진 톤**: 실제 공사·해체 현장 사진(레퍼런스 1·2·5). 히어로에는 노을 실루엣처럼 대비가 강한 사진에 어두운 그라데이션 오버레이(`linear-gradient(180deg, rgba(22,23,27,0) 0%, rgba(22,23,27,.7) 100%)`)를 깔고 흰 제목을 올립니다.
- **히어로 배경 대형 워터마크 글자**: 레퍼런스 3의 "SMARTSOLAR"처럼 흐린 대형 영문 로고 텍스트 (흰색 15% 불투명도)
- **아이콘**: 선형 아이콘, 선 두께 1.75px — [Lucide](https://lucide.dev) 권장. 아이콘 컨테이너는 레퍼런스 3처럼 옅은 배경의 둥근 사각형
- **3D 블록 모델**: 무광 재질, 자재 색은 2.4 도메인 색을 따름. 선택한 블록은 주황 외곽선

---

## 8. CSS 토큰 (바로 쓰기)

```css
:root {
  /* brand */
  --color-primary: #E8742A;
  --color-primary-strong: #B4530F;
  --color-primary-soft: #FBE9DC;
  --color-secondary: #1E3A8A;
  --color-secondary-soft: #E6ECF7;

  /* neutral (concrete) */
  --gray-0: #FFFFFF;
  --gray-50: #F7F6F3;
  --gray-100: #EDEBE7;
  --gray-200: #DEDBD5;
  --gray-400: #B2ABA1;
  --gray-600: #6B6560;
  --gray-800: #312D29;
  --gray-900: #1C1D22;
  --gray-950: #16171B;

  /* status */
  --color-success: #2F7D4F;
  --color-warning: #A15C07;
  --color-danger: #B42318;
  --color-info: #1E3A8A;

  /* domain */
  --material-concrete: #9C9084;
  --material-steel: #4A6FA5;
  --state-reuse: #2F7D4F;
  --state-dispose: #B2ABA1;
  --state-review: #D9B23A;
  --state-current-step: #E8742A;
  --route: #1E3A8A;

  /* semantic */
  --bg: var(--gray-50);
  --surface: var(--gray-0);
  --border: var(--gray-200);
  --text: var(--gray-900);
  --text-muted: var(--gray-600);

  /* type */
  --font-sans: "Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  --font-display: "Sora", "Pretendard Variable", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* shape */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 999px;
  --shadow-sm: 0 1px 2px rgba(28, 29, 34, .06);
  --shadow-md: 0 8px 24px rgba(28, 29, 34, .08);
  --shadow-lg: 0 16px 48px rgba(28, 29, 34, .14);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #16171B;
    --surface: #1F2026;
    --border: #33343C;
    --text: #EDEBE7;
    --text-muted: #9C9A96;
    --color-primary: #F29A4A;
    --color-secondary: #6FA8FF;
    --color-success: #5FBF86;
  }
}
:root[data-theme="dark"] {
  --bg: #16171B;
  --surface: #1F2026;
  --border: #33343C;
  --text: #EDEBE7;
  --text-muted: #9C9A96;
  --color-primary: #F29A4A;
  --color-secondary: #6FA8FF;
  --color-success: #5FBF86;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  word-break: keep-all;
}
```
