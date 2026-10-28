import json, os

greeting = os.environ.get("ZEROKIT_SETTING_GREETING", "你好")
token = os.environ.get("ZEROKIT_SETTING_API_TOKEN", "")
print(json.dumps({
    "greeting": greeting,
    "token_present": bool(token),
    "token_masked": (token[:2] + "***") if token else "(未配置)",
}, ensure_ascii=False))
