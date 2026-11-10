// compare_rules.js — 규칙 파일 두 개를 시험 40건·접수대장 520건으로 전후 비교한다.
// 실행: node compare_rules.js                       (원본 → data/rules_보강.csv)
//       node compare_rules.js 전.csv 후.csv
const fs = require("fs");
const path = require("path");
const Engine = require("./web/engine.js");

const DATA = path.join(__dirname, "data");
const read = (f) => fs.readFileSync(f, "utf8");
const before = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DATA, "배분기준표_소관키워드_304건.csv");
const after = process.argv[3] ? path.resolve(process.argv[3]) : path.join(DATA, "rules_보강.csv");

const org = read(path.join(DATA, "A부_조직도_26개과.csv"));
const tests = Engine.parseCSV(read(path.join(DATA, "시험_요구문항_40건.csv")));
const ledger = Engine.parseCSV(read(path.join(DATA, "요구자료_접수대장_2026국감_520건.csv")));

function score(file) {
  const e = Engine.create(read(file), org);
  const top = (x) => (e.classify(x)[0] || {}).과;
  return {
    rules: e.ruleCount,
    outside: e.outside.length,
    t3: tests.filter((t) => e.classify(t.요구내용).some((c) => c.과 === t.정답_배분과)).length,
    tw: tests.filter((t) => top(t.요구내용) !== t.정답_배분과).map((t) => t.시험번호),
    lw: ledger.filter((x) => top(x.요구내용) !== x.배분과).map((x) => x.접수번호),
  };
}

const a = score(before), b = score(after);
const nT = tests.length, nL = ledger.length;
const newT = b.tw.filter((x) => !a.tw.includes(x));
const newL = b.lw.filter((x) => !a.lw.includes(x));

console.log(`| 구분 | 고치기 전 (${path.basename(before)}) | 고친 후 (${path.basename(after)}) |`);
console.log("|---|---|---|");
console.log(`| 규칙 수 | ${a.rules} | ${b.rules} |`);
console.log(`| 시험 ${nT}건 1순위 | ${nT - a.tw.length}/${nT} | ${nT - b.tw.length}/${nT} |`);
console.log(`| 시험 ${nT}건 3순위 안 | ${a.t3}/${nT} | ${b.t3}/${nT} |`);
console.log(`| 접수대장 ${nL}건 1순위 | ${nL - a.lw.length} | ${nL - b.lw.length} |`);
console.log(`| 조직도 밖 규칙 | ${a.outside} | ${b.outside} |`);
console.log(`\n시험 새로 틀린 문항 ${newT.length}건 ${newT.join(", ")} · 고쳐진 문항 ${a.tw.filter((x) => !b.tw.includes(x)).length}건`);
console.log(`접수대장 새로 틀린 문항 ${newL.length}건 ${newL.join(", ")} · 고쳐진 문항 ${a.lw.filter((x) => !b.lw.includes(x)).length}건`);
console.log(`남은 시험 오답: ${b.tw.join(", ") || "없음"}`);
