/* MusicGraph Auth: Supabase Email OTP without extra frontend dependencies. */
(function () {
  "use strict";

  var SB = window.MG_SUPABASE || {};
  var STORAGE_KEY = "mg_supabase_session_v1";
  var listeners = [];
  var state = { session: null, user: null };

  function demoMode() { return /(^|[?&])mode=auth-demo(?:&|$)/.test(location.search); }
  function demoSession() {
    return {
      access_token: "auth-demo-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "auth-demo-user", email: "lin.demo@example.com" }
    };
  }
  function active() { return !!(SB && SB.url && SB.anonKey); }
  function headers(token) {
    var h = { apikey: SB.anonKey, "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    else if (SB.anonKey) h.Authorization = "Bearer " + SB.anonKey;
    return h;
  }
  function save(session) {
    state.session = session || null;
    state.user = session && session.user ? session.user : null;
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    render();
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }
  function read() {
    if (demoMode()) return demoSession();
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch (e) { return null; }
  }
  function authFetch(path, options) {
    if (!active()) return Promise.reject(new Error("Supabase Auth 未配置"));
    options = options || {};
    return fetch(SB.url + "/auth/v1" + path, {
      method: options.method || "GET",
      headers: headers(options.token),
      body: options.body,
      signal: AbortSignal.timeout(SB.timeoutMs || 8000)
    }).then(function (r) {
      return r.text().then(function (text) {
        var data = text ? JSON.parse(text) : {};
        if (!r.ok) throw new Error(data.message || data.msg || data.error_description || data.error || ("HTTP " + r.status));
        return data;
      });
    });
  }
  function normalize(session) {
    if (!session || !session.access_token) return null;
    session.expires_at = session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
    return session;
  }
  function refresh() {
    var session = state.session || read();
    if (!session || !session.refresh_token) return Promise.resolve(null);
    return authFetch("/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(function (next) {
      next = normalize(next);
      if (next) save(next);
      return next;
    }).catch(function () { save(null); return null; });
  }
  function getSession() {
    var session = state.session || read();
    if (!session) return Promise.resolve(null);
    state.session = session; state.user = session.user || null;
    if ((session.expires_at || 0) - Math.floor(Date.now() / 1000) > 60) return Promise.resolve(session);
    return refresh();
  }
  function sendOtp(email) {
    return authFetch("/otp", {
      method: "POST",
      body: JSON.stringify({ email: email, create_user: true, should_create_user: true })
    });
  }
  function verifyOtp(email, token) {
    return authFetch("/verify", {
      method: "POST",
      body: JSON.stringify({ email: email, token: token, type: "email" })
    }).then(function (data) {
      var session = normalize(data);
      if (!session) throw new Error("登录失败，请重新获取验证码");
      save(session);
      return session;
    });
  }
  function signOut() {
    if (demoMode()) { save(null); return Promise.resolve(); }
    var token = state.session && state.session.access_token;
    var done = function () { save(null); };
    if (!token) { done(); return Promise.resolve(); }
    return authFetch("/logout", { method: "POST", token: token, body: "{}" }).catch(function () {}).then(done);
  }
  function setMessage(msg, tone) {
    var el = document.getElementById("auth-message");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "auth-message" + (tone ? " " + tone : "");
  }
  function render() {
    var login = document.getElementById("auth-login-btn");
    var menu = document.getElementById("auth-user-menu");
    var userBtn = document.getElementById("auth-user-btn");
    var authed = !!(state.session && state.session.access_token);
    if (login) login.classList.toggle("hidden", authed);
    if (menu) menu.classList.toggle("hidden", !authed);
    if (userBtn && authed) {
      var email = (state.user && state.user.email) || "我的";
      userBtn.textContent = email.split("@")[0] || "我的";
      userBtn.title = email;
    }
  }
  function showEmailStep() {
    document.getElementById("auth-email-form").classList.remove("hidden");
    document.getElementById("auth-token-form").classList.add("hidden");
    var sendButton = document.querySelector("#auth-email-form button[type='submit']");
    if (sendButton) { sendButton.disabled = false; sendButton.textContent = "发送验证码"; }
    setMessage("");
  }
  function showTokenStep(email) {
    document.getElementById("auth-email-form").classList.add("hidden");
    document.getElementById("auth-token-form").classList.remove("hidden");
    document.getElementById("auth-email-sent").textContent = "验证码已发送至 " + email;
    document.getElementById("auth-token").value = "";
    setMessage("");
  }
  function open() {
    var modal = document.getElementById("auth-modal");
    if (!modal) return;
    ["auth-agreement-email", "auth-agreement-token"].forEach(function (id) {
      var checkbox = document.getElementById(id);
      if (checkbox) checkbox.checked = false;
    });
    showEmailStep();
    modal.classList.remove("hidden");
    setTimeout(function () { document.getElementById("auth-email").focus(); }, 0);
  }
  function close() {
    var modal = document.getElementById("auth-modal");
    if (modal) modal.classList.add("hidden");
  }
  function agreementChecked(id) {
    var checkbox = document.getElementById(id);
    return !!(checkbox && checkbox.checked);
  }
  function syncAgreement(sourceId, targetId) {
    var source = document.getElementById(sourceId);
    var target = document.getElementById(targetId);
    if (source && target) source.addEventListener("change", function () { target.checked = source.checked; });
  }
  function startOtpResendCooldown(button) {
    var remaining = 60;
    button.disabled = true;
    button.textContent = remaining + " 秒后可重发";
    var timer = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        button.disabled = false;
        button.textContent = "重新发送验证码";
        return;
      }
      button.textContent = remaining + " 秒后可重发";
    }, 1000);
  }
  function wire() {
    var currentEmail = "";
    var pop = document.getElementById("auth-menu-pop");
    var login = document.getElementById("auth-login-btn");
    var userBtn = document.getElementById("auth-user-btn");
    if (login) login.addEventListener("click", open);
    document.getElementById("auth-close").addEventListener("click", close);
    document.getElementById("auth-logout-btn").addEventListener("click", function () { signOut(); if (pop) pop.classList.add("hidden"); });
    document.getElementById("auth-change-email").addEventListener("click", showEmailStep);
    syncAgreement("auth-agreement-email", "auth-agreement-token");
    syncAgreement("auth-agreement-token", "auth-agreement-email");
    if (userBtn && pop) {
      userBtn.addEventListener("click", function () { pop.classList.toggle("hidden"); });
      document.addEventListener("click", function (e) {
        var menu = document.getElementById("auth-user-menu");
        if (menu && !menu.contains(e.target)) pop.classList.add("hidden");
      });
    }
    document.getElementById("auth-email-form").addEventListener("submit", function (e) {
      e.preventDefault();
      currentEmail = document.getElementById("auth-email").value.trim();
      if (!currentEmail) return;
      if (!agreementChecked("auth-agreement-email")) {
        setMessage("请先阅读并同意《用户协议》和《隐私政策》", "error");
        return;
      }
      var sendButton = e.currentTarget.querySelector("button[type='submit']");
      sendButton.disabled = true;
      sendButton.textContent = "正在发送…";
      setMessage("");
      sendOtp(currentEmail).then(function () { showTokenStep(currentEmail); }).catch(function (err) {
        sendButton.disabled = false;
        sendButton.textContent = "发送验证码";
        setMessage(err.message || "发送失败", "error");
      });
    });
    document.getElementById("auth-resend").addEventListener("click", function (e) {
      if (!currentEmail) return;
      startOtpResendCooldown(e.currentTarget);
      setMessage("正在重新发送…");
      sendOtp(currentEmail).then(function () { setMessage("验证码已重新发送"); }).catch(function (err) { setMessage(err.message || "发送失败", "error"); });
    });
    document.getElementById("auth-token-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var token = document.getElementById("auth-token").value.trim();
      if (!currentEmail || !token) return;
      if (!agreementChecked("auth-agreement-token")) {
        setMessage("请先阅读并同意《用户协议》和《隐私政策》", "error");
        return;
      }
      setMessage("正在登录…");
      verifyOtp(currentEmail, token).then(close).catch(function (err) { setMessage(err.message || "验证码错误或已过期", "error"); });
    });
  }

  window.MG_AUTH = {
    open: open,
    close: close,
    currentUser: function () { return state.user; },
    getSession: getSession,
    getAccessToken: function () { return getSession().then(function (session) { return session && session.access_token; }); },
    sendOtp: sendOtp,
    verifyOtp: verifyOtp,
    signOut: signOut,
    onChange: function (fn) {
      listeners.push(fn);
      // 晚于认证模块加载的页面逻辑，也能立刻拿到已经恢复的登录态。
      if (state.session) { try { fn(state); } catch (e) {} }
      return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    wire();
    state.session = read();
    state.user = state.session && state.session.user ? state.session.user : null;
    getSession().then(function (session) {
      // 恢复已有登录态时也通知页面，让匿名评分有机会自动归并到账号。
      if (session) save(session);
      else render();
    });
  });
})();
