(function () {
  "use strict";

  const app = document.getElementById("app");
  let SUBJECTS = [], GRADES = [];
  const SUBJ = {};

  // ---------- data loading ----------
  // 로컬(file://): data/*.js를 script 태그로 읽는다.
  // 배포(GitHub Pages): boot.js가 암호를 풀어 window.QUIZ_*를 채운 뒤 콜백을 부른다.
  function loadData(files, done) {
    let i = 0;
    const failed = [];
    (function next() {
      if (i >= files.length) return done(failed);
      const f = files[i++];
      const s = document.createElement("script");
      s.src = "data/" + f;
      s.onload = next;
      s.onerror = function () { failed.push(f); next(); };
      document.body.appendChild(s);
    })();
  }
  // 이미지 주소 풀기: 배포판은 암호화된 파일을 풀어 blob 주소를 돌려준다
  function imgURL(path) { return window.QUIZ_IMG ? window.QUIZ_IMG(path) : Promise.resolve(path); }
  function hydrate(root) {
    (root || document).querySelectorAll("img[data-img]").forEach(function (im) {
      const p = im.getAttribute("data-img");
      im.removeAttribute("data-img");
      imgURL(p).then(function (u) { im.src = u; }, function () { im.alt = "이미지를 불러오지 못했다"; });
    });
  }
  function setHTML(html) { app.innerHTML = html; hydrate(app); }

  let BANK = [];
  const BY_ID = {};
  // 한 주차에 PDF가 여러 개면 quiz.docs에 적고, 이미지 폴더(lec)별 이름을 여기에 모은다
  const DOCS = {};

  const KEY = {
    hist: "mq_history_v1",
    meta: "mq_meta_v1",
    settings: "mq_settings_v1",
    current: "mq_current_v1",
    oldHist: "bcq_history_v1",
    oldCurrent: "bcq_current_v1"
  };
  const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

  // ---------- storage ----------
  function load(k, def) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
  }
  function remove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  let settings = Object.assign({ shuffleOpts: true, shuffleQs: false, grade: null, subject: null }, load(KEY.settings, {}));
  function saveSettings() { save(KEY.settings, settings); }
  function history() { return load(KEY.hist, []); }
  function localMeta() { return load(KEY.meta, { resetAt: 0 }); }

  // 이전 버전(생화학실습 단일 사이트) 기록 옮기기: 점수만 보존, 문항이 바뀌어 문항별 기록은 버림
  function migrate() {
    const old = load(KEY.oldHist, null);
    if (!old || !old.length) return;
    const h = history();
    const seen = {};
    h.forEach(function (a) { seen[a.id] = 1; });
    old.forEach(function (a) {
      if (!a || seen[a.id]) return;
      const qid = a.quizId === "MIX" ? "MIX:bcl" : "bcl-" + a.quizId;
      h.push({ id: a.id, quizId: qid, mode: a.mode, ts: a.ts, durSec: a.durSec, score: a.score, total: a.total, items: [], legacy: true });
    });
    h.sort(function (x, y) { return x.ts - y.ts; });
    save(KEY.hist, h);
    remove(KEY.oldHist);
    remove(KEY.oldCurrent);
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // 10^6, 2^−ΔCt 같은 지수 표기 → 위첨자, **굵게**, 줄바꿈 → <br>
  function fmt(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\^([−\-]?[0-9A-Za-zΔ]+)/g, "<sup>$1</sup>").replace(/\n/g, "<br>");
  }
  const NL = String.fromCharCode(10);
  // ㄱㄴㄷ 보기형 문항: 첫 줄은 발문, 나머지는 보기 상자로
  function stemOf(t) { const k = t.indexOf(NL); return k < 0 ? t : t.slice(0, k); }
  function bogiOf(t) { const k = t.indexOf(NL); return k < 0 ? "" : t.slice(k + 1); }
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function range(n) { return Array.from({ length: n }, function (_, i) { return i; }); }
  // 섞기를 끈 경우: 문항마다 늘 같은 순서(원본 순서는 정답 위치가 치우쳐 있어 그대로 쓰지 않음)
  function fixedOrder(key, n) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const a = range(n);
    for (let i = n - 1; i > 0; i--) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      const j = h % (i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function qByKey(key) {
    const k = key.lastIndexOf("#");
    const qz = BY_ID[key.slice(0, k)];
    const idx = +key.slice(k + 1);
    return qz && qz.questions[idx] ? { quiz: qz, q: qz.questions[idx], idx: idx } : null;
  }
  function isExam(qz) { return qz && qz.kind === "exam"; }
  function qType(q) { return q.t || "mc"; }
  function answerSet(q) { return Array.isArray(q.a) ? q.a : [q.a]; }
  // 답 판정: 숫자(단일), 배열(복수), "ok"/"bad"(스스로 채점)
  function isRight(q, ans) {
    if (ans === undefined || ans === null) return false;
    if (ans === "ok") return true;
    if (ans === "bad") return false;
    const set = answerSet(q);
    if (Array.isArray(ans)) return ans.length === set.length && ans.every(function (x) { return set.indexOf(x) >= 0; });
    return set.length === 1 && set[0] === ans;
  }
  function qNumLabel(r) { return isExam(r.quiz) ? (r.q.label || r.q.n) + "번" : (r.idx + 1) + "번"; }
  function isMix(id) { return id.indexOf("MIX:") === 0; }
  function quizMeta(id) {
    if (isMix(id)) {
      const s = SUBJ[id.slice(4)] || { name: id.slice(4) };
      return { id: id, subjectId: id.slice(4), week: s.name, title: "과목 전체 랜덤 20문제" };
    }
    return BY_ID[id] || { id: id, subjectId: id.split("-")[0], week: "", title: id + " (삭제된 퀴즈)" };
  }
  function subjectOf(id) { return isMix(id) ? id.slice(4) : id.split("-")[0]; }
  function pct(a) { return a.total ? Math.round(a.score / a.total * 100) : 0; }
  function fmtDate(ts) {
    const d = new Date(ts);
    const p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? m + "분 " + s + "초" : s + "초";
  }
  // 쪽 표기: 숫자 = 같은 강의, "W3:17" = 같은 과목 다른 강의, "mg-W3:17" = 다른 과목
  function refInfo(quiz, p) {
    let id = quiz.id, page = p;
    if (typeof p === "string" && p.indexOf(":") > 0) {
      const sp = p.split(":");
      id = sp[0].indexOf("-") > 0 ? sp[0] : quiz.subjectId + "-" + sp[0];
      page = +sp[1];
    }
    const qz = BY_ID[id] || DOCS[id];
    const sid = id.split("-")[0], lec = id.slice(sid.length + 1);
    const pp = String(page).padStart(2, "0");
    const subjName = SUBJ[sid] ? SUBJ[sid].name : sid;
    const exam = isExam(qz);
    return {
      src: "img/" + sid + "/" + lec + "/p" + pp + ".jpg",
      label: (qz ? (exam ? "시험지" : (qz.label || qz.week)) : lec) + " p." + page,
      long: (sid !== quiz.subjectId ? subjName + " " : "") + (qz ? (exam ? "기출 " : qz.week + " ") + qz.title : lec) + " · " + page + "쪽"
    };
  }
  function thumbHTML(ref, cap) {
    return '<button type="button" class="thumb" data-src="' + esc(ref.src) + '" data-cap="' + esc(cap || ref.long) + '" title="크게 보기">' +
      '<img loading="lazy" data-img="' + esc(ref.src) + '" alt="' + esc(ref.long) + '">' +
      '<span class="cap">' + esc(ref.label) + "</span></button>";
  }
  function setNav(which) {
    document.getElementById("navHome").classList.toggle("active", which === "home");
    document.getElementById("navHistory").classList.toggle("active", which === "history");
  }
  function modeLabel(m) { return m === "wrong" ? "오답 다시" : m === "mix" ? "랜덤" : "전체"; }

  function subjectsOfGrade(g) { return SUBJECTS.filter(function (s) { return s.grade === g; }); }
  function quizzesOfSubject(sid) { return BANK.filter(function (q) { return q.subjectId === sid; }); }
  function lectureQuizzes(sid) { return quizzesOfSubject(sid).filter(function (q) { return !isExam(q); }); }
  function examQuizzes(sid) { return quizzesOfSubject(sid).filter(isExam); }
  function hasData(sid) { return quizzesOfSubject(sid).length > 0; }
  function ensureSelection() {
    const gradesWithData = GRADES.filter(function (g) { return subjectsOfGrade(g).some(function (s) { return hasData(s.id); }); });
    if (!settings.grade || gradesWithData.indexOf(settings.grade) < 0) settings.grade = gradesWithData[0] || GRADES[0];
    const subs = subjectsOfGrade(settings.grade).filter(function (s) { return hasData(s.id); });
    if (!settings.subject || !subs.some(function (s) { return s.id === settings.subject; })) settings.subject = subs.length ? subs[0].id : null;
    saveSettings();
  }

  // ---------- attempts ----------
  function attemptsOf(quizId) { return history().filter(function (a) { return a.quizId === quizId; }); }
  function fullAttempts(quizId) { return attemptsOf(quizId).filter(function (a) { return a.mode !== "wrong"; }); }
  function lastAttempt(quizId) {
    const h = attemptsOf(quizId).filter(function (a) { return !a.legacy; });
    return h.length ? h[h.length - 1] : null;
  }

  // ---------- session ----------
  let session = load(KEY.current, null);

  function startQuiz(quizId, mode) {
    let keys;
    if (isMix(quizId)) {
      const all = [];
      lectureQuizzes(subjectOf(quizId)).forEach(function (qz) { qz.questions.forEach(function (_, i) { all.push(qz.id + "#" + i); }); });
      keys = shuffle(all).slice(0, 20);
      mode = "mix";
    } else if (mode === "wrong") {
      const last = lastAttempt(quizId);
      keys = last ? last.items.filter(function (it) { return !it.correct && qByKey(it.key); }).map(function (it) { return it.key; }) : [];
      if (!keys.length) return renderHome();
      if (settings.shuffleQs) keys = shuffle(keys);
    } else {
      keys = range(BY_ID[quizId].questions.length).map(function (i) { return quizId + "#" + i; });
      if (settings.shuffleQs) keys = shuffle(keys);
      mode = "full";
    }
    const orders = {};
    keys.forEach(function (k) {
      const r = qByKey(k);
      const n = r.q.o.length;
      // 기출은 해설이 ①②… 번호로 선지를 가리키므로 원래 순서를 지킨다
      orders[k] = isExam(r.quiz) ? range(n) : (settings.shuffleOpts ? shuffle(range(n)) : fixedOrder(k, n));
    });
    session = { quizId: quizId, mode: mode, keys: keys, orders: orders, answers: {}, sel: {}, reveal: {}, pos: 0, start: Date.now() };
    save(KEY.current, session);
    renderQuiz();
    window.scrollTo({ top: 0 });
  }

  function sessionValid() {
    return session && session.keys && session.keys.length && session.keys.every(function (k) { return qByKey(k); });
  }
  function persist() { save(KEY.current, session); }

  function choose(displayIdx) {
    const key = session.keys[session.pos];
    if (session.answers[key] !== undefined) return;
    const r = qByKey(key);
    const orig = session.orders[key][displayIdx];
    const t = qType(r.q);
    if (t === "multi") {
      session.sel = session.sel || {};
      const cur = session.sel[key] || [];
      const i = cur.indexOf(orig);
      if (i >= 0) cur.splice(i, 1); else cur.push(orig);
      session.sel[key] = cur;
      persist(); renderQuiz();
      return;
    }
    if (t === "self") return;
    session.answers[key] = orig;
    persist(); renderQuiz(true);
  }
  function submitMulti() {
    const key = session.keys[session.pos];
    const cur = (session.sel && session.sel[key]) || [];
    if (!cur.length || session.answers[key] !== undefined) return;
    session.answers[key] = cur.slice().sort(function (a, b) { return a - b; });
    persist(); renderQuiz(true);
  }
  function revealSelf() {
    const key = session.keys[session.pos];
    session.reveal = session.reveal || {};
    session.reveal[key] = true;
    persist(); renderQuiz(true);
  }
  function gradeSelf(ok) {
    const key = session.keys[session.pos];
    if (session.answers[key] !== undefined) return;
    session.answers[key] = ok ? "ok" : "bad";
    persist(); renderQuiz();
  }

  function go(delta) {
    const np = session.pos + delta;
    if (np < 0) return;
    if (np >= session.keys.length) return finish();
    session.pos = np;
    persist();
    renderQuiz();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function finish() {
    const items = session.keys.map(function (k) {
      const r = qByKey(k);
      const ch = session.answers[k];
      return { key: k, chosen: ch === undefined ? null : ch, order: session.orders[k], correct: isRight(r.q, ch) };
    });
    const attempt = {
      id: "a" + Date.now() + Math.random().toString(36).slice(2, 6),
      quizId: session.quizId,
      mode: session.mode,
      ts: Date.now(),
      durSec: (Date.now() - session.start) / 1000,
      score: items.filter(function (i) { return i.correct; }).length,
      total: items.length,
      items: items
    };
    const h = history(); h.push(attempt); save(KEY.hist, h);
    session = null;
    remove(KEY.current);
    Sync.request();
    renderResult(attempt.id);
    window.scrollTo({ top: 0 });
  }

  // ---------- rendering: explanations ----------
  function explanationHTML(key, order, chosenOrig) {
    const r = qByKey(key);
    if (isExam(r.quiz)) return examExplanationHTML(r, chosenOrig);
    const q = r.q;
    let html = "";
    if (q.c) html += '<div class="concept"><b>기본 개념</b>' + fmt(q.c) + "</div>";
    // 근거 슬라이드가 같은 선지는 한 칸으로 묶고 사진은 하나만 보여 준다
    const groups = [], bySrc = {};
    order.forEach(function (orig, di) {
      const ref = refInfo(r.quiz, q.e[orig][1]);
      if (!bySrc[ref.src]) { bySrc[ref.src] = { ref: ref, items: [] }; groups.push(bySrc[ref.src]); }
      bySrc[ref.src].items.push({ orig: orig, di: di });
    });
    html += '<div class="ex-list">';
    groups.forEach(function (g) {
      const hasCorrect = g.items.some(function (it) { return it.orig === q.a; });
      const hasChosenWrong = g.items.some(function (it) { return it.orig === chosenOrig && it.orig !== q.a; });
      let body = "";
      const quotes = [];
      g.items.forEach(function (it) {
        const ex = q.e[it.orig];
        const isCorrect = it.orig === q.a;
        const isChosen = it.orig === chosenOrig;
        let pills = isCorrect ? '<span class="pill ok">정답</span>' : '<span class="pill bad">오답</span>';
        if (isChosen) pills += '<span class="pill mine">내 선택</span>';
        body += '<div class="ex-item' + (isCorrect ? " is-correct" : (isChosen ? " is-chosen-wrong" : "")) + '">' +
          '<div class="ex-head">' + CIRCLED[it.di] + " " + pills + "</div>" +
          '<div class="ex-opt">' + fmt(q.o[it.orig]) + "</div>" +
          '<div class="ex-why">' + fmt(ex[0]) + "</div></div>";
        const same = quotes.filter(function (x) { return x.text === ex[2]; })[0];
        if (same) same.nums.push(CIRCLED[it.di]); else quotes.push({ text: ex[2], nums: [CIRCLED[it.di]] });
      });
      const many = g.items.length > 1;
      quotes.forEach(function (x) {
        body += '<blockquote class="ex-quote"><span class="src">강의노트 ' + esc(g.ref.long) +
          (many ? " · " + x.nums.join("") + " 근거" : "") + "</span>" + fmt(x.text) + "</blockquote>";
      });
      html += '<div class="ex' + (many ? " grouped" : "") + (hasCorrect ? " is-correct" : (hasChosenWrong ? " is-chosen-wrong" : "")) + '">' +
        "<div>" + body + "</div>" +
        thumbHTML(g.ref, g.ref.long + " — " + quotes.map(function (x) { return x.text; }).join(" / ")) +
        "</div>";
    });
    return html + "</div>";
  }

  // 기출 해설 원고(expl) 한 줄씩: # 소제목, - 글머리, ①… 선지, → 고친 문장, ! 주의, + 함께 알기
  function examExplanationHTML(r, chosen) {
    const q = r.q;
    const set = answerSet(q);
    const chosenArr = Array.isArray(chosen) ? chosen : (typeof chosen === "number" ? [chosen] : []);
    let html = '<div class="exam-ans"><b>정답</b> ' + fmt(q.h) + "</div>";
    let inList = false;
    function closeList() { if (inList) { html += "</ul>"; inList = false; } }
    (q.x || []).forEach(function (line) {
      const t = line.trim();
      let m;
      if ((m = t.match(/^#\s*(.*)$/))) { closeList(); html += '<h4 class="xh">' + fmt(m[1]) + "</h4>"; return; }
      if ((m = t.match(/^-\s+(.*)$/))) { if (!inList) { html += '<ul class="xl">'; inList = true; } html += "<li>" + fmt(m[1]) + "</li>"; return; }
      closeList();
      if ((m = t.match(/^→\s*(.*)$/))) { html += '<div class="xfix">→ ' + fmt(m[1]) + "</div>"; return; }
      if ((m = t.match(/^!\s*(.*)$/))) { html += '<div class="xwarn">' + fmt(m[1]) + "</div>"; return; }
      if ((m = t.match(/^\+\s*(.*)$/))) { html += '<div class="xplus">' + fmt(m[1]) + "</div>"; return; }
      const ci = CIRCLED.indexOf(t.charAt(0));
      if (ci >= 0) {
        const cls = set.indexOf(ci) >= 0 && qType(q) !== "self" ? " ok" : (chosenArr.indexOf(ci) >= 0 ? " bad" : "");
        html += '<div class="xopt' + cls + '">' + fmt(t) + "</div>";
        return;
      }
      html += '<p class="xp">' + fmt(t) + "</p>";
    });
    closeList();
    const ref = refInfo(r.quiz, q.p || 1);
    html += '<div class="xsrc">' + thumbHTML(ref, "원본 시험지 " + ref.long) +
      '<div class="hint">원본 시험지 ' + esc(ref.long) + (r.quiz.note ? "<br>" + esc(r.quiz.note) : "") + "</div></div>";
    return '<div class="exam-x">' + html + "</div>";
  }

  // 기출 발문: [공통 지문], | 표 |, [그림] 줄을 따로 그린다
  function examStemHTML(r, num) {
    const q = r.q;
    const lines = String(q.q).split(NL);
    let out = "", first = true, para = [];
    function flush() {
      if (!para.length) return;
      const txt = para.join(NL);
      out += first ? '<p class="qtext">' + num + ". " + fmt(txt) + "</p>" : '<p class="qmore">' + fmt(txt) + "</p>";
      first = false; para = [];
    }
    lines.forEach(function (ln) {
      const t = ln.trim();
      if (!t) { flush(); return; }
      if (t.indexOf("[공통 지문]") === 0) { flush(); out += '<div class="shared">' + fmt(t.replace("[공통 지문]", "").trim()) + "</div>"; return; }
      if (t.charAt(0) === "|") {
        flush();
        out += '<div class="bogi">' + fmt(t.replace(/^\|\s*|\s*\|$/g, "").split(" / ").join(NL)) + "</div>";
        return;
      }
      if (t === "[그림]" || t === "[표]") {
        flush();
        const ref = refInfo(r.quiz, q.p || 1);
        out += '<div class="figline">' + thumbHTML(ref, "원본 시험지 " + ref.long) + '<span class="hint">그림·표는 원본 시험지에서 확인 (눌러서 크게 보기)</span></div>';
        return;
      }
      para.push(t);
    });
    flush();
    return out;
  }

  // ---------- views ----------
  function sparkSVG(vals, w, h) {
    if (!vals.length) return "";
    w = w || 120; h = h || 30;
    const n = vals.length;
    const pts = vals.map(function (v, i) {
      return [n === 1 ? w / 2 : 4 + i * (w - 8) / (n - 1), h - 3 - v / 100 * (h - 6)];
    });
    const d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    const last = pts[pts.length - 1];
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
      '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="var(--accent)"/></svg>';
  }

  function quizCard(meta, n) {
    const fa = fullAttempts(meta.id);
    const last = lastAttempt(meta.id);
    const best = fa.reduce(function (m, a) { return Math.max(m, pct(a)); }, 0);
    const wrongN = last ? last.items.filter(function (i) { return !i.correct; }).length : 0;
    const mix = isMix(meta.id);
    const exam = isExam(meta);
    let extra = "";
    if (exam) {
      const nSelf = meta.questions.filter(function (q) { return qType(q) === "self"; }).length;
      if (nSelf) extra = "<span>스스로 채점 " + nSelf + "</span>";
    }
    return '<div class="card quiz-card' + (mix ? " special" : "") + (exam ? " exam" : "") + '">' +
      '<div class="wk">' + esc(mix ? "전체 범위" : meta.week + (meta.prof ? " · " + meta.prof : "")) + "</div>" +
      '<div class="ttl">' + esc(meta.title) + "</div>" +
      '<div class="meta"><span>' + n + "문항</span>" + extra +
        (fa.length
          ? "<span>응시 <b>" + fa.length + "</b>회</span><span>최근 <b>" + pct(fa[fa.length - 1]) + "%</b></span><span>최고 <b>" + best + "%</b></span>"
          : "<span>아직 응시 기록 없음</span>") +
      "</div>" +
      '<div class="row">' +
        "<div>" + sparkSVG(fa.map(pct)) + "</div>" +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
          (!mix && wrongN ? '<button class="btn small" data-act="wrong" data-id="' + meta.id + '">틀린 ' + wrongN + "문제</button>" : "") +
          '<button class="btn small primary" data-act="start" data-id="' + meta.id + '">' + (fa.length ? "다시 풀기" : "시작") + "</button>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function pickerHTML() {
    const gradeBtns = GRADES.map(function (g) {
      const ok = subjectsOfGrade(g).some(function (s) { return hasData(s.id); });
      return '<button type="button" data-grade="' + esc(g) + '" class="' + (g === settings.grade ? "on" : "") + '"' + (ok ? "" : " disabled title=\"아직 문항 없음\"") + ">" + esc(g) + "</button>";
    }).join("");
    const subjBtns = subjectsOfGrade(settings.grade).map(function (s) {
      const nl = lectureQuizzes(s.id).length, ne = examQuizzes(s.id).length;
      const parts = [];
      if (nl) parts.push(nl + "개 주차");
      if (ne) parts.push("기출 " + ne);
      return '<button type="button" data-subject="' + s.id + '" class="' + (s.id === settings.subject ? "on" : "") + '"' + (nl + ne ? "" : " disabled") + ">" +
        esc(s.name) + "<small>" + (parts.length ? parts.join(" · ") : "준비 중") + "</small></button>";
    }).join("");
    return '<div class="picker">' +
      '<div class="picker-row"><span class="picker-label">학년</span><div class="seg">' + gradeBtns + "</div></div>" +
      '<div class="picker-row"><span class="picker-label">과목</span><div class="seg">' + (subjBtns || '<span class="hint">이 학년은 아직 과목이 없다.</span>') + "</div></div>" +
      "</div>";
  }

  function renderHome() {
    setNav("home");
    ensureSelection();
    const subj = SUBJ[settings.subject];
    let html = "<h1>퀴즈 선택</h1>" +
      '<p class="sub">강의는 주차마다 20문항, 기출은 시험 단위. 답을 고르면 바로 정답과 모든 선지의 해설이 나온다.</p>' +
      pickerHTML();

    if (sessionValid()) {
      const m = quizMeta(session.quizId);
      const answered = Object.keys(session.answers).length;
      const sname = SUBJ[subjectOf(session.quizId)] ? SUBJ[subjectOf(session.quizId)].name + " · " : "";
      html += '<div class="card resume"><div><b>풀던 퀴즈가 있다</b> — ' + esc(sname + (isMix(session.quizId) ? m.title : m.week + " " + m.title)) +
        " (" + modeLabel(session.mode) + ", " + answered + "/" + session.keys.length + " 답함)</div>" +
        '<div style="display:flex;gap:6px"><button class="btn small" data-act="discard">버리기</button>' +
        '<button class="btn small primary" data-act="resume">이어 풀기</button></div></div>';
    }

    html += '<div class="card settings">' +
      '<label><input type="checkbox" id="setOpts"' + (settings.shuffleOpts ? " checked" : "") + "> 선지 순서 섞기</label>" +
      '<label><input type="checkbox" id="setQs"' + (settings.shuffleQs ? " checked" : "") + "> 문제 순서 섞기</label>" +
      '<span class="hint">새로 시작하는 퀴즈부터 적용 · 기출은 해설이 선지 번호를 가리켜 선지를 섞지 않는다</span></div>';

    if (subj) {
      const lq = lectureQuizzes(subj.id), eq = examQuizzes(subj.id);
      html += "<h2>" + esc(subj.name) + ' <span class="badge">' + esc(subj.grade + " " + subj.term) + "</span></h2>";
      if (lq.length) {
        html += '<div class="quiz-grid">' + lq.map(function (qz) { return quizCard(qz, qz.questions.length); }).join("") +
          quizCard(quizMeta("MIX:" + subj.id), 20) + "</div>";
      }
      if (eq.length) {
        html += '<h3 class="sec">기출 문제 <span class="hint">해설지 원고 기반 · 서술형·복기 실패 문항은 해설을 보고 스스로 채점</span></h3>' +
          '<div class="quiz-grid">' + eq.map(function (qz) { return quizCard(qz, qz.questions.length); }).join("") + "</div>";
      }
    }

    html += '<div class="footer-tools">' +
      '<button class="btn small" data-act="export">기록 내보내기 (JSON)</button>' +
      '<label class="btn small" style="cursor:pointer">기록 가져오기<input type="file" id="importFile" accept="application/json,.json" hidden></label>' +
      '<button class="btn small" data-act="reset">기록 초기화</button>' +
      '<span class="hint">' + (Sync.enabled() ? "기록은 GitHub(비공개 저장소)에 자동 저장되어 다른 기기에서도 이어진다." : "기록은 이 브라우저에 저장된다. 브라우저를 바꾸거나 데이터를 지우기 전에 내보내 두면 된다.") + "</span>" +
      (window.QUIZ_LOCK ? '<button class="btn small" data-act="lock">이 기기에서 잠그기</button>' : "") +
      "</div>";

    setHTML(html);
    document.getElementById("setOpts").onchange = function (e) { settings.shuffleOpts = e.target.checked; saveSettings(); };
    document.getElementById("setQs").onchange = function (e) { settings.shuffleQs = e.target.checked; saveSettings(); };
    document.getElementById("importFile").onchange = importHistory;
  }

  function renderQuiz(justAnswered) {
    if (!sessionValid()) { session = null; remove(KEY.current); return renderHome(); }
    setNav("");
    const key = session.keys[session.pos];
    const r = qByKey(key);
    const q = r.q;
    const exam = isExam(r.quiz);
    const t = qType(q);
    const order = session.orders[key];
    const chosen = session.answers[key];
    const answered = chosen !== undefined;
    const revealed = t === "self" && session.reveal && session.reveal[key];
    const sel = (session.sel && session.sel[key]) || [];
    const meta = quizMeta(session.quizId);
    const subjName = SUBJ[subjectOf(session.quizId)] ? SUBJ[subjectOf(session.quizId)].name : "";
    const total = session.keys.length;
    const doneN = Object.keys(session.answers).length;
    const correctN = session.keys.filter(function (k) { return session.answers[k] !== undefined && isRight(qByKey(k).q, session.answers[k]); }).length;

    const dots = '<div class="dots">' + session.keys.map(function (k, i) {
      const a = session.answers[k];
      let c = a === undefined ? "" : (isRight(qByKey(k).q, a) ? "ok" : "bad");
      if (i === session.pos) c += " cur";
      return '<span class="' + c + '" title="' + (i + 1) + '번"></span>';
    }).join("") + "</div>";

    const showSrc = exam || isMix(session.quizId) || session.mode === "wrong";
    const num = session.pos + 1;
    let html =
      '<div class="qhead"><div><b>' + esc(subjName + " · " + (isMix(session.quizId) ? meta.title : (exam ? "기출 " : meta.week + " ") + meta.title)) + '</b> <span class="badge">' + modeLabel(session.mode) + "</span></div>" +
      "<div>" + num + " / " + total + " · 맞힘 " + correctN + "/" + doneN + "</div></div>" +
      '<div class="progress"><i style="width:' + (doneN / total * 100) + '%"></i></div>' + dots +
      '<div class="card qcard">' +
        (showSrc ? '<div class="qsrc">' + esc((exam ? "기출 " : r.quiz.week + " · ") + r.quiz.title) + " · " + esc(qNumLabel(r)) +
          (t === "multi" ? ' <span class="badge">' + answerSet(q).length + "개 고르기</span>" : "") +
          (t === "self" ? ' <span class="badge">스스로 채점</span>' : "") + "</div>" : "");

    if (exam) html += examStemHTML(r, num);
    else html += '<p class="qtext">' + num + ". " + fmt(stemOf(q.q)) + "</p>" + (bogiOf(q.q) ? '<div class="bogi">' + fmt(bogiOf(q.q)) + "</div>" : "");

    // 선지
    if (q.o.length) {
      const set = answerSet(q);
      const chosenArr = Array.isArray(chosen) ? chosen : (typeof chosen === "number" ? [chosen] : []);
      html += '<div class="opts">' + order.map(function (orig, di) {
        let cls = "opt", tag = "";
        const shown = answered || revealed;
        if (t === "self") {
          cls += " static";
        } else if (shown) {
          if (set.indexOf(orig) >= 0) { cls += " correct"; tag = "정답"; }
          else if (chosenArr.indexOf(orig) >= 0) { cls += " wrong"; tag = "내 선택"; }
          else cls += " dim";
        } else if (t === "multi" && sel.indexOf(orig) >= 0) {
          cls += " sel"; tag = "선택";
        }
        const disabled = answered || t === "self";
        return '<button type="button" class="' + cls + '" data-opt="' + di + '"' + (disabled ? " disabled" : "") + ">" +
          '<span class="num">' + (di + 1) + '</span><span class="otext">' + fmt(q.o[orig]) + "</span>" +
          (tag ? '<span class="tag">' + tag + "</span>" : "") + "</button>";
      }).join("") + "</div>";
    }

    if (t === "multi" && !answered) {
      html += '<div class="actions"><button class="btn primary" data-act="submit"' + (sel.length ? "" : " disabled") + ">" +
        "제출 (" + sel.length + "/" + answerSet(q).length + "개 선택)</button></div>";
    }
    if (t === "self" && !revealed) {
      html += '<div class="actions"><button class="btn primary" data-act="reveal">답을 생각한 뒤 해설 보기</button></div>';
    }

    if (answered && t !== "self") {
      const ok = isRight(q, chosen);
      const right = answerSet(q).map(function (o) { return CIRCLED[order.indexOf(o)]; }).join(", ");
      html += '<div class="verdict ' + (ok ? "ok" : "bad") + '" id="verdict">' +
        (ok ? "정답이다." : "틀렸다. 정답은 " + right + "번.") + "</div>" +
        '<div class="explain">' + explanationHTML(key, order, chosen) + "</div>";
    }
    if (revealed) {
      html += '<div class="explain" id="verdict">' + explanationHTML(key, order, null) + "</div>";
      html += answered
        ? '<div class="verdict ' + (chosen === "ok" ? "ok" : "bad") + '">스스로 채점: ' + (chosen === "ok" ? "맞혔다" : "틀렸다") + "</div>"
        : '<div class="selfgrade"><span>내 답은?</span><button class="btn" data-act="selfok">맞혔다</button><button class="btn" data-act="selfbad">틀렸다·모르겠다</button></div>';
    }

    const isLast = session.pos === total - 1;
    html += '<div class="qnav">' +
      '<button class="btn" data-act="prev"' + (session.pos === 0 ? " disabled" : "") + ">← 이전</button>" +
      '<span class="hint">숫자키 1–9로 선택 · Enter/→ 다음</span>' +
      '<button class="btn primary" data-act="next"' + (answered ? "" : " disabled") + ">" +
        (isLast ? (doneN === total ? "결과 보기" : "끝내기") : "다음 →") + "</button>" +
      "</div></div>";

    setHTML(html);
    if (justAnswered) {
      const v = document.getElementById("verdict");
      if (v) v.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function ringSVG(p) {
    const r = 48, c = 2 * Math.PI * r;
    return '<svg class="ring" viewBox="0 0 112 112"><circle cx="56" cy="56" r="' + r + '" fill="none" stroke="var(--surface-2)" stroke-width="10"/>' +
      '<circle cx="56" cy="56" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round" ' +
      'stroke-dasharray="' + (c * p / 100).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 56 56)"/>' +
      '<text x="56" y="62" text-anchor="middle" font-size="22" font-weight="800" fill="var(--ink)">' + p + "%</text></svg>";
  }

  function answerText(r, order, ch) {
    if (ch === null || ch === undefined) return "없음";
    if (ch === "ok") return "스스로 채점: 맞힘";
    if (ch === "bad") return "스스로 채점: 틀림";
    const arr = Array.isArray(ch) ? ch : [ch];
    return arr.map(function (o) { return CIRCLED[order.indexOf(o)] + " " + fmt(r.q.o[o] || ""); }).join(", ");
  }

  function reviewList(att) {
    if (att.legacy) return '<p class="empty">이전 버전 문항으로 푼 기록이라 점수만 남아 있다.</p>';
    return '<div class="stack">' + att.items.map(function (it, i) {
      const r = qByKey(it.key);
      if (!r) return "";
      const order = it.order || range(r.q.o.length);
      const exam = isExam(r.quiz);
      const rightTxt = exam ? fmt(r.q.h) : answerText(r, order, r.q.a);
      return '<details class="card review-item"' + (it.correct ? "" : " open") + ">" +
        '<summary><span class="mark ' + (it.correct ? "ok" : "bad") + '">' + (it.correct ? "○" : "✕") + "</span>" +
          '<div><div class="rq">' + (i + 1) + ". " + fmt(stemOf(String(r.q.q).replace("[공통 지문] ", ""))) + "</div>" +
          '<div class="ra">' + (exam || isMix(att.quizId) || att.mode === "wrong" ? esc(qNumLabel(r)) + " · " : "") +
            "내 답 " + answerText(r, order, it.chosen) +
            (it.correct ? "" : " · 정답 " + rightTxt) + "</div></div></summary>" +
        '<div class="explain">' + explanationHTML(it.key, order, it.chosen) + "</div>" +
      "</details>";
    }).join("") + "</div>";
  }

  function renderResult(attemptId) {
    setNav("");
    const h = history();
    const att = h.filter(function (a) { return a.id === attemptId; })[0];
    if (!att) return renderHome();
    const meta = quizMeta(att.quizId);
    const subjName = SUBJ[subjectOf(att.quizId)] ? SUBJ[subjectOf(att.quizId)].name : "";
    const p = pct(att);
    let deltaHTML = "";
    if (att.mode !== "wrong") {
      const prev = h.filter(function (a) { return a.quizId === att.quizId && a.mode !== "wrong" && a.ts < att.ts; });
      if (prev.length) {
        const d = p - pct(prev[prev.length - 1]);
        deltaHTML = '<div class="delta ' + (d > 0 ? "up" : d < 0 ? "down" : "same") + '">지난번 ' + pct(prev[prev.length - 1]) + "% 대비 " + (d > 0 ? "+" + d : d) + "%p</div>";
      } else deltaHTML = '<div class="delta same">첫 응시 기록</div>';
    }
    const wrongN = att.items.filter(function (i) { return !i.correct; }).length;
    const canRetry = !!BY_ID[att.quizId] || isMix(att.quizId);
    setHTML(
      "<h1>결과</h1>" +
      '<p class="sub">' + esc(subjName + " · " + (isMix(att.quizId) ? meta.title : meta.week + " " + meta.title)) + " · " + modeLabel(att.mode) + " · " + fmtDate(att.ts) +
        (att.legacy ? ' <span class="legacy">(이전 버전 문항)</span>' : "") + "</p>" +
      '<div class="card score-hero">' + ringSVG(p) +
        '<div><div class="big">' + att.score + " / " + att.total + "</div>" + deltaHTML +
        '<div class="hint">소요 시간 ' + fmtDur(att.durSec) + "</div>" +
        '<div class="actions">' +
          (!isMix(att.quizId) && wrongN && !att.legacy ? '<button class="btn" data-act="wrong" data-id="' + att.quizId + '">틀린 ' + wrongN + "문제 다시</button>" : "") +
          (canRetry ? '<button class="btn primary" data-act="start" data-id="' + att.quizId + '">' + (isMix(att.quizId) ? "새 랜덤 20문제" : "전체 다시 풀기") + "</button>" : "") +
          '<button class="btn" data-act="history">기록·진도</button>' +
          '<button class="btn" data-act="home">퀴즈 선택</button>' +
        "</div></div></div>" +
      "<h2>문항별 확인</h2>" +
      (att.legacy ? "" : '<p class="sub">틀린 문항은 펼쳐져 있다. 맞힌 문항도 눌러서 해설을 볼 수 있다.</p>') +
      reviewList(att));
  }

  function chartSVG(atts) {
    const W = 640, H = 170, L = 34, R = 12, T = 12, B = 26;
    const n = atts.length;
    const xs = function (i) { return n === 1 ? (L + (W - R)) / 2 : L + i * (W - L - R) / (n - 1); };
    const ys = function (v) { return T + (100 - v) / 100 * (H - T - B); };
    let s = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="점수 추이">';
    [0, 50, 100].forEach(function (v) {
      s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + ys(v) + '" y2="' + ys(v) + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (ys(v) + 4) + '" text-anchor="end">' + v + "</text>";
    });
    s += '<path class="ln" d="' + atts.map(function (a, i) { return (i ? "L" : "M") + xs(i).toFixed(1) + " " + ys(pct(a)).toFixed(1); }).join(" ") + '"/>';
    atts.forEach(function (a, i) {
      s += '<circle class="pt' + (a.legacy ? " legacy" : "") + '" cx="' + xs(i).toFixed(1) + '" cy="' + ys(pct(a)).toFixed(1) + '" r="4.5"><title>' +
        fmtDate(a.ts) + " · " + a.score + "/" + a.total + " (" + pct(a) + "%)" + (a.legacy ? " · 이전 버전 문항" : "") + "</title></circle>";
      if (n <= 12 || i === n - 1 || i === 0) s += '<text x="' + xs(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + (i + 1) + "회</text>";
    });
    return s + "</svg>";
  }

  function weakQuestions(quizId) {
    const stat = {};
    history().forEach(function (a) {
      (a.items || []).forEach(function (it) {
        if (it.key.slice(0, it.key.lastIndexOf("#")) !== quizId || !qByKey(it.key)) return;
        stat[it.key] = stat[it.key] || { seen: 0, wrong: 0 };
        stat[it.key].seen++;
        if (!it.correct) stat[it.key].wrong++;
      });
    });
    return Object.keys(stat).filter(function (k) { return stat[k].wrong > 0; })
      .sort(function (a, b) { return stat[b].wrong / stat[b].seen - stat[a].wrong / stat[a].seen || stat[b].wrong - stat[a].wrong; })
      .slice(0, 3).map(function (k) { return { key: k, s: stat[k] }; });
  }

  function renderHistory() {
    setNav("history");
    ensureSelection();
    const h = history();
    const subj = SUBJ[settings.subject];
    let html = "<h1>기록·진도</h1>" +
      '<p class="sub">퀴즈를 끝낼 때마다 점수가 저장된다' + (Sync.enabled() ? "(GitHub에 자동 저장)" : "") + ". 그래프는 전체 응시(오답 다시 풀기 제외)의 점수 변화다. 회색 점은 이전 버전 문항으로 푼 기록이다.</p>" +
      pickerHTML();
    if (!subj) { setHTML(html); return; }
    const ids = quizzesOfSubject(subj.id).map(function (q) { return q.id; }).concat(["MIX:" + subj.id]);
    h.forEach(function (a) { if (subjectOf(a.quizId) === subj.id && ids.indexOf(a.quizId) < 0) ids.push(a.quizId); });
    let any = false;
    ids.forEach(function (id) {
      const all = h.filter(function (a) { return a.quizId === id; });
      if (!all.length) return;
      any = true;
      const meta = quizMeta(id);
      const fa = all.filter(function (a) { return a.mode !== "wrong"; });
      const best = fa.reduce(function (m, a) { return Math.max(m, pct(a)); }, 0);
      html += '<div class="card hist-card" style="margin-bottom:14px">' +
        '<div class="hist-top"><div><b>' + esc(isMix(id) ? meta.title : (isExam(meta) ? "기출 · " : meta.week + " · ") + meta.title) + "</b></div>" +
        '<div class="hint">전체 응시 ' + fa.length + "회" + (fa.length ? " · 최고 " + best + "% · 최근 " + pct(fa[fa.length - 1]) + "%" : "") + "</div></div>" +
        (fa.length ? chartSVG(fa) : "");
      if (!isMix(id)) {
        const weak = weakQuestions(id);
        if (weak.length) {
          html += '<div class="weak"><div class="hint">자주 틀린 문항</div>' + weak.map(function (w) {
            const r = qByKey(w.key);
            return "<div><b>" + w.s.wrong + "/" + w.s.seen + "</b> · " + esc(qNumLabel(r)) + " " + fmt(stemOf(String(r.q.q).replace("[공통 지문] ", ""))) + "</div>";
          }).join("") + "</div>";
        }
      }
      html += '<table class="hist" style="margin-top:10px"><thead><tr><th>#</th><th>날짜</th><th>방식</th><th>점수</th><th>시간</th><th></th></tr></thead><tbody>' +
        all.slice().reverse().map(function (a, i) {
          return "<tr><td>" + (all.length - i) + "</td><td>" + fmtDate(a.ts) + (a.legacy ? ' <span class="legacy">이전 문항</span>' : "") + "</td><td>" + modeLabel(a.mode) +
            "</td><td><b>" + a.score + "/" + a.total + "</b> (" + pct(a) + "%)</td><td>" + fmtDur(a.durSec) +
            '</td><td><button class="btn small" data-act="view" data-id="' + a.id + '">보기</button></td></tr>';
        }).join("") + "</tbody></table></div>";
    });
    if (!any) html += '<div class="card hist-card"><div class="empty">' + esc(subj.name) + " 기록이 아직 없다. 퀴즈를 하나 끝내면 여기에 쌓인다.</div></div>";
    setHTML(html);
  }

  // ---------- 기록 합치기 ----------
  function mergeAttempts(a, b, resetAt) {
    const map = {};
    a.concat(b).forEach(function (x) { if (x && x.id && x.ts > (resetAt || 0)) map[x.id] = map[x.id] || x; });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) { return x.ts - y.ts; });
  }

  // ---------- GitHub 동기화 ----------
  // 비공개 저장소의 history/YYYY-MM.json(월별 응시 기록 배열)과 meta.json({resetAt})을 쓴다.
  const Sync = (function () {
    let busy = false, again = false, lastOk = 0, state = "off", msg = "";
    function cfg() { return window.QUIZ_SYNC || null; }
    function enabled() { return !!cfg(); }
    function chip() {
      const el = document.getElementById("syncChip");
      if (!el) return;
      el.hidden = !enabled();
      el.className = "sync-chip " + state;
      const t = lastOk ? new Date(lastOk) : null;
      el.textContent = state === "ok" ? "☁ 저장됨" + (t ? " " + String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0") : "")
        : state === "busy" ? "☁ 저장 중…" : state === "err" ? "☁ 저장 실패 — 다시 시도" : "☁";
      el.title = msg || "GitHub 기록 동기화";
    }
    function set(s, m) { state = s; msg = m || ""; chip(); }
    function b64enc(str) {
      const bytes = new TextEncoder().encode(str);
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }
    function b64dec(b64) {
      const bin = atob(b64.replace(/\s/g, ""));
      const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    function api(path, opt) {
      const c = cfg();
      opt = opt || {};
      const headers = { Authorization: "Bearer " + c.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
      if (opt.body) headers["Content-Type"] = "application/json";
      return fetch("https://api.github.com/repos/" + c.owner + "/" + c.repo + "/contents/" + path + (opt.method ? "" : "?ref=" + (c.branch || "main") + "&t=" + Date.now()),
        { method: opt.method || "GET", headers: headers, body: opt.body, cache: "no-store" });
    }
    async function readJSON(path) {
      const res = await api(path);
      if (res.status === 404) return { data: null, sha: null };
      if (!res.ok) throw new Error("읽기 실패 " + res.status);
      const j = await res.json();
      return { data: JSON.parse(b64dec(j.content || "") || "null"), sha: j.sha };
    }
    async function writeJSON(path, data, sha, message) {
      const body = { message: message, content: b64enc(JSON.stringify(data)), branch: cfg().branch || "main" };
      if (sha) body.sha = sha;
      const res = await api(path, { method: "PUT", body: JSON.stringify(body) });
      if (res.status === 409 || res.status === 422) return false; // 다른 기기가 먼저 썼다 → 다시 읽고 합친다
      if (!res.ok) throw new Error("쓰기 실패 " + res.status);
      return true;
    }
    async function listMonths() {
      const res = await api("history");
      if (res.status === 404) return [];
      if (!res.ok) throw new Error("목록 실패 " + res.status);
      const j = await res.json();
      return (Array.isArray(j) ? j : []).filter(function (f) { return /\.json$/.test(f.name); }).map(function (f) { return f.name.replace(/\.json$/, ""); });
    }
    function monthOf(ts) { const d = new Date(ts); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

    async function run() {
      // 1) 원격 meta와 월별 기록을 모두 읽는다
      const meta = await readJSON("meta.json");
      const remoteReset = (meta.data && meta.data.resetAt) || 0;
      const lm = localMeta();
      const resetAt = Math.max(remoteReset, lm.resetAt || 0);
      const months = await listMonths();
      const remote = {};
      let remoteAll = [];
      for (const m of months) {
        const r = await readJSON("history/" + m + ".json");
        remote[m] = r;
        remoteAll = remoteAll.concat(r.data || []);
      }
      // 2) 로컬과 합쳐 로컬에 저장
      const local = history();
      const merged = mergeAttempts(local, remoteAll, resetAt);
      save(KEY.hist, merged);
      save(KEY.meta, { resetAt: resetAt });
      // 3) 원격에 없는 기록이 있는 달만 다시 쓴다
      const remoteIds = {};
      remoteAll.forEach(function (a) { remoteIds[a.id] = 1; });
      const need = {};
      merged.forEach(function (a) { if (!remoteIds[a.id]) need[monthOf(a.ts)] = 1; });
      for (const m of Object.keys(need)) {
        for (let tries = 0; tries < 4; tries++) {
          const cur = tries === 0 && remote[m] ? remote[m] : await readJSON("history/" + m + ".json");
          const mine = merged.filter(function (a) { return monthOf(a.ts) === m; });
          const data = mergeAttempts(cur.data || [], mine, resetAt);
          if (await writeJSON("history/" + m + ".json", data, cur.sha, "기록 " + m + " (" + data.length + "건)")) break;
        }
      }
      if (resetAt > remoteReset) {
        for (let tries = 0; tries < 4; tries++) {
          const cur = tries === 0 ? meta : await readJSON("meta.json");
          if (await writeJSON("meta.json", { resetAt: resetAt }, cur.sha, "기록 초기화")) break;
        }
      }
      return merged.length !== local.length;
    }

    function request(onChange) {
      if (!enabled()) return;
      if (busy) { again = true; return; }
      busy = true; set("busy");
      run().then(function (changed) {
        lastOk = Date.now(); set("ok");
        if (changed && onChange) onChange();
      }, function (err) {
        set("err", String(err && err.message || err));
      }).then(function () {
        busy = false;
        if (again) { again = false; request(onChange); }
      });
    }
    return { enabled: enabled, request: request, chip: chip };
  })();

  // ---------- export / import ----------
  function exportHistory() {
    const blob = new Blob([JSON.stringify({ version: 2, exported: new Date().toISOString(), history: history() }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "강의퀴즈_기록_" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importHistory(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = function () {
      try {
        const data = JSON.parse(rd.result);
        let incoming = Array.isArray(data) ? data : data.history;
        if (!Array.isArray(incoming)) throw new Error("형식 오류");
        // 이전 버전(생화학실습 단일 사이트) 내보내기 파일도 받는다
        if (!data.version || data.version < 2) {
          incoming = incoming.map(function (a) {
            if (!a || /-|:/.test(a.quizId)) return a;
            return { id: a.id, quizId: a.quizId === "MIX" ? "MIX:bcl" : "bcl-" + a.quizId, mode: a.mode, ts: a.ts, durSec: a.durSec, score: a.score, total: a.total, items: [], legacy: true };
          });
        }
        const cur = history();
        const before = cur.length;
        const merged = mergeAttempts(cur, incoming.filter(function (a) { return a && Array.isArray(a.items); }), localMeta().resetAt);
        save(KEY.hist, merged);
        alert("기록 " + (merged.length - before) + "건을 가져왔다.");
        Sync.request();
        renderHome();
      } catch (err) {
        alert("가져오기에 실패했다: " + err.message);
      }
    };
    rd.readAsText(f);
  }

  // ---------- events ----------
  app.addEventListener("click", function (e) {
    const thumb = e.target.closest(".thumb");
    if (thumb) { openLightbox(thumb.dataset.src, thumb.dataset.cap); return; }
    const opt = e.target.closest("[data-opt]");
    if (opt && !opt.disabled) { choose(+opt.dataset.opt); return; }
    const g = e.target.closest("[data-grade]");
    if (g && !g.disabled) {
      settings.grade = g.dataset.grade; settings.subject = null; ensureSelection();
      return document.getElementById("navHistory").classList.contains("active") ? renderHistory() : renderHome();
    }
    const sb = e.target.closest("[data-subject]");
    if (sb && !sb.disabled) {
      settings.subject = sb.dataset.subject; saveSettings();
      return document.getElementById("navHistory").classList.contains("active") ? renderHistory() : renderHome();
    }
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === "start") startQuiz(id, "full");
    else if (act === "wrong") startQuiz(id, "wrong");
    else if (act === "next") go(1);
    else if (act === "prev") go(-1);
    else if (act === "submit") submitMulti();
    else if (act === "reveal") revealSelf();
    else if (act === "selfok") gradeSelf(true);
    else if (act === "selfbad") gradeSelf(false);
    else if (act === "resume") renderQuiz();
    else if (act === "discard") { session = null; remove(KEY.current); renderHome(); }
    else if (act === "history") renderHistory();
    else if (act === "home") renderHome();
    else if (act === "view") renderResult(id);
    else if (act === "export") exportHistory();
    else if (act === "lock") { if (confirm("이 기기에 저장된 잠금 해제 정보를 지울까? 다음에 열 때 암호를 다시 넣어야 한다.")) window.QUIZ_LOCK(); }
    else if (act === "reset") {
      if (confirm("모든 과목의 응시 기록을 지울까? " + (Sync.enabled() ? "다른 기기의 기록도 함께 지워진다. " : "") + "(되돌릴 수 없다. 먼저 내보내기를 권한다)")) {
        save(KEY.hist, []); save(KEY.meta, { resetAt: Date.now() }); Sync.request(); renderHome();
      }
    }
  });

  document.getElementById("homeBtn").onclick = function () { renderHome(); };
  document.getElementById("navHome").onclick = function () { renderHome(); };
  document.getElementById("navHistory").onclick = function () { renderHistory(); };
  const chipEl = document.getElementById("syncChip");
  if (chipEl) chipEl.onclick = function () { Sync.request(rerender); };

  const lb = document.getElementById("lightbox");
  function openLightbox(src, cap) {
    const im = document.getElementById("lbImg");
    im.removeAttribute("src");
    imgURL(src).then(function (u) { im.src = u; });
    document.getElementById("lbCap").textContent = cap || "";
    lb.hidden = false;
  }
  function closeLightbox() { lb.hidden = true; document.getElementById("lbImg").removeAttribute("src"); }
  document.getElementById("lbClose").onclick = closeLightbox;
  lb.addEventListener("click", function (e) { if (e.target === lb) closeLightbox(); });

  document.addEventListener("keydown", function (e) {
    if (!lb.hidden) { if (e.key === "Escape") closeLightbox(); return; }
    if (!session || !document.querySelector(".qcard")) return;
    if (e.target.tagName === "INPUT") return;
    const key = session.keys[session.pos];
    const r = qByKey(key);
    const t = qType(r.q);
    const answered = session.answers[key] !== undefined;
    if (/^[1-9]$/.test(e.key) && !answered && t !== "self") {
      const n = +e.key - 1;
      if (n < session.orders[key].length) { e.preventDefault(); choose(n); }
    } else if (e.key === "Enter" && !answered && t === "multi") {
      e.preventDefault(); submitMulti();
    } else if (e.key === "Enter" && !answered && t === "self" && !(session.reveal && session.reveal[key])) {
      e.preventDefault(); revealSelf();
    } else if ((e.key === "Enter" || e.key === "ArrowRight") && answered) {
      e.preventDefault(); go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault(); go(-1);
    }
  });

  // 동기화로 기록이 바뀌면 지금 보고 있는 화면을 다시 그린다(문제 푸는 중에는 건드리지 않음)
  function rerender() {
    if (document.querySelector(".qcard")) return;
    if (document.getElementById("navHistory").classList.contains("active")) renderHistory();
    else if (document.getElementById("navHome").classList.contains("active")) renderHome();
  }

  // ---------- start ----------
  function init(failed) {
    SUBJECTS = window.QUIZ_SUBJECTS || [];
    GRADES = window.QUIZ_GRADES || [];
    SUBJECTS.forEach(function (s) { SUBJ[s.id] = s; });
    BANK = window.QUIZ_BANK || [];
    BANK.forEach(function (qz) {
      BY_ID[qz.id] = qz;
      (qz.docs || []).forEach(function (d) {
        DOCS[qz.subjectId + "-" + d.lec] = { week: qz.week, title: d.title, label: qz.week + " " + d.title.split(" (")[0] };
      });
    });
    migrate();
    renderHome();
    Sync.chip();
    Sync.request(rerender);
    if (failed && failed.length) {
      app.insertAdjacentHTML("afterbegin", '<div class="card resume">불러오지 못한 데이터 파일: ' + esc(failed.join(", ")) + "</div>");
    }
    // 다른 기기에서 푼 기록을 가져오도록, 화면으로 돌아올 때마다 동기화
    document.addEventListener("visibilitychange", function () { if (!document.hidden) Sync.request(rerender); });
  }
  if (window.QUIZ_BOOT) window.QUIZ_BOOT(function () { init([]); });
  else loadData(window.QUIZ_FILES || [], init);
})();
