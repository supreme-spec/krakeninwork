#!/bin/bash

echo "========================================"
echo " KRAKEN - GPU Setup Script"
echo "========================================"
echo

# Check for NVIDIA CUDA
if command -v nvidia-smi &> /dev/null; then
    echo "[+] Обнаружено NVIDIA GPU! Устанавливаем onnxruntime-gpu..."
    ./venv/bin/pip install onnxruntime-gpu==1.20.1
elif [ "$(uname)" == "Linux" ]; then
    echo "[?] NVIDIA GPU не найден, проверка AMD ROCm / Intel OpenVINO..."
    echo
    read -p "У вас есть AMD GPU с ROCm (y/n)? " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "[+] Устанавливаем onnxruntime-rocm..."
        ./venv/bin/pip install onnxruntime-rocm==1.20.1
    else
        read -p "У вас есть Intel GPU/CPU и хотите OpenVINO (y/n)? " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "[+] Устанавливаем onnxruntime-openvino..."
            ./venv/bin/pip install onnxruntime-openvino==1.20.1
        else
            echo "[-] Оставляем CPU-only (onnxruntime)"
        fi
    fi
else
    echo "[-] macOS, оставляем CPU-only (onnxruntime)"
fi

echo
echo "========================================"
echo " Готово!"
echo "========================================"
