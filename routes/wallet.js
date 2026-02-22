const express = require('express');
const db = require('../config/database');
const router = express.Router();

const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
};

router.use(requireAuth);

// 确保钱包记录存在（首次访问自动创建，初始余额 200）
async function ensureWallet(userId) {
  await db.query(
    `INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 200.00)`,
    [userId]
  );
}

// GET /api/wallet — 获取余额 + 最近100条流水
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    await ensureWallet(userId);

    const [[wallet]] = await db.query(
      'SELECT balance FROM wallets WHERE user_id = ?',
      [userId]
    );

    const [txList] = await db.query(
      `SELECT id, character_id, type, amount, note, from_name, created_at
       FROM wallet_transactions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );

    res.json({ success: true, balance: parseFloat(wallet.balance), transactions: txList });
  } catch (e) {
    console.error('GET /wallet error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/wallet/transaction — 记录一笔流水并更新余额
// body: { type:'in'|'out', amount, note, fromName, characterId }
router.post('/transaction', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { type, amount, note, fromName, characterId } = req.body;

    if (!type || !amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: '参数错误' });
    }

    const amt = parseFloat(amount);
    if (amt <= 0) return res.status(400).json({ error: '金额必须为正数' });

    await ensureWallet(userId);

    // 原子更新余额
    if (type === 'in') {
      await db.query(
        'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
        [amt, userId]
      );
    } else {
      // 检查余额是否足够
      const [[{ balance }]] = await db.query(
        'SELECT balance FROM wallets WHERE user_id = ?',
        [userId]
      );
      if (parseFloat(balance) < amt) {
        return res.status(400).json({ error: '余额不足' });
      }
      await db.query(
        'UPDATE wallets SET balance = balance - ? WHERE user_id = ?',
        [amt, userId]
      );
    }

    // 记录流水
    await db.query(
      `INSERT INTO wallet_transactions (user_id, character_id, type, amount, note, from_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, characterId || null, type, amt, note || null, fromName || null]
    );

    // 返回最新余额
    const [[{ balance }]] = await db.query(
      'SELECT balance FROM wallets WHERE user_id = ?',
      [userId]
    );

    res.json({ success: true, balance: parseFloat(balance) });
  } catch (e) {
    console.error('POST /wallet/transaction error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/wallet/set-balance — 直接设置余额（仅用于初始化/修正，不记录流水）
router.post('/set-balance', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { balance } = req.body;
    const bal = parseFloat(balance);
    if (isNaN(bal) || bal < 0) return res.status(400).json({ error: '余额无效' });

    await ensureWallet(userId);
    await db.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [bal, userId]);
    res.json({ success: true, balance: bal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
