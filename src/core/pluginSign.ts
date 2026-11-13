/**
 * 第二百八十二轮：插件签名链最小实现（ed25519，零依赖——Node 内置 crypto）。
 * 供应链信任的第一环：keygen → pack 签名 → install 校验。
 * 兼容策略：无签名包/无公钥 = 现有行为不变；有签名且本地有公钥 = 强校验。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './paths.ts';

export interface ToolpackSignature {
  algo: 'ed25519';
  /** 公钥指纹（sha256 of SPKI DER 前 16 hex——人可核对） */
  keyId: string;
  /** 对 .toolpack 内容区（除 sig 段外全文序列化）的签名 base64 */
  sig: string;
}

export function keysDir(): string {
  return path.join(HOME, 'keys');
}

/** ① 生成密钥对：私钥 0600 落 keys/default.ed25519；公钥同目录 .pub；返回指纹 */
export function keygen(label = 'default'): { keyId: string; privateKeyPath: string; publicKeyPath: string } {
  const dir = keysDir();
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privPath = path.join(dir, `${label}.ed25519`);
  const pubPath = `${privPath}.pub`;
  fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  return { keyId: keyIdOf(publicKey), privateKeyPath: privPath, publicKeyPath: pubPath };
}

export function keyIdOf(publicKey: crypto.KeyObject): string {
  return crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
}

/** 加载本机私钥（用于 pack 签名）；无则 null */
export function loadPrivateKey(label = 'default'): crypto.KeyObject | null {
  const p = path.join(keysDir(), `${label}.ed25519`);
  try { return crypto.createPrivateKey(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** 加载本机公钥集（keys/*.pub——用于 install 校验；返回 keyId → KeyObject） */
export function loadTrustedPublicKeys(): Map<string, crypto.KeyObject> {
  const out = new Map<string, crypto.KeyObject>();
  try {
    for (const f of fs.readdirSync(keysDir()).filter((x) => x.endsWith('.pub'))) {
      try {
        const pub = crypto.createPublicKey(fs.readFileSync(path.join(keysDir(), f), 'utf8'));
        out.set(keyIdOf(pub), pub);
      } catch { /* 坏公钥跳过 */ }
    }
  } catch { /* 无 keys 目录 */ }
  return out;
}

/** ② 签名：对 payload（JSON 无 sig 字段的规范串）签名 */
export function signPayload(payload: unknown, privateKey: crypto.KeyObject): ToolpackSignature {
  const data = Buffer.from(canonicalJson(payload));
  const sig = crypto.sign(null, data, privateKey);
  return { algo: 'ed25519', keyId: keyIdOf(privateKeyAsPublic(privateKey)), sig: sig.toString('base64') };
}

/** ③ 校验：payload + sig → bool（公钥按 keyId 从 trusted 取） */
export function verifyPayload(payload: unknown, sigInfo: ToolpackSignature, trusted: Map<string, crypto.KeyObject>): boolean {
  const pub = trusted.get(sigInfo.keyId);
  if (!pub) return false;
  try {
    return crypto.verify(null, Buffer.from(canonicalJson(payload)), pub, Buffer.from(sigInfo.sig, 'base64'));
  } catch { return false; }
}

function privateKeyAsPublic(priv: crypto.KeyObject): crypto.KeyObject {
  return crypto.createPublicKey(priv);
}

/** 规范 JSON：键排序无空格——签名与校验两侧一致 */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export { canonicalJson };
