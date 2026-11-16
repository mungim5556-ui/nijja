@echo off
rem ReClaim 무인 실행: inbox 폴더의 .rvt를 모두 해체 분석하고 결과 서버로 보낸다.
rem 작업 스케줄러에 이 파일을 걸어 두면 자동으로 돈다. 설정: %USERPROFILE%\reclaim_config.json
chcp 65001 >nul
set HERE=%~dp0
set INBOX=C:\ReClaim\inbox
if not exist "%INBOX%" mkdir "%INBOX%"
(for %%F in ("%INBOX%\*.rvt") do @echo %%~fF) > "%HERE%models.txt"
for %%A in ("%HERE%models.txt") do if %%~zA==0 (echo inbox가 비어 있습니다: %INBOX% & exit /b 0)
pushd "%HERE%..\.." && git pull --ff-only & popd
pyrevit run "%HERE%reclaim_batch.py" "%HERE%models.txt" --revit=2027
rem 처리한 모델은 done 폴더로 옮겨 다음 실행에서 다시 돌지 않게 한다
if not exist "%INBOX%\done" mkdir "%INBOX%\done"
for /f "usebackq delims=" %%F in ("%HERE%models.txt") do move /y "%%F" "%INBOX%\done\" >nul
