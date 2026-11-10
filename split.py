# split.py — 원문/의 자료요구서 PDF를 문항 단위로 나눠 data/문항목록.csv로 저장한다.
# 규칙: 처리지침_초안.md 제9조(문항 분해) · 제27조(개인정보 저장 금지)
# 실행: python split.py   (이 파일이 있는 폴더에서)
import csv
import re
import sys
from pathlib import Path

from pypdf import PdfReader

BASE = Path(__file__).resolve().parent          # 01_공통툴_국회요구자료
SRC = BASE / "원문"                              # 입력: 요구서 PDF (읽기만)
OUT = BASE / "data" / "문항목록.csv"             # 결과: 새 파일

COLS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"]

RE_TITLE = re.compile(r"^(\S+위원회)\s+(\S+)\s+의원실\s+자료요구서")    # 1. 첫 줄: 위원회·의원
RE_DUE = re.compile(r"제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.")  # 2. 제출기한
RE_SKIP = re.compile(r"^(수신:|담당 보좌관:|끝\.)")                      # 3. 문항에 넣지 않는 줄
RE_ITEM = re.compile(r"^(\d+)\.\s*(.*)$")                                 # 4. 「숫자.」 = 새 문항
RE_SUB = re.compile(r"^[가나다라마바사아자차카타파하]\.\s*")              # 5. 「가.」「나.」 = 세부항목 ([가-하]는 「끝.」 등 모든 음절이 걸려서 쓰지 않음)
RE_NOTE = re.compile(r"^※\s*")                                            # 5. 「※」 = 비고


def read_lines(pdf: Path) -> list[str]:
    """PDF 전 쪽의 글자를 줄 목록으로 읽는다(빈 줄 제외)."""
    text = "\n".join(page.extract_text() or "" for page in PdfReader(pdf).pages)
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def split_pdf(pdf: Path) -> list[dict]:
    """요구서 1건을 문항 목록으로 나눈다."""
    committee = member = due = ""
    items: list[dict] = []
    last = None  # 바로 앞 항목: ("요구내용"|"세부항목"|"비고")

    for line in read_lines(pdf):
        if m := RE_TITLE.match(line):
            committee, member = m.group(1), m.group(2)
            continue
        if line.startswith("수신:") and (m := RE_DUE.search(line)):
            y, mo, d = m.groups()
            due = f"{y}-{int(mo):02d}-{int(d):02d}"
        if RE_SKIP.match(line):          # 수신·담당 보좌관(이름·연락처)·끝. 은 저장하지 않음
            continue
        if m := RE_ITEM.match(line):
            items.append({"번호": int(m.group(1)), "요구내용": m.group(2), "세부항목": [], "비고": []})
            last = "요구내용"
            continue
        if not items:                    # 첫 문항 전의 알 수 없는 줄은 버리지 않고 알림
            print(f"  [확인] {pdf.name}: 첫 문항 전 줄 무시 → {line}")
            continue
        cur = items[-1]
        if RE_SUB.match(line):
            cur["세부항목"].append(line)
            last = "세부항목"
        elif RE_NOTE.match(line):
            cur["비고"].append(line)
            last = "비고"
        else:                            # 6. 그 밖의 줄은 바로 앞 항목에 잇는다
            if last == "요구내용":
                cur["요구내용"] += " " + line
            else:
                cur[last][-1] += " " + line

    return [
        {
            "파일명": pdf.name, "위원회": committee, "의원": member, "제출기한": due,
            "문항번호": it["번호"], "요구내용": it["요구내용"],
            "세부항목": " / ".join(it["세부항목"]), "비고": " / ".join(it["비고"]),
        }
        for it in items
    ]


def main() -> int:
    pdfs = sorted(SRC.glob("*.pdf"))
    rows: list[dict] = []
    print("파일명 | 파일명의 문항 수 | 뽑은 문항 수 | 마지막 번호 | 번호 연속 | 일치")
    ok_all = True
    for pdf in pdfs:
        part = split_pdf(pdf)
        rows += part
        nums = [r["문항번호"] for r in part]
        m = re.search(r"_(\d+)문항", pdf.stem)
        expect = int(m.group(1)) if m else None
        seq = nums == list(range(1, len(nums) + 1))
        ok = expect == len(part) == (nums[-1] if nums else 0) and seq and all(r["제출기한"] for r in part)
        ok_all &= ok
        print(f"{pdf.name} | {expect} | {len(part)} | {nums[-1] if nums else '-'} | {'O' if seq else 'X'} | {'O' if ok else 'X'}")

    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:   # utf-8-sig: 엑셀에서 한글 안 깨짐
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)
    print(f"합계 {len(rows)}행 → {OUT.relative_to(BASE)}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
