/**
 * 添加好友模态框
 */

let friendCardData = null;
let friendPersonas = [];

// 显示添加好友模态框
async function showAddFriendModal(cardData) {
    friendCardData = cardData;
    
    const modal = document.getElementById('add-friend-modal');
    const content = modal.querySelector('.add-friend-content');
    
    // 显示加载中
    content.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">加载中...</div>';
    modal.style.display = 'flex';
    
    try {
        // 加载personas
        await loadFriendPersonas();
        
        // 渲染表单
        renderAddFriendForm();
        
    } catch (error) {
        console.error('❌ 加载失败:', error);
        content.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #FA5151;">
                <div style="font-size: 48px; margin-bottom: 15px;">⚠️</div>
                <div>${escapeHtml(error.message)}</div>
                <button onclick="closeAddFriendModal()" style="margin-top: 20px; padding: 8px 20px;">关闭</button>
            </div>
        `;
    }
}

// 加载personas
async function loadFriendPersonas() {
    const response = await fetch('/api/persona', {
        credentials: 'include'
    });
    
    if (!response.ok) {
        throw new Error('获取身份列表失败: ' + response.status);
    }
    
    const data = await response.json();
    friendPersonas = data.personas || [];
    
    // 如果没有persona，创建默认的
    if (friendPersonas.length === 0) {
        await createDefaultFriendPersona();
        
        // 重新获取
        const response2 = await fetch('/api/persona', {
            credentials: 'include'
        });
        const data2 = await response2.json();
        friendPersonas = data2.personas || [];
    }
    
    console.log('✅ personas加载成功:', friendPersonas.length);
}

// 创建默认persona
async function createDefaultFriendPersona() {
    const personaId = 'persona_' + Date.now();
    
    const response = await fetch('/api/persona', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
            personaId: personaId,
            name: '未知',
            description: '默认身份',
            isDefault: true
        })
    });
    
    if (!response.ok) {
        throw new Error('创建默认身份失败');
    }
    
    console.log('✅ 已创建默认persona: 未知');
}

// 渲染表单
function renderAddFriendForm() {
    const modal = document.getElementById('add-friend-modal');
    const content = modal.querySelector('.add-friend-content');
    
    // 构建persona选项
    const personaOptions = friendPersonas.map(p => 
        `<option value="${p.persona_id}">${escapeHtml(p.name)}</option>`
    ).join('');
    
    content.innerHTML = `
        <!-- 用户信息 -->
        <div class="add-friend-user-info">
            ${friendCardData.avatar ? 
                `<img src="${friendCardData.avatar}" class="add-friend-avatar-small" alt="${escapeHtml(friendCardData.name)}">` :
                `<div class="add-friend-default-avatar-small">${escapeHtml(friendCardData.name.substring(0, 1))}</div>`
            }
            <div class="add-friend-user-name">${escapeHtml(friendCardData.name)}</div>
        </div>

        <!-- 表单 -->
        <div class="add-friend-form">
            <div class="add-friend-form-row">
                <div class="add-friend-form-label">设置备注</div>
                <input type="text" class="add-friend-form-input" id="friend-nickname-input" 
                       placeholder="输入备注" value="${escapeHtml(friendCardData.name)}">
            </div>
            <div class="add-friend-form-row">
                <div class="add-friend-form-label">我的身份</div>
                <select class="add-friend-form-select" id="friend-persona-select">
                    ${personaOptions}
                </select>
                <span class="add-friend-select-arrow">›</span>
            </div>
        </div>

        <!-- 朋友圈权限 -->
        <div class="add-friend-moments">
            <div class="add-friend-moments-title">朋友圈和状态</div>
            <div class="add-friend-checkbox-row">
                <input type="checkbox" checked disabled>
                <label>可以看我的朋友圈</label>
            </div>
            <div class="add-friend-checkbox-row">
                <input type="checkbox" checked disabled>
                <label>可以看TA的朋友圈</label>
            </div>
            <div class="add-friend-coming-soon">💡 朋友圈功能即将上线</div>
        </div>

        <!-- 按钮 -->
        <div class="add-friend-actions">
            <button class="btn-secondary" onclick="closeAddFriendModal()">取消</button>
            <button class="btn-primary" onclick="submitAddFriend()">完成</button>
        </div>
    `;
    
    // 点击背景关闭
    modal.onclick = function(e) {
        if (e.target === modal) {
            closeAddFriendModal();
        }
    };
}

// 提交添加好友
async function submitAddFriend() {
    const nickname = document.getElementById('friend-nickname-input').value.trim();
    const personaId = document.getElementById('friend-persona-select').value;
    
    if (!nickname) {
        showToast('请输入备注');
        return;
    }
    
    if (!personaId) {
        showToast('请选择身份');
        return;
    }
    
    try {
        showToast('正在添加好友...');
        
        // 获取选中的persona
        const selectedPersona = friendPersonas.find(p => p.persona_id == personaId);
        const userNickname = selectedPersona ? selectedPersona.name : '未知';
        
        // 生成角色ID
        const characterId = 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // 调用API创建角色
        const response = await fetch('/api/character/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                characterId: characterId,
                name: friendCardData.name,
                avatar: friendCardData.avatar || null,
                systemPrompt: friendCardData.systemPrompt,
                firstMessage: friendCardData.firstMessage || '',
                config: {
                    aiNickname: nickname,
                    userNickname: userNickname,
                    userPersonaId: personaId,
                    baseurl: '',
                    apikey: '',
                    modelname: ''
                }
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '创建角色失败');
        }
        
        showToast('✅ 添加成功');
        
        // 关闭模态框
        closeAddFriendModal();
        
        // 刷新角色列表
        await loadCharactersList();
        renderCharactersList();
        
        // 切换到该角色并进入聊天页面
        setTimeout(() => {
            switchToCharacter(characterId);
            showPage('chat-page');
        }, 500);
        
    } catch (error) {
        console.error('❌ 添加失败:', error);
        showToast('添加失败: ' + error.message);
    }
}

// 关闭添加好友模态框
function closeAddFriendModal() {
    const modal = document.getElementById('add-friend-modal');
    modal.style.display = 'none';
    friendCardData = null;
    friendPersonas = [];
}
