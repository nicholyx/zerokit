/**
 * 插件脚手架：`zkit plugin new <id>` 生成一个能直接跑的最小插件骨架。
 *
 * 模板用 TS 模板字符串内嵌而不是模板目录——模板要跟内核版本走（清单规范
 * 变了模板跟着变），也不引入「生成模板的模板」这种递归。
 *
 * 生成的清单必须**直接通过现有校验**（生成完当场 loadDir 自检），注释按
 * 教学式写：第一次写插件的人对着生成的文件就能学会全貌。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ID_RE } from './manifest.ts';
import { type LoadResult } from './manifest.ts';
import { loadDir } from './registry.ts';

export type ScaffoldRuntime = 'node' | 'python';
/** 第三十六轮③：专题模板——chain/setting/http 三种能力的教学骨架。 */
export type ScaffoldExample = 'chain' | 'setting' | 'http';
export const SCAFFOLD_EXAMPLES: readonly ScaffoldExample[] = ['chain', 'setting', 'http'];

export interface ScaffoldOptions {
  /** 显示名，默认取 id */
  name?: string;
  runtime?: ScaffoldRuntime;
  /** 附带 web/index.html 富交互页面骨架（动作 render = "web"） */
  web?: boolean;
  /** 生成到哪个父目录下，默认当前目录 */
  dir?: string;
  /** 专题模板（chain/setting/http）：manifestTmpl 让位给 EXAMPLE_MANIFESTS */
  example?: ScaffoldExample;
}

export interface ScaffoldResult {
  ok: boolean;
  /** 生成的插件目录 */
  dir?: string;
  message: string;
  /** 生成后的加载结果（ok 时保证校验通过） */
  load?: LoadResult;
  /** 生成的文件（相对插件目录的路径） */
  files: string[];
}

/** node/python 各自的入口文件与 run 命令形状 */
function entryFiles(runtime: ScaffoldRuntime, web: boolean): Record<string, string> {
  if (runtime === 'python') {
    return {
      'main.py': PYTHON_MAIN,
      ...(web ? { 'web/index.html': WEB_INDEX } : {}),
    };
  }
  return {
    'main.mjs': NODE_MAIN,
    ...(web ? { 'web/index.html': WEB_INDEX } : {}),
  };
}

function manifestTmpl(id: string, name: string, runtime: ScaffoldRuntime, web: boolean): string {
  const requires = runtime === 'python'
    ? '# python 解释器要在（运行前 zerokit 会检查并给出安装指引）\n[requires]\npython = ">=3.8"\n'
    : '# node 在（写插件的你在用 zerokit，基本都有；声明出来 doctor 能提前发现问题）\n[requires]\nnode = ">=22"\n';
  const run = runtime === 'python'
    ? '["python", "main.py", "{name}"]'
    : '["{node}", "main.mjs", "{name}"]';
  return `# ${name}——由 zkit plugin new 生成的骨架，删掉注释也能直接用。
#
# 这份 plugin.toml 是全系统唯一的事实来源：CLI、MCP 工具、启动器、AI 工作台
# 四个面都从它派生。改它（加动作、加参数），四个面同时跟着变。
#
# 开发方式（改完即生效，不用反复装卸）：
#   zkit plugin dev ${id}        # 以链接方式装进插件目录
#   zkit run ${id} hello         # 跑起来看看
#   zkit plugin validate .       # 随手校验清单
#   zkit plugin add .            # 满意后转成正式副本

[plugin]
id       = "${id}"
name     = "${name}"
version  = "0.1.0"
summary  = "一句话说清这个插件干什么（会显示在启动器搜索里）"
keywords = ["${id}"]

${requires}\
# ---------------------------------------------------------------- 动作
# 一个动作 = 一个可以被四个面调用的能力。id 是 ASCII（会拼进 MCP 工具名），
# risk 决定调用前的确认策略：read 放行 / mutate 首次确认 / destructive 每次都问。

[[action]]
id          = "hello"
title       = "打招呼"
description = "示例动作：把传进来的名字放进一句问候。改成你的第一个真动作，或者删掉换新的。"
run         = ${run}
output      = "text"
${web ? '# render = "web"：结果交给本插件 web/index.html 渲染（富交互页面，能通过 zkit.run 桥调本插件其它动作）\nrender      = "web"\n' : ''}risk        = "read"

  # 参数声明一次，四个面同时多出这个入口：CLI 变 --name、MCP/表单变字段。
  [[action.param]]
  name        = "name"
  type        = "string"
  default     = "世界"
  description = "要问候的名字"
`;
}

const NODE_MAIN = `// 动作实现：zerokit 把参数作为 argv 元素直接传进来（见 plugin.toml 的 run），
// stdout 就是动作的输出。argv 的顺序和 run 里 {name} 占位符的位置一一对应。
const args = process.argv.slice(2);

// 单文件插件建议不引第三方包——zerokit 插件的价值之一就是零依赖可搬运。
// 要定位自己目录里的文件，用 import.meta.dirname（不要依赖工作目录）。
const name = args[0] || '世界';
console.log(\`你好，\${name}！这是你的第一个 zerokit 插件动作。\`);

// 下一步可以试的事：
//   - output 改成 "json" 并 console.log(JSON.stringify({...}))，启动器会渲染成卡片
//   - 再加一个 [[action]]（记得有自己的 id 和 risk）
//   - 参数类型换成 integer / boolean / enum / path，四个面的表单会跟着变
`;

const PYTHON_MAIN = `# 动作实现：zerokit 把参数作为 argv 元素直接传进来（见 plugin.toml 的 run），
# stdout 就是动作的输出。内核统一按 UTF-8 处理子进程输出，不用担心编码。
import sys

# 单文件脚本建议只用标准库——zerokit 插件的价值之一就是零依赖可搬运。
# 要定位自己目录里的文件，用 Path(__file__).parent（不要依赖工作目录）。
name = sys.argv[1] if len(sys.argv) > 1 else "世界"
print(f"你好，{name}！这是你的第一个 zerokit 插件动作。")
`;

const WEB_INDEX = `<!DOCTYPE html>
<!-- 富交互页面骨架：render = "web" 的动作结果会交给这个页面渲染。
     内核托管本文件时自动注入桥脚本（zkit-bridge.js），不要（也不能）引任何外部脚本。
     页面跑在 sandbox iframe 里，拿不到宿主令牌——执行只能走桥，
     mutate/destructive 动作的确认弹窗由宿主统一处理，绕不过。
     约定：zkit.ready(boot) 等桥就绪；上下文在 zkit.context（result.data 是触发
     本页面的动作输出，params 是用户当时填的参数）；zkit.run(actionId, 参数) 调
     本插件的其它动作；zkit.hosted 判断是否在宿主里（直接打开文件时优雅降级）。 -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>插件页面</title>
<style>
  :root { color-scheme: dark; }
  body {
    font: 14px/1.7 -apple-system, "Segoe UI", "PingFang SC", sans-serif;
    background: #14171c; color: #e6e9ef; padding: 16px; margin: 0;
  }
  pre { background: #1b1f26; border: 1px solid #262c36; border-radius: 8px; padding: 10px; white-space: pre-wrap; }
  button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 0; background: #2271f0; color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <div id="out">等待动作结果…</div>
  <p><button id="rerun">再跑一次 hello</button></p>
  <pre id="raw"></pre>
<script>
  function render(result) {
    var out = document.getElementById('out');
    var raw = document.getElementById('raw');
    if (result && result.error) { out.textContent = '出错：' + result.error; return; }
    out.textContent = (result && result.data) || '';
    raw.textContent = JSON.stringify(result, null, 2);
    if (window.zkit && window.zkit.hosted) {
      window.zkit.setHeight(Math.max(document.body.scrollHeight, 80));
    }
  }
  function boot() {
    var ctx = window.zkit ? window.zkit.context : null;
    render(ctx && ctx.result);
    var btn = document.getElementById('rerun');
    if (!window.zkit || !window.zkit.hosted) {
      btn.disabled = true;   // 直接打开文件时没有桥，按钮点了也没用，如实禁用
      return;
    }
    btn.addEventListener('click', function () {
      window.zkit.run('hello', { name: '插件作者' }).then(render);
    });
  }
  if (window.zkit) window.zkit.ready(boot);
  else boot();
</script>
</body>
</html>
`;

// ---------------- 第三十六轮③：专题模板（chain / setting / http） ----------------

const EXAMPLE_MANIFESTS: Record<ScaffoldExample, { files: Record<string, string>; manifest: (id: string, name: string) => string }> = {
  chain: {
    files: {
      'chain.py': '# 组合动作演示：get 产出数据，use 拿上一步的结果加工。\n# {别名.data.字段} 取上一步的结构化输出；risk 必须 ≥ 每一步（fail-closed）。\nimport json, sys\n\ncmd = sys.argv[1] if len(sys.argv) > 1 else ""\nif cmd == "get":\n    print(json.dumps({"value": 21}))\nelif cmd == "use":\n    v = int(sys.argv[sys.argv.index("--value") + 1])\n    print(json.dumps({"doubled": v * 2, "from": v}))\n',
      'README.md': '# 组合动作（chain）示例\n\n`zkit run ID pipeline`：第一步产出 21，第二步翻倍成 42。\n\n规则：步骤按序执行；risk 取各步最大；禁嵌套/后台步骤。\n',
    },
    manifest: (id, name) => `# ${name}——组合动作（type=chain）教学骨架。\n# 两步：get 取数 → use 加工。真实场景：先查询再加工、先备份再清理。\n[plugin]\nid       = "${id}"\nname     = "${name}"\nversion  = "0.1.0"\nsummary  = "组合动作演示：把两步串成一条流水线"\nkeywords = ["chain", "示例"]\n\n[[action]]\nid          = "get"\ntitle       = "取数据"\ndescription = "链路第一步：产出一个数给后面的步骤用。"\nrisk        = "read"\nrun         = ["{python}", "chain.py", "get"]\noutput      = "json"\n\n[[action]]\nid          = "use"\ntitle       = "翻倍"\ndescription = "把传进来的数翻倍。独立可用，也作为链路第二步。"\nrisk        = "read"\nrun         = ["{python}", "chain.py", "use", "--value", "{value}"]\noutput      = "json"\n\n  [[action.param]]\n  name        = "value"\n  type        = "integer"\n  description = "要翻倍的数"\n\n[[action]]\nid          = "pipeline"\ntitle       = "取数再翻倍"\ndescription = "组合动作：先跑 get，再跑 use 并把 get 的结果传进去。"\nrisk        = "read"\ntype        = "chain"\ntemplate    = "{first.data.value} 翻倍后是 {result.data.doubled}"\n\n  [[action.step]]\n  use = "self.get"\n  as  = "first"\n\n  [[action.step]]\n  use    = "self.use"\n  as     = "result"\n  params = { value = "{first.data.value}" }\n`,
  },
  setting: {
    files: {
      'settings_demo.py': '# 设置项演示：读 [[setting]] 声明的用户配置。\n# 非秘密值走 {setting.名} 占位符；secret 只走 ZEROKIT_SETTING_<NAME> 环境变量（不落命令行）。\nimport json, os\n\ngreeting = os.environ.get("ZEROKIT_SETTING_GREETING", "你好")\ntoken = os.environ.get("ZEROKIT_SETTING_API_TOKEN", "")\nprint(json.dumps({\n    "greeting": greeting,\n    "token_present": bool(token),\n    "token_masked": (token[:2] + "***") if token else "(未配置)",\n}, ensure_ascii=False))\n',
      'README.md': '# 设置项（[[setting]]）示例\n\n```\nzkit config ID api_token    # 写入 secret（不回显）\nzkit run ID greet\n```\n\n设置存在 ~/.zerokit/settings/ID.json（0600）；secret 只回掩码。\n',
    },
    manifest: (id, name) => `# ${name}——设置项教学骨架。\n# [[setting]] 声明的配置由用户填写、存在数据目录；动作经占位符/环境变量读取。\n[plugin]\nid       = "${id}"\nname     = "${name}"\nversion  = "0.1.0"\nsummary  = "设置项演示：用户配置与 secret 的正确用法"\nkeywords = ["setting", "示例"]\n\n[[setting]]\nname        = "greeting"\ntitle       = "问候语"\ndescription = "打招呼的开头语"\ntype        = "string"\ndefault     = "你好"\n\n[[setting]]\nname        = "api_token"\ntitle       = "API 令牌"\ndescription = "演示 secret：命令行与结果里都不会出现明文"\ntype        = "string"\nsecret      = true\n\n[[action]]\nid          = "greet"\ntitle       = "按设置打招呼"\ndescription = "读取用户设置并使用；secret 只验证存在不回显。"\nrisk        = "read"\nrun         = ["{python}", "settings_demo.py"]\n`,
  },
  http: {
    files: {
      'README.md': '# HTTP 动作示例\n\n`zkit run ID fetch` 取 zerokit 仓库信息。\n\nHTTP 动作不需要脚本文件：内核发请求（走系统代理或 config.toml [proxy]），headers 支持占位符，pick 挑字段。\n',
    },
    manifest: (id, name) => `# ${name}——HTTP 动作教学骨架。\n# type = "http"：内核发请求，响应 JSON 自动成为结构化结果。\n[plugin]\nid       = "${id}"\nname     = "${name}"\nversion  = "0.1.0"\nsummary  = "HTTP 动作演示：取 GitHub 仓库信息"\nkeywords = ["http", "示例"]\n\n[[action]]\nid          = "fetch"\ntitle       = "取仓库信息"\ndescription = "GET 一个公开 API 并挑出关键字段。什么场景用：查 GitHub 仓库概况。"\nrisk        = "read"\n\ntype    = "http"\nmethod  = "GET"\nurl     = "https://api.github.com/repos/nicholyx/zerokit"\npick    = ["full_name", "description", "stargazers_count"]\n\n[[action.param]]\nname        = "ua"\ntype        = "string"\ndefault     = "zerokit-demo"\ndescription = "User-Agent（GitHub API 必需）"\n\n[headers]\nUser-Agent = "{ua}"\n`,
  },
};

/** 生成插件骨架。目录已存在时拒绝（绝不覆盖任何已有文件）。 */
export function scaffoldPlugin(id: string, opts: ScaffoldOptions = {}): ScaffoldResult {
  if (!ID_RE.test(id)) {
    return {
      ok: false,
      files: [],
      message: `插件 id "${id}" 非法：只允许小写字母、数字、点、下划线、连字符，且以字母/数字开头（要能拼进 MCP 工具名）`,
    };
  }
  const runtime = opts.runtime ?? 'node';
  const parent = path.resolve(opts.dir ?? '.');
  const target = path.join(parent, id);
  if (fs.existsSync(target)) {
    return { ok: false, dir: target, files: [], message: `${target} 已存在，换个 id 或用 --dir 指定别的位置` };
  }
  const name = opts.name || id;
  const files: Record<string, string> = opts.example
    ? {
        'plugin.toml': EXAMPLE_MANIFESTS[opts.example].manifest(id, name),
        ...EXAMPLE_MANIFESTS[opts.example].files,
      }
    : {
    'plugin.toml': manifestTmpl(id, name, runtime, opts.web ?? false),
    ...entryFiles(runtime, opts.web ?? false),
    'README.md': `# ${name}\n\n由 \`zkit plugin new\` 生成的 zerokit 插件骨架。\n\n## 开发\n\n\`\`\`bash\nzkit plugin dev .      # 进入开发模式（改文件即生效）\nzkit run ${id} hello   # 跑起来\nzkit plugin validate . # 校验清单\n\`\`\`\n\n## 发布\n\n\`\`\`bash\nzkit plugin add .          # 转成正式副本\nzkit plugin export ${id}   # 打包成 .toolpack 单文件\n\`\`\`\n\n完整规范见 zerokit 仓库的 docs/plugin-spec.md。\n\n> 开发模式会在本目录写 \`.zerokit-source.json\`（zerokit 的来源记录），建议加进 .gitignore。\n`,
    };
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(target, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  } catch (e) {
    // 生成一半失败就把整个目录收掉，不留半个骨架
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: false, dir: target, files: [], message: `写文件失败：${(e as Error).message}` };
  }
  // 生成物必须当场通过校验——模板与校验规则不一致是脚手架的 bug，不能交给用户去发现
  const load = loadDir(target);
  if (!load.plugin) {
    const errs = load.errors.join('\n  - ');
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: false, files: [], message: `生成的清单没通过校验（这是脚手架的 bug，请提 issue）：\n  - ${errs}` };
  }
  return { ok: true, dir: target, message: `已生成插件骨架`, load, files: Object.keys(files) };
}
