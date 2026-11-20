// 許認可の更新期限・定期届出の日付計算。期限計算機(calc.html)とデモ(demo/)が共有する。画面には触らない。
// ブラウザでは window.QBDate、node では module.exports に出す。module 型 script は使わない。
(function () {
const pad = n => String(n).padStart(2, "0");
const fmt = d => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
const parse = s => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
// 時刻なしの今日
const dateOnly = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
// 民法143条2項: 期間の末日は起算日(満了日の翌日)の応当日の前日。応当日が無い月は、その月の末日で満了。
function addMonthsPeriod(end, months) {
  const start = addDays(end, 1);
  const y = start.getFullYear(), m = start.getMonth() + months, day = start.getDate();
  const last = new Date(y, m + 1, 0).getDate();
  if (day > last) return new Date(y, m, last);
  return addDays(new Date(y, m, day), -1);
}
// 満了日の months か月前の応当日（その月に同じ日が無ければ月末）
function sameDayMonthsBefore(exp, months) {
  const m = exp.getMonth() - months;
  const last = new Date(exp.getFullYear(), m + 1, 0).getDate();
  return new Date(exp.getFullYear(), m, Math.min(exp.getDate(), last));
}
// 月単位の受付開始(kind="start")・期限(kind="deadline")。count は "same_day"（応当日当日）・"day_after"（翌日）・空（未確認）。
// 未確認のとき、受付開始は遅い側(翌日)、期限は早い側(応当日当日)を返し、unconfirmed を true にする。
function monthRule(exp, months, count, kind) {
  const same = sameDayMonthsBefore(exp, months);
  const unconfirmed = count !== "same_day" && count !== "day_after";
  const useAfter = count === "day_after" || (unconfirmed && kind === "start");
  return { d: useAfter ? addDays(same, 1) : same, unconfirmed };
}
// 更新後の次の満了日（目安）
const nextExpiry = (exp, years) => addMonthsPeriod(exp, 12 * years);
// 事業実績報告書: 直近の 7 月 10 日（当日を含む）
function nextCargoResults(now) {
  const t = dateOnly(now);
  const d0 = new Date(t.getFullYear(), 6, 10);
  return d0 < t ? new Date(t.getFullYear() + 1, 6, 10) : d0;
}
// 住宅宿泊事業の定期報告: 直近の偶数月 15 日（当日を含む）
function nextMinpaku(now) {
  const t = dateOnly(now);
  const m = t.getMonth(); // 0 始まり。偶数月(2,4,...)は m が奇数
  const cand = new Date(t.getFullYear(), m % 2 === 1 ? m : m + 1, 15);
  return cand < t ? new Date(cand.getFullYear(), cand.getMonth() + 2, 15) : cand;
}
// a − b の日数。年月日だけで数える(時刻・タイムゾーンを使わない)
const diffDays = (a, b) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
const hasNum = v => v !== "" && v !== null && v !== undefined;

// 更新の行。l = 許可の種類(rules.json の licenses の 1 件)、loc = 許可行政庁の手引(local の 1 件。無ければ null)、exp = 満了日(Date または null)。
// 有効期間のある許可で exp が無いときは null を返す。
function renewalRows(l, loc, exp) {
  const rows = [];
  const push = (key, label, d, note, quote, url, retrieved, status) => rows.push({ key, label, d, note, quote, url, retrieved, status });

  if (l.valid_renewal) {
    if (!exp) return null;
    if (hasNum(l.window_start_days)) push("law_start", "法令上の受付開始", addDays(exp, -l.window_start_days), `満了 ${l.window_start_days} 日前から`, l.basis, l.basis_url, l.retrieved, l.status);
    if (hasNum(l.deadline_days)) push("law_deadline", "法令上の申請期限", addDays(exp, -l.deadline_days), `満了 ${l.deadline_days} 日前まで`, l.basis, l.basis_url, l.retrieved, l.status);
    else push("law_deadline", "法令上の申請期限", null, l.deadline_source === "local" ? "法令に期限の定めなし。許可行政庁の手引による" : "法令に定めなし", l.basis, l.basis_url, l.retrieved, l.status);
    if (loc) {
      const pushLocal = (key, label, months, count, kind, days, text, noteTail) => {
        let d = null, note = text || "記載なし", status = loc.status;
        if (hasNum(months)) {
          const r = monthRule(exp, months, count, kind);
          d = r.d;
          if (r.unconfirmed) { note += `（${noteTail}）`; status = "unconfirmed"; }
        } else if (hasNum(days)) d = addDays(exp, -Number(days));
        push(key, label, d, note, loc.quote, loc.source_url, loc.retrieved, status);
      };
      pushLocal("local_start", `手引の受付開始（${loc.authority}）`, loc.accept_start_months, loc.accept_start_count, "start", loc.accept_start_days, loc.accept_start, "月単位。応当日当日か翌日かは未確認のため遅い側を表示");
      pushLocal("local_deadline", `手引の期限（${loc.authority}）`, loc.deadline_guide_months, loc.deadline_guide_count, "deadline", loc.deadline_guide_days, loc.deadline_guide, "月単位。応当日当日か翌日かは未確認のため早い側を表示");
      push("late", "期限後の扱い", null, loc.late_acceptance || "手引に記載なし", "", loc.source_url, loc.retrieved, loc.status);
    }
    push("expiry", "満了日", exp, "", "", "", "", "");
    push("deemed", "審査中のみなし有効", null,
      l.deemed === "yes" ? "あり（更新の申請をして満了日までに処分がないときは、処分まで従前の許可が有効）" : l.deemed === "no" ? "なし（満了で失効。みなし規定なし）" : "未確認",
      l.basis, l.basis_url, l.retrieved, l.status);
    const yrs = parseInt(l.valid_renewal, 10);
    if (yrs) { const n = nextExpiry(exp, yrs); push("next_expiry", "更新後の次の満了日（目安）", n, `${l.valid_renewal} 年後。従前の満了日の翌日から数えた目安です。許可通知書の有効期間でご確認ください`, "", "", "", ""); }
  } else if (l.status === "pending") {
    push("no_renewal", "更新の期限", null, "更新制は施行待ち。施行日・初回更新の時期は政省令で決まります", l.basis, l.basis_url, l.retrieved, l.status);
  } else {
    push("no_renewal", "更新の期限", null, "有効期間なし（更新はありません）", l.basis, l.basis_url, l.retrieved, l.status);
  }
  return rows;
}

// 定期届出の日付。f = filings の 1 件、fy = 決算日(Date または null)、today = 今日(Date)。{d, note} を返す。
function filingDate(f, fy, today) {
  let d = null, note = f.deadline_rule;
  if (f.filing_id === "construction_annual") { if (fy) d = addMonthsPeriod(fy, 4); else note += "（決算日を入れると日付が出ます）"; }
  else if (f.filing_id === "construction_keishin") { if (fy) { d = addMonthsPeriod(fy, 19); note = "審査基準日（決算日）から 1 年 7 か月。結果通知の有効期間の末日の目安"; } else note += "（決算日を入れると日付が出ます）"; }
  else if (f.filing_id === "cargo_business_report") { if (fy) d = addDays(fy, 100); else note += "（決算日を入れると日付が出ます）"; }
  else if (f.filing_id === "cargo_results_report") { d = nextCargoResults(today); note = "毎年 7 月 10 日（前年 4 月 1 日〜3 月 31 日分）。直近の期日を表示"; }
  else if (f.filing_id === "minpaku_report") {
    d = nextMinpaku(today); note = "偶数月の 15 日までに前 2 か月分。直近の期日を表示";
  }
  return { d, note };
}

const QBDate = { pad, fmt, parse, addDays, dateOnly, addMonthsPeriod, sameDayMonthsBefore, monthRule, nextExpiry, nextCargoResults, nextMinpaku, diffDays, renewalRows, filingDate };
if (typeof window !== "undefined") window.QBDate = QBDate;
if (typeof module !== "undefined") module.exports = QBDate;
})();
