// Internationalization (i18n)
const i18n = {
    zh: {
        subtitle: 'GitHub Copilot API 代理服务',
        tab_login: '设备码登录',
        tab_direct: '直接添加 Token',
        tab_manage: '管理 Tokens',
        login_desc: '使用 GitHub 设备码流程登录，支持添加多个账号实现负载均衡。',
        btn_start_login: '开始登录',
        enter_code: '请在 GitHub 输入此验证码：',
        open_github: '点击这里打开 GitHub 验证页面 →',
        waiting_auth: '等待授权中... 请在 GitHub 完成验证',
        login_success: '✅ 登录成功！',
        btn_add_another: '添加另一个账号',
        login_failed: '登录失败',
        btn_retry: '重试',
        direct_desc: '如果你已经有 GitHub Token，可以直接添加：',
        token_placeholder: '输入 GitHub Token (ghu_xxx 或 gho_xxx)',
        btn_add_token: '添加 Token',
        btn_refresh: '刷新列表',
        click_refresh: '点击刷新加载 Token 列表',
        no_tokens: '暂无 Token，请先登录添加',
        token_count: '共 {total} 个 Token，{active} 个活跃',
        active: '✅ 活跃',
        inactive: '❌ 停用',
        requests: '请求',
        btn_delete: '删除',
        confirm_delete: '确定要删除这个 Token 吗？',
        delete_failed: '删除失败',
        load_failed: '加载失败',
        add_failed: '添加失败',
        add_success: '✅ 添加成功',
        enter_token: '请输入 Token',
        connect_failed: '无法连接服务器',
        timeout: '验证超时，请重试',
        auth_failed: '授权失败',
        account_added: '已添加账号'
    },
    en: {
        subtitle: 'GitHub Copilot API Proxy Service',
        tab_login: 'Device Code Login',
        tab_direct: 'Add Token Directly',
        tab_manage: 'Manage Tokens',
        login_desc: 'Login using GitHub device code flow, supports adding multiple accounts for load balancing.',
        btn_start_login: 'Start Login',
        enter_code: 'Enter this code on GitHub:',
        open_github: 'Click here to open GitHub verification page →',
        waiting_auth: 'Waiting for authorization... Please complete verification on GitHub',
        login_success: '✅ Login successful!',
        btn_add_another: 'Add Another Account',
        login_failed: 'Login failed',
        btn_retry: 'Retry',
        direct_desc: 'If you already have a GitHub Token, you can add it directly:',
        token_placeholder: 'Enter GitHub Token (ghu_xxx or gho_xxx)',
        btn_add_token: 'Add Token',
        btn_refresh: 'Refresh List',
        click_refresh: 'Click refresh to load Token list',
        no_tokens: 'No tokens yet, please login to add',
        token_count: 'Total {total} tokens, {active} active',
        active: '✅ Active',
        inactive: '❌ Inactive',
        requests: 'Requests',
        btn_delete: 'Delete',
        confirm_delete: 'Are you sure you want to delete this token?',
        delete_failed: 'Delete failed',
        load_failed: 'Load failed',
        add_failed: 'Add failed',
        add_success: '✅ Added successfully',
        enter_token: 'Please enter Token',
        connect_failed: 'Cannot connect to server',
        timeout: 'Verification timeout, please retry',
        auth_failed: 'Authorization failed',
        account_added: 'Account added'
    }
};

let currentLang = localStorage.getItem('copilot-router-lang') || 'zh';

function t(key, params = {}) {
    let text = i18n[currentLang][key] || key;
    Object.keys(params).forEach(k => {
        text = text.replace(`{${k}}`, params[k]);
    });
    return text;
}

function updatePageLanguage() {
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
    document.getElementById('langBtn').textContent = currentLang === 'zh' ? 'EN' : '中文';

    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });
}

function toggleLanguage() {
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('copilot-router-lang', currentLang);
    updatePageLanguage();
}

// Apply language settings on page load
document.addEventListener('DOMContentLoaded', updatePageLanguage);

let deviceCode = null;
let pollInterval = null;

function showTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tabs .tab').forEach((t, i) => {
        if ((tab === 'login' && i === 0) || (tab === 'direct' && i === 1) || (tab === 'tokens' && i === 2)) {
            t.classList.add('active');
        }
    });
    document.getElementById('tab-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('tab-direct').style.display = tab === 'direct' ? 'block' : 'none';
    document.getElementById('tab-tokens').style.display = tab === 'tokens' ? 'block' : 'none';

    if (tab === 'tokens') loadTokens();
}

async function startLogin() {
    try {
        const res = await fetch('/auth/login', { method: 'POST' });
        const data = await res.json();

        if (data.error) {
            showError(data.error.message);
            return;
        }

        deviceCode = data;
        document.getElementById('userCode').textContent = data.user_code;
        document.getElementById('verifyLink').href = data.verification_uri;

        showStep('step2');
        startPolling();
    } catch (e) {
        showError(t('connect_failed'));
    }
}

function startPolling() {
    pollInterval = setInterval(async () => {
        try {
            const res = await fetch('/auth/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_code: deviceCode.device_code,
                    interval: deviceCode.interval,
                    expires_in: deviceCode.expires_in
                })
            });
            const data = await res.json();

            // Handle new response format
            if (data.status === 'pending' || data.status === 'processing' || data.status === 'slow_down') {
                // Waiting for authorization or processing, continue polling
                return;
            }

            if (data.status === 'success') {
                clearInterval(pollInterval);
                pollInterval = null;
                document.getElementById('successMessage').textContent =
                    `${t('account_added')}: ${data.username || 'Unknown'}`;
                showStep('step3');
                return;
            }

            if (data.error) {
                clearInterval(pollInterval);
                pollInterval = null;
                showError(data.error.message || t('auth_failed'));
                return;
            }
        } catch (e) {
            // Network error, continue polling
            console.error('Polling error:', e);
        }
    }, (deviceCode.interval + 1) * 1000);

    // Timeout handling
    setTimeout(() => {
        if (pollInterval) {
            clearInterval(pollInterval);
            showError(t('timeout'));
        }
    }, deviceCode.expires_in * 1000);
}

async function addTokenDirect() {
    const token = document.getElementById('directToken').value.trim();
    if (!token) {
        document.getElementById('directResult').innerHTML =
            `<div class="status error" style="margin-top:15px">${t('enter_token')}</div>`;
        return;
    }

    try {
        const res = await fetch('/auth/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ github_token: token })
        });
        const data = await res.json();

        if (data.error) {
            document.getElementById('directResult').innerHTML =
                `<div class="status error" style="margin-top:15px">${data.error.message}</div>`;
        } else {
            document.getElementById('directResult').innerHTML =
                `<div class="status success" style="margin-top:15px">${t('add_success')}: ${data.username}</div>`;
            document.getElementById('directToken').value = '';
        }
    } catch (e) {
        document.getElementById('directResult').innerHTML =
            `<div class="status error" style="margin-top:15px">${t('add_failed')}</div>`;
    }
}

async function loadTokens() {
    try {
        const res = await fetch('/auth/tokens');
        const data = await res.json();

        if (!data.tokens || data.tokens.length === 0) {
            document.getElementById('tokenList').innerHTML =
                `<p style="color: #666; text-align: center; padding: 20px;">${t('no_tokens')}</p>`;
            return;
        }

        let html = `<p style="margin-bottom:15px">${t('token_count', { total: data.total, active: data.active })}</p>`;
        for (const tok of data.tokens) {
            html += `
        <div class="token-item">
          <div class="token-info">
            <strong>${tok.username || 'Unknown'}</strong><br>
            <small>ID: ${tok.id} | ${tok.is_active ? t('active') : t('inactive')} | ${t('requests')}: ${tok.request_count}</small>
          </div>
          <button class="btn-delete" onclick="deleteToken(${tok.id})">${t('btn_delete')}</button>
        </div>
      `;
        }
        document.getElementById('tokenList').innerHTML = html;
    } catch (e) {
        document.getElementById('tokenList').innerHTML =
            `<p style="color: red; text-align: center; padding: 20px;">${t('load_failed')}</p>`;
    }
}

async function deleteToken(id) {
    if (!confirm(t('confirm_delete'))) return;

    try {
        await fetch(`/auth/tokens/${id}`, { method: 'DELETE' });
        loadTokens();
    } catch (e) {
        alert(t('delete_failed'));
    }
}

function showStep(stepId) {
    document.querySelectorAll('#tab-login .step').forEach(s => s.classList.remove('active'));
    document.getElementById(stepId).classList.add('active');
}

function showError(message) {
    if (pollInterval) clearInterval(pollInterval);
    document.getElementById('errorMessage').textContent = message;
    showStep('stepError');
}

function resetLogin() {
    if (pollInterval) clearInterval(pollInterval);
    deviceCode = null;
    showStep('step1');
}
