const express = require('express');
const db = require('../config/database');
const { safeStringify, safeJsonParse } = require('../services/jsonHelper');
const router = express.Router();

const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
};
router.use(requireAuth);

// 创建批量总结任务
router.post('/create', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { characterId, messageIds, intervalSize = 200 } = req.body;

    if (!characterId || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 同一用户同一角色只允许一个活跃任务
    const [existing] = await db.query(
      `SELECT id FROM summary_tasks 
       WHERE user_id = ? AND character_id = ? AND status IN ('pending','running','paused')
       LIMIT 1`,
      [userId, characterId]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: '已有进行中的总结任务', taskId: existing[0].id });
    }

    const totalBatches = Math.ceil(messageIds.length / intervalSize);
    const taskData = safeStringify({ messageIds }, null);

    const [result] = await db.query(
      `INSERT INTO summary_tasks 
       (user_id, character_id, status, total_batches, current_batch, interval_size, task_data)
       VALUES (?, ?, 'pending', ?, 0, ?, ?)`,
      [userId, characterId, totalBatches, intervalSize, taskData]
    );

    console.log(`[SummaryTask] 创建任务 ${result.insertId}，用户 ${userId}，${messageIds.length} 条消息，${totalBatches} 批`);
    res.json({ success: true, taskId: result.insertId, totalBatches });

  } catch (err) {
    console.error('create summary task error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 查询任务进度
router.get('/status/:taskId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { taskId } = req.params;

    const [tasks] = await db.query(
      `SELECT id, status, total_batches, current_batch, interval_size, error_message, created_at, updated_at
       FROM summary_tasks WHERE id = ? AND user_id = ?`,
      [taskId, userId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({ error: '任务不存在' });
    }

    const task = tasks[0];
    res.json({
      success: true,
      taskId: task.id,
      status: task.status,
      totalBatches: task.total_batches,
      currentBatch: task.current_batch,
      intervalSize: task.interval_size,
      progress: task.total_batches > 0
        ? Math.round((task.current_batch / task.total_batches) * 100)
        : 0,
      errorMessage: task.error_message,
      createdAt: task.created_at,
      updatedAt: task.updated_at
    });

  } catch (err) {
    console.error('get task status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 用户操作：跳过当前失败批次 / 从失败处重试
router.post('/action', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { taskId, action } = req.body; // action: 'retry' | 'skip'

    if (!taskId || !['retry', 'skip'].includes(action)) {
      return res.status(400).json({ error: '参数错误' });
    }

    const [tasks] = await db.query(
      'SELECT * FROM summary_tasks WHERE id = ? AND user_id = ?',
      [taskId, userId]
    );
    if (tasks.length === 0) return res.status(404).json({ error: '任务不存在' });

    const task = tasks[0];
    if (task.status !== 'paused') {
      return res.status(400).json({ error: '任务不在暂停状态' });
    }

    if (action === 'retry') {
      // 重置状态为 pending，从当前批次重试
      await db.query(
        "UPDATE summary_tasks SET status = 'pending', error_message = NULL, updated_at = NOW() WHERE id = ?",
        [taskId]
      );
      res.json({ success: true, message: '已重置为重试' });

    } else if (action === 'skip') {
      // 跳过当前批次，进入下一批
      const nextBatch = task.current_batch + 1;
      if (nextBatch >= task.total_batches) {
        // 已是最后一批，标记完成
        await db.query(
          "UPDATE summary_tasks SET status = 'done', current_batch = ?, error_message = NULL, updated_at = NOW() WHERE id = ?",
          [nextBatch, taskId]
        );
        res.json({ success: true, message: '已跳过最后一批，任务完成' });
      } else {
        await db.query(
          "UPDATE summary_tasks SET status = 'pending', current_batch = ?, error_message = NULL, updated_at = NOW() WHERE id = ?",
          [nextBatch, taskId]
        );
        res.json({ success: true, message: `已跳过，从第 ${nextBatch + 1} 批继续` });
      }
    }

  } catch (err) {
    console.error('task action error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 取消任务
router.post('/cancel', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { taskId } = req.body;

    await db.query(
      "UPDATE summary_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = ? AND user_id = ?",
      [taskId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 查询当前角色是否有活跃任务（前端进入聊天时轮询用）
router.get('/active/:characterId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { characterId } = req.params;

    const [tasks] = await db.query(
      `SELECT id, status, total_batches, current_batch, error_message
       FROM summary_tasks 
       WHERE user_id = ? AND character_id = ? AND status IN ('pending','running','paused')
       ORDER BY created_at DESC LIMIT 1`,
      [userId, characterId]
    );

    if (tasks.length === 0) {
      return res.json({ success: true, hasActive: false });
    }

    const task = tasks[0];
    res.json({
      success: true,
      hasActive: true,
      taskId: task.id,
      status: task.status,
      totalBatches: task.total_batches,
      currentBatch: task.current_batch,
      progress: task.total_batches > 0
        ? Math.round((task.current_batch / task.total_batches) * 100)
        : 0,
      errorMessage: task.error_message
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
