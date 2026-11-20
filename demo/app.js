// デモの画面。状態・計算は model.js(window.QBDemo)に置き、ここは描画と操作だけ。
// 利用者が入れた文字・rules.json の文字は textContent で入れる(HTML の文字列は組み立てない)。
(function () {
"use strict";
const M = window.QBDemo, C = window.QBDate;
const { fmt, parse, addDays, diffDays } = C;
const KEY = "qb-demo-state-v1";
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const $ = id => document.getElementById(id);

let RULES = null, state = null, dirty = false;
let role = "office", clientSel = "c1";
const ui = { filters: { client: "", licenseId: "", staff: "", status: "", ym: "" }, err: null, flash: "", focusKey: null, noteWho: "" };

// ---- 要素を作る(文字は textContent) ----
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  const add = k => {
    if (k === null || k === undefined || k === false) return;
    if (Array.isArray(k)) { k.forEach(add); return; }
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}

// ---- 日付・文言 ----
const show = d => d ? `${fmt(d)}（${WEEK[d.getDay()]}）` : "";
const showS = s => { const d = M.parseStrict(s); return d ? show(d) : (s || ""); };
function remText(days, keishin) {
  if (keishin) return days > 0 ? `末日（目安）まで ${days} 日` : days === 0 ? "今日が末日（目安）" : `末日（目安）を ${-days} 日過ぎ`;
  return days > 0 ? `あと ${days} 日` : days === 0 ? "今日" : `${-days} 日過ぎ`;
}
const rem = (days, keishin) => h("span", { class: "rem" + (days < 0 && !keishin ? " over" : days >= 0 && days <= 7 && !keishin ? " near" : "") }, remText(days, keishin));
const tag = (t, cls) => h("span", { class: "tag" + (cls ? " " + cls : "") }, t);
const flagTag = row => (row && row.status && row.status !== "confirmed") ? tag("要確認") : null;
const licName = id => (RULES.licenses.find(l => l.id === id) || {}).name || id;
const KL = k => M.KIND_LABEL[k];

function srcCell(quote, url, retrieved) {
  return h("span", { class: "src" }, quote || "", url ? [" ", h("a", { href: url, target: "_blank", rel: "noopener" }, "出典")] : null, retrieved ? `（確認 ${retrieved}）` : "");
}

// 表。cols = 見出しの配列。rows = 各行のセル配列(要素または文字)。狭い幅ではカード表示になる
function table(cols, rows, opts) {
  opts = opts || {};
  return h("div", { class: "tbl cards-sm" }, h("table", { class: opts.wide ? "wide" : null },
    h("thead", null, h("tr", null, cols.map(c => h("th", { scope: "col" }, c)))),
    h("tbody", null, rows.map(r => {
      const tr = h("tr", { class: r.cls || null, "data-key": r.key || null, tabindex: r.key ? "-1" : null });
      r.cells.forEach((c, i) => {
        const td = h("td", { "data-th": cols[i], class: (r.tdClass && r.tdClass[i]) || null }, c);
        tr.appendChild(td);
      });
      return tr;
    }))));
}

// ---- 状態の保存 ----
function today() { return M.todayFromQuery(location.search, new Date()); }
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 使えないときはメモリだけで動かす */ } }
// 開いたまま日付をまたいだら、次の操作のときにずらす(タイマーは置かない)
function ensure() {
  const t = today();
  if (state.base !== fmt(t)) {
    if (dirty) { state = M.shiftState(state, t); save(); } else state = M.seed(t, RULES);
  }
  return t;
}
function mutate(fn, focusKey) {
  const t = ensure();
  ui.err = null; ui.flash = "";
  const res = fn(state, t) || { ok: true };
  if (res.ok) { dirty = true; save(); }
  ui.focusKey = focusKey || null;
  render();
  return res;
}

// ---- ルーティング ----
function route() {
  const hs = (location.hash || "#list").slice(1).split("/");
  let name = hs[0] || "list";
  if (!["list", "detail", "docs", "months", "import"].includes(name)) name = "list";
  if (role === "client") name = "docs";
  return { name, arg: hs[1] || "" };
}
const TABS = [["list", "① 期限一覧"], ["docs", "② 書類の回収"], ["months", "③ 今後 12 か月"], ["import", "④ 顧問先一覧の取込"]];
function renderTabs(r) {
  const nav = $("tabs"); nav.replaceChildren();
  if (role === "client") { nav.hidden = true; return; }
  nav.hidden = false;
  const cur = r.name === "detail" ? "list" : r.name;
  TABS.forEach(([n, t]) => nav.appendChild(h("a", { href: "#" + n, "aria-current": n === cur ? "page" : null }, t)));
}

// ---- 一覧 ----
const clientName = c => `${c.name}（${c.industry}）`;
function milestoneCell(v) {
  const m = v.milestone;
  if (v.done) {
    return [h("strong", null, `${M.statusLabel(v.proc.kind, "done")}（${v.proc.filedOn}）`), h("span", { class: "mini" }, m.label)];
  }
  const out = [h("strong", null, m.expired ? "満了日" : m.label), flagTag(v.rows ? v.rows.find(r => r.key === m.key) : null) || (m.flag ? tag("要確認") : null),
    h("span", { class: "mini d" }, show(m.d)),
    h("span", { class: "mini" }, m.expired ? h("span", { class: "rem over" }, `満了日を ${-m.days} 日過ぎ`) : rem(m.days, v.keishin))];
  m.past.forEach(p => out.push(h("span", { class: "mini" }, h("span", { class: "rem over" }, `${p.label}を ${p.days} 日過ぎ`))));
  if (m.noDeadline) out.push(h("span", { class: "mini" }, "手引に期限の記載なし（要確認）"));
  return out;
}
function dateLine(name, row) {
  if (!row) return h("span", { class: "mini" }, `${name} `, h("b", null, "—"));
  return h("span", { class: "mini" }, `${name} `, h("b", { class: row.d ? "d" : null }, row.d ? show(row.d) : (/^(local_|late$)/.test(row.key) ? noText(row.note) : row.note)), flagTag(row));
}
function deadlineCell(v) {
  if (v.proc.kind !== "renewal") {
    return h("span", { class: "mini" }, v.keishin ? "末日（目安） " : "期限 ", h("b", { class: "d" }, show(v.filing.d)));
  }
  const by = k => v.rows.find(r => r.key === k);
  const ls = by("local_start"), ws = by("law_start");
  const start = (ls && ls.d) ? ls : (ws && ws.d ? ws : (ls || ws || null));
  return [dateLine("受付開始", start), dateLine("手引の期限", by("local_deadline")), dateLine("法令上の申請期限", by("law_deadline")), dateLine("満了日", by("expiry"))];
}
function statusCell(v) {
  const p = v.proc;
  return v.done ? `${M.statusLabel(p.kind, "done")}（${p.filedOn}）` : M.statusLabel(p.kind, p.status);
}
function select(key, options, value, onchange, label) {
  const s = h("select", { "data-key": key, "aria-label": label, onchange: e => onchange(e.target.value) },
    options.map(([v, t]) => h("option", { value: v }, t)));
  s.value = value;
  return s;
}
function renderList(t, root) {
  const views = M.buildViews(RULES, state, t);
  const sm = M.summarize(views, state, t);
  const F = ui.filters;
  const setF = (k, v) => { F[k] = v; ui.focusKey = "f-" + k; render(); };
  root.appendChild(h("h1", null, "期限一覧"));
  root.appendChild(h("p", { class: "lead" }, `${state.office}の顧問先 ${state.clients.length} 社の手続 ${state.procs.length} 行を、次の節目の早い順に並べています。`));
  root.appendChild(h("div", { class: "cards" },
    h("div", { class: "card" }, h("b", null, sm.soon), " 件", h("span", null, "30 日以内に節目がある手続")),
    h("div", { class: "card" }, h("b", null, sm.overdue), " 件", h("span", null, "期限を過ぎている手続")),
    h("div", { class: "card" }, h("b", null, sm.docsOverdue), " 件", h("span", null, "期日を過ぎた書類の依頼"))));
  const types = [...new Set(state.licenses.map(l => l.licenseId))];
  root.appendChild(h("div", { class: "panel" }, h("div", { class: "grid" },
    h("div", null, h("label", null, "顧問先"), select("f-client", [["", "すべて"], ...state.clients.map(c => [c.id, c.name])], F.client, v => setF("client", v), "顧問先で絞り込む")),
    h("div", null, h("label", null, "許認可の種類"), select("f-licenseId", [["", "すべて"], ...types.map(id => [id, licName(id)])], F.licenseId, v => setF("licenseId", v), "許認可の種類で絞り込む")),
    h("div", null, h("label", null, "担当者"), select("f-staff", [["", "すべて"], ...state.staff.map(s => [s, s])], F.staff, v => setF("staff", v), "担当者で絞り込む")),
    h("div", null, h("label", null, "状態"), select("f-status", [["", "すべて"], ["todo", "未着手"], ["wip", "準備中"], ["done", "提出済・受審済"]], F.status, v => setF("status", v), "状態で絞り込む")))));
  if (F.ym) root.appendChild(h("div", { class: "chip" }, `次の節目が ${F.ym} の手続だけ表示中`, h("button", { type: "button", class: "ghost small", "data-key": "f-ym", onclick: () => setF("ym", "") }, "解除")));
  const rows = M.filterViews(views, F);
  root.appendChild(h("p", { class: "hint" }, `${rows.length} 件を表示`));
  if (!rows.length) root.appendChild(h("p", { class: "empty" }, "条件に合う手続がありません。"));
  else root.appendChild(table(["次の節目", "顧問先", "許認可と許可行政庁", "手続", "期限", "書類", "担当者", "状態"],
    rows.map(v => ({
      cls: v.done ? "done" : null,
      cells: [milestoneCell(v),
        h("a", { class: "rowlink", href: "#detail/" + v.proc.id, "data-key": "row-" + v.proc.id }, clientName(v.client)),
        [licName(v.lc.licenseId), h("span", { class: "mini" }, v.lc.authority)],
        KL(v.proc.kind),
        deadlineCell(v),
        v.docAsked ? `受領済 ${v.docRecv} ／依頼 ${v.docAsked}` : "—",
        v.proc.staff, statusCell(v)],
    })), { wide: true }));
  root.appendChild(h("p", { class: "note" }, "日付は暦日で計算しています。閉庁日の繰り上げは反映していません。『要確認』は原文で確かめきれていない値です。申請の前に、許可行政庁の手引でご確認ください。"));
}

// ---- 詳細 ----
// 手引に書かれていない値は、上の表(期限と根拠)と下の表(許可行政庁による違い)で同じ言い方にする
function noText(s) { return !s || s === "記載なし" ? "手引に記載なし" : s; }
// 月単位の行で、応当日当日か翌日かが未確認(count が空)なら、期限と根拠の表と同じく要確認にする
function monthCountOpen(r) {
  const open = (m, c) => m !== "" && m != null && c !== "same_day" && c !== "day_after";
  return open(r.accept_start_months, r.accept_start_count) || open(r.deadline_guide_months, r.deadline_guide_count);
}
function rowsForBasis(v, t) {
  const out = [];
  // 受付開始を過ぎたのは悪いことではないので、赤字の「過ぎ」にせず受付中と出す
  const startPast = (d, key) => /_start$/.test(key) && diffDays(d, t) < 0 && !(v.milestone && v.milestone.expired);
  const dateCell = (d, key, keishin) => d ? [h("span", { class: "d" }, show(d)), key === "next_expiry" ? null
    : h("span", { class: "mini" }, startPast(d, key) ? h("span", { class: "rem" }, `${-diffDays(d, t)} 日前から受付中`) : rem(diffDays(d, t), keishin))] : "—";
  if (v.rows) v.rows.forEach(r => out.push({ cells: [[r.label, flagTag(r)], dateCell(r.d, r.key, false), /^(local_|late$)/.test(r.key) ? noText(r.note) : r.note, srcCell(r.quote, r.url, r.retrieved)] }));
  if (v.filing) {
    const f = v.filing.f;
    out.push({ cells: [[f.filing_name, v.keishin ? tag("期限ではなく目安", "plain") : null], dateCell(v.filing.d, f.filing_id, v.keishin), v.filing.note, srcCell(f.basis, f.basis_url, f.retrieved)] });
  }
  return out;
}
function dateField(v, field, label, hint) {
  const p = v.proc, lc = v.lc;
  const err = ui.err && ui.err.procId === p.id && ui.err.field === field ? ui.err.msg : null;
  const id = `in-${field}`;
  return h("div", null, h("label", { for: id }, label),
    h("input", { type: "date", id, "data-key": id, value: field === "filedOn" ? p.filedOn : lc[field], "aria-invalid": err ? "true" : null, "aria-describedby": err ? id + "-e" : null,
      onchange: e => {
        const val = e.target.value;
        mutate((s, t) => {
          const r = field === "filedOn" ? M.setFiledOn(s, p.id, val, t) : M.setDate(s, p.id, field, val, t);
          if (!r.ok) { ui.err = { procId: p.id, field, msg: r.error }; return { ok: false }; }
          return r;
        }, id);
      } }),
    err ? h("p", { class: "err", id: id + "-e", role: "alert" }, err) : null,
    hint ? h("p", { class: "hint" }, hint) : null);
}
function renderDetail(t, root) {
  const v = M.buildViews(RULES, state, t).find(x => x.proc.id === ui.routeArg);
  if (!v) { root.appendChild(h("p", { class: "empty" }, "手続が見つかりません。")); root.appendChild(h("a", { href: "#list", class: "back" }, "← 期限一覧に戻る")); return; }
  const p = v.proc, lc = v.lc;
  root.appendChild(h("a", { href: "#list", class: "back" }, "← 期限一覧に戻る"));
  root.appendChild(h("h1", null, `${v.client.name}　${KL(p.kind)}`));
  root.appendChild(h("dl", { class: "kv" },
    h("dt", null, "顧問先"), h("dd", null, clientName(v.client)),
    h("dt", null, "許認可"), h("dd", null, licName(lc.licenseId), "　", lc.number),
    h("dt", null, "許可行政庁"), h("dd", null, lc.authority),
    h("dt", null, "手続"), h("dd", null, KL(p.kind))));
  // 入力
  const shared = p.kind !== "renewal" && p.kind !== "results" && state.procs.some(o => o.id !== p.id && o.lc === p.lc && (o.kind === "annual" || o.kind === "keishin"));
  const fields = [];
  if (p.kind === "renewal") fields.push(dateField(v, "exp", "満了日", "許可通知書などの「有効期間」の末日。変えると期限が計算し直されます。"));
  else if (p.kind === "results") fields.push(h("div", null, h("label", null, "期日"), h("p", { class: "hint" }, "毎年 7 月 10 日（暦の日付）。満了日・決算日の欄はありません。")));
  else fields.push(dateField(v, "fy", "決算日", shared ? "同じ許認可の決算変更届・経審と共通の日付です。" : null));
  fields.push(h("div", null, h("label", { for: "in-staff" }, "担当者"), select("in-staff", state.staff.map(s => [s, s]), p.staff, val => mutate((s, tt) => M.setStaff(s, p.id, val, tt), "in-staff"), "担当者")));
  fields.push(h("div", null, h("label", { for: "in-status" }, "状態"), select("in-status", M.STATUS_CODES.map(c => [c, M.statusLabel(p.kind, c)]), p.status, val => mutate((s, tt) => M.setStatus(s, p.id, val, tt), "in-status"), "状態")));
  if (v.done) fields.push(dateField(v, "filedOn", p.kind === "keishin" ? "受審日" : "提出日"));
  root.appendChild(h("div", { class: "panel" }, h("div", { class: "grid" }, fields)));
  if (!v.done) {
    const m = v.milestone;
    root.appendChild(h("p", null, "次の節目: ", h("strong", null, m.expired ? "満了日" : m.label), "　", h("span", { class: "d" }, show(m.d)), "　", m.expired ? h("span", { class: "rem over" }, `満了日を ${-m.days} 日過ぎ`) : rem(m.days, v.keishin)));
  }
  // 期限と根拠
  root.appendChild(h("h2", null, "期限と根拠"));
  const basis = rowsForBasis(v, t);
  if (p.kind === "bizreport" || p.kind === "results") {
    // 一般貨物: 更新の行は作らない。計算機と同じ文を出典つきで出す
    const nr = C.renewalRows(v.l, null, null);
    if (nr) nr.forEach(r => basis.push({ cells: [r.label, "—", r.note, srcCell(r.quote, r.url, r.retrieved)] }));
  }
  root.appendChild(table(["項目", "日付と残り", "内容", "根拠と出典"], basis));
  if (v.keishin) root.appendChild(h("p", { class: "note" }, "経営事項審査の日付は、結果通知の有効期間の末日の目安です。受審の期限ではありません。"));
  // 許可行政庁による違い
  if (p.kind === "renewal") {
    const locs = RULES.local.filter(r => r.license_id === lc.licenseId);
    root.appendChild(h("h2", null, "許可行政庁による違い"));
    root.appendChild(h("p", { class: "lead" }, "同じ許認可でも、受付の開始と期限は許可行政庁の手引で違います。収録していない許可行政庁は手引をご確認ください。"));
    root.appendChild(table(["許可行政庁", "受付開始", "期限", "期限後の扱い", "確認の状態", "出典"], locs.map(r => ({
      cls: r.authority === lc.authority ? "me" : null,
      cells: [[r.authority, r.authority === lc.authority ? tag("この顧問先", "plain") : null], noText(r.accept_start), noText(r.deadline_guide), noText(r.late_acceptance),
        r.status === "confirmed" && !monthCountOpen(r) ? "確認済" : tag("要確認"), srcCell(r.quote, r.source_url, r.retrieved)],
    }))));
  }
  // ほかの届出
  const events = RULES.filings.filter(f => f.kind === "event" && f.license_ids.includes(lc.licenseId));
  if (events.length) {
    root.appendChild(h("h2", null, "この許認可のほかの届出"));
    root.appendChild(table(["届出", "期限の決まり", "根拠"], events.map(f => ({ cells: [f.filing_name, f.deadline_rule, srcCell(f.basis, f.basis_url, f.retrieved)] }))));
  }
  // 書類
  root.appendChild(h("h2", null, "書類"));
  const ds = M.docsOf(RULES, state, p.id);
  const cnt = k => ds.filter(d => d.doc.state === k).length;
  root.appendChild(h("p", null, ds.length ? `依頼済 ${cnt("req")} ／ 届けた連絡あり ${cnt("rep")} ／ 受領済 ${cnt("recv")} ／ 未依頼 ${cnt("none")} ／ 使わない ${cnt("skip")}　` : "この手続の書類は登録されていません。　",
    h("a", { href: "#docs/" + p.id }, "書類の回収の画面で見る")));
  // 対応の記録
  root.appendChild(h("h2", null, "対応の記録"));
  const noteIn = h("input", { type: "text", id: "in-note", maxlength: "200", "aria-describedby": "in-note-h", "data-key": "in-note" });
  const who = select("in-who", state.staff.map(s => [s, s]), ui.noteWho || p.staff, val => { ui.noteWho = val; }, "記録する担当者");
  const noteErr = ui.err && ui.err.procId === p.id && ui.err.field === "note" ? ui.err.msg : null;
  root.appendChild(h("form", { class: "panel", onsubmit: e => {
    e.preventDefault();
    mutate((s, tt) => { const r = M.addNote(s, p.id, who.value, noteIn.value, tt); if (!r.ok) { ui.err = { procId: p.id, field: "note", msg: r.error }; return { ok: false }; } return r; }, "in-note");
  } },
    h("div", { class: "grid" }, h("div", null, h("label", { for: "in-who" }, "担当者"), who), h("div", null, h("label", { for: "in-note" }, "記録（200 字まで）"), noteIn)),
    h("p", { class: "hint", id: "in-note-h" }, "実際の社名・氏名を入れないでください。"),
    noteErr ? h("p", { class: "err", role: "alert" }, noteErr) : null,
    h("div", { class: "row" }, h("button", { type: "submit" }, "記録を足す"))));
  root.appendChild(h("ul", { class: "log" }, M.sortedLog(p).map(e => h("li", null, h("span", { class: "d" }, showS(e.d)), h("span", { class: "who" }, e.who), e.text))));
  root.appendChild(h("p", { class: "fixed" }, "この画面は申請書・届出書を作りません。書類の作成と提出は先生方のお仕事で、当社は期限と書類の受け取りの管理までを扱います。"));
}

// ---- 書類の回収 ----
function docStateCell(d) {
  const s = d.state;
  if (s === "none") return "未依頼";
  if (s === "req") return "依頼済";
  if (s === "rep") return `顧問先から届けたと連絡（${+d.repOn.slice(5, 7)}月${+d.repOn.slice(8, 10)}日）。確認待ち`;
  if (s === "recv") return "受領済";
  return "使わない";
}
function docDateCell(d, t) {
  if (d.state === "req" || d.state === "rep") {
    const days = diffDays(M.parseStrict(d.due) || t, t);
    return [h("span", { class: "d" }, `期日 ${d.due}`), h("span", { class: "mini" }, rem(days))];
  }
  if (d.state === "recv") return h("span", { class: "d" }, `受領 ${d.recvOn}`);
  return "—";
}
function btn(text, key, fn, ghost) { return h("button", { type: "button", class: "small" + (ghost ? " ghost" : ""), "data-key": key, onclick: fn }, text); }
function docRow(p, item, t) {
  const d = item.doc, k = "doc-" + d.id;
  const op = (fn) => () => mutate((s, tt) => fn(s, tt), k);
  const ops = [];
  if (d.state === "none") {
    const due = h("input", { type: "date", value: fmt(addDays(t, 14)), "aria-label": "期日（既定は今日 + 14 日）", "data-key": "due-" + d.id });
    ops.push(h("span", { class: "row" }, due, btn("依頼する", "req-" + d.id, () => mutate((s, tt) => { const r = M.docs.request(s, RULES, d.id, due.value, tt); if (!r.ok) { ui.err = { procId: p.id, field: "doc-" + d.id, msg: r.error }; return { ok: false }; } return r; }, k)),
      btn("この案件では使わない", "skip-" + d.id, op((s, tt) => M.docs.skip(s, RULES, d.id, tt)), true)));
    if (ui.err && ui.err.field === "doc-" + d.id) ops.push(h("p", { class: "err", role: "alert" }, ui.err.msg));
  } else if (d.state === "req") {
    ops.push(h("span", { class: "row" }, btn("受領を確認", "conf-" + d.id, op((s, tt) => M.docs.confirm(s, RULES, d.id, tt))), btn("依頼を取り消す", "cancel-" + d.id, op((s, tt) => M.docs.cancel(s, RULES, d.id, tt)), true)));
  } else if (d.state === "rep") {
    ops.push(h("span", { class: "row" }, btn("受領を確認", "conf-" + d.id, op((s, tt) => M.docs.confirm(s, RULES, d.id, tt))), btn("届いていない（依頼済に戻す）", "unrep-" + d.id, op((s, tt) => M.docs.unreport(s, RULES, d.id, tt)), true)));
  } else if (d.state === "recv") {
    ops.push(btn("依頼済に戻す", "rev-" + d.id, op((s, tt) => M.docs.revert(s, RULES, d.id, tt)), true));
  } else {
    ops.push(btn("未依頼に戻す", "unskip-" + d.id, op((s, tt) => M.docs.unskip(s, RULES, d.id, tt)), true));
  }
  const s = item.src;
  return { key: k, cls: d.state === "skip" ? "skip" : null, cells: [item.name, s ? [s.quote, " ", srcCell("", s.source_url, s.retrieved), h("span", { class: "mini" }, s.page, " ／ ", s.status === "confirmed" ? "原文で確認" : tag("要確認"))] : tag("事務所が追加", "plain"), docStateCell(d), docDateCell(d, t), ops] };
}
function addForm(p) {
  const inp = h("input", { type: "text", maxlength: "40", id: "add-" + p.id, "data-key": "add-" + p.id, "aria-label": "足す書類の名前（40 字まで）" });
  const err = ui.err && ui.err.field === "add-" + p.id ? ui.err.msg : null;
  return h("form", { class: "row", onsubmit: e => {
    e.preventDefault();
    mutate((s, tt) => { const r = M.docs.add(s, RULES, p.id, inp.value, tt); if (!r.ok) { ui.err = { procId: p.id, field: "add-" + p.id, msg: r.error }; return { ok: false }; } return r; }, "add-" + p.id);
  } }, h("label", { for: "add-" + p.id }, "書類を足す"), inp, h("button", { type: "submit", class: "small" }, "足す"), err ? h("span", { class: "err", role: "alert" }, err) : null);
}
function procHead(v) {
  return `${v.client.name}　${licName(v.lc.licenseId)}（${v.lc.authority}）　${KL(v.proc.kind)}`;
}
function renderDocsOffice(t, root) {
  const views = state.procs.map(p => M.procView(RULES, state, p, t));
  root.appendChild(h("h1", null, "書類の回収"));
  root.appendChild(h("p", { class: "lead" }, h("strong", null, "どの書類が要るかは、この画面では判定しません。"), "手引の記載を並べたものです（全件ではありません）。顧問先にお願いするものを選んで依頼してください。"));
  views.forEach(v => {
    const p = v.proc, items = M.docsOf(RULES, state, p.id);
    const hasData = M.docGroup(RULES, state, p).length > 0;
    const m = v.milestone;
    const head = h("h2", { id: "proc-" + p.id, tabindex: "-1" }, procHead(v));
    const sub = h("p", { class: "hint" }, v.done ? `${M.statusLabel(p.kind, "done")}（${p.filedOn}）` : `次の節目: ${m.expired ? "満了日" : m.label} ${fmt(m.d)}　`, v.done ? null : rem(m.days, v.keishin), "　", h("a", { href: "#detail/" + p.id }, "詳細"));
    const body = [];
    if (items.length) {
      body.push(h("h3", null, hasData ? "手引に記載の書類（例）" : "書類"));
      body.push(table(["書類の名前", "手引の記載", "状態", "期日", "操作"], items.map(it => docRow(p, it, t)), { wide: true }));
    } else if (!hasData) {
      body.push(h("p", { class: "note" }, "このデモでは、書類の例を建設業許可（東京都・大阪府）の更新と決算変更届だけ収録しています"));
    }
    body.push(addForm(p));
    if (items.length || hasData) root.appendChild(h("section", null, head, sub, body));
    else root.appendChild(h("section", null, head, sub, h("details", null, h("summary", null, "書類を足す"), body)));
  });
  root.appendChild(h("p", { class: "note" }, "実際の製品では、依頼と期日の前のお知らせを顧問先にメールで送り、届いた書類のファイルをここに保存します。デモでは送信・保存をしません。"));
}
function renderDocsClient(t, root) {
  root.appendChild(h("h1", null, "顧問先の画面"));
  root.appendChild(h("p", { class: "lead" }, "実際の製品では、顧問先の方は自分の会社の分だけを見られます"));
  root.appendChild(h("div", { class: "panel" }, h("div", { class: "grid" }, h("div", null, h("label", { for: "client-sel" }, "顧問先を選ぶ"),
    select("client-sel", state.clients.map(c => [c.id, c.name]), clientSel, v => { clientSel = v; ui.flash = ""; ui.focusKey = "client-sel"; render(); }, "顧問先を選ぶ")))));
  const c = state.clients.find(x => x.id === clientSel) || state.clients[0];
  root.appendChild(h("h2", null, `${c.name}様にお願いしている書類`));
  if (ui.flash) root.appendChild(h("p", { class: "panel", role: "status" }, ui.flash));
  let any = false;
  state.procs.filter(p => state.licenses.find(l => l.id === p.lc).client === c.id).forEach(p => {
    const items = M.docsOf(RULES, state, p.id).filter(it => ["req", "rep", "recv"].includes(it.doc.state));
    if (!items.length) return;
    any = true;
    const v = M.procView(RULES, state, p, t);
    root.appendChild(h("h3", null, procHead(v)));
    root.appendChild(table(["書類の名前", "手引の記載", "期日", "状態", ""], items.map(it => {
      const d = it.doc, s = it.src;
      return { key: "cdoc-" + d.id, cells: [it.name, s ? [s.quote, " ", srcCell("", s.source_url, s.retrieved)] : "事務所が追加", d.state === "recv" ? `受領 ${d.recvOn}` : d.due,
        docStateCell(d), d.state === "req" ? btn("届けました", "rep-" + d.id, () => mutate((st, tt) => { const r = M.docs.report(st, RULES, d.id, tt); if (r.ok) ui.flash = "事務所に連絡しました（デモではこのブラウザの中だけです）。事務所が確認します"; return r; }, "cdoc-" + d.id)) : ""] };
    }), { wide: true }));
  });
  if (!any) root.appendChild(h("p", { class: "empty" }, "いまお願いしている書類はありません。"));
}

// ---- 今後 12 か月 ----
function renderMonths(t, root) {
  const views = M.buildViews(RULES, state, t);
  const ms = M.monthly(views, t);
  root.appendChild(h("h1", null, "今後 12 か月"));
  root.appendChild(h("p", { class: "lead" }, "それぞれの手続の、次の節目がある月で数えています。月を押すと期限一覧がその月で絞り込まれます。提出済・受審済は数えません。"));
  root.appendChild(table(["月", "更新", "決算変更届", "経審（有効期間の末日の目安）", "報告書（事業報告書・事業実績報告書）", "計"], ms.map(m => ({
    cells: [m.total ? h("button", { type: "button", class: "small ghost", "data-key": "m-" + m.ym, onclick: () => { ui.filters = { client: "", licenseId: "", staff: "", status: "", ym: m.ym }; if (location.hash === "#list") render(); else location.hash = "#list"; } }, m.ym) : m.ym,
      m.renewal, m.annual, m.keishin, m.report, m.total],
    tdClass: [null, "num", "num", "num", "num", "num"],
  }))));
  root.appendChild(h("p", { class: "note" }, "報酬の見込みを入れる欄は準備中です"));
}

function renderImport(t, root) {
  root.appendChild(h("h1", null, "顧問先一覧の取込"));
  root.appendChild(h("p", null, tag("準備中", "plain"), " お手元の一覧（Excel・CSV）から顧問先と満了日を取り込めるようにします"));
}

// ---- 描画 ----
function render() {
  const t = ensure();
  const r = route();
  ui.routeArg = r.arg;
  renderTabs(r);
  $("roleOffice").setAttribute("aria-pressed", role === "office" ? "true" : "false");
  $("roleClient").setAttribute("aria-pressed", role === "client" ? "true" : "false");
  const root = h("div", null);
  if (r.name === "list") renderList(t, root);
  else if (r.name === "detail") renderDetail(t, root);
  else if (r.name === "docs") (role === "client" ? renderDocsClient : renderDocsOffice)(t, root);
  else if (r.name === "months") renderMonths(t, root);
  else renderImport(t, root);
  $("view").replaceChildren(root);
  const fk = ui.focusKey; ui.focusKey = null;
  const el = fk ? document.querySelector(`[data-key="${fk}"]`) : null;
  if (el) el.focus({ preventScroll: false });
  else if (ui.focusMain) { ui.focusMain = false; $("view").focus({ preventScroll: true }); }
  if (r.name === "docs" && r.arg && !fk) { const a = document.getElementById("proc-" + r.arg); if (a) { a.scrollIntoView(); a.focus({ preventScroll: true }); } }
}

function reset() {
  try { sessionStorage.removeItem(KEY); } catch (e) { /* 使えなくても続ける */ }
  dirty = false; state = M.seed(today(), RULES);
  ui.filters = { client: "", licenseId: "", staff: "", status: "", ym: "" }; ui.err = null; ui.flash = "";
  render();
  $("resetMsg").textContent = "戻しました";
}
function setRole(r) {
  ensure();
  role = r; ui.flash = ""; ui.err = null;
  if (r === "client" && route().name !== "docs") { location.hash = "#docs"; }
  ui.focusKey = r === "client" ? "client-sel" : null;
  $("resetMsg").textContent = "";
  render();
}

(async function init() {
  try {
    const res = await fetch("../rules.json"); if (!res.ok) throw new Error(res.status);
    RULES = await res.json();
    const t = today();
    let raw = null;
    try { raw = sessionStorage.getItem(KEY); } catch (e) { raw = null; }
    const r = raw ? M.restore(raw, RULES, t) : { state: M.seed(t, RULES), dirty: false };
    state = r.state; dirty = r.dirty;
    if (dirty) save();
    $("reset").addEventListener("click", reset);
    $("roleOffice").addEventListener("click", () => setRole("office"));
    $("roleClient").addEventListener("click", () => setRole("client"));
    window.addEventListener("hashchange", () => { ui.err = null; ui.flash = ""; $("resetMsg").textContent = ""; ui.focusMain = true; render(); });
    render();
  } catch (e) {
    $("tabs").hidden = true;
    $("view").replaceChildren(h("p", { class: "empty" }, "ルールを読み込めませんでした。ページを再読み込みしてください。"));
  }
})();
})();
