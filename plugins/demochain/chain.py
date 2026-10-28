import json, sys

cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "gen":
    print(json.dumps({"value": 21}))
elif cmd == "double":
    v = int(sys.argv[sys.argv.index("--value") + 1])
    print(json.dumps({"from": v, "doubled": v * 2}))
