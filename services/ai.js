const axios = require('axios');
const db = require('../config/database');

async function getUserApiConfig(userId) {
  const [configs] = await db.execute(
    'SELECT api_key, api_base_url FROM user_config WHERE user_id = ?',
    [userId]
  );

  if (configs.length === 0 || !configs[0].api_key) {
    throw new Error('请先在设置中配置API Key');
  }

  return {
    apiKey: configs[0].api_key,
    apiBaseUrl: configs[0].api_base_url || 'https://api.openai.com',
  };
}

async function callAI(userId, messages, model = 'gpt-3.5-turbo') {
  const config = await getUserApiConfig(userId);
  
  try {
    const response = await axios.post(
      `${config.apiBaseUrl}/v1/chat/completions`,
      {
        model: model,
        messages: messages,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        timeout: 60000,
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('AI API Error:', error.response?.data || error.message);
    throw new Error('AI调用失败: ' + (error.response?.data?.error?.message || error.message));
  }
}

module.exports = {
  getUserApiConfig,
  callAI,
};
