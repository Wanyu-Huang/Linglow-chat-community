const webpush = require('web-push');
const db = require('../config/database');

/**
 * 发送推送通知给指定用户
 * @param {number} userId - 用户ID
 * @param {Object} payload - 通知内容
 */
async function sendPushNotification(userId, payload) {
  try {
    // 检查VAPID是否配置
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      console.warn('VAPID keys not configured, skipping push notification');
      return;
    }

    // 获取用户的所有订阅
    const [subscriptions] = await db.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );

    if (subscriptions.length === 0) {
      console.log(`No push subscriptions found for user ${userId}`);
      return;
    }

    const payloadString = JSON.stringify(payload);

    // 发送给所有订阅
    const promises = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      try {
        await webpush.sendNotification(pushSubscription, payloadString);
        console.log(`✅ Push notification sent to subscription ${sub.id}`);
      } catch (error) {
        console.error(`❌ Push notification failed for subscription ${sub.id}:`, error.message);
        
        // 如果订阅已过期(410)或无效(404),删除它
        if (error.statusCode === 410 || error.statusCode === 404) {
          await db.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
          console.log(`🗑️ Removed expired subscription ${sub.id}`);
        }
      }
    });

    await Promise.allSettled(promises);
  } catch (error) {
    console.error('Send push notification error:', error);
    throw error;
  }
}

/**
 * 生成VAPID密钥对(用于初始化)
 */
function generateVAPIDKeys() {
  const vapidKeys = webpush.generateVAPIDKeys();
  
  console.log('='.repeat(60));
  console.log('VAPID密钥对已生成,请将以下内容添加到.env文件:');
  console.log('='.repeat(60));
  console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  console.log('='.repeat(60));
  
  return vapidKeys;
}

module.exports = {
  sendPushNotification,
  generateVAPIDKeys
};
