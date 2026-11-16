@echo off
rem ReClaim 무인 실행: inbox 폴더의 .rvt를 모두 해체 분석하고 결과 서버로 보낸다.
rem 작업 스케줄러에 이 파일을 걸어 두면 자동으로 돈다. 설정: %USERPROFILE%\reclaim_config.json
rem 모델 목록은 reclaim_batch.py가 설정의 inbox 폴더를 직접 읽는다 (한글 파일 이름 때문).
rem 성공한 모델은 inbox\done, 실패한 모델은 inbox\failed로 옮긴다. 로그: out_dir\reclaim_batch.log
chcp 65001 >nul
set HERE=%~dp0
where pyrevit >nul 2>nul || set "PATH=%PATH%;C:\pyRevit-Master\bin;%APPDATA%\pyRevit-Master\bin"
pushd "%HERE%..\.." && git pull --ff-only & popd
pyrevit run "%HERE%reclaim_batch.py" --revit=2027
