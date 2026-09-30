@echo off
cd /d "%~dp0"
python run.py
if errorlevel 1 (
  echo.
  echo Terjadi error di atas. Jendela ini sengaja tidak tertutup supaya pesannya bisa dibaca.
)
pause