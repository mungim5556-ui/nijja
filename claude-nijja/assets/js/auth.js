// 시연용 로그인 세션. 서버 인증이 없으므로 비밀번호는 저장하지 않고
// 이메일·이름·역할만 브라우저에 보관한다.
(function () {
  const KEY = "reclaim.session";
  const read = (store) => { try { return JSON.parse(store.getItem(KEY)); } catch { return null; } };

  window.auth = {
    get() { return read(localStorage) || read(sessionStorage); },
    login(session, remember) {
      const data = JSON.stringify({ ...session, at: new Date().toISOString() });
      try {
        (remember ? localStorage : sessionStorage).setItem(KEY, data);
        (remember ? sessionStorage : localStorage).removeItem(KEY);
        sessionStorage.removeItem("reclaim.role"); // 새로 로그인한 역할을 앱의 기본 역할로 쓴다
      } catch {}
    },
    logout() {
      try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch {}
    },
    // 로그인하지 않았으면 로그인 페이지로 보내고, 끝나면 원래 페이지로 돌아오게 한다
    require() {
      if (this.get()) return true;
      const next = location.pathname.split("/").pop() + location.search + location.hash;
      location.replace("login.html?next=" + encodeURIComponent(next));
      return false;
    },
  };
})();
