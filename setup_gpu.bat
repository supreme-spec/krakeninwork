@echo off
echo Выбери свою видеокарту:
echo 1. NVIDIA (CUDA)
echo 2. AMD/Intel (DirectML)
echo 3. Только CPU
set /p choice=Введи номер:

if "%choice%"=="1" (
    pip uninstall onnxruntime -y
    pip install onnxruntime-gpu==1.20.1
    echo Установлен ONNX Runtime с поддержкой NVIDIA CUDA
) else if "%choice%"=="2" (
    pip uninstall onnxruntime -y
    pip install onnxruntime-directml==1.20.1
    echo Установлен ONNX Runtime с поддержкой DirectML
) else (
    echo Оставляем CPU версию
)
