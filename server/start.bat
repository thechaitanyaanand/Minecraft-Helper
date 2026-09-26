@echo off
cd /d "%~dp0"
"..\tools\jdk-21\bin\java.exe" -Xms2G -Xmx4G -jar paper-1.20.4.jar --nogui
pause
