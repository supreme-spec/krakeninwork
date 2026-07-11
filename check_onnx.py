#!/usr/bin/env python3

import onnx
from pathlib import Path

models_dir = Path(__file__).parent / "models" / "buffalo_l"

for onnx_file in sorted(models_dir.glob("*.onnx")):
    print(f"\nChecking {onnx_file.name}...")
    try:
        model = onnx.load(onnx_file)
        graph = model.graph
        print("  Inputs:")
        for inp in graph.input:
            shape = []
            for d in inp.type.tensor_type.shape.dim:
                shape.append(d.dim_value if d.dim_value > 0 else "?")
            print(f"    - {inp.name}: {shape}")
        print("  Outputs:")
        num_outputs = len(graph.output)
        print(f"    Count: {num_outputs}")
        for out in graph.output:
            print(f"    - {out.name}")
    except Exception as e:
        print(f"  Error: {e}")
