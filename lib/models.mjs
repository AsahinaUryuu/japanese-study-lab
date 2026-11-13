import { GradeError, normalizeConnection } from './config.mjs';
import { fetchViaProxy } from './proxy.mjs';
import { readLimited } from './response.mjs';

const MAX_MODELS = 1000;
const MAX_PAGES = 20;
const text = value => typeof value === 'string' ? value.trim() : '';

export function normalizeModelsConfig(config) {
  const connection = normalizeConnection(config);
  const endpoint = new URL(connection.baseUrl);
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + '/models';
  const { baseUrl, ...result } = connection;
  return { ...result, endpoint: endpoint.toString() };
}

function modelItem(item, provider) {
  if (!item || typeof item !== 'object') return null;
  if (provider === 'gemini' && Array.isArray(item.supportedGenerationMethods)
    && !item.supportedGenerationMethods.includes('generateContent')) return null;
  const id = provider === 'gemini' ? text(item.name).replace(/^models\//, '') : text(item.id);
  if (!id || id.length > 200 || /[\s\x00-\x1f\x7f]/.test(id)) return null;
  const name = text(provider === 'gemini' ? item.displayName : item.name).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 300) || id;
  return { id, name };
}

export async function listModels(input, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const config = normalizeModelsConfig(input?.config);
  const headers = { accept: 'application/json' };
  if (config.apiKey) {
    if (config.provider === 'gemini') headers['x-goog-api-key'] = config.apiKey;
    else headers.Authorization = `Bearer ${config.apiKey}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const models = new Map();
  const seenTokens = new Set();
  let pageToken = '';
  let truncated = false;
  try {
    const send = config.proxyUrl ? (url, options) => fetchViaProxy(url, options, config.proxyUrl) : fetchImpl;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(config.endpoint);
      if (config.provider === 'gemini') {
        url.searchParams.set('pageSize', String(MAX_MODELS));
        if (pageToken) url.searchParams.set('pageToken', pageToken);
      }
      const response = await send(url.toString(), { method: 'GET', headers, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        const errors = {
          400: '模型列表请求被拒绝，请检查协议和接口地址。',
          401: 'API Key 无效或已过期，请重新配置。',
          403: '当前密钥或地区没有读取模型列表的权限。',
          404: '服务未提供模型列表接口，请检查地址，或手动填写模型名称。',
          429: '模型服务限流或额度不足，请稍后重试或检查账户额度。'
        };
        throw new GradeError(errors[response.status] || `获取模型列表失败（HTTP ${response.status}），请稍后重试。`, 502);
      }
      const raw = await readLimited(response, 1024 * 1024, '模型列表响应过大，请手动填写模型名称。');
      let result;
      try { result = JSON.parse(raw); }
      catch { throw new GradeError('模型列表接口未返回 JSON，请检查协议和接口地址。', 502); }
      if (!result || typeof result !== 'object' || Array.isArray(result) || result.error) {
        throw new GradeError('模型列表格式不符合所选协议，请检查接口地址，或手动填写模型名称。', 502);
      }
      // Protobuf JSON may omit an empty repeated models field in Gemini responses.
      const items = config.provider === 'gemini' ? (result.models ?? []) : result.data;
      if (!Array.isArray(items)) throw new GradeError('模型列表格式不符合所选协议，请检查接口地址，或手动填写模型名称。', 502);
      for (const item of items) {
        const model = modelItem(item, config.provider);
        if (!model || models.has(model.id)) continue;
        if (models.size >= MAX_MODELS) { truncated = true; break; }
        models.set(model.id, model);
      }
      if (config.provider === 'openai') { truncated ||= result.has_more === true; break; }
      const nextToken = text(result.nextPageToken);
      if (!nextToken) break;
      if (truncated || models.size >= MAX_MODELS || page === MAX_PAGES - 1
        || nextToken.length > 8192 || seenTokens.has(nextToken)) {
        truncated = true;
        break;
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }
    const result = { models: [...models.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), endpoint: config.endpoint };
    if (truncated) result.truncated = true;
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new GradeError('获取模型列表超时，请检查接口地址、网络或本机代理后重试。', 504);
    if (error instanceof GradeError) throw error;
    throw new GradeError('无法连接模型列表接口，请检查接口地址、网络和本机代理设置。', 502);
  } finally { clearTimeout(timer); }
}
