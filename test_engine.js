// test_engine.js — web/engine.js를 시험 40건으로 채점한다.
// 실행: node test_engine.js            (원본 배분기준표)
//       node test_engine.js 규칙.csv   (다른 규칙 파일, 예: data/rules_보강.csv)
const fs = require("fs");
const path = require("path");
const Engine = require("./web/engine.js");

const DATA = path.join(__dirname, "data");
const rulesFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DATA, "배분기준표_소관키워드_304건.csv");
const read = (f) => fs.readFileSync(f, "utf8");

const eng = Engine.create(read(rulesFile), read(path.join(DATA, "A부_조직도_26개과.csv")));
const tests = Engine.parseCSV(read(path.join(DATA, "시험_요구문항_40건.csv")));

console.log(`규칙 ${path.basename(rulesFile)} ${eng.ruleCount}건 · 조직도 ${eng.depts.length}개 과 · 조직도 밖 규칙 ${eng.outside.length}건`);

let top1 = 0, top3 = 0;
const wrong = [];
for (const t of tests) {
  const c = eng.classify(t.요구내용);
  const names = c.map((x) => x.과);
  if (names[0] === t.정답_배분과) top1++;
  if (names.includes(t.정답_배분과)) top3++;
  if (names[0] !== t.정답_배분과) wrong.push({ t, c });
}

const n = tests.length;
console.log(`\n1순위 정답 ${top1}/${n} (${Math.round((top1 / n) * 100)}%) · 3순위 안 ${top3}/${n}`);
console.log(`\n틀린 문항 ${wrong.length}건`);
console.log("시험번호 | 요구내용 | 정답 | 엔진 결과(점수·근거키워드)");
for (const { t, c } of wrong) {
  const res = c.length ? c.map((x) => `${x.과}(${x.점수}: ${x.근거키워드.join("·")})`).join(" > ") : "(후보 없음)";
  console.log(`${t.시험번호} | ${t.요구내용} | ${t.정답_배분과} | ${res}`);
}
