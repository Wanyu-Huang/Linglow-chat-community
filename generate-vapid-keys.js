#!/usr/bin/env node

/**
 * VAPID密钥生成工具
 * 用于生成Web Push通知所需的密钥对
 */

const webpush = require('web-push');

console.log('\n========================================');
console.log('  VAPID密钥生成工具');
console.log('========================================\n');

try {
  const vapidKeys = webpush.generateVAPIDKeys();
  
  console.log('✅ VAPID密钥对生成成功!\n');
  console.log('请将以下内容添加到 .env 文件中:\n');
  console.log('----------------------------------------');
  console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  console.log('VAPID_MAILTO=mailto:your-email@example.com');
  console.log('----------------------------------------\n');
  
  console.log('⚠️  注意事项:');
  console.log('1. 请妥善保管私钥,不要泄露');
  console.log('2. 修改VAPID_MAILTO为您的邮箱地址');
  console.log('3. 密钥生成后不要频繁更换\n');
  
} catch (error) {
  console.error('❌ 生成失败:', error.message);
  console.error('\n请确保已安装依赖: npm install\n');
  process.exit(1);
}
