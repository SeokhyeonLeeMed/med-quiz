// 문제지·해설지 인쇄와 Word(.docx) 파일 만들기
//
// 같은 판 번호면 문제지와 해설지의 선지 순서가 같다(판 번호로 만든 난수로 섞는다).
// 인쇄 화면(브라우저)과 Word 파일이 같은 모양이 되도록:
//   1) 모든 문단을 고정 줄 간격(pt)으로 쓰고, 글꼴(Noto Sans KR)·크기·들여쓰기·탭 위치를 한 모델에서 같이 쓴다.
//   2) 쪽·단 나눔은 브라우저가 실제 높이를 재서 정하고, Word 파일에는 그 결과를 그대로 적는다
//      (문제지: 쪽마다 2칸짜리 표 한 줄, 해설지: 쪽 첫 문단에 '앞에서 쪽 나눔').
//   3) 쪽마다 한 줄 정도 여유를 남겨, Word에서 줄이 하나 더 꺾여도 다음 쪽으로 밀리지 않게 한다.
// 양식의 원본: 의예2/2학기/시험지 양식/수정_문제지 양식.docx, 수정_해설지 양식.docx (사용자가 고친 것)
(function () {
  "use strict";
  const A = () => window.QuizApp;
  const CIRC = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  // 글꼴: Word 이름과 CSS 이름. (Noto Sans KR은 Windows에 가변 글꼴로 깔려 있어 Word가 글자 폭을 잘못 재므로 쓰지 않는다)
  const FONT = "맑은 고딕", CSS_FONT = '"Malgun Gothic","맑은 고딕"';
  // 고정 줄 간격에서 Word는 기준선을 줄 높이의 80% 자리에 둔다. 브라우저는 글자를 줄 가운데에 두므로
  // 기준선 = 줄/2 + (ascent−descent)/2 (맑은 고딕: (2229−495)/2048/2 em). 차이만큼 글자를 아래로 옮겨 보인다(배치는 그대로)
  const FONT_K = (2229 - 495) / 2048 / 2;
  const baseShift = (sz, L) => Math.round((0.8 * L - (L / 2 + FONT_K * sz)) * 100) / 100;
  const BLUE = "1F4E79", RED = "C00000", GRAY = "595959", GREEN = "1B6E2F";

  // ---------- 쪽 크기 (pt). Word 값(twip)과 맞추려고 twip에서 계산한다 ----------
  const TW = (tw) => tw / 20;
  const PAGE_W = TW(11906), PAGE_H = TW(16838);
  const M_TOP = TW(794), M_SIDE = TW(850), M_FOOT = TW(397);
  const BODY_W = TW(10205), BODY_H = TW(16838 - 794 * 2);
  const COL_L = TW(5102), COL_R = TW(5103), COL_PAD = TW(226), COL_PAD_R = TW(227);
  const COL_W = TW(5102 - 226);                // 단 하나의 글 너비 = 243.8pt
  const SLACK = 6;                             // 쪽 끝 여유 (표 줄 높이에서 뺌)
  const RESERVE = 21;                          // 채울 때 남겨 두는 여유(한 줄)
  const P1_TOP = 8;                            // 첫 쪽 제목 줄 아래 여백
  // 글자 크기별 줄 간격: 양식(Word, 줄 간격 1.15)에서 잰 값
  const LN = { 17: 36.8, 12: 26, 11: 23.8, 10: 21.6, 9.5: 20.5, 9: 19.5, 8.5: 18.4, 8: 17.3 };
  const ln = (sz) => LN[sz] || Math.round(sz * 21.63) / 10;
  const tw = (pt) => Math.round(pt * 20);
  const NARROW = 0;                            // 브라우저 줄 폭을 이만큼 좁힌다(1pt로 해 보니 오히려 더 어긋났다)

  // ---------- 판 번호 · 난수 ----------
  const CODE_CH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function newCode() { let s = ""; for (let i = 0; i < 4; i++) s += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; return s; }
  function seedOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function rng(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // 판 번호로 문항마다 선지 순서(조합형은 보기까지 새로 만든 변형)를 정한다. 문제지·해설지가 같은 함수를 쓴다
  // refs: [{qz, i}] — 강의 퀴즈 한 회차의 문항들, 또는 과목 전체에서 뽑은 랜덤 20문항
  function prepareItems(refs, rnd) {
    const X = A(), S = X.settings();
    return refs.map(function (ref, k) {
      const qz = ref.qz, i = ref.i, q0 = qz.questions[i];
      let q = q0, order;
      if (X.isComboQ(q0)) {
        const v = S.shuffleOpts && q0.sx ? X.makeVariant(q0, rnd) : null;
        if (v) q = Object.assign({}, q0, v);
        order = X.range(q.o.length);
      } else {
        order = S.shuffleOpts ? X.shuffle(X.range(q0.o.length), rnd) : X.fixedOrder(qz.id + "#" + i, q0.o.length);
      }
      const ans = order.indexOf(q.a);
      return { n: k + 1, lab: String(k + 1), qz: qz, q: q, order: order, ans: ans, ansText: CIRC[ans] };
    });
  }
  // 기출: 선지를 섞지 않는다(해설이 ①② 번호를 직접 가리킨다). 정답은 여러 개일 수 있고 서술형은 없다
  function examItems(qz) {
    return qz.questions.map(function (q, k) {
      const a = q.a || [];
      return { n: k + 1, lab: String(q.label || q.n).replace(/\s+/g, " "), qz: qz, q: q, exam: 1, order: (q.o || []).map((_, i) => i),
        ansSet: a, ansText: q.t === "self" || !a.length ? "서술" : a.map((i) => CIRC[i]).join("") };
    });
  }

  // 문서 정보: 강의 회차 / 과목 랜덤 20문제("MIX:과목") / 기출
  function docMeta(quizId) {
    const X = A();
    if (quizId.indexOf("MIX:") === 0) {
      const sid = quizId.slice(4), s = X.subject(sid) || { name: sid };
      return { type: "mix", id: quizId, sid: sid, subject: s.name, grade: s.grade, term: s.term, shuffle: true,
        head: "전체 범위 랜덤 20문제", round: "", name: s.name + " 랜덤 20문제" };
    }
    const qz = X.quiz(quizId);
    if (!qz) return null;
    if (X.isExam(qz)) {
      return { type: "exam", id: quizId, qz: qz, subject: qz.subject, grade: qz.grade, term: qz.term, shuffle: false,
        head: qz.title, round: "", name: qz.subject + " " + qz.title, note: qz.note };
    }
    const t = titleParts(qz);
    return { type: "lecture", id: quizId, qz: qz, subject: qz.subject, grade: qz.grade, term: qz.term, shuffle: true,
      head: qz.week + " " + t.base + (qz.prof ? " (" + qz.prof + ")" : ""), round: t.round,
      keyHead: qz.week + " " + qz.title, name: qz.subject + " " + qz.week + (t.round ? " " + t.round : "") };
  }
  function docItems(m, code) {
    const X = A();
    if (m.type === "exam") return examItems(m.qz);
    if (m.type === "mix") {
      const refs = [];
      X.lectureQuizzes(m.sid).forEach((qz) => qz.questions.forEach((_, i) => refs.push({ qz: qz, i: i })));
      const rnd = rng(seedOf(code + "|" + m.id));
      return prepareItems(X.shuffle(refs, rnd).slice(0, 20), rnd);
    }
    return prepareItems(m.qz.questions.map((_, i) => ({ qz: m.qz, i: i })), rng(seedOf(code + "|" + m.id)));
  }

  // ---------- 글 조각(run) ----------
  // **굵게**, ^위첨자, 줄바꿈을 조각으로 나눈다. st: {b, i, c, sz}
  function runs(text, st) {
    st = st || {};
    const out = [];
    String(text == null ? "" : text).split("**").forEach(function (part, k) {
      if (!part) return;
      const b = st.b || k % 2 === 1;
      const re = /\^([−\-]?[0-9A-Za-zΔ]+)/g;
      let last = 0, m;
      while ((m = re.exec(part))) {
        if (m.index > last) out.push(Object.assign({}, st, { t: part.slice(last, m.index), b: b }));
        out.push(Object.assign({}, st, { t: m[1], b: b, sup: 1 }));
        last = re.lastIndex;
      }
      if (last < part.length) out.push(Object.assign({}, st, { t: part.slice(last), b: b }));
    });
    return out;
  }
  // 맑은 고딕에 없는 글자: Word와 브라우저가 서로 다른 대체 글꼴을 써서 폭이 달라지므로 바꿔 쓴다.
  // 위첨자 문자(⁺ ⁻ ⁿ ᶜ ¹ …)는 보통 글자 + 위첨자 서식으로, 나머지는 비슷한 글자로.
  // 빼기(−)·위첨자 빼기(⁻)는 줄을 바꾸지 않는 하이픈(U+2011)으로: Word에는 <w:noBreakHyphen/>, 브라우저에는 낱말 안의 '-'
  const NBH = "‑";
  const SUPCH = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": NBH, "ⁿ": "n", "ˢ": "s", "ᶜ": "c" };
  const REPL = { "−": NBH, "≈": "≒" };
  function fixChars(list) {
    const out = [];
    list.forEach(function (r) {
      if (r.t === "\t") { out.push(r); return; }
      let buf = "", sup = null;
      const push = function () { if (buf) out.push(Object.assign({}, r, { t: buf }, sup ? { sup: 1 } : {})); buf = ""; };
      const chars = Array.from(String(r.t));
      chars.forEach(function (ch, i) {
        const isSup = !r.sup && SUPCH[ch] !== undefined;
        if (isSup !== !!sup) { push(); sup = isSup; }
        let c = isSup ? SUPCH[ch] : (REPL[ch] || ch);
        // 낱말 끝의 빼기("Amp⁻ plate")는 보통 하이픈으로. 줄을 막을 필요가 있는 것은 뒤에 글자가 붙을 때뿐("2^−ΔCt")
        if (c === NBH && (i === chars.length - 1 || /\s/.test(chars[i + 1]))) c = "-";
        buf += c;
      });
      push();
    });
    return out;
  }
  const R = (t, st) => Object.assign({ t: t }, st || {});
  const TAB = { t: "\t" };

  // 문단 모델: {k:"p", sz, ln, bf, af, il, hg, jc, tabs, bdr:{sz,c,sp}, runs}
  function P(o, rs) {
    const sz = o.sz || 9.5;
    return Object.assign({ k: "p", sz: sz, ln: o.ln || ln(sz), bf: 0, af: 0, il: 0, hg: 0, jc: "left", tabs: [], rule: "exact" }, o, { runs: fixChars(rs || []) });
  }
  // 빈 칸(높이만): 표가 이어 붙거나 칸이 비는 것을 막고 간격을 준다
  function SP(h) { return P({ sz: 1, ln: Math.max(1, h) }, []); }

  // 보기 줄: "ㄱ. …", "(가) …", "A. …", "I. …"
  // 보기 기호 칸 너비: 가장 넓은 기호("(가)" 등)가 들어가게. 칸보다 기호가 넓으면 Word는 다음 기본 탭(36pt)까지 밀어 버린다
  function labelHang(bs, sz, st, base) {
    const w = Math.max.apply(null, [0].concat(bs.filter((b) => b.lab).map((b) => textWidth([R(b.lab, st)], sz))));
    return Math.max(base, Math.ceil((w + 3) * 20) / 20);
  }
  const BOGI_LINE = /^(?:[ㄱ-ㅎ]|[가나다라마바사아자차카타파하]|[A-Ha-h]|IV|V|I{1,3})[.)]\s|^\([가나다라마바사아자차카타파하]\)\s/;
  function bogiLine(l) {
    const m = String(l).match(/^((?:[ㄱ-ㅎ]|[가나다라마바사아자차카타파하]|IV|V|I{1,3}|[A-Ha-h])[.)]|\([가-하]\))\s*(.*)$/);
    return m ? { lab: m[1], text: m[2] } : { lab: "", text: l };
  }

  // ---------- 쪽 표기 ----------
  function srcLabel(quiz, p) {
    const X = A();
    let id = quiz.id, page = p;
    if (typeof p === "string" && p.indexOf(":") > 0) {
      const sp = p.split(":");
      id = sp[0].indexOf("-") > 0 ? sp[0] : quiz.subjectId + "-" + sp[0];
      page = +sp[1];
    }
    const qz = X.quiz(id) || X.doc(id);
    const sid = id.split("-")[0];
    const other = sid !== quiz.subjectId ? ((X.subject(sid) || { name: sid }).name + " ") : "";
    const name = qz ? (qz.label || qz.week) : id.slice(sid.length + 1);
    return other + name + " 강의 " + page + "쪽";
  }

  function gradeText(qz) {
    const m = String(qz.grade || "").match(/^(의예|의학)(\d)$/);
    return (m ? m[1] + "과 " + m[2] + "학년" : (qz.grade || "")) + (qz.term ? " " + qz.term : "");
  }
  function titleParts(qz) {
    const m = String(qz.title).match(/^(.*?)\s*(\d+회)$/);
    return { base: m ? m[1] : qz.title, round: m ? m[2] : "" };
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + ". " + (d.getMonth() + 1) + ". " + d.getDate() + ".";
  }

  // ======================================================================
  // HTML (측정·인쇄용)
  // ======================================================================
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function hRun(r, psz) {
    let st = "";
    if (r.b) st += "font-weight:700;";
    if (r.i) st += "font-style:italic;";
    if (r.c) st += "color:#" + r.c + ";";
    if (r.sz && r.sz !== psz) st += "font-size:" + r.sz + "pt;line-height:1;";
    const t = esc(r.t).replace(/‑/g, "-").replace(/\n/g, "<br>");
    return r.sup ? '<sup style="' + st + '">' + t + "</sup>" : (st ? '<span style="' + st + '">' + t + "</span>" : t);
  }
  // Word처럼 공백과 하이픈·대시 뒤에서만 줄을 바꾸도록 낱말을 nowrap으로 묶는다
  // (Chrome은 "고정된다(Lorenz)"의 '(' 앞에서도 줄을 바꾸지만 Word는 바꾸지 않는다)
  // Word(한국어 줄 바꿈 규칙)가 줄 첫머리에 두지 않는 글자. 이 글자 앞의 공백에서는 줄을 바꾸지 않는다("95 ℃")
  const NOSTART = "!%),.:;?]}°’”‰′″℃、。〉》」』】〕！％），．：；？］｝";
  function hRuns(rs, psz) {
    // 조각(공백 / 낱말 / 줄바꿈)으로 먼저 나눈 뒤, 다음 조각을 보고 공백을 낱말에 붙일지 정한다
    const pcs = [];
    rs.forEach(function (r) {
      String(r.t).split(/( +|\n)/).forEach(function (t) {
        if (t) pcs.push({ r: r, t: t, k: t === "\n" ? "nl" : /^ +$/.test(t) ? "sp" : "w" });
      });
    });
    let out = "", word = "", wlen = 0;
    const flush = function () {
      if (word) out += wlen > 40 ? word : '<span class="qp-w">' + word + "</span>";
      word = ""; wlen = 0;
    };
    pcs.forEach(function (pc, i) {
      const r = pc.r, t = pc.t;
      if (pc.k === "nl") { flush(); out += "<br>"; return; }
      if (pc.k === "sp") {
        const nx = pcs[i + 1];
        const sp = hRun(Object.assign({}, r, { t: t, sup: 0 }), psz);
        if (word && nx && nx.k === "w" && NOSTART.indexOf(nx.t.charAt(0)) >= 0) { word += sp; wlen += t.length; return; }
        flush(); out += sp; return;
      }
      const segs = r.sup ? [t] : t.split(/(?<=[-–—→])/);      // Word는 화살표 뒤에서도 줄을 바꾼다
      segs.forEach(function (seg, j) {
        word += hRun(Object.assign({}, r, { t: seg }), psz); wlen += seg.length;
        if (j < segs.length - 1) flush();
      });
    });
    flush();
    return out;
  }
  function hPara(p) {
    // 탭으로 나뉜 조각: 탭 위치까지 고정 너비 칸으로 둔다(Word의 왼쪽 탭과 같은 자리)
    const segs = [[]];
    p.runs.forEach(function (r) {
      if (r.t === "\t") { segs.push([]); return; }
      const parts = r.t.split("\t");
      parts.forEach(function (t, i) { if (i) segs.push([]); if (t) segs[segs.length - 1].push(Object.assign({}, r, { t: t })); });
    });
    const stops = (p.hg ? [p.il] : []).concat(p.tabs);
    let cur = p.il - p.hg, body = "";
    segs.forEach(function (seg, i) {
      const html = hRuns(seg, p.sz);
      if (i < segs.length - 1) {
        // 정한 탭 위치가 없으면 Word의 기본 탭(0.5인치 = 36pt 간격, defaultTabStop 720)으로 간다 — 예: 빈칸 "(\t)"
        const stop = stops[i] != null ? stops[i] : (Math.floor((cur + textWidth(seg, p.sz)) / 36 + 1e-6) + 1) * 36;
        const w = Math.max(0, stop - cur);
        body += '<span class="qp-tb" style="width:' + w.toFixed(2) + 'pt">' + html + "</span>";
        cur = stop;
      } else body += html;
    });
    let inner = "font-size:" + p.sz + "pt;line-height:" + p.ln + "pt;padding-right:" + NARROW + "pt;";
    if (p.il || p.hg) inner += "padding-left:" + p.il + "pt;text-indent:" + (-p.hg) + "pt;";
    if (p.jc === "center") inner += "text-align:center;";
    if (p.bdr) inner += "border-bottom:" + p.bdr.sz + "pt solid #" + p.bdr.c + ";padding-bottom:" + p.bdr.sp + "pt;";
    if (!body) body = "&#8203;";
    else body = '<span class="qp-t" style="top:' + baseShift(p.sz, p.ln) + 'pt">' + body + "</span>";
    // 문단 앞뒤 간격: Word는 앞 문단의 뒤 간격과 이 문단의 앞 간격 중 큰 값만 쓴다 → CSS 여백 겹침(margin collapse)과 같다
    const pad = (p.bf || p.af) ? ' style="margin:' + p.bf + "pt 0 " + p.af + 'pt 0"' : "";
    return '<div class="qp-p"' + pad + '><div style="' + inner + '">' + body + "</div></div>";
  }
  // 상자 안 위·아래 여백은 빈 문단으로 둔다(Word는 칸 위·아래 여백을 브라우저와 다르게 더한다)
  function boxItems(b) { return (b.mt ? [SP(b.mt)] : []).concat(b.items, b.mb ? [SP(b.mb)] : []); }
  function hBox(b) {
    let st = "width:" + b.w + "pt;padding:0 " + b.mr + "pt 0 " + b.ml + "pt;";
    if (b.fill) st += "background:#" + b.fill + ";";
    if (b.bdr) st += "box-shadow:inset 0 0 0 " + b.bdr.sz + "pt #" + b.bdr.c + ";";
    return '<div class="qp-box" style="' + st + '">' + boxItems(b).map(hItem).join("") + "</div>";
  }
  function hGrid(g) {
    const W = g.cols.reduce((s, x) => s + x, 0);
    let h = '<div class="qp-grid" style="width:' + W + "pt;border-top:" + g.bdr.sz + "pt solid #" + g.bdr.c + ";border-left:" + g.bdr.sz + "pt solid #" + g.bdr.c + '">';
    g.rows.forEach(function (row) {
      h += '<div class="qp-gr" style="height:' + row.h + 'pt">';
      row.cells.forEach(function (c, i) {
        h += '<div class="qp-gc" style="width:' + g.cols[i] + "pt;border-right:" + g.bdr.sz + "pt solid #" + g.bdr.c + ";border-bottom:" + g.bdr.sz + "pt solid #" + g.bdr.c + ";" +
          (c.fill ? "background:#" + c.fill + ";" : "") + '">' + c.items.map(hItem).join("") + "</div>";
      });
      h += "</div>";
    });
    return h + "</div>";
  }
  function hImg(m) {
    return '<div class="qp-p" style="margin:' + m.bf + "pt 0 " + m.af + 'pt 0"><div style="height:' + m.ln + "pt;padding-left:" + m.il + 'pt;position:relative">' +
      '<img class="qp-img" src="' + esc(m.url) + '" style="width:' + m.w + "pt;height:" + m.h + "pt;top:" + (m.ln - m.h).toFixed(2) + "pt;left:" + m.il + 'pt" alt=""></div></div>';
  }
  function hItem(it) {
    return it.k === "p" ? hPara(it) : it.k === "box" ? hBox(it) : it.k === "grid" ? hGrid(it) : it.k === "img" ? hImg(it) : "";
  }

  // ---------- 측정 ----------
  let meas = null;
  function measurer() {
    if (!meas) {
      meas = document.createElement("div");
      meas.className = "qp-font qp-meas";
      document.body.appendChild(meas);
    }
    return meas;
  }
  // 덩어리(unit: 항목 배열)마다 높이(pt)를 잰다
  function measureUnits(units, width) {
    const m = measurer();
    m.style.width = width + "pt";
    m.innerHTML = units.map((u) => '<div class="qp-u">' + u.map(hItem).join("") + "</div>").join("");
    const els = m.children, out = [];
    for (let i = 0; i < els.length; i++) out.push(els[i].getBoundingClientRect().height * 0.75);
    m.innerHTML = "";
    return out;
  }
  function textWidth(runsList, sz) {
    const m = measurer();
    // measureUnits가 hPara를 부르는 도중에도 쓰이므로(탭 칸 너비) 너비·내용을 되돌려 놓는다
    const w0 = m.style.width, h0 = m.innerHTML;
    m.style.width = "2000pt";
    m.innerHTML = '<span style="font-size:' + sz + 'pt;white-space:pre">' + runsList.map((r) => hRun(r, sz)).join("") + "</span>";
    const w = m.firstChild.getBoundingClientRect().width * 0.75;
    m.innerHTML = h0;
    m.style.width = w0;
    return w;
  }
  async function fontsReady(text) {
    if (!document.fonts || !document.fonts.load) return;
    const sample = text.slice(0, 20000) || "가";
    try {
      await Promise.all([
        document.fonts.load("400 10pt " + CSS_FONT, sample),
        document.fonts.load("700 10pt " + CSS_FONT, sample),
        document.fonts.load("italic 400 10pt " + CSS_FONT, sample)
      ]);
      await document.fonts.ready;
    } catch (e) { /* 글꼴을 못 불러도 진행 */ }
  }

  // 그림 크기 미리 알기 (배포판은 암호를 풀어 blob 주소)
  const imgInfo = {};
  function loadImg(src) {
    if (!imgInfo[src]) {
      imgInfo[src] = A().imgURL(src).then(function (url) {
        return new Promise(function (res) {
          const im = new Image();
          im.onload = function () { res({ url: url, w: im.naturalWidth, h: im.naturalHeight }); };
          im.onerror = function () { res(null); };
          im.src = url;
        });
      }, function () { return null; });
    }
    return imgInfo[src];
  }

  // ======================================================================
  // 문제지
  // ======================================================================
  function examTitle(m) {
    const items = [
      P({ sz: 10, jc: "center" }, [R(gradeText(m) ? "고려대학교 의과대학 " + gradeText(m) : "고려대학교 의과대학")]),
      P({ sz: 17, jc: "center" }, [R(m.subject, { b: 1 })]),
      P({ sz: 12, jc: "center" }, [R(m.head, { b: 1 })])
    ];
    if (m.round) items.push(P({ sz: 12, jc: "center" }, [R("- " + m.round + " -", { b: 1 })]));
    return items;
  }

  // 보기 상자(ㄱㄴㄷㄹ, (가)(나), a/b …)
  function bogiBox(lines, w) {
    const bs = lines.map(bogiLine), hg = labelHang(bs, 9, { b: 1 }, 14.15);
    return { k: "box", w: w, bdr: { sz: 0.5, c: "808080" }, mt: 0, mb: 0, ml: 5.4, mr: 5.4,
      items: bs.map((b) => b.lab ? P({ sz: 9, il: hg, hg: hg }, [R(b.lab, { b: 1 }), TAB].concat(runs(b.text))) : P({ sz: 9 }, runs(b.text))) };
  }
  // 선지: 짧은 선지(조합형 등)는 한 줄에 3개씩
  function optionParas(it, bf0) {
    const q = it.q, X = A(), out = [];
    const opts = it.order.map((o, di) => [R(CIRC[di] + " ")].concat(runs(q.o[o])));
    const slot = [TW(1672) - TW(142), TW(3203) - TW(1672), COL_W - TW(3203)];
    const three = X.isComboQ(q) || opts.every((rs) => textWidth(rs, 9.5) <= Math.min.apply(null, slot) - 4);
    if (three && opts.length <= 6) {
      for (let r = 0; r < opts.length; r += 3) {
        let rs = [];
        opts.slice(r, r + 3).forEach(function (o, k) { if (k) rs.push(TAB); rs = rs.concat(o); });
        out.push(P({ sz: 9.5, il: TW(142), tabs: [TW(1672), TW(3203)], bf: r === 0 ? bf0 : 0 }, rs));
      }
    } else {
      it.order.forEach(function (o, di) {
        out.push(P({ sz: 9.5, il: TW(425), hg: TW(283), bf: di === 0 ? bf0 : 0 }, [R(CIRC[di]), TAB].concat(runs(q.o[o]))));
      });
    }
    return out;
  }
  // 문항 번호 칸: 번호가 칸보다 넓으면 넓힌다
  function numHang(lab) { return Math.max(15.6, Math.ceil((textWidth([R(lab + ".", { b: 1 })], 9.5) + 3) * 20) / 20); }

  function examQuestion(it) {
    const q = it.q;
    const lines = String(q.q).split("\n");
    const stem = lines[0], bogi = lines.slice(1).filter((l) => l.trim());
    const hg = numHang(it.lab), out = [];
    out.push(P({ sz: 9.5, il: hg, hg: hg, af: bogi.length ? 0 : 12 }, [R(it.lab + ".", { b: 1 }), TAB].concat(runs(stem))));
    if (bogi.length) out.push(bogiBox(bogi, COL_W));
    return out.concat(optionParas(it, bogi.length ? 3 : 0));
  }

  // 기출 발문 나누기(사이트와 같은 규칙): 빈 줄 = 문단 구분, [공통 지문] = 지문 상자, | a / b | = 보기 상자, [그림]·[표] = 잘라 둔 그림
  function examStemParts(q) {
    const parts = [];
    let para = [], box = null;
    const flush = function () { if (para.length) { parts.push({ k: "p", t: para.join("\n") }); para = []; } };
    String(q.q).split("\n").forEach(function (l) {
      const t = l.trim();
      // 이어지는 보기 줄(ㄱ. 가. A. I. (가) …)은 보기 상자 하나로
      if (t && BOGI_LINE.test(t)) { flush(); if (!box) { box = { k: "bogi", lines: [] }; parts.push(box); } box.lines.push(t); return; }
      box = null;
      if (!t) { flush(); return; }
      if (t.indexOf("[공통 지문]") === 0) { flush(); parts.push({ k: "shared", t: t.replace("[공통 지문]", "").trim() }); return; }
      if (t.charAt(0) === "|") { flush(); parts.push({ k: "bogi", lines: t.replace(/^\|\s*|\s*\|$/g, "").split(" / ") }); return; }
      if (t === "[그림]" || t === "[표]") { flush(); if (!parts.some((p) => p.k === "fig")) parts.push({ k: "fig" }); return; }
      para.push(t);
    });
    flush();
    return parts;
  }
  // 상자가 맞붙으면 사이에 3pt (Word는 표끼리 붙으면 하나로 합치므로 빈 문단이 필요하다 — 두 출력 모두 같은 빈 칸을 둔다)
  function pushBlock(out, b) {
    const last = out[out.length - 1];
    if (last && (last.k === "box" || last.k === "grid") && (b.k === "box" || b.k === "grid")) out.push(SP(3));
    out.push(b);
  }
  async function figItems(q, maxW, il) {
    const out = [];
    for (const src of q.figs || []) {
      const im = await loadImg(src);
      if (!im) continue;
      const w = Math.min(maxW, Math.round(im.w * 0.36 * 20) / 20), h = Math.round(w * im.h / im.w * 20) / 20;   // 잘라 둔 그림은 200dpi
      out.push({ k: "img", src: src, url: im.url, w: w, h: h, ln: Math.ceil(h + 4), il: il, bf: 2, af: 2 });
    }
    return out;
  }
  // Claude가 보완한 기출 문항 표시
  function altMark(q) { return q.alt ? [R("(Claude 보완) ", { b: 1, c: GRAY })] : []; }
  async function examQuestionX(it) {
    const q = it.q, hg = numHang(it.lab), out = [];
    let numbered = false;
    for (const p of examStemParts(q)) {
      if (p.k === "p") {
        out.push(numbered ? P({ sz: 9.5, il: hg, bf: 3 }, runs(p.t)) : P({ sz: 9.5, il: hg, hg: hg }, [R(it.lab + ".", { b: 1 }), TAB].concat(altMark(q), runs(p.t))));
        numbered = true;
      } else if (p.k === "shared") {
        pushBlock(out, { k: "box", w: COL_W, fill: "F5F5F5", bdr: { sz: 0.5, c: "808080" }, mt: 2, mb: 2, ml: 5.4, mr: 5.4, items: [P({ sz: 9 }, runs(p.t))] });
      } else if (p.k === "bogi") {
        pushBlock(out, bogiBox(p.lines, COL_W));
      } else (await figItems(q, COL_W - hg - 2, hg)).forEach((x) => out.push(x));
    }
    if (!numbered) out.unshift(P({ sz: 9.5, il: hg, hg: hg }, [R(it.lab + ".", { b: 1 }), TAB].concat(altMark(q))));
    const last = out[out.length - 1];
    if (q.o && q.o.length) {
      if (last.k === "p") { last.af = 12; return out.concat(optionParas(it, 0)); }
      return out.concat(optionParas(it, 3));
    }
    // 서술형·선지 복기 실패: 답 쓰는 칸
    if (last.k === "p") last.af = 4;
    pushBlock(out, { k: "box", w: COL_W, bdr: { sz: 0.5, c: "808080" }, mt: 2, mb: 0, ml: 5.4, mr: 5.4,
      items: [P({ sz: 8.5 }, [R("답", { b: 1, c: GRAY })]), SP(70)] });
    return out;
  }

  // 문제를 단에 채운다: 넘치면 문제 전체를 다음 단으로, 왼쪽 단 → 오른쪽 단 → 다음 쪽
  function layoutExam(units, title) {
    const hs = measureUnits(units, COL_W);
    const gapH = ln(9.5);
    const titleH = measureUnits([title], BODY_W)[0];
    const T = Math.ceil((titleH + 8) * 20) / 20;      // 제목 줄 높이(아래 8pt 여백 포함)
    const pages = [];
    let page = null, col = 0, used = 0;
    function newPage() {
      page = { cols: [[], []], first: !pages.length };
      page.colH = page.first ? BODY_H - T - SLACK : BODY_H - SLACK;
      page.top = page.first ? P1_TOP : 0;
      if (page.top) page.cols.forEach((c) => c.push(Object.assign(SP(page.top), { spacer: 1 })));
      pages.push(page); col = 0; used = page.top;
    }
    newPage();
    units.forEach(function (u, i) {
      const limit = page.colH - RESERVE;
      const empty = !page.cols[col].some((x) => !x.spacer);
      const need = (empty ? 0 : gapH) + hs[i];
      if (!empty && used + need > limit) {
        if (col === 0) { col = 1; used = page.top; } else newPage();
      }
      const c = page.cols[col];
      if (c.length && !(c.length === 1 && c[0].spacer)) { c.push(P({ sz: 9.5 }, [])); used += gapH; }
      u.forEach((x) => c.push(x));
      used += hs[i];
    });
    return { pages: pages, T: T, title: title, heights: hs };
  }

  function examFooter(m, code, first) {
    const pan = m.shuffle ? "판 " + code : "";
    return { left: m.name + " 문제지", right: first ? today() + " 인쇄" + (pan ? " (" + pan + ")" : "") : pan };
  }

  function examPagesHTML(L, m, code) {
    return L.pages.map(function (pg, k) {
      const ft = examFooter(m, code, k === 0);
      let h = '<div class="qp-pg qp-font"><div class="qp-body">';
      if (pg.first) h += '<div class="qp-title" style="height:' + L.T + 'pt">' + L.title.map(hItem).join("") + "</div>";
      h += '<div class="qp-cols" style="height:' + pg.colH + 'pt">' +
        '<div class="qp-col" style="width:' + COL_L + "pt;padding:0 " + COL_PAD + 'pt 0 0">' + pg.cols[0].map(hItem).join("") + "</div>" +
        '<div class="qp-col" style="width:' + COL_R + "pt;padding:0 0 0 " + COL_PAD_R + 'pt">' + pg.cols[1].map(hItem).join("") + "</div>" +
        '<div class="qp-sep" style="left:' + COL_L + 'pt"></div></div>';
      return h + "</div>" + footerHTML(ft, k + 1) + "</div>";
    }).join("");
  }

  // ======================================================================
  // 해설지
  // ======================================================================
  function keyTitle(m) {
    const out = [
      P({ sz: 17 }, [R(m.subject, { b: 1 })]),
      P({ sz: 12 }, [R((m.keyHead || m.head) + " 해설지", { b: 1 })]),
      P({ sz: 9.5, ln: 6, af: 6, bdr: { sz: 1.75, c: BLUE, sp: 1 } }, [])
    ];
    if (m.note) out.push(P({ sz: 8.5, af: 4 }, [R("※ " + m.note, { c: GRAY })]));
    return out;
  }

  function answerGrid(items) {
    const N = items.length, rows = [];
    const cols = [];
    for (let i = 0; i < 11; i++) cols.push(i < 10 ? TW(928) : TW(10205 - 928 * 10));
    const head = (t) => ({ fill: "EEF3F8", items: [P({ sz: 8.5, jc: "center", ln: 18.4 }, [R(t, { b: 1, c: BLUE })])] });
    for (let s = 0; s < N; s += 10) {
      const nums = [head("번호")], ans = [head("정답")];
      for (let j = 0; j < 10; j++) {
        const it = items[s + j];
        nums.push({ fill: "F2F2F2", items: [P({ sz: 8.5, jc: "center", ln: 18.4 }, it ? [R(it.lab.replace(/ /g, ""), { b: 1 })] : [])] });
        const at = it ? it.ansText : "";
        ans.push({ items: [P({ sz: at.length > 1 ? 8.5 : 10, jc: "center", ln: 18.4 }, it ? [R(at, { b: 1, c: RED })] : [])] });
      }
      rows.push({ h: TW(433), cells: nums }, { h: TW(433), cells: ans });
    }
    return { k: "grid", cols: cols, rows: rows, bdr: { sz: 0.5, c: "808080" } };
  }

  // 기출 해설: 원고(q.x) 한 줄이 한 문단. # 소제목, - 글머리, ①… 선지, → 고친 문장, ! 주의 상자, + 함께 알기 상자
  async function examKeyUnits(it) {
    const q = it.q, units = [], set = it.ansSet || [];
    const head = [R(it.lab + "번", { b: 1, c: BLUE, sz: 12 }), R("     정답 " + (q.h || it.ansText), { b: 1, c: RED, sz: 11 })];
    if (q.alt) head.push(R("     Claude 보완", { b: 1, c: GRAY, sz: 9 }));
    if (q.pf) head.push(R("     " + q.pf + " 교수", { c: GRAY, sz: 9 }));
    const u1 = [P({ sz: 12, bf: 14, af: 2, bdr: { sz: 0.75, c: BLUE, sp: 1 } }, head)];
    let firstP = true;
    for (const p of examStemParts(q)) {
      if (p.k === "p" || p.k === "shared") {
        u1.push(P({ sz: 8.5, bf: firstP ? 3 : 2, af: 1 }, runs((p.k === "shared" ? "[공통 지문] " : "") + p.t, { c: GRAY })));
        firstP = false;
      } else if (p.k === "bogi") {
        const bs = p.lines.map(bogiLine), bhg = labelHang(bs, 8.5, {}, TW(227));
        bs.forEach((b) => u1.push(b.lab ? P({ sz: 8.5, il: TW(170) + bhg, hg: bhg }, [R(b.lab, { c: GRAY }), TAB].concat(runs(b.text, { c: GRAY })))
          : P({ sz: 8.5, il: TW(170) }, runs(b.text, { c: GRAY }))));
      } else (await figItems(q, 220, TW(170))).forEach((x) => u1.push(x));
    }
    (q.o || []).forEach(function (o, i) {
      const st = set.indexOf(i) >= 0 && q.t !== "self" ? { b: 1, c: RED } : { c: GRAY };
      u1.push(P({ sz: 8.5, il: TW(425), hg: TW(255) }, [R(CIRC[i], st), TAB].concat(runs(o, st))));
    });
    (q.notes || []).forEach((n) => u1.push(P({ sz: 8, bf: 2, il: TW(170) }, [R("※ " + n, { c: GRAY })])));
    units.push(u1);
    let pending = null;                                   // 소제목은 다음 줄과 같은 쪽에
    (q.x || []).forEach(function (line) {
      const t = String(line).trim();
      if (!t) return;
      let m;
      const u = pending ? [pending] : [];
      pending = null;
      if ((m = t.match(/^#\s*(.*)$/))) { pending = P({ sz: 10, bf: 7, af: 2 }, [R("■ " + m[1], { b: 1, c: BLUE })]); if (u.length) units.push(u); return; }
      if ((m = t.match(/^-\s+(.*)$/))) u.push(P({ sz: 9.5, il: TW(397), hg: TW(227), af: 1 }, [R("•"), TAB].concat(runs(m[1]))));
      else if ((m = t.match(/^→\s*(.*)$/))) u.push(P({ sz: 9.5, il: TW(397), af: 1 }, runs("→ " + m[1], { c: GREEN })));
      else if ((m = t.match(/^([!+])\s*(.*)$/))) {
        const warn = m[1] === "!";
        const rs = (warn ? [] : [R("▶ 함께 알기  ", { b: 1, c: BLUE })]).concat(runs(m[2]));
        u.push(SP(2), { k: "box", w: BODY_W, fill: warn ? "FFF3D1" : "EEF3F8", mt: 2, mb: 2, ml: TW(113), mr: TW(113), items: [P({ sz: 9.5 }, rs)] }, SP(3));
      } else if (CIRC.indexOf(t.charAt(0)) >= 0) {
        const ci = CIRC.indexOf(t.charAt(0)), ok = set.indexOf(ci) >= 0 && q.t !== "self";
        u.push(P({ sz: 9.5, il: TW(397), hg: TW(283), af: 1 }, [R(t.charAt(0), ok ? { b: 1, c: RED } : { b: 1 }), TAB].concat(runs(t.slice(1).trim()))));
      } else u.push(P({ sz: 9.5, af: 2 }, runs(t)));
      units.push(u);
    });
    if (pending) units.push([pending]);
    return units;
  }

  // 해설지 덩어리들: 덩어리 안에서는 쪽을 나누지 않는다
  async function keyUnits(m, items) {
    const X = A();
    const units = [];
    units.push([P({ sz: 11, af: 3 }, [R("정답", { b: 1, c: BLUE })]), answerGrid(items)]);
    for (const it of items) {
      if (it.exam) { (await examKeyUnits(it)).forEach((u) => units.push(u)); continue; }
      const q = it.q, combo = !!q.sx, qz = it.qz, noImg = !!qz.noImg;
      const lines = String(q.q).split("\n");
      const stem = lines[0], bogi = lines.slice(1).filter((l) => l.trim());
      // 1) 문항 머리 + 문항 다시 보기
      const head = [R(it.lab + "번", { b: 1, c: BLUE, sz: 12 }), R("     정답 " + CIRC[it.ans], { b: 1, c: RED, sz: 11 })];
      if (combo) head.push(R("  (" + q.o[q.a] + ")", { b: 1, c: RED, sz: 10 }));
      if (m.type === "mix") head.push(R("     " + qz.week + " " + qz.title, { c: GRAY, sz: 9 }));   // 랜덤: 어느 회차 문항인지
      const u1 = [P({ sz: 12, bf: 14, af: 2, bdr: { sz: 0.75, c: BLUE, sp: 1 } }, head)];
      u1.push(P({ sz: 8.5, bf: 3, af: 1 }, runs(stem, { c: GRAY })));
      const bs = bogi.map(bogiLine), bhg = labelHang(bs, 8.5, {}, TW(227));
      bs.forEach(function (b) {
        u1.push(b.lab ? P({ sz: 8.5, il: TW(170) + bhg, hg: bhg }, [R(b.lab, { c: GRAY }), TAB].concat(runs(b.text, { c: GRAY })))
          : P({ sz: 8.5, il: TW(170) }, runs(b.text, { c: GRAY })));
      });
      const optRuns = it.order.map(function (o, di) {
        const st = di === it.ans ? { b: 1, c: RED } : { c: GRAY };
        return [R(CIRC[di] + " " + q.o[o], st)];
      });
      const stops = [TW(1191), TW(2211), TW(3231), TW(4252)];
      const oneLine = X.isComboQ(q) && optRuns.length <= 5 && optRuns.every((rs) => textWidth(rs, 8.5) <= TW(1020) - 3);
      if (oneLine) {
        let rs = [];
        optRuns.forEach(function (o, k) { if (k) rs.push(TAB); rs = rs.concat(o); });
        u1.push(P({ sz: 8.5, il: TW(170), tabs: stops, bf: 1 }, rs));
      } else {
        it.order.forEach(function (o, di) {
          const st = di === it.ans ? { b: 1, c: RED } : { c: GRAY };
          u1.push(P({ sz: 8.5, il: TW(425), hg: TW(255) }, [R(CIRC[di], st), TAB].concat(runs(q.o[o], st))));
        });
      }
      units.push(u1);
      // 2) 기본 개념
      if (q.c) {
        units.push([
          P({ sz: 10, bf: 7, af: 2 }, [R("■ 기본 개념", { b: 1, c: BLUE })]),
          { k: "box", w: BODY_W, fill: "EEF3F8", mt: 0, mb: 0, ml: TW(113), mr: TW(113), items: [P({ sz: 9.5 }, runs(q.c))] },
          SP(4)
        ]);
      }
      // 3) 선지(보기) 해설: 근거 슬라이드가 같은 것끼리 묶고, 묶음마다 슬라이드 사진 하나
      const heading = P({ sz: 10, bf: 2, af: 2 }, [R(combo ? "■ 보기 해설" : "■ 선지 해설", { b: 1, c: BLUE })]);
      const groups = [], byKey = {};
      if (combo) {
        q.sx.forEach(function (s, i) {
          const ref = X.refInfo(qz, s[3]);
          const gk = noImg ? "s" + i : ref.src;
          if (!byKey[gk]) { byKey[gk] = { ref: ref, page: s[3], items: [] }; groups.push(byKey[gk]); }
          byKey[gk].items.push({ lab: s[0], ok: !!s[1], ex: s[2], quote: s[4], correct: false });
        });
      } else {
        it.order.forEach(function (o, di) {
          const e = q.e[o];
          const ref = X.refInfo(qz, e[1]);
          const gk = noImg ? "o" + o : ref.src;
          if (!byKey[gk]) { byKey[gk] = { ref: ref, page: e[1], items: [] }; groups.push(byKey[gk]); }
          byKey[gk].items.push({ lab: CIRC[di], ok: o === q.a, ex: String(e[0]).replace(/^정답[.:]?\s*/, ""), quote: e[2], correct: o === q.a });
        });
        // 정답이 든 묶음을 먼저
        groups.sort((a, b) => (b.items.some((x) => x.correct) ? 1 : 0) - (a.items.some((x) => x.correct) ? 1 : 0));
      }
      const imgs = noImg ? [] : await Promise.all(groups.map((g) => loadImg(g.ref.src)));
      let firstUnit = true;
      groups.forEach(function (g, gi) {
        const sameQuote = g.items.every((x) => x.quote === g.items[0].quote);
        const quoteP = (qt) => P({ sz: 8, il: TW(397), af: 1 }, [R(srcLabel(qz, g.page) + "   ", { b: 1, c: GRAY }), R("“" + qt + "”", { i: 1, c: GRAY })]);
        g.items.forEach(function (x, xi) {
          const lab = combo ? R(x.lab, { b: 1 }) : R(x.lab, x.correct ? { b: 1, c: RED } : { b: 1 });
          const verdict = combo ? (x.ok ? R("옳음   ", { b: 1, c: GREEN }) : R("틀림   ", { b: 1, c: RED }))
            : (x.correct ? R("정답   ", { b: 1, c: GREEN }) : R("오답   ", { b: 1, c: RED }));
          const u = [];
          if (firstUnit) { u.push(heading); firstUnit = false; }
          u.push(P({ sz: 9.5, il: TW(397), hg: TW(283), af: 1 }, [lab, TAB, verdict].concat(runs(x.ex))));
          const last = xi === g.items.length - 1;
          if (!sameQuote) u.push(quoteP(x.quote));
          else if (last) u.push(quoteP(g.items[0].quote));
          const im = imgs[gi];
          if (last && im) {
            const w = TW(3118), h = Math.round(w * im.h / im.w * 20) / 20;   // 폭 55mm
            u.push({ k: "img", src: g.ref.src, url: im.url, w: w, h: h, ln: Math.ceil(h + 4), il: TW(397), bf: 0, af: 4 });
          }
          units.push(u);
        });
      });
    }
    return units;
  }

  function layoutKey(units, title) {
    const titleH = measureUnits([title], BODY_W)[0];
    const hs = measureUnits(units, BODY_W);
    const pages = [{ items: title.slice(), used: titleH }];
    units.forEach(function (u, i) {
      let pg = pages[pages.length - 1];
      const limit = BODY_H - RESERVE;
      if (pg.items.length && pg.used + hs[i] > limit) {
        pg = { items: [], used: 0 };
        pages.push(pg);
      }
      let h = hs[i];
      if (!pg.items.length && u[0].k === "p" && u[0].bf) {      // 쪽 맨 위 문단은 앞 간격을 없앤다
        h -= u[0].bf;
        u = [Object.assign({}, u[0], { bf: 0 })].concat(u.slice(1));
      }
      u.forEach((x) => pg.items.push(x));
      pg.used += h;
    });
    return { pages: pages };
  }

  function keyFooter(m, code) { return { left: m.name + " 해설지", right: m.shuffle ? "판 " + code : "" }; }

  function keyPagesHTML(L, m, code) {
    const ft = keyFooter(m, code);
    return L.pages.map(function (pg, k) {
      return '<div class="qp-pg qp-font"><div class="qp-body">' + pg.items.map(hItem).join("") + "</div>" + footerHTML(ft, k + 1) + "</div>";
    }).join("");
  }

  function footerHTML(ft, pageNo) {
    return '<div class="qp-ft"><span class="l">' + esc(ft.left) + '</span><span class="c">- ' + pageNo + ' -</span><span class="r">' + esc(ft.right) + "</span></div>";
  }

  // ======================================================================
  // 문서 만들기 (모델 + HTML)
  // ======================================================================
  // kind: "exam" = 문제지, "key" = 해설지
  async function build(quizId, kind, code) {
    const m = docMeta(quizId);
    if (!m) throw new Error("퀴즈 없음: " + quizId);
    const items = docItems(m, code);
    await fontsReady(JSON.stringify(items.map((it) => it.q)) + m.name + "①②③④⑤■“”‘’0123456789번정답오답옳음틀림쪽강의판인쇄");
    if (kind === "exam") {
      const units = [];
      for (const it of items) units.push(it.exam ? await examQuestionX(it) : examQuestion(it));
      const L = layoutExam(units, examTitle(m));
      return { kind: kind, qz: m, meta: m, code: code, L: L, html: examPagesHTML(L, m, code), nPages: L.pages.length };
    }
    const units = await keyUnits(m, items);
    const L = layoutKey(units, keyTitle(m));
    return { kind: kind, qz: m, meta: m, code: code, L: L, html: keyPagesHTML(L, m, code), nPages: L.pages.length };
  }

  // ======================================================================
  // DOCX
  // ======================================================================
  function xesc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function xRun(r) {
    let pr = "";
    if (r.b) pr += "<w:b/><w:bCs/>";
    if (r.i) pr += "<w:i/><w:iCs/>";
    if (r.c) pr += '<w:color w:val="' + r.c + '"/>';
    if (r.sz) pr += '<w:sz w:val="' + Math.round(r.sz * 2) + '"/><w:szCs w:val="' + Math.round(r.sz * 2) + '"/>';
    if (r.sup) pr += '<w:vertAlign w:val="superscript"/>';
    const rpr = pr ? "<w:rPr>" + pr + "</w:rPr>" : "";
    let body = "";
    String(r.t).split("\n").forEach(function (line, i) {
      if (i) body += "<w:br/>";
      line.split("\t").forEach(function (t, j) {
        if (j) body += "<w:tab/>";
        t.split("‑").forEach(function (u, k) {
          if (k) body += "<w:noBreakHyphen/>";
          if (u) body += '<w:t xml:space="preserve">' + xesc(u) + "</w:t>";
        });
      });
    });
    return "<w:r>" + rpr + body + "</w:r>";
  }
  function xPPr(p, extra) {
    extra = extra || {};
    let s = "<w:pPr>";
    if (extra.pbb) s += "<w:pageBreakBefore/>";
    s += '<w:widowControl w:val="0"/>';
    if (p.bdr) s += '<w:pBdr><w:bottom w:val="single" w:sz="' + Math.round(p.bdr.sz * 8) + '" w:space="' + Math.round(p.bdr.sp) + '" w:color="' + p.bdr.c + '"/></w:pBdr>';
    const stops = (p.hg ? [p.il] : []).concat(p.tabs || []);
    if (stops.length) s += "<w:tabs>" + stops.map((x) => '<w:tab w:val="left" w:pos="' + tw(x) + '"/>').join("") + "</w:tabs>";
    s += '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:snapToGrid w:val="0"/>';
    s += '<w:spacing w:before="' + tw(p.bf) + '" w:after="' + tw(p.af) + '" w:line="' + tw(p.ln) + '" w:lineRule="' + (p.rule || "exact") + '"/>';
    if (p.il || p.hg) s += '<w:ind w:left="' + tw(p.il) + '"' + (p.hg ? ' w:hanging="' + tw(p.hg) + '"' : "") + "/>";
    if (p.jc === "center") s += '<w:jc w:val="center"/>';
    s += '<w:rPr><w:sz w:val="' + Math.round(p.sz * 2) + '"/><w:szCs w:val="' + Math.round(p.sz * 2) + '"/></w:rPr>';
    return s + "</w:pPr>";
  }
  function xPara(p, ctx, extra) {
    return "<w:p>" + xPPr(p, extra) + p.runs.map(function (r) {
      const sz = r.sz || p.sz;                      // 기본 글자 크기(9.5pt)가 아니면 조각마다 크기를 적는다
      return xRun(Object.assign({}, r, { sz: sz === 9.5 ? 0 : sz }));
    }).join("") + "</w:p>";
  }
  function xImg(m, ctx) {
    const rid = ctx.imgRid(m.src);
    if (!rid) return xPara(P({ sz: 8, il: m.il, bf: m.bf, af: m.af, ln: m.ln }, [R("[그림을 불러오지 못함]", { c: GRAY })]), ctx);
    const id = ++ctx.picId, cx = Math.round(m.w * 12700), cy = Math.round(m.h * 12700);
    const p = P({ sz: 1, ln: m.ln, il: m.il, bf: m.bf, af: m.af, rule: "atLeast" }, []);   // 최소 줄 높이: 그림이 줄 아래에 붙는다
    return "<w:p>" + xPPr(p) + '<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:effectExtent l="3175" t="3175" r="3175" b="3175"/><wp:docPr id="' + id + '" name="그림 ' + id + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="slide' + id + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:ln w="6350"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  const NOBDR = '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
  function bdrXml(tag, b) {
    return "<w:" + tag + ">" + ["top", "left", "bottom", "right"].concat(tag === "tblBorders" ? ["insideH", "insideV"] : [])
      .map((s) => '<w:' + s + ' w:val="single" w:sz="' + Math.round(b.sz * 8) + '" w:space="0" w:color="' + b.c + '"/>').join("") + "</w:" + tag + ">";
  }
  function mar(t, l, b, r) {
    return '<w:top w:w="' + tw(t) + '" w:type="dxa"/><w:left w:w="' + tw(l) + '" w:type="dxa"/><w:bottom w:w="' + tw(b) + '" w:type="dxa"/><w:right w:w="' + tw(r) + '" w:type="dxa"/>';
  }
  function xBox(b, ctx) {
    return '<w:tbl><w:tblPr><w:tblW w:w="' + tw(b.w) + '" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>' + (b.bdr ? bdrXml("tblBorders", b.bdr) : NOBDR) +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar>' + mar(0, b.ml, 0, b.mr) + '</w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="' + tw(b.w) + '"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="' + tw(b.w) + '" w:type="dxa"/>' +
      (b.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + b.fill + '"/>' : "") + "</w:tcPr>" + xItems(boxItems(b), ctx) + "</w:tc></w:tr></w:tbl>";
  }
  function xGrid(g, ctx) {
    const W = g.cols.reduce((s, x) => s + tw(x), 0);
    let s = '<w:tbl><w:tblPr><w:tblW w:w="' + W + '" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>' + bdrXml("tblBorders", g.bdr) +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar>' + mar(0, 0, 0, 0) + '</w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>' +
      g.cols.map((c) => '<w:gridCol w:w="' + tw(c) + '"/>').join("") + "</w:tblGrid>";
    g.rows.forEach(function (row) {
      s += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="' + tw(row.h) + '" w:hRule="exact"/></w:trPr>';
      row.cells.forEach(function (c, i) {
        s += '<w:tc><w:tcPr><w:tcW w:w="' + tw(g.cols[i]) + '" w:type="dxa"/>' + (c.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + c.fill + '"/>' : "") +
          '<w:vAlign w:val="center"/></w:tcPr>' + xItems(c.items, ctx) + "</w:tc>";
      });
      s += "</w:tr>";
    });
    return s + "</w:tbl>";
  }
  // 항목 나열: 표가 맞붙거나 칸이 표로 끝나면 1pt 빈 문단을 넣는다(Word 규칙). HTML에는 없으므로 높이 1pt만 차이 난다
  function xItems(items, ctx, firstExtra) {
    let s = "", prevTbl = false;
    if (!items.length) return xPara(SP(1), ctx);
    items.forEach(function (it, i) {
      const isTbl = it.k === "box" || it.k === "grid";
      if (isTbl && prevTbl) s += xPara(SP(1), ctx);
      const extra = i === 0 ? firstExtra : null;
      s += it.k === "p" ? xPara(it, ctx, extra) : it.k === "img" ? xImg(it, ctx) : it.k === "box" ? xBox(it, ctx) : xGrid(it, ctx);
      prevTbl = isTbl;
    });
    if (prevTbl) s += xPara(SP(1), ctx);
    return s;
  }

  function footerXml(ft) {
    const g = { c: GRAY };
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ' + NS + "><w:p><w:pPr><w:tabs>" +
      '<w:tab w:val="clear" w:pos="4680"/><w:tab w:val="clear" w:pos="9360"/><w:tab w:val="center" w:pos="5102"/><w:tab w:val="right" w:pos="10176"/></w:tabs>' +
      '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:snapToGrid w:val="0"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>' +
      xRun(R(ft.left, Object.assign({ sz: 8 }, g))) + xRun(R("\t- ", Object.assign({ sz: 9 }, g))) +
      '<w:fldSimple w:instr=" PAGE ">' + xRun(R("1", Object.assign({ sz: 9 }, g))) + "</w:fldSimple>" +
      xRun(R(" -\t", Object.assign({ sz: 9 }, g))) + xRun(R(ft.right, Object.assign({ sz: 8 }, g))) + "</w:p></w:ftr>";
  }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  function stylesXml() {
    const f = '<w:rFonts w:ascii="' + FONT + '" w:eastAsia="' + FONT + '" w:hAnsi="' + FONT + '" w:cs="' + FONT + '"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:docDefaults><w:rPrDefault><w:rPr>" + f + '<w:sz w:val="19"/><w:szCs w:val="19"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr><w:rPr>' + f + '<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>' + mar(0, 0, 0, 0) + "</w:tblCellMar></w:tblPr></w:style>" +
      "</w:styles>";
  }
  function settingsXml(titlePg) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>' +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
  }

  async function imageBytes(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      // file:// 에서는 fetch가 막힌다. 그림을 캔버스에 그려 다시 뽑아 본다(이것도 막히면 그림 없이 만든다)
      try {
        const im = await new Promise(function (res, rej) { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext("2d").drawImage(im, 0, 0);
        const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
        return new Uint8Array(await blob.arrayBuffer());
      } catch (e2) { return null; }
    }
  }

  async function makeDocx(doc) {
    const qz = doc.qz, files = [], media = [], rels = {};
    const ctx = {
      picId: 0,
      imgRid: function (src) { return rels[src] && rels[src].rid; }
    };
    // 그림 미리 받기
    const srcs = [];
    doc.L.pages.forEach(function (pg) {
      const all = pg.items || pg.cols[0].concat(pg.cols[1]);
      all.forEach(function walk(it) { if (it.k === "img" && srcs.indexOf(it.src) < 0) srcs.push(it.src); (it.items || []).forEach(walk); });
    });
    for (const src of srcs) {
      const info = await loadImg(src);
      const bytes = info && await imageBytes(info.url);
      if (!bytes) continue;
      const png = bytes[0] === 0x89 && bytes[1] === 0x50;
      const name = "image" + (media.length + 1) + (png ? ".png" : ".jpeg");
      rels[src] = { rid: "rIdImg" + (media.length + 1), name: name };
      media.push({ name: name, data: bytes });
    }

    let body = "";
    const sectFooter = [];
    if (doc.kind === "exam") {
      const L = doc.L;
      body += '<w:tbl><w:tblPr><w:tblW w:w="10205" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>' + NOBDR + '<w:tblLayout w:type="fixed"/>' +
        "<w:tblCellMar>" + mar(0, 0, 0, 0) + '</w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid><w:gridCol w:w="5102"/><w:gridCol w:w="5103"/></w:tblGrid>';
      L.pages.forEach(function (pg) {
        if (pg.first) {
          body += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="' + tw(L.T) + '" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="10205" w:type="dxa"/><w:gridSpan w:val="2"/>' +
            '<w:tcBorders><w:bottom w:val="single" w:sz="14" w:space="0" w:color="' + BLUE + '"/></w:tcBorders></w:tcPr>' + xItems(L.title, ctx) + "</w:tc></w:tr>";
        }
        body += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="' + tw(pg.colH) + '" w:hRule="atLeast"/></w:trPr>' +
          '<w:tc><w:tcPr><w:tcW w:w="5102" w:type="dxa"/><w:tcMar>' + mar(0, 0, 0, COL_PAD) + "</w:tcMar></w:tcPr>" + xItems(pg.cols[0], ctx) + "</w:tc>" +
          '<w:tc><w:tcPr><w:tcW w:w="5103" w:type="dxa"/><w:tcBorders><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tcBorders><w:tcMar>' +
          mar(0, COL_PAD_R, 0, 0) + "</w:tcMar></w:tcPr>" + xItems(pg.cols[1], ctx) + "</w:tc></w:tr>";
      });
      body += "</w:tbl>" + xPara(SP(1), ctx);
      sectFooter.push({ type: "default", xml: footerXml(examFooter(qz, doc.code, false)) }, { type: "first", xml: footerXml(examFooter(qz, doc.code, true)) });
    } else {
      doc.L.pages.forEach(function (pg, k) { body += xItems(pg.items, ctx, k ? { pbb: 1 } : null); });
      sectFooter.push({ type: "default", xml: footerXml(keyFooter(qz, doc.code)) });
    }
    const titlePg = sectFooter.some((f) => f.type === "first");
    const sect = "<w:sectPr>" + sectFooter.map((f, i) => '<w:footerReference w:type="' + f.type + '" r:id="rIdF' + (i + 1) + '"/>').join("") +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="794" w:right="850" w:bottom="794" w:left="850" w:header="397" w:footer="397" w:gutter="0"/>' +
      '<w:cols w:space="720"/>' + (titlePg ? "<w:titlePg/>" : "") + "</w:sectPr>";
    const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + NS + "><w:body>" + body + sect + "</w:body></w:document>";

    const enc = new TextEncoder();
    const add = (name, s) => files.push({ name: name, data: typeof s === "string" ? enc.encode(s) : s });
    add("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      sectFooter.map((f, i) => '<Override PartName="/word/footer' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>').join("") +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
    add("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    add("docProps/core.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + xesc(fileBase(doc)) + "</dc:title><dc:creator>KU MedQ</dc:creator></cp:coreProperties>");
    add("word/document.xml", docXml);
    add("word/styles.xml", stylesXml());
    add("word/settings.xml", settingsXml(titlePg));
    sectFooter.forEach((f, i) => add("word/footer" + (i + 1) + ".xml", f.xml));
    add("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      sectFooter.map((f, i) => '<Relationship Id="rIdF' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer' + (i + 1) + '.xml"/>').join("") +
      Object.keys(rels).map((k) => '<Relationship Id="' + rels[k].rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + rels[k].name + '"/>').join("") +
      "</Relationships>");
    media.forEach((m) => add("word/media/" + m.name, m.data));
    return zip(files);
  }

  // ---------- ZIP (압축 없이 저장) ----------
  const CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cd = [];
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let off = 0;
    files.forEach(function (f) {
      const nm = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
      h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
      c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + n;
    });
    const cdSize = cd.reduce((s, a) => s + a.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cd, [new Uint8Array(e.buffer)]), { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // ======================================================================
  // PDF 바로 받기 (2026-10-25 사용자 지시: 인쇄 창을 거치지 않고, 미리 만든 PDF를 올려 두지도 않고, 누를 때 만든다)
  // 미리보기 화면에 그려진 쪽을 그대로 읽어 벡터 PDF로 옮긴다: 글자 하나하나의 실제 위치, 배경·테두리 상자, 그림.
  // 글꼴: 이 컴퓨터의 맑은 고딕(Chrome 로컬 글꼴 허용) → 없으면 나눔고딕을 받아 넣는다(글자마다 위치를 따로 잡으므로 배치는 같다).
  // 라이브러리: vendor/pdf-lib.min.js, vendor/fontkit.umd.min.js (MIT, 처음 누를 때 불러온다)
  // ======================================================================
  const VENDOR = ["vendor/pdf-lib.min.js", "vendor/fontkit.umd.min.js"];
  // 대체 글꼴은 TTF여야 한다(pdf-lib은 OTF(CFF) 글꼴을 줄여 넣으면 깨진다) → 나눔고딕(OFL), google/fonts 커밋 고정
const NANUM = "https://cdn.jsdelivr.net/gh/google/fonts@e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nanumgothic/NanumGothic-";
  const SYM = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/";   // 기호용 보조 글꼴(DejaVu Sans, 자유 라이선스)
  const MG_ASC = 2229, MG_DESC = 495;   // 맑은 고딕 hhea(단위 2048): 글자 칸 높이 중 기준선 위치
  let libP = null, fontP = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement("script"); s.src = src;
      s.onload = res; s.onerror = function () { rej(new Error(src + "를 불러오지 못했습니다")); };
      document.head.appendChild(s);
    });
  }
  function pdfLibs() {
    if (!libP) libP = (async function () { for (const v of VENDOR) await loadScript(v); return { L: window.PDFLib, fk: window.fontkit }; })();
    libP.catch(function () { libP = null; });
    return libP;
  }
  // 버튼을 누른 바로 그때 불러야 한다(로컬 글꼴 허용 창은 사용자 클릭 직후에만 뜬다)
  function pdfFonts() {
    if (!fontP) fontP = (async function () {
      try {
        if (window.queryLocalFonts) {
          const fs = await window.queryLocalFonts({ postscriptNames: ["MalgunGothic", "MalgunGothicBold"] });
          const r = fs.find((f) => f.postscriptName === "MalgunGothic"), b = fs.find((f) => f.postscriptName === "MalgunGothicBold");
          if (r && b) return { name: "맑은 고딕", r: await (await r.blob()).arrayBuffer(), b: await (await b.blob()).arrayBuffer() };
        }
      } catch (e) { /* 허용하지 않음 → 나눔고딕 */ }
      const get = async function (w) {
        const res = await fetch(NANUM + w + ".ttf");
        if (!res.ok) throw new Error("글꼴을 받지 못했습니다(" + res.status + ")");
        return res.arrayBuffer();
      };
      const both = await Promise.all([get("Regular"), get("Bold")]);
      return { name: "나눔고딕", r: both[0], b: both[1] };
    })();
    fontP.catch(function () { fontP = null; });
    return fontP;
  }
  function cssColor(L, s) {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (v.length > 3 && v[3] === 0) return null;
    return L.rgb(v[0] / 255, v[1] / 255, v[2] / 255);
  }
  // pagesEl: 미리보기의 .qp-pages (지금 화면에 그려진 문서)
  async function makePdf(pagesEl, fontsP, progress, title) {
    const libs = await pdfLibs(), L = libs.L;
    const F = await fontsP;
    const pdf = await L.PDFDocument.create();
    pdf.registerFontkit(libs.fk);
    const fR = await pdf.embedFont(F.r, { subset: true }), fB = await pdf.embedFont(F.b, { subset: true });
    const has = (f, cp) => { try { return f.embedder.font.hasGlyphForCodePoint(cp); } catch (e) { return false; } };
    // 기본 글꼴에 없는 글자(그리스 문자·첨자·원 숫자 등)가 있으면 기호용 DejaVu Sans를 더 받는다. 그래도 없는 글자는 그림으로
    let sR = null, sB = null;
    const allText = pagesEl.textContent || "";
    const needSym = Array.from(new Set(Array.from(allText))).some((c) => c.trim() && !has(fR, c.codePointAt(0)));
    if (needSym) {
      try {
        const get = async (w) => { const r = await fetch(SYM + w + ".ttf"); if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); };
        const sb = await Promise.all([get("DejaVuSans"), get("DejaVuSans-Bold")]);
        sR = await pdf.embedFont(sb[0], { subset: true }); sB = await pdf.embedFont(sb[1], { subset: true });
      } catch (e) { /* 못 받으면 없는 글자는 그림으로 */ }
    }
    const charImg = {};
    async function glyphImage(ch, cs, wpx, hpx) {
      const key = ch + "|" + cs.fontWeight + "|" + cs.fontStyle + "|" + cs.color + "|" + Math.round(wpx * 10) + "|" + Math.round(hpx * 10);
      if (!charImg[key]) charImg[key] = (async function () {
        const S = 6, cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.ceil(wpx * S)); cv.height = Math.max(1, Math.ceil(hpx * S));
        const c = cv.getContext("2d");
        c.font = cs.fontStyle + " " + cs.fontWeight + " " + (parseFloat(cs.fontSize) * S) + "px " + cs.fontFamily;
        c.fillStyle = cs.color; c.textBaseline = "alphabetic";
        c.fillText(ch, 0, hpx * S * MG_ASC / (MG_ASC + MG_DESC));
        const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
        return pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
      })();
      return charImg[key];
    }
    const imgCache = {};
    async function embedImg(src) {
      if (!imgCache[src]) imgCache[src] = (async function () {
        const buf = new Uint8Array(await (await fetch(src)).arrayBuffer());
        return buf[0] === 0x89 && buf[1] === 0x50 ? pdf.embedPng(buf) : pdf.embedJpg(buf);
      })();
      return imgCache[src];
    }
    const pages = Array.from(pagesEl.querySelectorAll(".qp-pg"));
    await Promise.all(Array.from(pagesEl.querySelectorAll("img")).map((im) => im.decode ? im.decode().catch(() => {}) : null));
    const range = document.createRange();
    for (let pi = 0; pi < pages.length; pi++) {
      if (progress) progress(pi + 1, pages.length);
      const pgEl = pages[pi], page = pdf.addPage([PAGE_W, PAGE_H]);
      const pr = pgEl.getBoundingClientRect(), k = PAGE_W / pr.width;     // 화면 px → pt (미리보기 확대 비율과 무관)
      const X = (x) => (x - pr.left) * k, Y = (y) => PAGE_H - (y - pr.top) * k;
      // 1) 배경과 테두리, 그림 (문서 순서 = 바깥 상자부터)
      for (const el of pgEl.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) continue;
        if (el.tagName === "IMG") {
          try { const im = await embedImg(el.currentSrc || el.src); page.drawImage(im, { x: X(r.left), y: Y(r.bottom), width: r.width * k, height: r.height * k }); } catch (e) { /* 그림 하나 실패는 건너뛴다 */ }
          continue;
        }
        const bg = cssColor(L, cs.backgroundColor);
        if (bg && !(bg.red === 1 && bg.green === 1 && bg.blue === 1)) page.drawRectangle({ x: X(r.left), y: Y(r.bottom), width: r.width * k, height: r.height * k, color: bg });
        const side = function (w, st, c, x, y, ww, hh) {
          const wpt = parseFloat(w) * 0.75;
          if (!(wpt > 0) || st === "none" || st === "hidden") return;
          const color = cssColor(L, c); if (!color) return;
          page.drawRectangle({ x: x, y: y, width: ww === null ? wpt : ww, height: hh === null ? wpt : hh, color: color });
        };
        side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor, X(r.left), Y(r.top) - parseFloat(cs.borderTopWidth) * 0.75, r.width * k, null);
        side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor, X(r.left), Y(r.bottom), r.width * k, null);
        side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor, X(r.left), Y(r.bottom), null, r.height * k);
        side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor, X(r.right) - parseFloat(cs.borderRightWidth) * 0.75, Y(r.bottom), null, r.height * k);
      }
      // 2) 글자: 화면에 놓인 자리 그대로. 같은 줄에서 글꼴의 글자 폭대로 이어지면 한 덩어리로 쓴다
      const tw = document.createTreeWalker(pgEl, NodeFilter.SHOW_TEXT);
      let node, gap = null;              // 낱말 사이 띄어쓰기는 따로 떨어진 글자 조각이다 → 다음 덩어리 앞에 붙여 복사·검색 때 띄어쓰기가 남게 한다
      while ((node = tw.nextNode())) {
        const t = node.nodeValue;
        if (!t) continue;
        if (!t.trim()) {
          if (t.indexOf("\n") < 0) { range.selectNodeContents(node); const q = range.getClientRects()[0]; gap = q ? { x: X(q.left), base: Y(q.top + q.height * MG_ASC / (MG_ASC + MG_DESC)) } : null; }
          continue;
        }
        const cs = getComputedStyle(node.parentElement);
        if (cs.visibility === "hidden") continue;
        const size = parseFloat(cs.fontSize) * 0.75, bold = parseInt(cs.fontWeight, 10) >= 600;
        const main = bold ? fB : fR, sym = bold ? sB : sR;
        const color = cssColor(L, cs.color) || L.rgb(0, 0, 0), ital = cs.fontStyle === "italic";
        let run = "", rx = 0, ry = 0, nx = 0, rf = null;
        const flush = function () {
          if (run.trim()) page.drawText(run, { x: rx, y: ry, size: size, font: rf, color: color, xSkew: ital ? L.degrees(12) : undefined });
          run = "";
        };
        for (let i = 0; i < t.length;) {
          const cp = t.codePointAt(i), n = cp > 0xFFFF ? 2 : 1, ch = t.slice(i, i + n);
          range.setStart(node, i); range.setEnd(node, i + n); i += n;
          if (ch === "\n" || ch === "\t") { flush(); continue; }
          const rs = range.getClientRects();
          const rc = Array.from(rs).find((q) => q.width > 0) || rs[0];
          if (!rc) { flush(); continue; }
          const x = X(rc.left), base = Y(rc.top + rc.height * MG_ASC / (MG_ASC + MG_DESC));
          const font = !ch.trim() || has(main, cp) ? main : sym && has(sym, cp) ? sym : null;
          if (!font) {                                   // 어느 글꼴에도 없는 글자: 화면 모양을 그 자리에 그림으로
            flush(); gap = null;
            try { const im = await glyphImage(ch, cs, rc.width * k / 0.75, rc.height * k / 0.75); page.drawImage(im, { x: x, y: Y(rc.bottom), width: rc.width * k, height: rc.height * k }); } catch (e) { /* 건너뛴다 */ }
            continue;
          }
          if (run && font === rf && Math.abs(base - ry) < 0.3 && Math.abs(x - nx) < 0.4) run += ch;
          else {
            flush(); run = ch; rx = x; ry = base; nx = x; rf = font;
            if (gap && Math.abs(gap.base - base) < 0.5 && gap.x < x) { run = " " + ch; rx = x - font.widthOfTextAtSize(" ", size); }
          }
          gap = null;
          let w; try { w = font.widthOfTextAtSize(ch, size); } catch (e) { w = rc.width * k; }
          nx = x + w;
        }
        flush();
      }
      await new Promise((r) => setTimeout(r, 0));   // 화면이 멈추지 않게
    }
    if (title) pdf.setTitle(title);
    return { bytes: await pdf.save(), font: F.name };
  }

  function fileBase(doc) {
    const m = doc.meta;
    return m.name + " " + (doc.kind === "exam" ? "문제지" : "해설지") + (m.shuffle ? " (판 " + doc.code + ")" : "");
  }

  // ======================================================================
  // 화면: 미리보기 · 인쇄 · Word 받기
  // ======================================================================
  const CSS = `
.qp-font{font-family:${CSS_FONT},sans-serif;color:#000;font-kerning:none;font-variant-ligatures:none;font-feature-settings:"kern" 0,"liga" 0,"clig" 0;
  word-break:keep-all;overflow-wrap:break-word;white-space:pre-wrap;letter-spacing:0;font-weight:400;font-style:normal;
  -webkit-text-size-adjust:none;text-size-adjust:none;text-align:left;line-height:1}
.qp-font *{box-sizing:border-box}
.qp-meas{position:absolute;left:-30000px;top:0;visibility:hidden;pointer-events:none}
.qp-u{display:flow-root}
.qp-p>div{min-height:0}
.qp-w{white-space:nowrap}
.qp-t{position:relative}
.qp-tb{display:inline-block;text-indent:0;white-space:pre;vertical-align:baseline}
.qp-font sup{font-size:.65em;line-height:0;vertical-align:.45em}
.qp-box{display:flow-root}
.qp-gr{display:flex}
.qp-gc{display:flex;flex-direction:column;justify-content:center}
.qp-img{position:absolute;outline:.5pt solid #A6A6A6;max-width:none;display:block}
.qp-pg{position:relative;width:${PAGE_W}pt;height:${PAGE_H}pt;background:#fff;overflow:hidden}
.qp-body{position:absolute;left:${M_SIDE}pt;top:${M_TOP}pt;width:${BODY_W}pt}
.qp-title{box-shadow:inset 0 -1.75pt 0 #${BLUE};overflow:hidden}
.qp-cols{position:relative;display:flex}
.qp-col{flex:none}
.qp-sep{position:absolute;top:0;bottom:0;border-left:.5pt solid #000}
.qp-ft{position:absolute;left:${M_SIDE}pt;width:${BODY_W}pt;bottom:${M_FOOT}pt;height:12pt;line-height:12pt;color:#${GRAY};white-space:pre}
.qp-ft .l,.qp-ft .r{position:absolute;bottom:0;font-size:8pt}
.qp-ft .l{left:0}.qp-ft .r{right:${TW(10205 - 10176)}pt}
.qp-ft .c{position:absolute;bottom:0;left:${TW(5102)}pt;transform:translateX(-50%);font-size:9pt}
#qpRoot{position:fixed;inset:0;z-index:200;background:#3a3836;display:flex;flex-direction:column;color:#fff;font-family:var(--font,sans-serif)}
#qpRoot[hidden]{display:none}
.qp-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;background:#24221f;border-bottom:1px solid #000}
.qp-bar .ttl{font-weight:700;margin-right:auto;font-size:15px}
.qp-bar .seg{display:inline-flex;border:1px solid #6b6661;border-radius:9px;overflow:hidden}
.qp-bar .seg button{background:transparent;border:0;color:#ddd;padding:6px 12px;font-size:14px}
.qp-bar .seg button.on{background:#e9e4dd;color:#1d1b19;font-weight:700}
.qp-bar [hidden]{display:none!important}
.qp-bar .code{display:inline-flex;align-items:center;gap:6px;font-size:14px}
.qp-bar .code input{width:5.2em;font:inherit;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:5px 7px;border-radius:7px;border:1px solid #6b6661;background:#fff;color:#1d1b19}
.qp-bar .b{background:#e9e4dd;color:#1d1b19;border:0;border-radius:9px;padding:7px 12px;font-size:14px;font-weight:600}
.qp-bar .b.pri{background:#8b1e2d;color:#fff}
.qp-bar .b:disabled{opacity:.5}
.qp-msg{font-size:13px;color:#d8d2ca;padding:0 14px 8px;background:#24221f}
.qp-view{flex:1;overflow:auto;padding:18px 0}
.qp-pages{width:max-content;margin:0 auto}
.qp-pages .qp-pg{margin:0 auto 18px;box-shadow:0 2px 12px rgba(0,0,0,.5)}
@media print{
  @page{size:A4;margin:0}
  html,body{background:#fff!important;margin:0!important}
  body>*:not(#qpRoot){display:none!important}
  #qpRoot{position:static;display:block;background:#fff}
  .qp-bar,.qp-msg{display:none!important}
  .qp-view{overflow:visible;padding:0}
  .qp-pages{zoom:1!important;width:auto}
  .qp-pages .qp-pg{margin:0;box-shadow:none;break-after:page;page-break-after:always}
  .qp-pages .qp-pg:last-child{break-after:auto;page-break-after:auto}
  .qp-font{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;

  (function () { const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); })();
  let root = null, state = null;
  const LS = "mq_print_codes_v1";
  function savedCode(id) { try { return (JSON.parse(localStorage.getItem(LS) || "{}"))[id] || null; } catch (e) { return null; } }
  function saveCode(id, code) { try { const m = JSON.parse(localStorage.getItem(LS) || "{}"); m[id] = code; localStorage.setItem(LS, JSON.stringify(m)); } catch (e) { /* ignore */ } }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div"); root.id = "qpRoot"; root.hidden = true;
    root.innerHTML = '<div class="qp-bar"><span class="ttl"></span>' +
      '<span class="seg"><button type="button" data-k="exam">문제지</button><button type="button" data-k="key">해설지</button></span>' +
      '<label class="code">판 <input type="text" maxlength="4" spellcheck="false" autocomplete="off"></label>' +
      '<button type="button" class="b" data-a="new" title="선지를 새로 섞은 판">새 판</button>' +
      '<button type="button" class="b pri" data-a="print">인쇄</button>' +
      '<button type="button" class="b" data-a="pdf">PDF 받기</button>' +
      '<button type="button" class="b" data-a="docx">Word 파일</button>' +
      '<button type="button" class="b" data-a="close">닫기</button></div>' +
      '<div class="qp-msg"></div><div class="qp-view"><div class="qp-pages"></div></div>';
    document.body.appendChild(root);
    root.addEventListener("click", function (e) {
      const k = e.target.closest("[data-k]"), a = e.target.closest("[data-a]");
      if (k) { state.kind = k.dataset.k; render(); }
      else if (a && a.dataset.a === "new") { setCode(newCode()); render(); }
      else if (a && a.dataset.a === "print") doPrint();
      else if (a && a.dataset.a === "docx") doDocx();
      else if (a && a.dataset.a === "pdf") doPdf();
      else if (a && a.dataset.a === "close") close();
    });
    const inp = root.querySelector(".code input");
    inp.addEventListener("change", function () {
      const v = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (v.length === 4) { setCode(v); render(); } else inp.value = state.code;
    });
    document.addEventListener("keydown", function (e) { if (!root.hidden && e.key === "Escape") close(); });
    window.addEventListener("resize", fit);
    return root;
  }
  function setCode(c) { state.code = c; saveCode(state.id, c); root.querySelector(".code input").value = c; }
  function msg(t) { root.querySelector(".qp-msg").textContent = t || ""; }
  function busy(on) { root.querySelectorAll("[data-a=print],[data-a=docx],[data-a=pdf]").forEach((b) => { b.disabled = on; }); }
  function fit() {
    if (!root || root.hidden) return;
    const pages = root.querySelector(".qp-pages");
    const wpx = PAGE_W * 4 / 3, avail = root.querySelector(".qp-view").clientWidth - 24;
    pages.style.zoom = String(Math.min(1, avail / wpx));
  }

  async function render() {
    const s = state, my = ++s.seq;
    root.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.k === s.kind));
    busy(true); msg(s.kind === "key" ? "해설지를 만드는 중…" + (s.meta.type === "exam" ? "" : " (슬라이드 그림을 불러옵니다)") : "문제지를 만드는 중…");
    try {
      const doc = await build(s.id, s.kind, s.code);
      if (my !== s.seq) return;
      s.doc = doc;
      root.querySelector(".qp-pages").innerHTML = doc.html;
      fit();
      msg(doc.nPages + "쪽" + (s.meta.shuffle ? " · 판 " + s.code + " — 같은 판 번호로 만든 문제지와 해설지는 " +
        (s.meta.type === "mix" ? "문항과 " : "") + "선지 순서가 같습니다." : " — 기출은 선지를 섞지 않습니다."));
    } catch (e) {
      if (my === s.seq) msg("만들지 못했습니다: " + (e && e.message || e));
    }
    if (my === s.seq) busy(false);
  }

  // 인쇄 기록(관리자 화면): 누가 어떤 문서를 어떤 방식으로 만들었는지
  function logPrint(fmt) {
    if (window.QuizAuth) window.QuizAuth.logPrint({ quizId: state.id, title: state.meta.name, kind: state.kind, fmt: fmt, code: state.meta.shuffle ? state.code : null });
  }
  async function doPrint() {
    if (!state.doc) return;
    logPrint("print");
    const imgs = Array.from(root.querySelectorAll(".qp-pages img"));
    await Promise.all(imgs.map((im) => im.decode ? im.decode().catch(() => {}) : null));
    const t = document.title;
    document.title = fileBase(state.doc);
    const restore = function () { document.title = t; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    window.print();
    setTimeout(restore, 1500);
  }
  async function doDocx() {
    if (!state.doc) return;
    busy(true); msg("Word 파일을 만드는 중…");
    try {
      const blob = await makeDocx(state.doc);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileBase(state.doc) + ".docx";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      msg("Word 파일을 받았습니다: " + a.download);
      logPrint("docx");
    } catch (e) { msg("Word 파일을 만들지 못했습니다: " + (e && e.message || e)); }
    busy(false);
  }
  async function doPdf() {
    if (!state.doc) return;
    const fontsP = pdfFonts();          // 클릭 바로 그때 시작해야 로컬 글꼴 허용 창이 뜬다
    busy(true); msg("PDF를 만드는 중…");
    try {
      const out = await makePdf(root.querySelector(".qp-pages"), fontsP, function (i, n) { msg("PDF를 만드는 중… " + i + " / " + n + "쪽"); }, fileBase(state.doc));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([out.bytes], { type: "application/pdf" }));
      a.download = fileBase(state.doc) + ".pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      msg("PDF를 받았습니다: " + a.download + (out.font === "맑은 고딕" ? "" : " (이 컴퓨터의 맑은 고딕을 쓸 수 없어 " + out.font + " 글꼴로 만들었습니다)"));
      logPrint("pdf");
    } catch (e) { msg("PDF를 만들지 못했습니다: " + (e && e.message || e)); }
    busy(false);
  }
  function close() { root.hidden = true; root.querySelector(".qp-pages").innerHTML = ""; document.body.style.overflow = ""; }

  function open(quizId) {
    const m = docMeta(quizId);
    if (!m) return;
    ensureRoot();
    state = { id: quizId, meta: m, kind: "exam", code: savedCode(quizId) || newCode(), seq: 0, doc: null };
    saveCode(quizId, state.code);
    root.querySelector(".ttl").textContent = m.subject + " · " + (m.type === "lecture" ? m.qz.week + " " + m.qz.title : m.head);
    root.querySelector(".code input").value = state.code;
    // 기출은 섞지 않으므로 판 번호가 필요 없다
    root.querySelector(".code").hidden = !m.shuffle;
    root.querySelector("[data-a=new]").hidden = !m.shuffle;
    root.hidden = false;
    document.body.style.overflow = "hidden";
    render();
  }

  window.QuizPrint = {
    open: open,
    // 테스트용: 화면 없이 문서를 만들고 HTML·docx를 돌려준다
    _build: build,
    _docx: async function (quizId, kind, code) { const d = await build(quizId, kind, code); const b = await makeDocx(d); return new Uint8Array(await b.arrayBuffer()); },
    _css: CSS
  };
})();
