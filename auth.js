// 계정: 로그인·가입·계정 관리·관리자 기능. 로그인 방식은 두 가지(Supabase, Firebase) 중 사용자가 고른다.
// 설정은 window.QUIZ_AUTH_CONFIG(공개해도 되는 값만: 주소·공개 키). 없으면(로컬판) 계정 기능을 끈다.
//   { idDomain, providers: { supabase: {url, anonKey}, firebase: {apiKey, authDomain, projectId, appId}, mock: true } }
// 비밀번호는 브라우저에서 로그인 서버로만 간다(HTTPS). 서버는 해시만 저장한다. 이 사이트·관리자는 비밀번호를 받지 않는다.
// 전체 구조와 설정 방법은 _tools/auth/README.md(로컬 전용).
(function () {
  "use strict";
  const CFG = window.QUIZ_AUTH_CONFIG || null;
  const LS_PROV = "mq_auth_provider";
  const NAMES = { supabase: "Supabase", firebase: "Firebase", mock: "테스트" };
  const ID_RE = /^[a-z0-9][a-z0-9_.-]{2,19}$/;

  function idDomain() { return (CFG && CFG.idDomain) || "med-quiz.invalid"; }
  function emailOf(id) { return String(id).trim().toLowerCase() + "@" + idDomain(); }
  function idOf(email) { return String(email || "").split("@")[0]; }
  function providers() { return CFG ? Object.keys(CFG.providers || {}).filter((k) => CFG.providers[k]) : []; }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]')) return res();
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("불러오기 실패: " + src)); };
      document.head.appendChild(s);
    });
  }
  function friendly(e) {
    const m = String((e && (e.message || e.code)) || e || "");
    if (/invalid login|invalid-credential|wrong-password|user-not-found|Invalid login credentials|INVALID_LOGIN_CREDENTIALS/i.test(m)) return "ID 또는 비밀번호가 맞지 않습니다.";
    if (/already registered|already-in-use|User already registered/i.test(m)) return "이미 있거나 사용할 수 없는 ID입니다(탈퇴한 ID도 다시 쓸 수 없습니다).";
    if (/banned|탈퇴한 계정/i.test(m)) return "탈퇴한 계정입니다.";
    if (/weak-password|at least 6|Password should be/i.test(m)) return "비밀번호가 너무 짧습니다(8자 이상).";
    if (/requires-recent-login/i.test(m)) return "보안을 위해 다시 로그인한 뒤 바꿔 주세요.";
    if (/network|Failed to fetch/i.test(m)) return "네트워크 오류입니다. 잠시 뒤 다시 시도하세요.";
    if (/too-many-requests|rate limit/i.test(m)) return "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요.";
    return m || "알 수 없는 오류";
  }

  // ======================================================================
  // 로그인 방식(공급자). 모두 같은 함수를 갖는다:
  //  init() → 저장된 로그인 복구, signUp(id,pw,name), signIn(id,pw), signOut(), changePassword(old,new),
  //  profile(), contentKey(), store(읽기·쓰기), logPrint(e), admin.{listUsers,setApproved,listPrintLogs}
  // ======================================================================
  const P = {};

  // ---------- Supabase ----------
  P.supabase = function () {
    const c = CFG.providers.supabase;
    let sb = null, user = null, prof = null;
    async function client() {
      if (!sb) {
        await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js");
        sb = window.supabase.createClient(c.url, c.anonKey, { auth: { persistSession: true, storageKey: "mq-sb-auth", autoRefreshToken: true } });
      }
      return sb;
    }
    async function loadProfile() {
      const { data, error } = await sb.from("profiles").select("login_id,name,approved,is_admin,created_at,withdrawn_at").eq("id", user.id).maybeSingle();
      if (error) throw error;
      prof = data ? { uid: user.id, loginId: data.login_id, name: data.name, approved: data.approved, isAdmin: data.is_admin, provider: "supabase" } : null;
      return prof;
    }
    const api = {
      async init() {
        await client();
        const { data } = await sb.auth.getSession();
        user = data && data.session ? data.session.user : null;
        if (user) await loadProfile();
        return prof;
      },
      async signUp(id, pw, name) {
        await client();
        const { data, error } = await sb.auth.signUp({ email: emailOf(id), password: pw, options: { data: { login_id: id, name: name } } });
        if (error) throw error;
        if (!data.session) throw new Error("가입은 되었지만 로그인 세션이 없습니다. 관리자에게 알려 주세요(이메일 확인 설정).");
        user = data.user; return loadProfile();
      },
      async signIn(id, pw) {
        await client();
        const { data, error } = await sb.auth.signInWithPassword({ email: emailOf(id), password: pw });
        if (error) throw error;
        user = data.user; return loadProfile();
      },
      async signOut() { if (sb) await sb.auth.signOut(); user = null; prof = null; },
      async changePassword(oldPw, newPw) {
        // 지금 비밀번호를 한 번 더 확인한 뒤 바꾼다
        const { error: e1 } = await sb.auth.signInWithPassword({ email: user.email, password: oldPw });
        if (e1) throw new Error("지금 비밀번호가 맞지 않습니다.");
        const { error } = await sb.auth.updateUser({ password: newPw });
        if (error) throw error;
      },
      // 탈퇴: 비밀번호를 확인한 뒤 서버 함수가 계정을 막는다(로그인 금지). 기록과 ID는 남는다
      async withdraw(pw) {
        const { error: e1 } = await sb.auth.signInWithPassword({ email: user.email, password: pw });
        if (e1) throw new Error("비밀번호가 맞지 않습니다.");
        const { error } = await sb.rpc("withdraw_me");
        if (error) throw error;
        await sb.auth.signOut(); user = null; prof = null;
      },
      async setName(name) {
        const { error } = await sb.from("profiles").update({ name: name }).eq("id", user.id);
        if (error) throw error; prof.name = name;
      },
      profile() { return prof; },
      async contentKey() {
        const { data, error } = await sb.from("app_secret").select("content_key").eq("id", 1).maybeSingle();
        if (error) throw error;
        return data ? data.content_key : null;
      },
      // 기록 저장소: user_files(user_id, path, data, ver). 본인만 읽고 쓴다(관리자도 못 본다)
      store: {
        async read(path) {
          const { data, error } = await sb.from("user_files").select("data,ver").eq("user_id", user.id).eq("path", path).maybeSingle();
          if (error) throw error;
          return data ? { data: data.data, sha: data.ver } : { data: null, sha: null };
        },
        async write(path, value, ver) {
          if (ver == null) {
            const { error } = await sb.from("user_files").insert({ user_id: user.id, path: path, data: value, ver: 1 });
            if (error) { if (/duplicate|23505/.test(error.message + error.code)) return false; throw error; }
            return true;
          }
          const { data, error } = await sb.from("user_files").update({ data: value, ver: ver + 1 }).eq("user_id", user.id).eq("path", path).eq("ver", ver).select("ver");
          if (error) throw error;
          return !!(data && data.length);
        },
        async list(prefix) {
          const { data, error } = await sb.from("user_files").select("path").eq("user_id", user.id).like("path", prefix + "%");
          if (error) throw error;
          return (data || []).map((r) => r.path);
        }
      },
      async logPrint(e) {
        await sb.from("print_logs").insert({ quiz_id: e.quizId, title: e.title, kind: e.kind, fmt: e.fmt, code: e.code || null });
      },
      admin: {
        async listUsers() {
          const { data, error } = await sb.from("profiles").select("id,login_id,name,approved,is_admin,created_at,withdrawn_at,purged_at").order("created_at", { ascending: false });
          if (error) throw error;
          return data.map((r) => ({ uid: r.id, loginId: r.login_id, name: r.name, approved: r.approved, isAdmin: r.is_admin, created: r.created_at, withdrawn: r.withdrawn_at, purged: r.purged_at }));
        },
        async purge(uid) {
          const { error } = await sb.rpc("admin_purge", { target: uid });
          if (error) throw error;
        },
        async setApproved(uid, value) {
          const { error } = await sb.rpc("admin_set_approved", { target: uid, value: value });
          if (error) throw error;
        },
        async listPrintLogs() {
          const { data, error } = await sb.from("print_logs").select("login_id,name,quiz_id,title,kind,fmt,code,created_at").order("created_at", { ascending: false }).limit(500);
          if (error) throw error;
          return data.map((r) => ({ loginId: r.login_id, name: r.name, quizId: r.quiz_id, title: r.title, kind: r.kind, fmt: r.fmt, code: r.code, at: r.created_at }));
        }
      }
    };
    return api;
  };

  // ---------- Firebase ----------
  P.firebase = function () {
    const c = CFG.providers.firebase;
    let app = null, auth = null, db = null, user = null, prof = null;
    const V = "10.12.2";
    async function client() {
      if (!app) {
        await loadScript("https://www.gstatic.com/firebasejs/" + V + "/firebase-app-compat.js");
        await loadScript("https://www.gstatic.com/firebasejs/" + V + "/firebase-auth-compat.js");
        await loadScript("https://www.gstatic.com/firebasejs/" + V + "/firebase-firestore-compat.js");
        app = window.firebase.initializeApp(c, "mq");
        auth = app.auth(); db = app.firestore();
      }
    }
    async function loadProfile() {
      const s = await db.collection("users").doc(user.uid).get();
      const d = s.exists ? s.data() : null;
      prof = d ? { uid: user.uid, loginId: d.loginId, name: d.name, approved: !!d.approved, isAdmin: !!d.isAdmin, provider: "firebase" } : null;
      if (d && d.withdrawn) { await auth.signOut(); user = null; prof = null; throw new Error("탈퇴한 계정"); }
      return prof;
    }
    const fileDoc = (path) => db.collection("users").doc(user.uid).collection("files").doc(encodeURIComponent(path));
    const ts = (v) => (v && v.toDate ? v.toDate().toISOString() : v || null);
    const api = {
      async init() {
        await client();
        user = await new Promise(function (res) { const off = auth.onAuthStateChanged(function (u) { off(); res(u); }); });
        if (user) await loadProfile();
        return prof;
      },
      async signUp(id, pw, name) {
        await client();
        const cred = await auth.createUserWithEmailAndPassword(emailOf(id), pw);
        user = cred.user;
        await db.collection("users").doc(user.uid).set({ loginId: id, name: name, approved: false, isAdmin: false, createdAt: window.firebase.firestore.FieldValue.serverTimestamp() });
        return loadProfile();
      },
      async signIn(id, pw) {
        await client();
        const cred = await auth.signInWithEmailAndPassword(emailOf(id), pw);
        user = cred.user; return loadProfile();
      },
      async signOut() { if (auth) await auth.signOut(); user = null; prof = null; },
      async changePassword(oldPw, newPw) {
        const cred = window.firebase.auth.EmailAuthProvider.credential(user.email, oldPw);
        try { await user.reauthenticateWithCredential(cred); } catch (e) { throw new Error("지금 비밀번호가 맞지 않습니다."); }
        await user.updatePassword(newPw);
      },
      async setName(name) { await db.collection("users").doc(user.uid).update({ name: name }); prof.name = name; },
      // 탈퇴: Firebase는 브라우저에서 계정을 막을 수 없으므로 프로필에 탈퇴 표시를 하고(규칙이 내용 열쇠를 막음, 로그인해도 바로 나감)
      // 관리자가 기록을 지울 수 있게 기록 파일 목록을 함께 적어 둔다. 로그인 계정은 남으므로 같은 ID로 다시 가입할 수 없다
      async withdraw(pw) {
        const cred = window.firebase.auth.EmailAuthProvider.credential(user.email, pw);
        try { await user.reauthenticateWithCredential(cred); } catch (e) { throw new Error("비밀번호가 맞지 않습니다."); }
        const files = (await db.collection("users").doc(user.uid).collection("files").get()).docs.map((d) => d.id);
        await db.collection("users").doc(user.uid).update({ withdrawn: true, approved: false, files: files, withdrawnAt: window.firebase.firestore.FieldValue.serverTimestamp() });
        await auth.signOut(); user = null; prof = null;
      },
      profile() { return prof; },
      async contentKey() {
        const s = await db.collection("secrets").doc("content").get();
        return s.exists ? s.data().key : null;
      },
      store: {
        async read(path) {
          const s = await fileDoc(path).get();
          if (!s.exists) return { data: null, sha: null };
          const d = s.data();
          return { data: JSON.parse(d.data), sha: d.ver };
        },
        async write(path, value, ver) {
          const ref = fileDoc(path);
          return db.runTransaction(async function (tx) {
            const s = await tx.get(ref);
            const cur = s.exists ? s.data().ver : null;
            if ((cur == null ? null : cur) !== (ver == null ? null : ver)) return false;
            tx.set(ref, { path: path, data: JSON.stringify(value), ver: (ver || 0) + 1 });
            return true;
          });
        },
        async list(prefix) {
          const q = await db.collection("users").doc(user.uid).collection("files").get();
          return q.docs.map((d) => d.data().path).filter((p) => p.indexOf(prefix) === 0);
        }
      },
      async logPrint(e) {
        await db.collection("printLogs").add({ uid: user.uid, loginId: prof.loginId, name: prof.name, quizId: e.quizId, title: e.title, kind: e.kind, fmt: e.fmt, code: e.code || null,
          at: window.firebase.firestore.FieldValue.serverTimestamp() });
      },
      admin: {
        async listUsers() {
          const q = await db.collection("users").get();
          return q.docs.map(function (d) { const x = d.data(); return { uid: d.id, loginId: x.loginId, name: x.name, approved: !!x.approved, isAdmin: !!x.isAdmin, created: ts(x.createdAt), withdrawn: x.withdrawn ? ts(x.withdrawnAt) || true : null, purged: x.purged ? ts(x.purgedAt) || true : null }; })
            .sort((a, b) => String(b.created).localeCompare(String(a.created)));
        },
        async setApproved(uid, value) { await db.collection("users").doc(uid).update({ approved: value }); },
        async purge(uid) {
          const ref = db.collection("users").doc(uid);
          const s = await ref.get();
          for (const f of (s.data().files || [])) await ref.collection("files").doc(f).delete();
          await ref.update({ purged: true, name: "(기록 삭제됨)", files: [], purgedAt: window.firebase.firestore.FieldValue.serverTimestamp() });
        },
        async listPrintLogs() {
          const q = await db.collection("printLogs").orderBy("at", "desc").limit(500).get();
          return q.docs.map(function (d) { const x = d.data(); return { loginId: x.loginId, name: x.name, quizId: x.quizId, title: x.title, kind: x.kind, fmt: x.fmt, code: x.code, at: ts(x.at) }; });
        }
      }
    };
    return api;
  };

  // ---------- 테스트용(브라우저 안 가짜 서버). config.providers.mock이 있을 때만 ----------
  P.mock = function () {
    const K = "mq_mock_db";
    const db = () => { try { return JSON.parse(localStorage.getItem(K)) || { users: {}, files: {}, logs: [] }; } catch (e) { return { users: {}, files: {}, logs: [] }; } };
    const put = (d) => localStorage.setItem(K, JSON.stringify(d));
    let prof = null;
    const me = () => prof && db().users[prof.uid];
    const pf = (u) => u ? { uid: u.uid, loginId: u.loginId, name: u.name, approved: u.approved, isAdmin: u.isAdmin, provider: "mock" } : null;
    return {
      async init() { const uid = localStorage.getItem("mq_mock_uid"); prof = uid ? pf(db().users[uid]) : null; return prof; },
      async signUp(id, pw, name) {
        const d = db();
        if (Object.values(d.users).some((u) => u.loginId === id)) throw new Error("User already registered");
        const uid = "u" + Math.random().toString(36).slice(2, 9);
        d.users[uid] = { uid: uid, loginId: id, name: name, pw: "hash:" + pw.length, approved: id === "admin", isAdmin: id === "admin", created: new Date().toISOString() };
        d.users[uid].pwcheck = pw; put(d); localStorage.setItem("mq_mock_uid", uid); prof = pf(d.users[uid]); return prof;
      },
      async signIn(id, pw) {
        const u = Object.values(db().users).find((x) => x.loginId === id && x.pwcheck === pw);
        if (!u) throw new Error("Invalid login credentials");
        if (u.withdrawn) throw new Error("User is banned");
        localStorage.setItem("mq_mock_uid", u.uid); prof = pf(u); return prof;
      },
      async signOut() { localStorage.removeItem("mq_mock_uid"); prof = null; },
      async changePassword(o, n) { const d = db(); const u = d.users[prof.uid]; if (u.pwcheck !== o) throw new Error("지금 비밀번호가 맞지 않습니다."); u.pwcheck = n; put(d); },
      async setName(name) { const d = db(); d.users[prof.uid].name = name; put(d); prof.name = name; },
      async withdraw(pw) { const d = db(); const u = d.users[prof.uid]; if (u.pwcheck !== pw) throw new Error("비밀번호가 맞지 않습니다."); u.withdrawn = new Date().toISOString(); u.approved = false; put(d); localStorage.removeItem("mq_mock_uid"); prof = null; },
      profile() { return prof; },
      async contentKey() { return me() && me().approved ? localStorage.getItem("mq_mock_key") : null; },
      store: {
        async read(path) { const f = (db().files[prof.uid] || {})[path]; return f ? { data: f.data, sha: f.ver } : { data: null, sha: null }; },
        async write(path, v, ver) { const d = db(); const m = d.files[prof.uid] = d.files[prof.uid] || {}; const cur = m[path] ? m[path].ver : null; if (cur !== (ver == null ? null : ver)) return false; m[path] = { data: v, ver: (ver || 0) + 1 }; put(d); return true; },
        async list(prefix) { return Object.keys(db().files[prof.uid] || {}).filter((p) => p.indexOf(prefix) === 0); }
      },
      async logPrint(e) { const d = db(); d.logs.unshift(Object.assign({ loginId: prof.loginId, name: prof.name, at: new Date().toISOString() }, e)); put(d); },
      admin: {
        async listUsers() { return Object.values(db().users).map((u) => ({ uid: u.uid, loginId: u.loginId, name: u.name, approved: u.approved, isAdmin: u.isAdmin, created: u.created, withdrawn: u.withdrawn || null, purged: u.purged || null })); },
        async setApproved(uid, v) { const d = db(); if (d.users[uid].withdrawn) throw new Error("탈퇴한 계정"); d.users[uid].approved = v; put(d); },
        async purge(uid) { const d = db(); if (!d.users[uid].withdrawn) throw new Error("탈퇴하지 않은 계정"); delete d.files[uid]; d.users[uid].purged = new Date().toISOString(); d.users[uid].name = "(기록 삭제됨)"; put(d); },
        async listPrintLogs() { return db().logs; }
      }
    };
  };

  // ======================================================================
  // 상태
  // ======================================================================
  const inst = {};                   // 공급자별 인스턴스(관리자는 두 방식에 모두 로그인할 수 있다)
  let cur = null;                    // 지금 쓰는 로그인 방식
  function get(name) { if (!inst[name]) inst[name] = P[name](); return inst[name]; }
  function me() { return cur && inst[cur] ? inst[cur].profile() : null; }

  async function init() {
    if (!CFG) return null;
    let name = null;
    try { name = localStorage.getItem(LS_PROV); } catch (e) { /* ignore */ }
    if (!name || providers().indexOf(name) < 0) return null;
    try {
      const p = await get(name).init();
      if (p) cur = name;
      return p;
    } catch (e) { return null; }
  }

  // ======================================================================
  // 화면
  // ======================================================================
  const CSS = `
.au-btn{white-space:nowrap;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:6px 14px;font-weight:600}
.au-btn.pri{background:var(--accent);border-color:var(--accent);color:#fff}
.au-btn.au-danger{background:var(--bad);border-color:var(--bad);color:#fff}
.au-wd summary{cursor:pointer;color:var(--ink-3);font-size:14px}
.au-ov{position:fixed;inset:0;z-index:300;background:rgba(10,10,10,.55);display:grid;place-items:center;padding:16px}
.au-ov[hidden]{display:none}
.au-box{width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--surface);color:var(--ink);border-radius:16px;box-shadow:var(--shadow);padding:22px 22px 18px;position:relative}
.au-box h2{margin:0 0 4px;font-size:20px}
.au-box .sub{color:var(--ink-2);font-size:14px;margin:0 0 14px}
.au-x{position:absolute;right:12px;top:10px;border:0;background:none;font-size:20px;color:var(--ink-3)}
.au-seg{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:12px}
.au-seg button{flex:1;border:0;background:none;padding:8px;color:var(--ink-2)}
.au-seg button.on{background:var(--accent-soft);color:var(--accent);font-weight:700}
.au-f{display:flex;flex-direction:column;gap:10px}
.au-f label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--ink-2)}
.au-f input{font:inherit;font-size:15px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink)}
.au-f .row{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:4px}
.au-msg{min-height:20px;font-size:13px;color:var(--bad)}
.au-msg.ok{color:var(--ok)}
.au-link{border:0;background:none;color:var(--accent);padding:0;font-size:13px;text-decoration:underline}
.au-meta{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:14px;margin:6px 0 14px}
.au-meta dt{color:var(--ink-3)}.au-meta dd{margin:0}
.au-sec{border-top:1px solid var(--line);margin-top:14px;padding-top:12px}
.au-steps{margin:8px 0;padding-left:20px;font-size:14px;line-height:1.6}
.au-demo{background:var(--quote);border-radius:10px;padding:10px 12px;font-size:13px;word-break:break-all}
.au-demo code{font-size:12px}
.au-pill{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;background:var(--surface-2);color:var(--ink-2)}
.au-pill.ok{background:var(--ok-soft);color:var(--ok)}.au-pill.wait{background:var(--bad-soft);color:var(--bad)}
#authBtn{max-width:8em;overflow:hidden;text-overflow:ellipsis}
@media (max-width:640px){.topbar{padding-left:10px;padding-right:10px;gap:6px}.brand-text{display:none}.topnav{gap:2px}.topnav .navbtn{padding:6px 8px}#authBtn{padding:6px 10px;max-width:6em}.sync-chip{font-size:11px;padding:4px 8px}}
@media (max-width:420px){#authBtn{padding:6px 8px;max-width:4.6em;font-size:13.5px}.sync-chip{padding:3px 6px}}
@media (max-width:370px){.sync-chip{display:none}}
`;
  let ov = null, cssOn = false;
  function ensureCss() { if (cssOn) return; cssOn = true; const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); }
  function overlay() {
    if (ov) return ov;
    ensureCss();
    ov = document.createElement("div"); ov.className = "au-ov"; ov.hidden = true;
    ov.innerHTML = '<div class="au-box" role="dialog" aria-modal="true"><button type="button" class="au-x" aria-label="닫기">✕</button><div class="au-in"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov || e.target.closest(".au-x")) close(); });
    document.addEventListener("keydown", function (e) { if (!ov.hidden && e.key === "Escape") close(); });
    return ov;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function show(html) { overlay(); ov.querySelector(".au-in").innerHTML = html; ov.hidden = false; const f = ov.querySelector("input"); if (f) f.focus(); return ov.querySelector(".au-in"); }
  function close() { if (ov) ov.hidden = true; }

  // 헤더 오른쪽 위 버튼
  function headerButton() {
    if (!CFG) return;
    ensureCss();
    const nav = document.querySelector(".topnav");
    if (!nav) return;
    let b = document.getElementById("authBtn");
    if (!b) { b = document.createElement("button"); b.type = "button"; b.id = "authBtn"; nav.appendChild(b); b.onclick = function () { me() ? account() : login(); }; }
    const p = me();
    b.className = "au-btn" + (p ? "" : " pri");
    b.textContent = p ? p.name + " 님" : "로그인";
  }

  function provSeg(sel) {
    const ps = providers();
    if (ps.length < 2) return "";
    return '<div class="au-seg">' + ps.map((p) => '<button type="button" data-p="' + p + '" class="' + (p === sel ? "on" : "") + '">' + NAMES[p] + " 계정</button>").join("") + "</div>" +
      '<p class="sub" style="margin-top:-6px">가입할 때 고른 방식으로 로그인하세요. 두 방식의 계정은 따로입니다.</p>';
  }
  function wireSeg(box, state) {
    box.querySelectorAll(".au-seg button").forEach(function (b) {
      b.onclick = function () { state.p = b.dataset.p; box.querySelectorAll(".au-seg button").forEach((x) => x.classList.toggle("on", x === b)); };
    });
  }
  function lastProv() { let p = null; try { p = localStorage.getItem(LS_PROV); } catch (e) { /* ignore */ } return providers().indexOf(p) >= 0 ? p : providers()[0]; }

  function login(reason) {
    const state = { p: lastProv() };
    const box = show('<h2>로그인</h2><p class="sub">' + esc(reason || "사이트 이용을 위해 로그인해주십시오.") + "</p>" + provSeg(state.p) +
      '<form class="au-f"><label>ID<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
      '<label>비밀번호<input name="pw" type="password" autocomplete="current-password" required></label>' +
      '<div class="au-msg"></div><div class="row"><button type="button" class="au-link" data-go="signup">계정 만들기</button><button class="au-btn pri" type="submit">로그인</button></div>' +
      '<button type="button" class="au-link" data-go="sec" style="align-self:flex-start">비밀번호는 어떻게 보호되나요?</button></form>');
    wireSeg(box, state);
    box.querySelector("[data-go=signup]").onclick = signup;
    box.querySelector("[data-go=sec]").onclick = security;
    box.querySelector("form").onsubmit = async function (e) {
      e.preventDefault();
      const f = e.target, msg = box.querySelector(".au-msg");
      const id = f.id.value.trim().toLowerCase();
      msg.className = "au-msg"; msg.textContent = "로그인 중…";
      try {
        const p = await get(state.p).signIn(id, f.pw.value);
        f.pw.value = "";
        cur = state.p; try { localStorage.setItem(LS_PROV, cur); } catch (err) { /* ignore */ }
        afterLogin(p);
      } catch (err) { msg.textContent = friendly(err); }
    };
  }

  function signup() {
    const state = { p: lastProv() };
    const box = show('<h2>계정 만들기</h2><p class="sub">가입한 뒤 관리자가 승인하면 문항을 볼 수 있습니다.</p>' + provSeg(state.p) +
      '<form class="au-f"><label>ID (영문 소문자·숫자 3~20자)<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
      '<label>이름<input name="name" autocomplete="name" required maxlength="30"></label>' +
      '<label>비밀번호 (8자 이상)<input name="pw" type="password" autocomplete="new-password" required></label>' +
      '<label>비밀번호 확인<input name="pw2" type="password" autocomplete="new-password" required></label>' +
      '<div class="au-msg"></div><div class="row"><button type="button" class="au-link" data-go="login">이미 계정이 있어요</button><button class="au-btn pri" type="submit">가입</button></div>' +
      '<button type="button" class="au-link" data-go="sec" style="align-self:flex-start">비밀번호는 어떻게 보호되나요?</button></form>');
    wireSeg(box, state);
    box.querySelector("[data-go=login]").onclick = function () { login(); };
    box.querySelector("[data-go=sec]").onclick = security;
    box.querySelector("form").onsubmit = async function (e) {
      e.preventDefault();
      const f = e.target, msg = box.querySelector(".au-msg");
      const id = f.id.value.trim().toLowerCase(), name = f.name.value.trim();
      msg.className = "au-msg";
      if (!ID_RE.test(id)) { msg.textContent = "ID는 영문 소문자·숫자로 시작하고 3~20자(._- 가능)여야 합니다."; return; }
      if (!name) { msg.textContent = "이름을 적어 주세요."; return; }
      if (f.pw.value.length < 8) { msg.textContent = "비밀번호는 8자 이상이어야 합니다."; return; }
      if (f.pw.value !== f.pw2.value) { msg.textContent = "비밀번호 확인이 다릅니다."; return; }
      msg.textContent = "가입 중…";
      try {
        const p = await get(state.p).signUp(id, f.pw.value, name);
        f.pw.value = f.pw2.value = "";
        cur = state.p; try { localStorage.setItem(LS_PROV, cur); } catch (err) { /* ignore */ }
        afterLogin(p);
      } catch (err) { msg.textContent = friendly(err); }
    };
  }

  function afterLogin(p) {
    headerButton();
    if (p && p.approved) { close(); location.reload(); return; }   // 승인된 계정: 내용 열쇠를 받아 다시 시작
    pending();
  }
  function pending() {
    const p = me();
    const box = show("<h2>승인 대기 중</h2><p class=\"sub\">" + esc(p ? p.name : "") + " 님, 가입되었습니다. 관리자가 승인하면 문항을 볼 수 있습니다.</p>" +
      '<div class="au-f"><div class="row"><button type="button" class="au-btn" data-a="check">승인 확인</button><button type="button" class="au-btn" data-a="acct">계정 관리</button></div><div class="au-msg"></div></div>');
    box.querySelector("[data-a=acct]").onclick = account;
    box.querySelector("[data-a=check]").onclick = async function () {
      const p2 = await get(cur).init();
      if (p2 && p2.approved) { close(); location.reload(); } else box.querySelector(".au-msg").textContent = "아직 승인되지 않았습니다.";
    };
  }

  function account() {
    const p = me();
    if (!p) return login();
    const box = show("<h2>계정 관리</h2>" +
      '<dl class="au-meta"><dt>ID</dt><dd>' + esc(p.loginId) + "</dd><dt>이름</dt><dd>" + esc(p.name) + "</dd><dt>로그인 방식</dt><dd>" + esc(NAMES[p.provider]) + "</dd>" +
      "<dt>상태</dt><dd>" + (p.approved ? '<span class="au-pill ok">승인됨</span>' : '<span class="au-pill wait">승인 대기</span>') + (p.isAdmin ? ' <span class="au-pill">관리자</span>' : "") + "</dd></dl>" +
      '<form class="au-f" data-f="name"><label>이름 바꾸기<input name="name" value="' + esc(p.name) + '" maxlength="30" required></label><div class="row"><button class="au-btn" type="submit">이름 저장</button></div><div class="au-msg"></div></form>' +
      '<form class="au-f au-sec" data-f="pw"><b>비밀번호 바꾸기</b>' +
      '<label>지금 비밀번호<input name="old" type="password" autocomplete="current-password" required></label>' +
      '<label>새 비밀번호 (8자 이상)<input name="pw" type="password" autocomplete="new-password" required></label>' +
      '<label>새 비밀번호 확인<input name="pw2" type="password" autocomplete="new-password" required></label>' +
      '<div class="au-msg"></div><div class="row"><button class="au-btn pri" type="submit">비밀번호 바꾸기</button></div></form>' +
      '<div class="au-sec au-f"><div class="row" style="justify-content:space-between"><button type="button" class="au-link" data-go="sec">비밀번호는 어떻게 보호되나요?</button><button type="button" class="au-btn" data-a="out">로그아웃</button></div></div>' +
      '<details class="au-sec au-wd"><summary>회원 탈퇴</summary>' +
      '<p class="sub" style="margin:8px 0">탈퇴하면 이 계정으로 다시 로그인할 수 없고, <b>같은 ID로 다시 가입할 수도 없습니다</b>. 응시 기록은 지워지지 않고 서버에 남습니다(관리자가 지울 수 있습니다).</p>' +
      '<form class="au-f" data-f="wd"><label>비밀번호 확인<input name="pw" type="password" autocomplete="current-password" required></label>' +
      '<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="ok" required style="width:auto"> 위 내용을 확인했습니다.</label>' +
      '<div class="au-msg"></div><div class="row"><button class="au-btn au-danger" type="submit">탈퇴하기</button></div></form></details>');
    box.querySelector("[data-f=name]").onsubmit = async function (e) {
      e.preventDefault(); const m = e.target.querySelector(".au-msg");
      try { await get(cur).setName(e.target.name.value.trim()); m.className = "au-msg ok"; m.textContent = "저장했습니다."; headerButton(); } catch (err) { m.className = "au-msg"; m.textContent = friendly(err); }
    };
    box.querySelector("[data-f=pw]").onsubmit = async function (e) {
      e.preventDefault(); const f = e.target, m = f.querySelector(".au-msg");
      m.className = "au-msg";
      if (f.pw.value.length < 8) { m.textContent = "새 비밀번호는 8자 이상이어야 합니다."; return; }
      if (f.pw.value !== f.pw2.value) { m.textContent = "새 비밀번호 확인이 다릅니다."; return; }
      m.textContent = "바꾸는 중…";
      try { await get(cur).changePassword(f.old.value, f.pw.value); f.old.value = f.pw.value = f.pw2.value = ""; m.className = "au-msg ok"; m.textContent = "비밀번호를 바꿨습니다."; }
      catch (err) { m.textContent = friendly(err); }
    };
    box.querySelector("[data-go=sec]").onclick = security;
    box.querySelector("[data-a=out]").onclick = signOut;
    box.querySelector("[data-f=wd]").onsubmit = async function (e) {
      e.preventDefault(); const f = e.target, m = f.querySelector(".au-msg");
      if (!confirm("정말 탈퇴할까요? 되돌릴 수 없습니다.")) return;
      m.className = "au-msg"; m.textContent = "탈퇴 처리 중…";
      try {
        await get(cur).withdraw(f.pw.value);
        try { localStorage.removeItem(LS_PROV); } catch (err) { /* ignore */ }
        alert("탈퇴했습니다. 그동안 이용해 주셔서 감사합니다.");
        close(); location.reload();
      } catch (err) { m.textContent = friendly(err); }
    };
  }

  async function signOut() {
    for (const k of Object.keys(inst)) { try { await inst[k].signOut(); } catch (e) { /* ignore */ } }
    cur = null;
    close(); location.reload();
  }

  // 비밀번호 보호 설명 + 일방향 해시 체험(이 브라우저 안에서만 계산, 아무 데도 보내지 않음)
  function security() {
    const box = show("<h2>비밀번호는 어떻게 보호되나요?</h2>" +
      '<ol class="au-steps">' +
      "<li>입력한 비밀번호는 HTTPS(TLS)로 암호화되어 <b>로그인 서버(Supabase 또는 Firebase)</b>로만 갑니다. 이 사이트와 관리자에게는 전달되지 않습니다.</li>" +
      "<li>로그인 서버는 비밀번호 원문을 저장하지 않습니다. 계정마다 다른 임의의 값(<b>salt</b>)을 붙여 <b>일방향 해시</b>(Supabase: bcrypt, Firebase: scrypt)로 바꾼 값만 저장합니다.</li>" +
      "<li>해시는 되돌릴 수 없어 <b>관리자를 포함해 누구도</b> 원래 비밀번호를 알 수 없습니다. 로그인할 때는 입력한 비밀번호를 같은 방법으로 해시해 저장된 값과 같은지만 비교합니다.</li>" +
      "<li>관리자 화면에는 비밀번호 항목이 없습니다. 관리자는 가입 승인만 할 수 있고, 응시 기록도 볼 수 없습니다(본인만 읽고 쓰도록 서버 규칙으로 막혀 있습니다).</li>" +
      "</ol>" +
      '<div class="au-sec"><b>직접 확인해 보기</b><p class="sub" style="margin:4px 0 8px">아무 글자나 넣어 보세요. 이 브라우저 안에서만 계산하며 어디에도 보내지 않습니다(설명용 예시로, 실제 서버의 계산 방식·값과는 다릅니다).</p>' +
      '<div class="au-f"><label>예시 비밀번호<input name="demo" type="text" autocomplete="off" placeholder="예: apple123"></label></div>' +
      '<div class="au-demo" style="margin-top:8px"></div></div>');
    const inp = box.querySelector("[name=demo]"), out = box.querySelector(".au-demo");
    const hex = (u) => Array.from(u).map((b) => b.toString(16).padStart(2, "0")).join("");
    async function run() {
      const pw = inp.value;
      if (!pw) { out.innerHTML = "입력하면 저장되는 형태가 여기에 나옵니다."; return; }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
      const t0 = performance.now();
      const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: 100000 }, base, 256));
      const ms = Math.round(performance.now() - t0);
      out.innerHTML = "① 비밀번호: <code>" + esc(pw.replace(/./g, "•")) + "</code> (원문은 저장하지 않음)<br>" +
        "② 이 계정만의 salt(임의 값): <code>" + hex(salt) + "</code><br>" +
        "③ 해시를 10만 번 반복(느리게 만들어 무작위 대입을 어렵게 함, " + ms + "ms): <code>" + hex(bits) + "</code><br>" +
        "④ 서버에는 ②와 ③만 저장됩니다. 같은 비밀번호라도 salt가 달라 결과가 매번 다릅니다 — 다시 입력해 보세요.";
    }
    inp.addEventListener("input", run); run();
  }

  // ======================================================================
  // 밖에서 쓰는 함수
  // ======================================================================
  window.QuizAuth = {
    enabled: function () { return !!CFG; },
    providers: providers,
    names: NAMES,
    init: async function () { const p = await init(); headerButton(); return p; },
    user: me,
    isAdmin: function () { const p = me(); return !!(p && p.isAdmin && p.approved); },
    contentKey: function () { return cur ? get(cur).contentKey() : Promise.resolve(null); },
    store: function () { return cur && me() ? get(cur).store : null; },
    login: login, signup: signup, account: account, pending: pending, security: security, signOut: signOut,
    headerButton: headerButton,
    logPrint: function (e) { if (!cur || !me()) return; get(cur).logPrint(e).catch(function () { /* 기록 실패는 인쇄를 막지 않는다 */ }); },
    // 관리자: 공급자마다 그 공급자의 관리자 세션이 있어야 한다
    admin: {
      session: async function (name) { const x = get(name); const p = x.profile() || await x.init(); return p && p.isAdmin && p.approved ? p : null; },
      signIn: async function (name, id, pw) { const p = await get(name).signIn(id, pw); if (!p || !p.isAdmin) throw new Error("이 방식의 관리자 계정이 아닙니다."); return p; },
      listUsers: (name) => get(name).admin.listUsers(),
      setApproved: (name, uid, v) => get(name).admin.setApproved(uid, v),
      purge: (name, uid) => get(name).admin.purge(uid),
      listPrintLogs: (name) => get(name).admin.listPrintLogs()
    }
  };
})();
