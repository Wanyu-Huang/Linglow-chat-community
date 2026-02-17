// ==================== 认证和登录模块 ====================

// 全局变量
let currentUserId = null;
let isAuthenticated = false;
let autoSaveTimer = null;

// ========== UI辅助函数 ==========

function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.add('active');
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('active');
}

function showLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) modal.classList.add('active');
}

function hideLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) modal.classList.remove('active');
}

function showLoginError(message) {
    const errorDiv = document.getElementById('loginError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.add('show');
        setTimeout(() => {
            errorDiv.classList.remove('show');
        }, 3000);
    }
}

// ========== 登录逻辑 ==========

async function handleLogin() {
    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');
    
    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!username || !password) {
        showLoginError('请输入用户名和密码');
        return;
    }

    showLoading();

    try {
        const result = await LinglowAPI.Auth.login(username, password);
        
        if (result.success) {
            isAuthenticated = true;
            currentUserId = result.user.id;
            hideLoginModal();
            
            // 加载用户数据
            await loadAllDataFromAPI();
            
            hideLoading();
            console.log('✅ 登录成功');
            // 触发推送订阅
            window.dispatchEvent(new Event('userLoggedIn'));
        }
    } catch (error) {
        hideLoading();
        showLoginError(error.message || '登录失败');
        console.error('Login error:', error);
    }
}

async function checkAuth() {
    try {
        const result = await LinglowAPI.Auth.check();
        
        if (result.authenticated) {
            isAuthenticated = true;
            currentUserId = result.userId;
            await loadAllDataFromAPI();
        } else {
            showLoginModal();
        }
    } catch (error) {
        console.error('Auth check error:', error);
        showLoginModal();
    }
}

// ========== 数据加载 ==========

async function loadConfigFromAPI() {
    try {
        const result = await LinglowAPI.Config.get();
        if (result.success && result.config) {
            config.baseurl = result.config.baseurl || '';
            config.apikey = result.config.apikey || '';
            config.modelname = result.config.modelname || 'gpt-3.5-turbo';
            console.log('✅ 配置已加载');
        }
    } catch (error) {
        console.error('Load config error:', error);
    }
}

async function saveConfigToAPI() {
    try {
        await LinglowAPI.Config.save(
            config.baseurl,
            config.apikey,
            config.modelname,
            {}
        );
        console.log('✅ 配置已保存');
        return true;
    } catch (error) {
        console.error('Save config error:', error);
        return false;
    }
}

async function loadCharactersFromAPI() {
    try {
        const result = await LinglowAPI.Character.list();
        if (result.success) {
            charactersList = result.characters;
            console.log('✅ 角色列表已加载:', charactersList.length);

            // 将每个角色的 config 写入 localStorage（始终覆盖，保持最新）
            charactersList.forEach(char => {
                if (char.config && Object.keys(char.config).length > 0) {
                    localStorage.setItem(`char_${char.id}_config`, JSON.stringify(char.config));
                }
            });
        }
    } catch (error) {
        console.error('Load characters error:', error);
    }
}

async function loadChatHistoryFromAPI(characterId) {
    try {
        const result = await LinglowAPI.Chat.getHistory(characterId);
        if (result.success) {
            chatHistory = result.messages || [];
            console.log('✅ 聊天记录已加载:', chatHistory.length);
        }
    } catch (error) {
        console.error('Load history error:', error);
        chatHistory = [];
    }
}

async function loadCharacterDataFromAPI(characterId) {
    try {
        const charResult = await LinglowAPI.Character.get(characterId);
        if (charResult.success) {
            const char = charResult.character;
            
            longTermMemory = char.longTermMemory || {
                basic_info: {},
                emotional_profile: "",
                relationships: "",
                important_events: [],
                metadata: {
                    total_messages: 0,
                    last_summary_at: 0,
                    last_updated: null,
                    version: 3,
                    next_memory_id: 1
                }
            };
            
            pendingSummaryBubbles = char.pendingSummary || [];
            
            console.log('✅ 角色数据已加载');
        }
        
        await loadChatHistoryFromAPI(characterId);
    } catch (error) {
        console.error('Load character data error:', error);
    }
}

async function saveCurrentCharacterData() {
    if (!currentCharacterId || !isAuthenticated) {
        return;
    }
    
    try {
        // 只保存记忆和待总结，聊天记录由 /api/chat/send 实时写入
        await LinglowAPI.Character.saveData(currentCharacterId, {
            longTermMemory: longTermMemory,
            pendingSummary: pendingSummaryBubbles,
            favorites: []
        });
        console.log('✅ 记忆数据已保存');
    } catch (error) {
        console.error('Save character data error:', error);
    }
}

async function loadAllDataFromAPI() {
    showLoading();
    
    try {
        await loadConfigFromAPI();
        await loadCharactersFromAPI();
        
        if (typeof currentCharacterId !== 'undefined' && currentCharacterId) {
            await loadCharacterDataFromAPI(currentCharacterId);
        }
        
        // 加载完成后触发UI渲染（如果角色列表页正在显示）
        if (typeof renderCharactersList === 'function') {
            renderCharactersList();
        }
        
        console.log('✅ 所有数据加载完成');
    } catch (error) {
        console.error('Load data error:', error);
    } finally {
        hideLoading();
    }
}

// ========== 自动保存 ==========

function startAutoSave() {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
    }
    
    autoSaveTimer = setInterval(async () => {
        if (isAuthenticated && typeof currentCharacterId !== 'undefined' && currentCharacterId) {
            try {
                // 只保存记忆和config，不全量写聊天记录（避免每30秒写27000条）
                // 聊天记录通过 /append 接口增量保存，全量同步在切换角色时进行
                await LinglowAPI.Character.saveData(currentCharacterId, {
                    longTermMemory: typeof longTermMemory !== 'undefined' ? longTermMemory : null,
                    pendingSummary: typeof pendingSummaryBubbles !== 'undefined' ? pendingSummaryBubbles : [],
                    favorites: []
                });
            } catch(e) {
                console.warn('自动保存记忆失败:', e.message);
            }
        }
    }, 30000);
    
    console.log('✅ 自动保存已启动（每30秒保存记忆）');
}

// ========== 初始化 ==========

window.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Linglow Chat 启动中...');
    await checkAuth();
    startAutoSave();
});

window.addEventListener('beforeunload', async (e) => {
    if (isAuthenticated && typeof currentCharacterId !== 'undefined' && currentCharacterId) {
        await saveCurrentCharacterData();
    }
});
