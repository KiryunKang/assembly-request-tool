// test_validate.js — web/validate.js(처리지침 제4·5장 검증 규칙)를 시험한다.
// 실행: node test_validate.js
// ① 실제 자료: 부서회신 6건 → 확인필요 3건 · 검증용 접수대장 120건 → 12건 (교안 기준값)
// ② 일부러 틀린 값 넣기: 정상 회신·정상 접수대장 행을 복사해 오류를 심고, 심은 오류를 도구가 모두 찾는지 대조
const fs = require("fs");
const path = require("path");
const XLSX = require("./web/lib/xlsx.full.min.js");
const Engine = require("./web/engine.js");
const V = require("./web/validate.js");

let pass = 0, failN = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "통과" : "실패"} | ${name}${detail ? " | " + detail : ""}`);
  ok ? pass++ : failN++;
}
const readXlsx = (f) => { const wb = XLSX.read(fs.readFileSync(f)); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: false }); };
const ctx = { 요구내용: "", 기준연도: 2026 };

// ── ① 실제 자료 ───────────────────────────────────────────
const dir = path.join(__dirname, "부서회신");
const found = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".xlsx"))) found[f] = V.checkReply(readXlsx(path.join(dir, f)), ctx);
const total = Object.values(found).reduce((t, x) => t + x.length, 0);
check("부서회신 6건 → 확인필요 3건", Object.keys(found).length === 6 && total === 3, Object.entries(found).map(([f, x]) => `${f.replace(/회신_|\.xlsx/g, "")} ${x.map((y) => y.항목).join("·") || "0"}`).join(" / "));
check("  산업정책과: 합계 불일치", found["회신_산업정책과.xlsx"].some((x) => x.항목 === "합계 불일치"));
check("  안전정책과: 집행액>예산(비고 없음)", found["회신_안전정책과.xlsx"].some((x) => x.항목 === "집행액>예산" && x.내용.includes("2024")));
check("  지역정책과: 2023년 누락", found["회신_지역정책과.xlsx"].some((x) => x.항목 === "연도 누락" && x.내용.includes("2023")));

const org = Engine.parseCSV(fs.readFileSync(path.join(__dirname, "data", "A부_조직도_26개과.csv"), "utf8")).map((o) => o.과);
const ledger = Engine.parseCSV(fs.readFileSync(path.join(__dirname, "data", "검증용_접수대장_120건.csv"), "utf8"), true);
const L = V.checkLedger(ledger, org);
const cnt = {}; for (const x of L) cnt[x.항목] = (cnt[x.항목] || 0) + 1;
check("검증용 접수대장 120건 → 확인필요 12건", ledger.length === 120 && L.length === 12, JSON.stringify(cnt));
check("  공백을 지우지 않고 읽어야 「제출완료 」를 찾음", L.some((x) => x.접수번호 === "2026-0030" && x.항목 === "표기(공백)")
  && V.checkLedger(Engine.parseCSV(fs.readFileSync(path.join(__dirname, "data", "검증용_접수대장_120건.csv"), "utf8")), org).length === 11);

// ── ② 일부러 틀린 값 넣기 ─────────────────────────────────
const good = readXlsx(path.join(dir, "회신_디지털정책과.xlsx"));
check("정상 회신(디지털정책과)은 확인필요 0", V.checkReply(good, ctx).length === 0);
const bad = JSON.parse(JSON.stringify(good));
const planted = [];
planted.push("연도 누락");
bad.forEach((r, i) => { if (i >= 2 && r[0] === 2023) r[0] = 2099; });             // 2023년 행을 모두 2099년으로 바꿔 2023년을 없앰
bad[2][6] = 25000; planted.push("집행액>예산");                                  // 2022년 예산 20000 < 집행액 25000, 비고 없음
bad.push(["합계", "", "", "", "", 1, "", ""]); planted.push("합계 불일치");
bad[3][7] = "위원 교체로 추가 지출"; bad[3][6] = 9000;                            // 비고가 있으면 집행액>예산이어도 확인필요 아님
const got = V.checkReply(bad, ctx).map((x) => x.항목);
const missed = planted.filter((p) => !got.includes(p));
check("회신에 심은 오류 3종을 모두 찾음 · 비고 있는 초과는 넘어감", !missed.length && got.filter((x) => x === "집행액>예산").length === 1, `찾음 ${got.join(", ")}${missed.length ? " · 놓침 " + missed.join(", ") : ""}`);
check("머리글 공통 열이 없으면 양식 확인필요", V.checkReply([["요구"], ["연도", "금액"], [2026, 1]], ctx).some((x) => x.항목 === "양식"));
check("「2022년 이후」·「최근 3년」·「2021~2023」 연도 범위", JSON.stringify([V.years("2022년 이후", 2026), V.years("최근 3년간", 2026), V.years("2021~2023 실적", 2026)]) === JSON.stringify([[2022, 2023, 2024, 2025, 2026], [2024, 2025, 2026], [2021, 2022, 2023]]));

const okRows = ledger.filter((r) => !L.some((x) => x.행 === ledger.indexOf(r) + 2)).slice(0, 8).map((r) => ({ ...r }));
check("정상 접수대장 8행은 확인필요 0", V.checkLedger(okRows, org).length === 0);
const seed = okRows.map((r) => ({ ...r }));
seed[0].배분과 = "미래전략과"; seed[1].요구기간_시작 = "2030"; seed[2].제출기한 = "2026/10/01";
seed[3].제출기한 = "2026-01-01"; seed[3].접수일 = "2026-02-01"; seed[4].위원회 = "행정안전위원회  ";
seed[5] = { ...seed[6] };                                                          // 6행을 그대로 복사(같은 번호·같은 내용)
const want = ["조직도에 없는 부서명", "기간 역전", "날짜 형식", "기한이 접수일보다 빠름", "표기(공백)", "중복 접수"];
const gotL = V.checkLedger(seed, org).map((x) => x.항목);
const missL = want.filter((w) => !gotL.includes(w));
check("접수대장에 심은 오류 6종을 모두 찾음", !missL.length, `찾음 ${[...new Set(gotL)].join(", ")}${missL.length ? " · 놓침 " + missL.join(", ") : ""}`);

// 합치기: 회신과 열이 붙고 행 수가 맞는지
const c = { 회신: { 디지털정책과: { 행: good }, 인재정책과: { 행: readXlsx(path.join(dir, "회신_인재정책과.xlsx")) }, 운영지원과: { 행: [], 메모: "해당 자료 없음" } } };
const m = V.merge(c);
check("과별 회신 합치기(회신과 열 · 10+5행 · 메모만 1)", m.머리글[0] === "회신과" && m.행.length === 15 && m.행[0][0] === "디지털정책과" && m.메모만.length === 1, `${m.머리글.join("|")} · ${m.행.length}행`);

console.log(`\n통과 ${pass} · 실패 ${failN}`);
process.exit(failN ? 1 : 0);
