const express = require('express');
const db = require('../config/database');
const webpush = require('web-push');
const router = express.Router();

// 配置VAPID密钥
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// 认证中间件
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
};

router.use(requireAuth);

// 获取VAPID公钥
router.get('/vapid-public-key', (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  
  if (!publicKey) {
    return res.status(500).json({ error: 'VAPID密钥未配置' });
  }

  res.json({
    success: true,
    publicKey
  });
});

// 订阅推送通知
router.post('/subscribe', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 检查是否已存在
    const [existing] = await db.query(
      'SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
      [userId, endpoint]
    );

    if (existing.length === 0) {
      // 保存订阅
      await db.query(
        'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)',
        [userId, endpoint, keys.p256dh, keys.auth]
      );
    }

    res.json({ success: true, message: '订阅成功' });
  } catch (error) {
    console.error('Subscribe push error:', error);
    res.status(500).json({ error: '订阅失败' });
  }
});

// 取消订阅
router.post('/unsubscribe', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { endpoint } = req.body;

    await db.query(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
      [userId, endpoint]
    );

    res.json({ success: true, message: '取消订阅成功' });
  } catch (error) {
    console.error('Unsubscribe push error:', error);
    res.status(500).json({ error: '取消订阅失败' });
  }
});

// 测试推送
router.post('/test', async (req, res) => {
  try {
    const userId = req.session.userId;

    // 获取用户的订阅
    const [subscriptions] = await db.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );

    if (subscriptions.length === 0) {
      return res.status(400).json({ error: '未找到推送订阅' });
    }

    const payload = JSON.stringify({
      title: '测试通知',
      body: '这是一条测试推送通知',
      icon: '/icon.png',
      badge: '/badge.png',
      tag: 'test-notification',
      timestamp: Date.now()
    });

    // 发送给所有订阅
    const promises = subscriptions.map(sub => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      return webpush.sendNotification(pushSubscription, payload)
        .catch(err => {
          console.error('Push error:', err);
          // 如果订阅失效,删除它
          if (err.statusCode === 410) {
            db.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
          }
        });
    });

    await Promise.all(promises);

    res.json({ success: true, message: '测试通知已发送' });
  } catch (error) {
    console.error('Test push error:', error);
    res.status(500).json({ error: '发送测试通知失败' });
  }
});

module.exports = router;
