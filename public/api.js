// Linglow Chat API Module
// 后端API调用封装

const API_BASE = '/api';

// ==================== 工具函数 ====================

async function apiCall(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
        credentials: 'include', // 发送cookie（session）
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    };

    try {
        const response = await fetch(url, config);
        const data = await response.json();

        if (!response.ok) {
            const errMsg = data.error || '请求失败';
            const detail = data.detail ? ` [detail: ${data.detail}]` : '';
            throw new Error(errMsg + detail);
        }

        return data;
    } catch (error) {
        console.error(`API Error [${endpoint}]:`, error);
        throw error;
    }
}

// ==================== 认证API ====================

const AuthAPI = {
    // 登录
    async login(username, password) {
        return await apiCall('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },

    // 注册
    async register(username, password, nickname) {
        return await apiCall('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password, nickname })
        });
    },

    // 检查登录状态
    async check() {
        return await apiCall('/auth/check');
    },

    // 登出
    async logout() {
        return await apiCall('/auth/logout', { method: 'POST' });
    },

    // 修改密码
    async changePassword(oldPassword, newPassword) {
        return await apiCall('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ oldPassword, newPassword })
        });
    }
};

// ==================== 配置API ====================

const ConfigAPI = {
    // 获取配置
    async get() {
        return await apiCall('/config');
    },

    // 保存配置
    async save(baseurl, apikey, modelname, customConfig = {}) {
        return await apiCall('/config', {
            method: 'POST',
            body: JSON.stringify({ baseurl, apikey, modelname, customConfig })
        });
    }
};

// ==================== 角色API ====================

const CharacterAPI = {
    // 获取角色列表
    async list() {
        return await apiCall('/character/list');
    },

    // 获取单个角色
    async get(characterId) {
        return await apiCall(`/character/${characterId}`);
    },

    // 保存角色
    async save(characterData) {
        return await apiCall('/character/save', {
            method: 'POST',
            body: JSON.stringify(characterData)
        });
    },

    // 删除角色
    async delete(characterId) {
        return await apiCall(`/character/${characterId}`, { method: 'DELETE' });
    },

    // 清空当前用户所有角色（导入前重置用）
    async clearAll() {
        return await apiCall('/character/all', { method: 'DELETE' });
    },

    // 保存角色数据（memory, pending, favorites）
    async saveData(characterId, data) {
        return await apiCall(`/character/${characterId}/data`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    // 保存长期记忆
    async saveMemory(characterId, longTermMemory) {
        return await apiCall(`/character/${characterId}/memory`, {
            method: 'POST',
            body: JSON.stringify({ longTermMemory })
        });
    },

    // 保存待总结气泡
    async savePending(characterId, pendingSummary) {
        return await apiCall(`/character/${characterId}/pending`, {
            method: 'POST',
            body: JSON.stringify({ pendingSummary })
        });
    },

    // 保存收藏
    async saveFavorites(characterId, favorites) {
        return await apiCall(`/character/${characterId}/favorites`, {
            method: 'POST',
            body: JSON.stringify({ favorites })
        });
    },

    // 更新主动消息配置
    async updateProactive(characterId, config) {
        return await apiCall(`/character/${characterId}/proactive`, {
            method: 'PUT',
            body: JSON.stringify(config)
        });
    }
};

// ==================== 聊天API ====================

const ChatAPI = {
    // 获取聊天历史
    async getHistory(characterId, limit = 200) {
        // 只拉最新 limit 条用于渲染，总数由 total 字段返回
        return await apiCall(`/chat/history/${characterId}?limit=${limit}`);
    },

    // 加载更多历史（上滑懒加载），beforeSeq是当前最老消息的seq
    async getHistoryBefore(characterId, beforeSeq, limit = 200) {
        return await apiCall(`/chat/history/${characterId}/before?beforeSeq=${beforeSeq}&limit=${limit}`);
    },

    // 发送消息（后端中转AI）
    async send(characterId, message, messageId) {
        return await apiCall('/chat/send', {
            method: 'POST',
            body: JSON.stringify({ characterId, message, messageId })
        });
    },

    // 批量保存聊天历史
    async saveHistoryBatch(characterId, messages) {
        return await apiCall(`/chat/history/${characterId}/batch`, {
            method: 'POST',
            body: JSON.stringify({ messages })
        });
    },

    // 删除消息
    async deleteMessage(messageId) {
        return await apiCall(`/chat/message/${messageId}`, { method: 'DELETE' });
    },

    // 清空聊天记录
    async clearHistory(characterId) {
        return await apiCall(`/chat/history/${characterId}`, { method: 'DELETE' });
    }
};

// ==================== 人设API ====================

const PersonaAPI = {
    // 获取所有人设
    async list() {
        return await apiCall('/persona');
    },

    // 创建人设
    async create(personaData) {
        return await apiCall('/persona', {
            method: 'POST',
            body: JSON.stringify(personaData)
        });
    },

    // 更新人设
    async update(personaId, personaData) {
        return await apiCall(`/persona/${personaId}`, {
            method: 'PUT',
            body: JSON.stringify(personaData)
        });
    },

    // 删除人设
    async delete(personaId) {
        return await apiCall(`/persona/${personaId}`, { method: 'DELETE' });
    },

    // 设置默认人设
    async setDefault(personaId) {
        return await apiCall(`/persona/${personaId}/set-default`, { method: 'POST' });
    },

    // 获取默认人设
    async getDefault() {
        return await apiCall('/persona/default');
    }
};

// ==================== 推送API ====================

const PushAPI = {
    // 订阅推送
    async subscribe(subscription) {
        return await apiCall('/push/subscribe', {
            method: 'POST',
            body: JSON.stringify(subscription)
        });
    },

    // 取消订阅
    async unsubscribe() {
        return await apiCall('/push/unsubscribe', { method: 'POST' });
    }
};

// ==================== 钱包API ====================

const WalletAPI = {
    // 获取余额和流水
    async get() {
        return await apiCall('/wallet');
    },

    // 记录一笔流水并更新余额
    async transaction(type, amount, { note = '', fromName = '', characterId = null } = {}) {
        return await apiCall('/wallet/transaction', {
            method: 'POST',
            body: JSON.stringify({ type, amount, note, fromName, characterId })
        });
    },

    // 直接设置余额（初始化/修正用）
    async setBalance(balance) {
        return await apiCall('/wallet/set-balance', {
            method: 'POST',
            body: JSON.stringify({ balance })
        });
    }
};

// ==================== 导出 ====================

window.LinglowAPI = {
    Auth: AuthAPI,
    Config: ConfigAPI,
    Character: CharacterAPI,
    Chat: ChatAPI,
    Persona: PersonaAPI,
    Push: PushAPI,
    Wallet: WalletAPI
};
