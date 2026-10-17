// 배포판 전용: 암호로 d.bin(문항·과목·동기화 설정)과 img/*.bin(강의노트·시험지 그림)을 푼다.
// 암호에서 PBKDF2-SHA256으로 AES-GCM 키를 만들고, 맞으면 그 키를 이 기기에 저장해 다음부터는 묻지 않는다.
(function () {
  "use strict";
  const LS = "mq_key_v1";
  const imgCache = {};
  let aesKey = null;

  function b64d(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64e(u) { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
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
  async function derive(pw, k) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64d(k.salt), iterations: k.iter }, base, 512);
    return new Uint8Array(bits).slice(0, 32);
  }
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

  window.QUIZ_LOCK = function () {
    try { localStorage.removeItem(LS); } catch (e) { /* ignore */ }
    location.reload();
  };

  window.QUIZ_BOOT = function (done) {
    const lock = document.getElementById("lock");
    const app = document.getElementById("app");
    const msg = document.getElementById("pwMsg");
    const pwEl = document.getElementById("pw");
    const btn = document.getElementById("pwGo");
    let k = null, blob = null;

    function start(r) {
      aesKey = r.key;
      const d = r.data;
      window.QUIZ_SUBJECTS = d.subjects;
      window.QUIZ_GRADES = d.grades;
      window.QUIZ_BANK = d.bank;
      window.QUIZ_SYNC = d.sync || null;
      lock.hidden = true;
      document.body.classList.remove("locked");
      done();
    }
    function showLock() {
      app.innerHTML = "";
      lock.hidden = false;
      document.body.classList.add("locked");
      pwEl.focus();
    }

    Promise.all([
      fetch("k.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
      fetchBuf("d.bin", true)
    ]).then(async function (res) {
      k = res[0]; blob = res[1];
      let saved = null;
      try { saved = localStorage.getItem(LS); } catch (e) { /* ignore */ }
      if (saved) {
        try { return start(await openBundle(b64d(saved), blob)); } catch (e) { /* 암호가 바뀌었으면 다시 묻는다 */ }
      }
      showLock();
    }, function (err) {
      app.innerHTML = '<p class="sub">데이터를 불러오지 못했다: ' + String(err.message || err) + "</p>";
    });

    document.getElementById("lockForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      const pw = pwEl.value;
      if (!pw || !k) return;
      btn.disabled = true;
      msg.textContent = "여는 중…";
      try {
        const raw = await derive(pw, k);
        const r = await openBundle(raw, blob);
        try { localStorage.setItem(LS, b64e(raw)); } catch (err) { /* 저장이 안 되면 매번 묻는다 */ }
        msg.textContent = "";
        pwEl.value = "";
        start(r);
      } catch (err) {
        msg.textContent = "암호가 맞지 않는다.";
        btn.disabled = false;
        pwEl.select();
      }
    });
  };
})();
