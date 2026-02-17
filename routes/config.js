const express = require('express');
const db = require('../config/database');
const { safeJsonParse, safeStringify } = require('../services/jsonHelper');
const router = express.Router();

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
    console.log('[CONFIG] GET / - session.userId =', req.session ? req.session.userId : null);
    const userId = req.session.userId;

    const [configs] = await db.query(
      'SELECT api_key, api_base_url, model_name, config FROM user_config WHERE user_id = ?',
      [userId]
    );

    if (configs.length === 0) {
      // 返回默认配置
      return res.json({
        success: true,
        config: {
          baseurl: 'https://api.openai.com',
          apikey: '',
          modelname: 'gpt-3.5-turbo',
          customConfig: {}
        }
      });
    }

    const config = configs[0];
    res.json({
      success: true,
      config: {
        baseurl: config.api_base_url || 'https://api.openai.com',
        apikey: config.api_key || '',
        modelname: config.model_name || 'gpt-3.5-turbo',
        customConfig: safeJsonParse(config.config, {})
      }
    });
  } catch (error) {
    console.error('Get config error:', error && error.stack ? error.stack : error);
    res.status(500).json({ error: '获取配置失败', detail: error && error.message ? error.message : null });
  }
});

// 更新用户配置
router.post('/', async (req, res) => {
  try {
    console.log('[CONFIG] POST / - session.userId =', req.session ? req.session.userId : null, 'bodyKeys=', Object.keys(req.body || {}));
    const userId = req.session.userId;
    const { baseurl, apikey, modelname, customConfig } = req.body;

    // 检查是否已有配置
    const [existing] = await db.query(
      'SELECT id FROM user_config WHERE user_id = ?',
      [userId]
    );

    const configJson = safeStringify(customConfig, null);

    if (existing.length === 0) {
      // 创建新配置
      await db.query(
        `INSERT INTO user_config (user_id, api_key, api_base_url, model_name, config) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, apikey, baseurl, modelname, configJson]
      );
    } else {
      // 更新配置
      await db.query(
        `UPDATE user_config 
         SET api_key = ?, api_base_url = ?, model_name = ?, config = ? 
         WHERE user_id = ?`,
        [apikey, baseurl, modelname, configJson, userId]
      );
    }

    res.json({ success: true, message: '配置已保存' });
  } catch (error) {
    console.error('Update config error:', error && error.stack ? error.stack : error);
    res.status(500).json({ error: '保存配置失败', detail: error && error.message ? error.message : null });
  }
});

module.exports = router;
