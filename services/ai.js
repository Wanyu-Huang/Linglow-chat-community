const axios = require('axios');
const db = require('../config/database');

async function getUserApiConfig(userId) {
  const [configs] = await db.execute(
    'SELECT api_key, api_base_url, model_name FROM user_config WHERE user_id = ?',
    [userId]
  );

  if (configs.length === 0 || !configs[0].api_key) {
    throw new Error('请先在设置中配置API Key');
  }

  return {
    apiKey: configs[0].api_key,
    apiBaseUrl: configs[0].api_base_url || 'https://api.openai.com',
    modelName: configs[0].model_name || 'gpt-3.5-turbo',
  };
}

async function getCharacterApiConfig(userId, characterId) {
  // 查角色绑定的api_config_id
  const [chars] = await db.execute(
    'SELECT api_config_id FROM characters WHERE user_id = ? AND character_id = ?',
    [userId, characterId]
  );
  if (chars.length > 0 && chars[0].api_config_id) {
    const [cfgs] = await db.execute(
      'SELECT api_key, api_url, model_name FROM api_configs WHERE id = ? AND user_id = ?',
      [chars[0].api_config_id, userId]
    );
    if (cfgs.length > 0 && cfgs[0].api_key) {
      return { apiKey: cfgs[0].api_key, apiBaseUrl: cfgs[0].api_url, modelName: cfgs[0].model_name };
    }
  }
  // 降级：用api_configs里的默认配置
  const [defaults] = await db.execute(
    'SELECT api_key, api_url, model_name FROM api_configs WHERE user_id = ? AND is_default = TRUE LIMIT 1',
    [userId]
  );
  if (defaults.length > 0 && defaults[0].api_key) {
    return { apiKey: defaults[0].api_key, apiBaseUrl: defaults[0].api_url, modelName: defaults[0].model_name };
  }
  // 最终降级：旧的user_config
  return await getUserApiConfig(userId);
}

async function callAI(userId, messages, model = null, characterId = null) {
  const config = characterId
    ? await getCharacterApiConfig(userId, characterId)
    : await getUserApiConfig(userId);
  const modelToUse = model || config.modelName;

  // 智能处理 baseUrl，防止 /v1 重复
  // 支持三种格式：
  //   https://api.openai.com         → https://api.openai.com/v1/chat/completions
  //   https://api.openai.com/v1      → https://api.openai.com/v1/chat/completions
  //   https://api.openai.com/v1/     → https://api.openai.com/v1/chat/completions
  let baseUrl = (config.apiBaseUrl || 'https://api.openai.com').replace(/\/+$/, '');
  if (baseUrl.endsWith('/v1')) {
    baseUrl = baseUrl.slice(0, -3);
  }
  const endpoint = `${baseUrl}/v1/chat/completions`;

  console.log('[AI] 调用端点:', endpoint, '模型:', modelToUse, '消息数:', messages.length);

  try {
    const response = await axios.post(
      endpoint,
      {
        model: modelToUse,
        messages: messages,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        timeout: 120000,
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error('[AI] 调用失败:', detail, '端点:', endpoint);
    throw new Error('AI调用失败: ' + detail);
  }
}

module.exports = {
  getUserApiConfig,
  callAI,
};
