@echo off
echo ==========================================
echo  KRAKEN - Installing Dependencies
echo ==========================================
echo.

echo [1/5] Removing old venv...
if exist venv rmdir /s /q venv
if exist venv_new rmdir /s /q venv_new
echo Done!
echo.

echo [2/5] Creating new virtual environment...
python -m venv venv
echo Done!
echo.

echo [3/5] Updating pip...
call venv\Scripts\pip.exe install --upgrade pip
echo Done!
echo.

echo [4/5] Installing Python dependencies from requirements.txt...
call venv\Scripts\pip.exe install -r requirements.txt
if errorlevel 1 (
    echo Error installing Python dependencies!
    pause
    exit /b 1
)
echo Done!
echo.

echo [5/5] Installing Node.js dependencies...
if exist package-lock.json del package-lock.json
call npm.cmd install
if errorlevel 1 (
    echo Error installing Node.js dependencies!
    pause
    exit /b 1
)
echo Done!
echo.

echo ==========================================
echo  Installation complete! 🎉
echo ==========================================
echo.
echo Now you can run the project with:
echo npm run dev
echo.
pause
