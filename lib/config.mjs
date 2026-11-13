export class GradeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const isLocal = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
const text = value => typeof value === 'string' ? value.trim() : '';

// Model discovery and grading share connection validation, but discovery needs no model.
export function normalizeConnection(config) {
  if (!config || !['openai', 'gemini'].includes(config.provider)) {
    throw new GradeError('请选择 OpenAI 兼容协议或 Gemini 协议。');
  }
  const provider = config.provider;
  const base = text(config.baseUrl) || (provider === 'gemini'
    ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1');
  if (base.length > 2048) throw new GradeError('接口地址过长。');
  let endpoint;
  try { endpoint = new URL(base); } catch { throw new GradeError('接口地址应为完整的 http:// 或 https:// 地址。'); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new GradeError('接口地址不能带用户名、密码、查询参数或锚点；请把密钥填在 API Key 中。');
  }
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && isLocal(endpoint.hostname))) {
    throw new GradeError('远程接口必须使用 HTTPS；本机 localhost/127.0.0.1 可以使用 HTTP。');
  }
  const apiKey = text(config.apiKey);
  if ((!apiKey && !isLocal(endpoint.hostname)) || apiKey.length > 8192 || /[\r\n]/.test(apiKey)) {
    throw new GradeError('请填写 API Key；只有本机模型服务可以留空。');
  }
  let pathname = endpoint.pathname.replace(/\/+$/, '');
  if (!pathname) pathname = provider === 'gemini' ? '/v1beta' : '/v1';
  pathname = provider === 'openai'
    ? pathname.replace(/\/(?:chat\/completions|models)$/, '')
    : pathname.replace(/\/models(?:\/[^/]+:generateContent)?$/, '');
  endpoint.pathname = pathname;
  let proxyUrl = '';
  const proxyInput = text(config.proxyUrl);
  if (proxyInput) {
    let proxy;
    try { proxy = new URL(proxyInput); } catch { throw new GradeError('代理地址格式不正确，例如 http://127.0.0.1:7897。'); }
    if (proxyInput.length > 2048 || proxy.protocol !== 'http:' || !isLocal(proxy.hostname)
      || proxy.username || proxy.password || proxy.search || proxy.hash || (proxy.pathname && proxy.pathname !== '/')) {
      throw new GradeError('代理只支持本机、无认证的 HTTP 地址，例如 http://127.0.0.1:7897；不要填写用户名或密钥。');
    }
    proxyUrl = proxy.toString();
  }
  return { provider, apiKey, proxyUrl, baseUrl: endpoint.toString() };
}
