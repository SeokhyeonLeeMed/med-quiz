// 배포판 전용: d.bin(문항·과목)과 img/*.bin(강의노트·시험지 그림)은 AES-GCM으로 암호화되어 있다.
// 풀 열쇠(내용 열쇠)는 로그인해 관리자 승인을 받은 계정만 로그인 서버(Supabase/Firebase)에서 받는다(auth.js).
// 로그인하지 않았거나 승인 전이면 공개 목록(catalog.json: 과목·퀴즈 제목·문항 수)만 보여 준다.
(function () {
  "use strict";
  const imgCache = {};
  let aesKey = null;

  function b64d(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  async function fetchBuf(url, fresh) {
    const r = await fetch(url, { cache: fresh ? "no-cache" : "default" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }
  // 파일 형식: IV 12바이트 + 암호문(끝 16바이트가 인증 태그)
  async function decrypt(key, u) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12) }, key, u.subarray(12)));
  }
  async function gunzip(u) {
    const s = new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  function importKey(raw) { return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]); }
  async function openBundle(raw, blob) {
    const key = await importKey(raw);
    const data = JSON.parse(new TextDecoder().decode(await gunzip(await decrypt(key, blob))));
    return { key: key, data: data };
  }

  window.QUIZ_IMG = function (path) {
    const p = path.replace(/\.jpg$/, ".bin");
    if (!imgCache[p]) {
      imgCache[p] = fetchBuf(p).then(function (u) { return decrypt(aesKey, u); })
        .then(function (b) { return URL.createObjectURL(new Blob([b], { type: "image/jpeg" })); });
      imgCache[p].catch(function () { delete imgCache[p]; });
    }
    return imgCache[p];
  };
  // 새 배포가 있으면 다시 불러온다(브라우저가 예전 index.html을 최대 10분 캐시하므로)
  function myVersion() {
    const s = document.querySelector('script[src*="app.js?v="]');
    const m = s && s.getAttribute("src").match(/v=([0-9a-f]+)/);
    return m ? m[1] : "";
  }
  async function latestVersion() {
    const r = await fetch("index.html?t=" + Date.now(), { cache: "no-store" });
    const m = (await r.text()).match(/app\.js\?v=([0-9a-f]+)/);
    return m ? m[1] : "";
  }
  async function reloadFresh() {
    try { await fetch("index.html", { cache: "reload" }); } catch (e) { /* ignore */ }
    location.reload();
  }
  async function checkUpdate(onBoot) {
    let v;
    try { v = await latestVersion(); } catch (e) { return; }
    if (!v || v === myVersion()) return;
    let tried = null;
    try { tried = sessionStorage.getItem("mq_reload_for"); } catch (e) { /* ignore */ }
    if (tried === v) return;                       // 다시 불러와도 그대로면 반복하지 않는다
    try { sessionStorage.setItem("mq_reload_for", v); } catch (e) { /* ignore */ }
    if (onBoot || !document.querySelector(".qcard")) return reloadFresh();
    if (document.getElementById("updBtn")) return;
    const b = document.createElement("button");
    b.id = "updBtn"; b.type = "button"; b.className = "sync-chip upd";
    b.textContent = "새 버전 — 다시 불러오기";
    b.onclick = reloadFresh;
    const nav = document.querySelector(".topnav");
    if (nav) nav.insertBefore(b, nav.firstChild);
  }
  checkUpdate(true);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checkUpdate(false); });

  window.QUIZ_LOCK = function () { window.QuizAuth.signOut(); };

  // 공개 목록으로 화면을 채운다: 문항 내용 없이 퀴즈마다 문항 수만큼 빈 문항을 둔다(카드의 "N문항" 표시용)
  function catalogBank(cat) {
    return cat.quizzes.map(function (z) {
      const qs = [];
      for (let i = 0; i < z.n; i++) qs.push({ t: i < (z.nSelf || 0) ? "self" : "mc" });
      return Object.assign({}, z, { questions: qs, locked: true });
    });
  }

  window.QUIZ_BOOT = function (done) {
    const app = document.getElementById("app");
    function start(r, prof) {
      aesKey = r.key;
      const d = r.data;
      window.QUIZ_SUBJECTS = d.subjects;
      window.QUIZ_GRADES = d.grades;
      window.QUIZ_BANK = d.bank;
      window.QUIZ_CHANGES = d.changes || [];
      window.QUIZ_USER = prof;
      window.QUIZ_STORE = window.QuizAuth.store();
      done();
    }
    function startLocked(cat, prof) {
      window.QUIZ_LOCKED = true;
      window.QUIZ_SUBJECTS = cat.subjects;
      window.QUIZ_GRADES = cat.grades;
      window.QUIZ_BANK = catalogBank(cat);
      window.QUIZ_USER = prof || null;
      done();
      if (prof && !prof.approved) window.QuizAuth.pending();
    }
    Promise.all([
      fetch("catalog.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
      window.QuizAuth.init()
    ]).then(async function (res) {
      const cat = res[0], prof = res[1];
      if (prof && prof.approved) {
        try {
          const k = await window.QuizAuth.contentKey();
          if (k) return start(await openBundle(b64d(k), await fetchBuf("d.bin", true)), prof);
        } catch (e) { /* 열쇠가 바뀌었거나 네트워크 오류: 목록만 보여 준다 */ }
      }
      startLocked(cat, prof);
    }, function (err) {
      app.innerHTML = '<p class="sub">데이터를 불러오지 못했다: ' + String(err.message || err) + "</p>";
    });
  };
})();
