/**
 * 安全地将值转为 JSON 字符串存入数据库
 * - 如果已经是合法 JSON 字符串，直接返回
 * - 如果是对象/数组，JSON.stringify
 * - 如果是 "[object Object]" 这类坏数据，返回 null
 */
function safeStringify(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    // 已经是字符串：检查是否是合法 JSON
    try {
      JSON.parse(value);
      return value; // 合法 JSON 字符串，直接用
    } catch (e) {
      // 不是合法 JSON（如 "[object Object]"），转换它
      console.warn('[safeStringify] 非法JSON字符串，尝试重新序列化:', value.substring(0, 50));
      return fallback;
    }
  }
  // 对象/数组，正常序列化
  try {
    return JSON.stringify(value);
  } catch (e) {
    console.error('[safeStringify] JSON.stringify 失败:', e.message);
    return fallback;
  }
}

/**
 * 安全地解析数据库里的 JSON 字段
 * - 如果是 null/undefined，返回 defaultValue
 * - 如果是对象（mysql2 可能自动解析 JSON 列），直接返回
 * - 如果是字符串，尝试 JSON.parse；失败则返回 defaultValue
 */
function safeJsonParse(value, defaultValue = null) {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'object') return value; // mysql2 已自动解析
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      console.warn('[safeJsonParse] 解析失败，值:', value.substring(0, 80), '错误:', e.message);
      return defaultValue;
    }
  }
  return defaultValue;
}

module.exports = { safeStringify, safeJsonParse };
