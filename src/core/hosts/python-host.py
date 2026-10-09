# -*- coding: utf-8 -*-
"""zerokit 的 Python 常驻宿主。

为什么需要它：起一个 python 解释器本身就要 200~250ms，而插件脚本里的
import（ssl / ctypes / subprocess 这些）又要一次。实测 `proxy.py status`
每调用一次要 476ms，而放进常驻宿主里反复执行只要 **22ms**（21 倍）。

原理很简单：**同一个解释器进程里反复执行脚本**。模块缓存（sys.modules）保留，
所以 import 只付一次。

代价是语义变了，所以必须由插件显式声明 runtime = "host"：
  - 模块级状态在多次调用之间**会保留**（全局变量会被重新赋值，但 import 的模块是同一个）
  - 脚本不能读 stdin（那条通道是协议用的）
  - 脚本不能用 os.write(1, ...) 直接写文件描述符（会污染协议）
  - 脚本里 os.chdir 会改变宿主的工作目录（所以每次调用前我们会重新 chdir）

协议：stdin/stdout 上一行一条 JSON。
  请求 {"id": "...", "script": "...", "argv": [...], "cwd": "..."}
  响应 {"id": "...", "exitCode": 0, "stdout": "...", "stderr": "..."}
"""

import contextlib
import io
import json
import os
import sys
import traceback


def _run(req):
    script = req["script"]
    cwd = req.get("cwd")
    if cwd:
        try:
            os.chdir(cwd)
        except OSError:
            pass

    sys.argv = [script] + list(req.get("argv") or [])
    out, err = io.StringIO(), io.StringIO()
    code = 0

    # 关键：脚本目录要放在 sys.path[0]，和 `python script.py` 的行为一致。
    # 宿主自己的目录在 sys.path[0] 的话，插件 import 自己的同级模块会失败——
    # 这种"只在常驻模式下才出现"的差异最难查，所以必须对齐。
    script_dir = os.path.dirname(os.path.abspath(script))
    saved_path = list(sys.path)
    sys.path.insert(0, script_dir)

    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            with open(script, "rb") as f:
                src = f.read()
            # 每次都用**全新的 globals**：这样脚本里的模块级变量不会跨调用串味，
            # 而 import 的模块仍然命中 sys.modules 缓存——这正是快的来源。
            exec(compile(src, script, "exec"),
                 {"__name__": "__main__", "__file__": script})
        except SystemExit as e:
            # 插件用 sys.exit() 退出是常态，不能当成错误
            if e.code is None:
                code = 0
            elif isinstance(e.code, int):
                code = e.code
            else:
                code = 1
                err.write(str(e.code) + "\n")
        except BaseException:
            code = 1
            err.write(traceback.format_exc())
        finally:
            sys.path[:] = saved_path

    return {"id": req.get("id"), "exitCode": code,
            "stdout": out.getvalue(), "stderr": err.getvalue()}


def main():
    # 协议走 stdout，所以插件自己的输出必须被重定向走；这里的写必须是原子的
    proto = sys.stdout
    while True:
        line = sys.stdin.readline()
        if not line:
            break                      # stdin 关了 = 宿主没了，跟着退出
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        try:
            resp = _run(req)
        except BaseException:
            resp = {"id": None, "exitCode": 1, "stdout": "",
                    "stderr": traceback.format_exc()}
        proto.write(json.dumps(resp, ensure_ascii=False) + "\n")
        proto.flush()


if __name__ == "__main__":
    main()