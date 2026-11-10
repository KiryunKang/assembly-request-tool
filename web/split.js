// split.js — 요구서 PDF 글자를 문항 단위로 나눈다(split.py와 같은 규칙을 JS로 옮김).
// 규칙: 처리지침.md 제2장(접수·분해) · 개인정보(보좌관 이름·연락처) 저장 금지
// 쓰는 법(브라우저):
//   const lines = await Split.readPdf(pdfjsLib, arrayBuffer);   // PDF → 줄 목록
//   const rows  = Split.splitLines(lines, 파일명);               // 줄 목록 → 문항 목록
//   const chk   = Split.check(파일명, rows);                      // 파일명의 문항 수와 비교
(function (root) {
  "use strict";

  const COLS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];
  const RE_TITLE = /^(\S+위원회)\s+(\S+)\s+의원실\s+자료요구서/;           // 1. 첫 줄: 위원회·의원
  const RE_DUE = /제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./;        // 2. 제출기한
  const RE_SKIP = /^(수신:|담당 보좌관:|끝\.)/;                              // 3. 문항에 넣지 않는 줄
  const RE_ITEM = /^(\d+)\.\s*(.*)$/;                                         // 4. 「숫자.」 = 새 문항
  const RE_SUB = /^[가나다라마바사아자차카타파하]\.\s*/;                     // 5. 「가.」「나.」 = 세부항목([가-하]는 모든 음절이 걸림)
  const RE_NOTE = /^※\s*/;                                                    // 5. 「※」 = 비고

  // pdf.js로 PDF 전 쪽의 글자를 줄 목록으로 읽는다(빈 줄 제외). 같은 높이(y)의 글자 조각을 한 줄로 잇는다.
  async function readPdf(pdfjsLib, data) {
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      let line = "", y = null, endX = null;
      const flush = () => { if (line.trim()) out.push(line.trim().replace(/\s+/g, " ")); line = ""; };
      for (const it of tc.items) {
        if (!("str" in it)) continue;
        const iy = it.transform[5], ix = it.transform[4];
        if (y !== null && Math.abs(iy - y) > 2) { flush(); endX = null; }
        // 같은 줄인데 앞 조각 끝과 떨어져 있으면 띄어쓰기를 넣는다
        if (line && endX !== null && ix - endX > 1 && !/\s$/.test(line) && !/^\s/.test(it.str)) line += " ";
        line += it.str;
        y = iy; endX = ix + (it.width || 0);
        if (it.hasEOL) { flush(); endX = null; }
      }
      flush();
    }
    return out;
  }

  // 줄 목록 → 문항 목록. split.py split_pdf()와 같은 순서로 판정한다.
  function splitLines(lines, fileName) {
    let committee = "", member = "", due = "", last = null, m;
    const items = [], skipped = [];
    for (const line of lines) {
      if ((m = line.match(RE_TITLE))) { committee = m[1]; member = m[2]; continue; }
      if (line.startsWith("수신:") && (m = line.match(RE_DUE))) {
        due = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
      }
      if (RE_SKIP.test(line)) continue;               // 수신·담당 보좌관(이름·연락처)·끝. 은 저장하지 않음
      if ((m = line.match(RE_ITEM))) {
        items.push({ 번호: Number(m[1]), 요구내용: m[2], 세부항목: [], 비고: [] });
        last = "요구내용";
        continue;
      }
      if (!items.length) { skipped.push(line); continue; }   // 첫 문항 전의 알 수 없는 줄
      const cur = items[items.length - 1];
      if (RE_SUB.test(line)) { cur.세부항목.push(line); last = "세부항목"; }
      else if (RE_NOTE.test(line)) { cur.비고.push(line); last = "비고"; }
      else if (last === "요구내용") cur.요구내용 += " " + line;   // 6. 그 밖의 줄은 바로 앞 항목에 잇는다
      else cur[last][cur[last].length - 1] += " " + line;
    }
    const rows = items.map((it) => ({
      파일명: fileName, 위원회: committee, 의원: member, 제출기한: due,
      문항번호: it.번호, 요구내용: it.요구내용,
      세부항목: it.세부항목.join(" / "), 비고: it.비고.join(" / "),
    }));
    rows.skipped = skipped;
    return rows;
  }

  // 파일명의 「n문항」과 뽑은 문항 수·마지막 번호·번호 연속·제출기한을 비교한다.
  function check(fileName, rows) {
    const m = String(fileName).match(/_(\d+)문항/);
    const expect = m ? Number(m[1]) : null;
    const nums = rows.map((r) => r.문항번호);
    const lastNo = nums.length ? nums[nums.length - 1] : 0;
    const seq = nums.every((n, i) => n === i + 1);
    const ok = expect === rows.length && rows.length === lastNo && seq && rows.every((r) => r.제출기한);
    return { 파일명: fileName, 기대: expect, 문항수: rows.length, 마지막번호: lastNo, 번호연속: seq, 일치: ok };
  }

  const Split = { COLS, readPdf, splitLines, check };
  if (typeof module === "object" && module.exports) module.exports = Split;   // node
  else root.Split = Split;                                                    // 브라우저
})(typeof self !== "undefined" ? self : this);
