// デモの状態・計算(画面に触らない)。ブラウザでは window.QBDemo、node では module.exports に出す。
// 日付計算は ../date-core.js(window.QBDate)を使う。ここでは日付の計算ルールを新しく作らない。
(function () {
const core = (typeof window !== "undefined" && window.QBDate) ? window.QBDate : require("../date-core.js");
const { fmt, parse, addDays, dateOnly, diffDays, renewalRows, filingDate } = core;

const STAFF = ["東", "西", "南"];
const KIND_LABEL = { renewal: "更新", annual: "決算変更届", keishin: "経審", bizreport: "事業報告書", results: "事業実績報告書" };
const FILING_ID = { annual: "construction_annual", keishin: "construction_keishin", bizreport: "cargo_business_report", results: "cargo_results_report" };
const MILESTONE_LABEL = {
  annual: "決算変更届の期限", keishin: "経審の結果通知の有効期間の末日（目安）",
  bizreport: "事業報告書の期限", results: "事業実績報告書の期日",
};
const STATUS_CODES = ["todo", "wip", "done"];
const statusLabel = (kind, code) => code === "todo" ? "未着手" : code === "wip" ? "準備中" : (kind === "keishin" ? "受審済" : "提出済");
const DOC_STATE_LABEL = { none: "未依頼", req: "依頼済", rep: "届けた連絡あり", recv: "受領済", skip: "使わない" };

// ---- 日付の入力 ----
// 実在する YYYY-MM-DD だけを Date にする(2027-02-30 のように読んで書き戻すと別の日になる値は不正)
function parseStrict(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = parse(s);
  return fmt(d) === s ? d : null;
}
// ?today=YYYY-MM-DD があれば今日を差し替える(不正なら無視して端末の日付)
function todayFromQuery(search, now) {
  let v = null;
  try { v = new URLSearchParams(search || "").get("today"); } catch (e) { v = null; }
  const d = parseStrict(v);
  return d || dateOnly(now || new Date());
}

// ---- 手続の種類 ----
// その許認可に作れる手続の種類。更新は有効期間のある許可だけ。届出は filings の license_ids に含まれるものだけ(一般貨物には更新の行を作らない)
function kindsFor(l, filings) {
  const kinds = [];
  if (l.valid_renewal) kinds.push("renewal");
  for (const [kind, fid] of Object.entries(FILING_ID)) {
    const f = (filings || []).find(x => x.filing_id === fid);
    if (f && f.kind === "periodic" && f.license_ids.includes(l.id)) kinds.push(kind);
  }
  return kinds;
}

// ---- 次の節目 ----
// rows = renewalRows の結果。{key,label,d,days,flag,past,noDeadline,expired}
function nextMilestone(rows, today) {
  const by = k => rows.find(r => r.key === k);
  const flag = r => !(r.status === "confirmed" || !r.status);
  const mk = (r, extra) => Object.assign({ key: r.key, label: r.label, d: r.d, days: diffDays(r.d, today), flag: flag(r), past: [], noDeadline: false, expired: false }, extra);
  const ls = by("local_start"), ws = by("law_start");
  const start = (ls && ls.d) ? ls : (ws && ws.d ? ws : null);
  // 期限の候補は法令を先に置き、厳密に早いほうだけが取って代わる(同じ日なら法令のほう)
  let dl = null;
  const dls = [by("law_deadline"), by("local_deadline")].filter(r => r && r.d);
  for (const r of dls) if (!dl || r.d < dl.d) dl = r;
  const noDeadline = dls.length === 0;
  const exp = by("expiry");
  if (start && today < start.d) return mk(start, { noDeadline });
  if (dl && today <= dl.d) return mk(dl, { noDeadline });
  if (today <= exp.d) {
    const past = dls.filter(r => r.d < today).map(r => ({ label: r.label, days: diffDays(today, r.d) }));
    return mk(exp, { past, noDeadline });
  }
  return mk(exp, { expired: true, noDeadline });
}

// ---- 架空データ ----
function seed(today, rules) {
  const T = n => fmt(addDays(today, n));
  const L = id => rules.licenses.find(l => l.id === id);
  const locOf = (id, auth) => rules.local.find(r => r.license_id === id && r.authority === auth) || null;
  const filingOf = fid => rules.filings.find(f => f.filing_id === fid);
  // f(x) が target 以上になる最初の x を 1 日ずつ探す(月単位の決まりは日数で置けないので前向きに計算する)
  function search(startDate, f, target) {
    let x = startDate;
    for (let i = 0; i < 900; i++) { const v = f(x); if (v && v >= target) return x; x = addDays(x, 1); }
    throw new Error("seed: 日付が見つからない");
  }
  const expFor = (licId, auth, key, n) => {
    const l = L(licId), loc = locOf(licId, auth), target = addDays(today, n);
    return fmt(search(target, e => { const r = renewalRows(l, loc, e).find(x => x.key === key); return r && r.d; }, target));
  };
  const fyFor = (fid, n) => {
    const f = filingOf(fid), target = addDays(today, n);
    return fmt(search(addDays(target, -130), fy => filingDate(f, fy, today).d, target));
  };

  const clients = [
    { id: "c1", name: "A社", industry: "建設" }, { id: "c2", name: "B社", industry: "建設" },
    { id: "c3", name: "C社", industry: "建設" }, { id: "c4", name: "D社", industry: "不動産" },
    { id: "c5", name: "E社", industry: "産廃収集運搬" }, { id: "c6", name: "F社", industry: "電気工事" },
    { id: "c7", name: "G社", industry: "運送" }, { id: "c8", name: "H社", industry: "解体" },
  ];
  const TOKYO = "東京都";
  const annualA = fyFor("construction_annual", 40);
  const licenses = [
    { id: "l1", client: "c1", licenseId: "construction", authority: TOKYO, exp: expFor("construction", TOKYO, "local_start", 5), fy: annualA },
    { id: "l2", client: "c2", licenseId: "construction", authority: "大阪府", exp: T(42), fy: fyFor("construction_annual", -20) },
    { id: "l3", client: "c3", licenseId: "construction", authority: "国土交通大臣(関東地方整備局)", exp: T(160), fy: fyFor("construction_annual", -4) },
    { id: "l4", client: "c4", licenseId: "takken", authority: "福岡県", exp: T(27) },
    { id: "l5", client: "c5", licenseId: "sanpai_collect", authority: "愛知県", exp: expFor("sanpai_collect", "愛知県", "local_deadline", 9) },
    { id: "l6", client: "c5", licenseId: "sanpai_collect", authority: TOKYO, exp: expFor("sanpai_collect", TOKYO, "local_start", 20) },
    { id: "l7", client: "c5", licenseId: "sanpai_collect", authority: "長野県", exp: T(200) },
    { id: "l8", client: "c6", licenseId: "electrical", authority: TOKYO, exp: T(33) },
    { id: "l9", client: "c7", licenseId: "cargo_general", authority: L("cargo_general").authority, fy: T(-82) },
    { id: "l10", client: "c8", licenseId: "demolition", authority: "長野県", exp: T(55) },
  ];
  licenses.forEach(lc => { lc.number = "（架空）第 00000 号"; });

  const P = (n, lc, kind, status, staff, log, extra) => Object.assign({ id: "p" + n, lc, kind, status, staff, filedOn: null, target: null, log }, extra || {});
  const procs = [
    P(1, "l1", "renewal", "todo", "東", [{ d: T(-9), who: "東", text: "満了日を台帳に登録" }]),
    P(2, "l1", "annual", "wip", "西", [{ d: T(-12), who: "西", text: "決算日を台帳に登録" }, { d: T(-8), who: "西", text: "書類 1 点を依頼" }]),
    P(3, "l1", "keishin", "todo", "東", [{ d: T(-12), who: "東", text: "経審を受ける予定を台帳に登録" }]),
    P(4, "l2", "renewal", "wip", "西", [{ d: T(-14), who: "西", text: "書類 3 点を依頼" }, { d: T(-6), who: "西", text: "B社の担当者に電話で確認" }]),
    P(5, "l2", "annual", "done", "西", [{ d: T(-45), who: "西", text: "書類 1 点を依頼" }, { d: T(-30), who: "西", text: "提出済として記録（提出は事務所）" }], { filedOn: T(-30) }),
    P(6, "l3", "renewal", "todo", "東", [{ d: T(-20), who: "東", text: "満了日を台帳に登録" }]),
    P(7, "l3", "annual", "todo", "南", [{ d: T(-15), who: "南", text: "C社の担当者に決算書の準備を確認" }]),
    P(8, "l4", "renewal", "wip", "東", [{ d: T(-10), who: "東", text: "D社に更新の意向を確認" }]),
    P(9, "l5", "renewal", "wip", "南", [{ d: T(-7), who: "南", text: "愛知県の手引の期限を確認" }]),
    P(10, "l6", "renewal", "todo", "南", [{ d: T(-5), who: "南", text: "満了日を台帳に登録" }]),
    P(11, "l7", "renewal", "todo", "南", [{ d: T(-5), who: "南", text: "満了日を台帳に登録" }]),
    P(12, "l8", "renewal", "todo", "西", [{ d: T(-4), who: "西", text: "満了日を台帳に登録" }]),
    P(13, "l9", "bizreport", "wip", "東", [{ d: T(-6), who: "東", text: "G社に決算書の準備を依頼" }]),
    P(14, "l9", "results", "todo", "東", [{ d: T(-6), who: "東", text: "実績の集計を G社に依頼する予定" }], { target: fmt(core.nextCargoResults(today)) }),
    P(15, "l10", "renewal", "todo", "南", [{ d: T(-3), who: "南", text: "満了日を台帳に登録" }]),
  ];
  // 許可の種類ごとに作れない手続は作らない(seed 自体が仕様の確認になる)
  const kindOk = procs.filter(p => {
    const lc = licenses.find(x => x.id === p.lc);
    return kindsFor(L(lc.licenseId), rules.filings).includes(p.kind);
  });

  const state = { v: 1, base: fmt(today), nextId: 1, office: "（架空）サンプル行政書士事務所", staff: STAFF.slice(), clients, licenses, procs: kindOk, docs: [] };

  // 書類: 手引に記載の書類のうち、この手続の行を seq の順に未依頼で作り、最初の状態を当てる
  for (const p of state.procs) {
    for (const d of docGroup(rules, state, p)) {
      state.docs.push({ id: p.id + ":" + d.doc_id, procId: p.id, docId: d.doc_id, seq: d.seq, custom: false, name: "", state: "none", due: "", reqOn: "", repOn: "", recvOn: "" });
    }
  }
  const setDoc = (procId, seq, st, f) => { const d = state.docs.find(x => x.procId === procId && x.seq === seq); if (d) Object.assign(d, { state: st }, f); };
  // A社・B社は法人。決算変更届では法人の納税証明書だけを使い、個人の書類は「使わない」にする。
  // 受領済・依頼済・期日超過・届けた連絡ありが最初の画面に出るように割り当てる
  setDoc("p2", 1, "req", { reqOn: T(-8), due: T(7) });
  state.docs.filter(d => d.procId === "p2" && d.seq !== 1).forEach(d => { d.state = "skip"; });
  setDoc("p4", 1, "recv", { reqOn: T(-14), due: T(-4), recvOn: T(-9) });
  setDoc("p4", 2, "req", { reqOn: T(-14), due: T(-2) });
  setDoc("p4", 3, "rep", { reqOn: T(-14), due: T(2), repOn: T(-1) });
  setDoc("p5", 1, "recv", { reqOn: T(-45), due: T(-35), recvOn: T(-40) });
  state.docs.filter(d => d.procId === "p5" && d.state === "none").forEach(d => { d.state = "skip"; });
  return state;
}

// その手続の「手引に記載の書類（例）」(rules.documents を seq の順に)
function docGroup(rules, state, proc) {
  const lc = state.licenses.find(x => x.id === proc.lc);
  const procedure = proc.kind === "renewal" ? "renewal" : proc.kind === "annual" ? "annual" : null;
  if (!procedure) return [];
  return (rules.documents || []).filter(d => d.license_id === lc.licenseId && d.procedure === procedure && d.authority === lc.authority)
    .slice().sort((a, b) => a.seq - b.seq);
}
// 画面に出す書類の行(手引の行と事務所が足した行)
function docsOf(rules, state, procId) {
  return state.docs.filter(d => d.procId === procId).map(d => {
    const src = d.custom ? null : (rules.documents || []).find(x => x.doc_id === d.docId);
    return { doc: d, name: d.custom ? d.name : (src ? src.document_name : d.docId), src };
  }).sort((a, b) => a.doc.seq - b.doc.seq);
}

// ---- 一覧の行 ----
function procView(rules, state, proc, today) {
  const lc = state.licenses.find(x => x.id === proc.lc);
  const client = state.clients.find(x => x.id === lc.client);
  const l = rules.licenses.find(x => x.id === lc.licenseId);
  const loc = rules.local.find(r => r.license_id === lc.licenseId && r.authority === lc.authority) || null;
  const v = { proc, lc, client, l, loc, rows: null, filing: null, milestone: null, done: proc.status === "done", keishin: proc.kind === "keishin" };
  if (proc.kind === "renewal") {
    v.rows = renewalRows(l, loc, parseStrict(lc.exp));
    v.milestone = nextMilestone(v.rows, today);
  } else {
    const f = rules.filings.find(x => x.filing_id === FILING_ID[proc.kind]);
    const fd = filingDate(f, parseStrict(lc.fy), today);
    const d = proc.kind === "results" ? parseStrict(proc.target) : fd.d;
    // 事業実績報告書は手続ごとの期日(target)で数える。過ぎたまま未提出なら「直近の期日」の注は合わない
    const note = proc.kind === "results" && proc.status !== "done" && d < today
      ? `毎年 7 月 10 日（前年 4 月 1 日〜3 月 31 日分）。この回の期日 ${fmt(d)} を過ぎています。提出したら状態を提出済にしてください`
      : fd.note;
    v.filing = { f, d, note };
    v.milestone = { key: proc.kind, label: MILESTONE_LABEL[proc.kind], d, days: diffDays(d, today), flag: false, past: [], noDeadline: false, expired: false };
  }
  const m = v.milestone;
  v.overdue = !v.done && !v.keishin && (proc.kind === "renewal" ? (m.past.length > 0 || m.expired) : m.days < 0);
  v.soon = !v.done && m.days >= 0 && m.days <= 30;
  const docs = state.docs.filter(d => d.procId === proc.id);
  v.docAsked = docs.filter(d => d.state === "req" || d.state === "rep" || d.state === "recv").length;
  v.docRecv = docs.filter(d => d.state === "recv").length;
  return v;
}
// 次の節目の早い順。提出済(受審済)の行は下にまとめる
function buildViews(rules, state, today) {
  const views = state.procs.map(p => procView(rules, state, p, today));
  const num = v => Number(v.proc.id.slice(1));
  views.sort((a, b) => (a.done - b.done) || (a.milestone.d - b.milestone.d) || (num(a) - num(b)));
  return views;
}
function summarize(views, state, today) {
  return {
    soon: views.filter(v => v.soon).length,
    overdue: views.filter(v => v.overdue).length,
    docsOverdue: state.docs.filter(d => d.state === "req" && parseStrict(d.due) && diffDays(parseStrict(d.due), today) < 0).length,
  };
}
const ymOf = d => fmt(d).slice(0, 7);
function filterViews(views, f) {
  f = f || {};
  return views.filter(v => (!f.client || v.client.id === f.client) && (!f.licenseId || v.lc.licenseId === f.licenseId)
    && (!f.staff || v.proc.staff === f.staff) && (!f.status || v.proc.status === f.status)
    && (!f.ym || (!v.done && ymOf(v.milestone.d) === f.ym)));
}
const colOf = kind => kind === "renewal" ? "renewal" : kind === "annual" ? "annual" : kind === "keishin" ? "keishin" : "report";
// 今月から 12 か月。数えるのは一覧と同じ「次の節目」の日付。提出済・受審済は除く
function monthly(views, today) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const t = new Date(today.getFullYear(), today.getMonth() + i, 1);
    months.push({ ym: ymOf(t), renewal: 0, annual: 0, keishin: 0, report: 0, total: 0 });
  }
  for (const v of views) {
    if (v.done) continue;
    const m = months.find(x => x.ym === ymOf(v.milestone.d));
    if (m) { m[colOf(v.proc.kind)]++; m.total++; }
  }
  return months;
}

// ---- 日付ずらしと年の切り替え ----
const DATE_KEYS = ["exp", "fy", "filedOn", "d", "due", "reqOn", "repOn", "recvOn"];
// 状態の中の日付を全部(today − 基準日)日だけずらす。事業実績報告書の target(暦の 7 月 10 日)はずらさない
function shiftState(state, today) {
  const s = JSON.parse(JSON.stringify(state));
  const n = diffDays(today, parse(s.base));
  const sh = v => (v ? fmt(addDays(parse(v), n)) : v);
  if (n !== 0) {
    s.licenses.forEach(x => { DATE_KEYS.forEach(k => { if (k in x) x[k] = sh(x[k]); }); });
    s.procs.forEach(p => { p.filedOn = sh(p.filedOn); p.log.forEach(e => { e.d = sh(e.d); }); });
    s.docs.forEach(d => { ["due", "reqOn", "repOn", "recvOn"].forEach(k => { d[k] = sh(d[k]); }); });
  }
  s.base = fmt(today);
  return normalize(s, today);
}
// 事業実績報告書: 今日が対象の期日を過ぎ、提出済なら翌年の 7 月 10 日に進めて未着手に戻す(記録は残す)
function normalize(state, today) {
  for (const p of state.procs) {
    if (p.kind !== "results") continue;
    const t = parseStrict(p.target);
    if (t && today > t && p.status === "done") {
      const old = fmt(t);
      p.target = fmt(new Date(t.getFullYear() + 1, 6, 10));
      p.status = "todo"; p.filedOn = null;
      p.log.push({ d: fmt(today), who: "自動記録", text: `${old} が期日の分は提出済。翌年分に切り替え` });
    }
  }
  return state;
}
// sessionStorage の文字列から状態を戻す。読めない・形が違う・知らない許認可を含むときは seed(今日)
function restore(raw, rules, today) {
  try {
    const s = JSON.parse(raw);
    const ok = s && s.v === 1 && parseStrict(s.base) && Array.isArray(s.clients) && Array.isArray(s.licenses) && Array.isArray(s.procs) && Array.isArray(s.docs)
      && s.licenses.every(x => rules.licenses.some(l => l.id === x.licenseId)) && s.procs.every(p => s.licenses.some(x => x.id === p.lc) && Array.isArray(p.log));
    if (ok) return { state: shiftState(s, today), dirty: true };
  } catch (e) { /* seed に落とす */ }
  return { state: seed(today, rules), dirty: false };
}

// ---- 操作(状態を直接書き換える。{ok, error} を返す) ----
const NEED_DATE = "日付を入れてください";
const find = (arr, id) => arr.find(x => x.id === id);
const log = (p, today, who, text) => { p.log.push({ d: fmt(today), who, text }); };
// 新しい順(同じ日は後に足したほうが上)
const sortedLog = p => p.log.map((e, i) => ({ e, i })).sort((a, b) => (a.e.d < b.e.d ? 1 : a.e.d > b.e.d ? -1 : b.i - a.i)).map(x => x.e);

function setStaff(state, procId, staff, today) {
  const p = find(state.procs, procId);
  if (!p || !state.staff.includes(staff)) return { ok: false, error: "担当者を選んでください" };
  if (p.staff !== staff) { log(p, today, "事務所", `担当者を ${p.staff} から ${staff} に変更`); p.staff = staff; }
  return { ok: true };
}
function setStatus(state, procId, code, today) {
  const p = find(state.procs, procId);
  if (!p || !STATUS_CODES.includes(code)) return { ok: false, error: "状態を選んでください" };
  if (p.status !== code) {
    log(p, today, "事務所", `状態を「${statusLabel(p.kind, p.status)}」から「${statusLabel(p.kind, code)}」に変更`);
    p.status = code; p.filedOn = code === "done" ? fmt(today) : null;
  }
  return { ok: true };
}
function setFiledOn(state, procId, str, today) {
  const p = find(state.procs, procId);
  if (!p || p.status !== "done") return { ok: false, error: NEED_DATE };
  if (!parseStrict(str)) return { ok: false, error: NEED_DATE };
  if (p.filedOn !== str) { log(p, today, "事務所", `${p.kind === "keishin" ? "受審日" : "提出日"}を ${p.filedOn} から ${str} に変更`); p.filedOn = str; }
  return { ok: true };
}
// field = "exp"(満了日) か "fy"(決算日)。空・不正のときは何も変えない
function setDate(state, procId, field, str, today) {
  const p = find(state.procs, procId);
  if (!p || (field !== "exp" && field !== "fy")) return { ok: false, error: NEED_DATE };
  if (!parseStrict(str)) return { ok: false, error: NEED_DATE };
  const lc = find(state.licenses, p.lc);
  if (lc[field] !== str) {
    log(p, today, "事務所", `${field === "exp" ? "満了日" : "決算日"}を ${lc[field]} から ${str} に変更`);
    lc[field] = str;
  }
  return { ok: true };
}
function addNote(state, procId, who, text, today) {
  const p = find(state.procs, procId);
  const t = String(text || "").trim();
  if (!p || !state.staff.includes(who)) return { ok: false, error: "担当者を選んでください" };
  if (!t) return { ok: false, error: "記録の文を入れてください" };
  if (t.length > 200) return { ok: false, error: "200 字までです" };
  log(p, today, who, t);
  return { ok: true };
}

const docName = (rules, state, d) => (d.custom ? d.name : ((rules.documents || []).find(x => x.doc_id === d.docId) || {}).document_name || d.docId);
function docOp(state, rules, id, today, fn) {
  const d = find(state.docs, id); if (!d) return { ok: false, error: "書類が見つかりません" };
  const p = find(state.procs, d.procId);
  return fn(d, p, docName(rules, state, d)) || { ok: true };
}
const clear = d => { d.due = ""; d.reqOn = ""; d.repOn = ""; d.recvOn = ""; };
const docs = {
  request(state, rules, id, dueStr, today) {
    return docOp(state, rules, id, today, (d, p, name) => {
      if (d.state !== "none") return { ok: false, error: "すでに依頼済みです" };
      if (!parseStrict(dueStr)) return { ok: false, error: NEED_DATE };
      d.state = "req"; d.due = dueStr; d.reqOn = fmt(today);
      log(p, today, "事務所", `書類「${name}」を依頼（期日 ${dueStr}）`);
    });
  },
  skip(state, rules, id, today) {
    return docOp(state, rules, id, today, (d, p, name) => { if (d.state !== "none") return { ok: false, error: "未依頼の書類だけです" }; d.state = "skip"; log(p, today, "事務所", `書類「${name}」をこの案件では使わないことにした`); });
  },
  unskip(state, rules, id, today) {
    return docOp(state, rules, id, today, (d, p, name) => { if (d.state !== "skip") return { ok: false }; d.state = "none"; log(p, today, "事務所", `書類「${name}」を未依頼に戻した`); });
  },
  cancel(state, rules, id, today) {
    return docOp(state, rules, id, today, (d, p, name) => { if (d.state !== "req") return { ok: false }; d.state = "none"; clear(d); log(p, today, "事務所", `書類「${name}」の依頼を取り消した`); });
  },
  report(state, rules, id, today) {
    return docOp(state, rules, id, today, (d, p, name) => { if (d.state !== "req") return { ok: false }; d.state = "rep"; d.repOn = fmt(today); log(p, today, "顧問先", `書類「${name}」を届けたと連絡`); });
  },
  unreport(state, rules, id, today) {
    return docOp(state, rules, id, today, (d, p, name) => { if (d.state !== "rep") return { ok: false }; d.state = "req"; d.repOn = ""; log(p, today, "事務所", `書類「${name}」は届いていないため依頼済に戻した`); });
  },
  confirm(state, rules, id, today) {
    return docOp(state, rules, id, today, (d, p, name) => { if (d.state !== "req" && d.state !== "rep") return { ok: false }; d.state = "recv"; d.recvOn = fmt(today); log(p, today, "事務所", `書類「${name}」の受領を確認`); });
  },
  revert(state, rules, id, today) {
    return docOp(state, rules, id, today, (d, p, name) => { if (d.state !== "recv") return { ok: false }; d.state = "req"; d.recvOn = ""; log(p, today, "事務所", `書類「${name}」を依頼済に戻した`); });
  },
  add(state, rules, procId, name, today) {
    const p = find(state.procs, procId); const t = String(name || "").trim();
    if (!p) return { ok: false, error: "手続が見つかりません" };
    if (!t) return { ok: false, error: "書類の名前を入れてください" };
    if (t.length > 40) return { ok: false, error: "40 字までです" };
    const seq = 1000 + state.nextId;
    state.docs.push({ id: `${procId}:c${state.nextId}`, procId, docId: "", seq, custom: true, name: t, state: "none", due: "", reqOn: "", repOn: "", recvOn: "" });
    state.nextId++;
    log(p, today, "事務所", `書類「${t}」を追加`);
    return { ok: true };
  },
};

const QBDemo = {
  STAFF, KIND_LABEL, FILING_ID, STATUS_CODES, DOC_STATE_LABEL, statusLabel,
  parseStrict, todayFromQuery, kindsFor, nextMilestone, seed, docGroup, docsOf, procView, buildViews, summarize, filterViews, monthly,
  shiftState, normalize, restore, sortedLog, setStaff, setStatus, setFiledOn, setDate, addNote, docs, docName,
};
if (typeof window !== "undefined") window.QBDemo = QBDemo;
if (typeof module !== "undefined") module.exports = QBDemo;
})();
