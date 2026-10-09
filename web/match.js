// 内容智能匹配的判定逻辑——纯函数，抽出来是为了能脱离浏览器直接测。
//
// 思路：不看用户打了什么字，而是看**他手里是什么东西**。粘一个链接进来，
// "打开链接"这个动作该自己冒出来，不需要先知道插件叫什么。

/**
 * 嗅探一段内容"像什么"。
 * 返回 null 表示看不出特别之处（那就走普通的文字搜索）。
 */
export function detectContent(raw) {
  const t = String(raw ?? '').trim();
  if (!t || t.length > 2000) return null;

  if (/^https?:\/\/\S+$/i.test(t)) return { kind: 'url', label: '链接' };
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(t)) return { kind: 'ip', label: 'IP 地址' };
  if (/^\d{13}$/.test(t)) return { kind: 'timestamp', label: '时间戳（毫秒）' };
  if (/^\d{10}$/.test(t)) return { kind: 'timestamp', label: '时间戳（秒）' };
  if (/^#?[0-9a-f]{6}$/i.test(t)) return { kind: 'color', label: '颜色' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return { kind: 'email', label: '邮箱' };
  if (/^\{[\s\S]*\}$|^\[[\s\S]*\]$/.test(t)) return { kind: 'json', label: 'JSON' };
  if (/^[\w./\\:-]+\.(png|jpe?g|gif|webp|svg|mp4|mp3|pdf|zip|txt|md|json|log)$/i.test(t)) {
    return { kind: 'files', label: '文件' };
  }
  return null;
}

/**
 * 判断某个动作声明的 match 是否命中当前内容。
 *
 * files 类型可以传入真实文件路径列表（拖放进来的）；没有的话就退化成
 * 看输入框里那串文字像不像文件路径。
 */
export function matchFires(match, content, sniffed, files) {
  if (!match) return false;
  switch (match.type) {
    case 'url':
      return sniffed?.kind === 'url';
    case 'files': {
      const list = files?.length ? files : (sniffed?.kind === 'files' ? [content] : []);
      if (list.length === 0) return false;
      if (!match.extensions || match.extensions.length === 0) return true;
      return list.every((f) => match.extensions.includes(String(f).split('.').pop().toLowerCase()));
    }
    case 'regex':
      try {
        return new RegExp(match.pattern).test(content);
      } catch {
        return false;
      }
    case 'text':
      return String(content ?? '').trim().length > 0;
    default:
      return false;
  }
}

export const MATCH_LABEL = { url: '链接', files: '文件', regex: '匹配内容', text: '文本' };