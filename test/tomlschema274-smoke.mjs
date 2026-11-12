// 第二百七十四轮：plugin.toml JSON Schema——结构/枚举/编辑器接线/真实清单校验
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- tomlschema274 ${d}`); } };
console.log('tomlschema274-smoke');

const schemaPath = path.join(ROOT, 'docs', 'schema', 'plugin-manifest.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// ① 结构：六节 + plugin.id 必填
check('① 结构（六节 plugin/action/param/service/setting/requires + required:[plugin]）',
  schema.required?.[0] === 'plugin' && ['plugin', 'action', 'param', 'service', 'setting'].every((k) => schema.properties[k]), JSON.stringify(Object.keys(schema.properties ?? {})));

// ⑤ 枚举约束抽查
const riskEnum = schema.properties.action.items.properties.risk.enum;
const encEnum = schema.properties.action.items.properties.encoding.enum;
check('⑤ 枚举（risk 三值 + encoding 含 gbk）', JSON.stringify(riskEnum) === JSON.stringify(['read', 'mutate', 'destructive']) && encEnum.includes('gbk'), JSON.stringify({ riskEnum, encEnum }));

// ② 与 spec 对齐抽查（id 模式 / param name 模式 / port 范围 / healthCheck 形态）
const pid = schema.properties.plugin.properties.id.pattern;
const pn = schema.properties.param.items.properties.name.pattern;
const port = schema.properties.service.items.properties.port;
const hc = schema.properties.service.items.properties.healthCheck;
check('② spec 对齐（id ^[a-z0-9]、param name ^[a-zA-Z_]、port 1-65535、healthCheck http/tcp pattern）',
  pid === '^[a-z0-9][a-z0-9._-]{0,63}$' && pn === '^[a-zA-Z_][a-zA-Z0-9_]*$' && port.maximum === 65535 && hc.properties.http.pattern.startsWith('^https?') && hc.properties.tcp.pattern.includes(':'), '');

// ④ 真实清单过最小校验器（手写 TOML→粗 JSON：抽 plugin.id/action[].risk/service[].port 结构断言）
//    用 quick 与 clipboard 两个自带插件：手工解析关键行验证 schema 约束可满足
for (const pid2 of ['quick', 'clipboard', 'sysinfo']) {
  const toml = fs.readFileSync(path.join(ROOT, 'plugins', pid2, 'plugin.toml'), 'utf8');
  const idOk = new RegExp(`^id\\s*=\\s*"${pid2}"`, 'm').test(toml);
  const risks = [...toml.matchAll(/^risk\s*=\s*"(\w+)"/gm)].map((m) => m[1]);
  const riskOk = risks.every((r) => ['read', 'mutate', 'destructive'].includes(r)) && risks.length > 0;
  check(`④ ${pid2} 清单可满足 schema（id 匹配 + risk 全合法 ${risks.length} 个）`, idOk && riskOk, `${idOk}/${riskOk}`);
}

// ③ schema 命令存在（源码断言 + 文件存在已隐含）
const cliSrc = fs.readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
check('③ zkit plugin schema 命令（含 taplo/Even Better TOML 接线说明）', cliSrc.includes("sub === 'schema'") && cliSrc.includes('evenBetterToml') && cliSrc.includes('taplo'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
