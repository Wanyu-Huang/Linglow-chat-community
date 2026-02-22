# Linglow Chat 社区版 - 模块化功能整合文档

## 📦 整合概述

本次整合采用**模块化架构**，将新功能拆分为独立的JS文件，保持社区版的代码组织原则。

## 🆕 新增功能模块

### 1. **状态栏系统** (`status-bar.js`)
- **功能**: 显示并管理角色的位置、心情、好感度、穿着、活动
- **AI集成**: 自动解析AI回复中的状态块 `<<STATUS>>...<<END_STATUS>>`
- **UI**: 聊天页面顶部抽屉式展示，支持手动编辑
- **存储**: `localStorage['char_{id}_status']`

### 2. **钱包系统** (`wallet.js`)
- **功能**: 虚拟货币余额管理、转账、交易记录
- **交互**: 
  - 用户→角色转账（扣除余额）
  - 角色→用户转账（AI回复中使用 `[转账:金额]`）
  - 收款/退回功能
- **UI**: 独立钱包页面 + 转账卡片气泡
- **存储**: 
  - `localStorage['userWallet']` - 余额
  - `localStorage['walletTxList']` - 交易记录

### 3. **记忆优化** (`memory-optimize.js`)
- **功能**: 使用小模型筛选最相关的长期记忆，降低token消耗
- **流程**:
  1. 提取用户最近消息
  2. 小模型评估所有记忆的相关性
  3. 只注入最相关的5条记忆
- **配置**: 在设置页选择API服务商和小模型
- **存储**: `localStorage['memoryOptimizeEnabled']`、`localStorage['moActiveId']`、`localStorage['moModelname']`

### 4. **联网搜索** (`web-search.js`)
- **功能**: 判断用户消息是否需要联网，如需要则调用支持联网的模型搜索
- **流程**:
  1. （可选）小模型判断是否需要联网
  2. 如需要，调用联网模型（Perplexity、Gemini等）搜索
  3. 将搜索结果注入到systemPrompt
- **智能集成**: 与记忆优化共用小模型，一次调用完成两件事
- **配置**: 
  - 联网模型服务商 + 模型名
  - 判断小模型服务商 + 模型名（可选）
- **存储**: `localStorage['webSearchEnabled']`、`localStorage['webActiveId']`、`localStorage['webModelname']`

## 📁 文件结构

```
/linglow-chat-community/
├── public/
│   ├── index.html                    # 主HTML文件（新增页面结构）
│   ├── styles.css                    # 样式文件
│   │
│   ├── api.js                        # API配置管理（原有）
│   ├── utils.js                      # 工具函数（原有）
│   ├── login.js                      # 登录逻辑（原有）
│   ├── character-import.js           # 角色导入（原有）
│   ├── character-info-modal.js       # 角色信息弹窗（原有）
│   ├── add-friend-modal.js           # 添加好友弹窗（原有）
│   │
│   ├── status-bar.js                 # ⭐ 新增：状态栏系统
│   ├── wallet.js                     # ⭐ 新增：钱包系统
│   ├── memory-optimize.js            # ⭐ 新增：记忆优化
│   └── web-search.js                 # ⭐ 新增：联网搜索
│
├── routes/                           # 后端路由（不变）
├── services/                         # 后端服务（不变）
└── server.js                         # 服务器入口（不变）
```

## 🔧 关键整合点

### 1. HTML结构新增
在 `index.html` 中新增以下页面：
- **钱包页面** (`#wallet-page`)
- **转账页面** (`#transfer-page`)
- **转账详情页** (`#transfer-detail-page`)
- **转账成功遮罩** (`#transfer-success-overlay`)
- **收款通知弹窗** (`#receive-money-notify`)
- **收藏页面** (`#favorites-page`)
- **状态栏抽屉** (`#status-drawer`)
- **状态栏编辑模态框** (`#status-edit-modal`)

### 2. 设置页新增配置
在设置页面添加：
- **记忆优化 Beta** 配置区域
  - 开关
  - API服务商选择
  - 模型选择
  - 拉取模型按钮
- **联网功能 Beta** 配置区域
  - 开关
  - 联网模型服务商 + 模型
  - 判断小模型服务商 + 模型
  - 拉取模型按钮

### 3. 核心函数集成

#### `processAndDisplaySegments()` 函数
```javascript
function processAndDisplaySegments(fullAiText) {
    // ✅ 新增：解析状态块
    let processedText = statusParseAndStrip(fullAiText);
    
    // ✅ 新增：解析钱包标记
    // [转账:N] → AI转账给用户
    // [收款:N] → AI收款成功
    // [退回:N] → AI退回转账
    
    // 原有：分段显示逻辑...
}
```

#### `callAPIToGenerate()` 函数
```javascript
async function callAPIToGenerate() {
    // ...构建apiMessages...
    
    let finalSystemPrompt = config.systemPrompt;
    
    // ✅ 新增：注入状态栏系统提示
    if (window.statusBuildPromptInjection) {
        finalSystemPrompt += statusBuildPromptInjection();
    }
    
    // ✅ 新增：尝试联网搜索
    if (window.callWebSearchIfNeeded) {
        const recentUserContent = apiMessages
            .filter(m => m.role === 'user')
            .slice(-3)
            .map(m => m.content)
            .join('\n');
        const webResult = await callWebSearchIfNeeded(recentUserContent);
        if (webResult) {
            finalSystemPrompt += `\n\n=== 联网搜索结果 ===\n${webResult}`;
        }
    }
    
    // ✅ 已有：注入长期记忆（集成记忆优化）
    if (memoryOptimizeEnabled) {
        eventsToInject = await filterMemoriesBySmallModel(recentUserContent, allEvents);
    }
    
    // 原有：API调用...
}
```

### 4. 模块加载顺序
```html
<head>
    <!-- 原有模块 -->
    <script src="/api.js"></script>
    <script src="/utils.js"></script>
    <script src="/character-import.js"></script>
    <script src="/character-info-modal.js"></script>
    <script src="/add-friend-modal.js"></script>
    <script src="/login.js"></script>
    
    <!-- 新增模块 -->
    <script src="/status-bar.js"></script>
    <script src="/wallet.js"></script>
    <script src="/memory-optimize.js"></script>
    <script src="/web-search.js"></script>
</head>
```

## 🚀 使用方法

### 状态栏
1. AI回复时会自动输出状态块
2. 状态栏会自动解析并显示
3. 点击聊天页面顶部可展开/收起状态栏
4. 点击各字段可手动编辑

### 钱包
1. 从底部dock或"我的"页面进入钱包
2. 点击"转账"可向当前角色转账
3. AI回复中使用 `[转账:50]` 可向用户转账
4. AI使用 `[收款:30]` 表示收下用户转账
5. AI使用 `[退回:20]` 表示退回用户转账

### 记忆优化
1. 在设置页开启"记忆优化 Beta"
2. 选择API服务商（建议选便宜快速的模型）
3. 拉取并选择模型（不要选thinking类型）
4. 发送消息时会自动筛选最相关的5条记忆

### 联网搜索
1. 在设置页开启"联网功能 Beta"
2. 配置联网模型（Perplexity、Gemini等支持联网的模型）
3. （可选）配置判断小模型，用于判断是否需要联网
4. 如果同时开启记忆优化，判断和记忆筛选会合并为一次小模型调用

## ⚙️ 技术细节

### 模块间通信
所有模块通过全局 `window` 对象暴露函数：
```javascript
// status-bar.js
window.statusParseAndStrip = statusParseAndStrip;
window.statusBuildPromptInjection = statusBuildPromptInjection;

// wallet.js
window.walletBalance = walletBalance;
window.renderTransferBubble = renderTransferBubble;

// memory-optimize.js
window.filterMemoriesBySmallModel = filterMemoriesBySmallModel;

// web-search.js
window.callWebSearchIfNeeded = callWebSearchIfNeeded;
```

### localStorage 键名规范
```javascript
// 状态栏
'char_{id}_status'

// 钱包
'userWallet'
'walletTxList'

// 记忆优化
'memoryOptimizeEnabled'
'moActiveId'
'moModelname'

// 联网搜索
'webSearchEnabled'
'webActiveId'
'webModelname'
'webJudgeActiveId'
'webJudgeModelname'
```

### 特殊全局变量
```javascript
// 记忆优化与联网搜索的协调
window._pendingWebSearchQuery = null;      // 待搜索的关键词
window._pendingWebSearchDecided = false;   // 是否已决定联网
```

## 🔄 与后端的兼容性

- ✅ **完全兼容**：所有新功能均为纯前端实现
- ✅ **无需后端修改**：不需要修改任何后端代码
- ✅ **数据存储**：使用localStorage，不依赖后端数据库
- ✅ **API调用**：复用现有的API配置系统（apiProviders）

## 📊 性能优化

1. **记忆优化**：通过小模型筛选，将长期记忆从10+条降至5条，节省约50% token
2. **联网判断**：使用小模型判断是否需要联网，避免每次都调用昂贵的联网模型
3. **合并调用**：记忆优化+联网判断合并为一次小模型调用，降低延迟
4. **模块懒加载**：各功能模块独立，未使用的功能不会影响性能

## 🐛 已知限制

1. **钱包数据**：存储在localStorage，更换设备或清除缓存会丢失
2. **状态栏**：需要AI主动输出状态块才会更新
3. **联网模型**：需要使用支持联网的模型（Perplexity、Gemini带search的版本等）
4. **小模型选择**：建议使用便宜快速的模型，不要使用thinking类型

## 📝 测试清单

- [ ] 状态栏自动解析AI回复中的状态块
- [ ] 状态栏手动编辑各字段
- [ ] 钱包初始余额显示
- [ ] 用户向角色转账
- [ ] AI向用户转账（`[转账:N]`）
- [ ] AI收款（`[收款:N]`）
- [ ] AI退款（`[退回:N]`）
- [ ] 记忆优化筛选功能
- [ ] 联网搜索判断功能
- [ ] 联网搜索结果注入
- [ ] 记忆优化+联网判断合并调用

## 📦 部署说明

1. 将整个 `linglow-chat-community` 目录上传到服务器
2. 安装依赖：`npm install`
3. 启动服务：`npm start`
4. 访问：`http://localhost:3000`

无需额外配置，所有新功能开箱即用！

---

**版本**: v2.0.0-modular  
**整合日期**: 2025-02-20  
**Pure版来源**: index.html (13,568行)  
**社区版基础**: linglow-chat-community (原版)  
**最终大小**: index.html (21,331行, 1016KB)
