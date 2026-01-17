const express = require('express');
const db = require('../config/database');
const router = express.Router();

// 认证中间件
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
};

router.use(requireAuth);

// 获取用户配置
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;

    const [configs] = await db.query(
      'SELECT api_key, api_base_url, user_nickname, user_avatar, use_system_key, config FROM user_config WHERE user_id = ?',
      [userId]
    );

    if (configs.length === 0) {
      // 返回默认配置
      return res.json({
        success: true,
        config: {
          apiKey: '',
          apiBaseUrl: 'https://api.anthropic.com',
          userNickname: '',
          userAvatar: '',
          useSystemKey: true,
          customConfig: {}
        }
      });
    }

    const config = configs[0];
    res.json({
      success: true,
      config: {
        apiKey: config.api_key || '',
        apiBaseUrl: config.api_base_url || 'https://api.anthropic.com',
        userNickname: config.user_nickname || '',
        userAvatar: config.user_avatar || '',
        useSystemKey: config.use_system_key !== false, // 默认true
        customConfig: config.config ? JSON.parse(config.config) : {}
      }
    });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ error: '获取配置失败' });
  }
});

// 更新用户配置
router.post('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { apiKey, apiBaseUrl, userNickname, userAvatar, useSystemKey, customConfig } = req.body;

    // 检查是否已有配置
    const [existing] = await db.query(
      'SELECT id FROM user_config WHERE user_id = ?',
      [userId]
    );

    const configJson = customConfig ? JSON.stringify(customConfig) : null;

    if (existing.length === 0) {
      // 创建新配置
      await db.query(
        `INSERT INTO user_config (user_id, api_key, api_base_url, user_nickname, user_avatar, use_system_key, config) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, apiKey, apiBaseUrl, userNickname, userAvatar, useSystemKey !== false, configJson]
      );
    } else {
      // 更新配置
      await db.query(
        `UPDATE user_config 
         SET api_key = ?, api_base_url = ?, user_nickname = ?, user_avatar = ?, use_system_key = ?, config = ? 
         WHERE user_id = ?`,
        [apiKey, apiBaseUrl, userNickname, userAvatar, useSystemKey !== false, configJson, userId]
      );
    }

    res.json({ success: true, message: '配置已保存' });
  } catch (error) {
    console.error('Update config error:', error);
    res.status(500).json({ error: '保存配置失败' });
  }
});

// 测试API Key
router.post('/test-api-key', async (req, res) => {
  try {
    const { apiKey, apiBaseUrl } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: '请提供API Key' });
    }

    const axios = require('axios');
    
    // 发送一个简单的测试请求
    const response = await axios.post(
      `${apiBaseUrl || 'https://api.anthropic.com'}/v1/messages`,
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.content) {
      res.json({ 
        success: true, 
        message: 'API Key 有效',
        model: response.data.model
      });
    } else {
      res.status(500).json({ error: 'API返回格式异常' });
    }
  } catch (error) {
    console.error('Test API key error:', error);
    
    if (error.response) {
      if (error.response.status === 401) {
        return res.status(401).json({ error: 'API Key无效' });
      } else if (error.response.status === 429) {
        return res.status(429).json({ error: 'API请求频率超限' });
      }
    }
    
    res.status(500).json({ error: '测试失败: ' + error.message });
  }
});

module.exports = router;
