# test_web.py — 화면 시험(연결 실습 ①: 시작 화면 처리 기록 골라 보기·엑셀)
# 실행: python -m http.server 8000 -d web  을 띄운 뒤
#       python test_web.py [화면 주소, 기본 http://127.0.0.1:8000]
# ⚠ 기록을 새로 만들어 시험하므로 서버 공유 주소(*.vercel.app)에는 돌리지 않는다(브라우저 저장 주소 전용).
import sys, os, re, tempfile, datetime
from playwright.sync_api import sync_playwright
import openpyxl

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
if ".vercel.app" in URL:
    sys.exit("서버 공유 주소에는 돌리지 않습니다(시험 기록이 서버에 남음). 내 PC 주소로 실행하세요.")
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = tempfile.mkdtemp(prefix="test_web_")
ok = fail = 0
errs = []

def check(name, cond, detail=""):
    global ok, fail
    print(("통과" if cond else "실패") + " | " + name + (" | " + str(detail) if detail != "" else ""))
    ok, fail = ok + bool(cond), fail + (not cond)

def wait_msg(pg, before=""):
    pg.wait_for_function("t => { const m = document.querySelector('#msg'); return m && m.innerText.trim() && m.innerText !== t; }", arg=before, timeout=20000)
    return pg.inner_text("#msg").strip()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True).new_page()
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: d.accept())

    # ── 준비: 접수 → 의원K-01 산업정책과 배분 → 산업정책과 재배정 요청 → 운영지원과로 다시 배분 · 의원K-02 산업정책과 배분·회신
    pg.goto(URL + "/assign.html")
    pg.wait_for_function("document.querySelector('#count').innerText.length > 0")
    pg.set_input_files("#csv", os.path.join(BASE, "data", "문항목록.csv"))
    pg.wait_for_function("!document.getElementById('register').disabled")
    m = pg.inner_text("#msg"); pg.click("#register"); wait_msg(pg, m)
    for cid in ["의원K-01", "의원K-02"]:
        r = pg.locator(f"#rows tr[data-id='{cid}']"); r.locator("select.main").select_option("산업정책과")
        m = pg.inner_text("#msg"); r.locator("button.go").click(); wait_msg(pg, m)
    pg.goto(URL + "/dept.html?과=산업정책과")
    pg.wait_for_function("document.querySelector('#count').innerText.length > 0")
    c = pg.locator("section.case[data-id='의원K-01']"); c.locator("details.co summary").click()
    c.locator("input.why").fill("인사 업무라 운영지원과 소관"); c.locator("select.want").select_option("운영지원과")
    m = pg.inner_text("#msg"); c.locator("button.ask").click(); wait_msg(pg, m)
    c = pg.locator("section.case[data-id='의원K-02']"); c.locator("input.memo").fill("해당 자료 없음")
    m = pg.inner_text("#msg"); c.locator("button.send").click(); wait_msg(pg, m)
    pg.goto(URL + "/assign.html")
    pg.wait_for_function("document.querySelector('#count').innerText.length > 0")
    r = pg.locator("#rows tr[data-id='의원K-01']")
    m = pg.inner_text("#msg"); r.locator("button.go").click(); wait_msg(pg, m)    # 희망 과(운영지원과)가 기본값

    # ── 시작 화면 ───────────────────────────────────────
    pg.goto(URL + "/index.html")
    pg.wait_for_function("document.querySelector('#logCount').innerText.length > 0")
    total = int(re.search(r"전체 (\d+)건", pg.inner_text("#logCount")).group(1))
    check("골라 보기 전: n건 / 전체 n건", pg.inner_text("#logCount") == f"{total}건 / 전체 {total}건", pg.inner_text("#logCount"))
    check("작업 목록", pg.locator("#fWork option").all_inner_texts() == ["전체", "접수", "배분", "재배정요청", "회신"], pg.locator("#fWork option").all_inner_texts())

    # ① 과 = 산업정책과 → 그 과 기록만 · 엑셀 행 수 같음
    pg.select_option("#fDept", "산업정책과")
    rows = pg.locator("#log tr")
    n = rows.count(); depts = {rows.nth(i).locator("td").nth(3).inner_text().split(" (")[0] for i in range(n)}
    check("과=산업정책과 → 그 과 기록만", n > 0 and depts == {"산업정책과"} and pg.inner_text("#logCount") == f"{n}건 / 전체 {total}건", f"{n}건 · 과 {depts}")
    with pg.expect_download() as d: pg.click("#logXlsx")
    f = os.path.join(OUT, d.value.suggested_filename); d.value.save_as(f)
    ws = openpyxl.load_workbook(f).active
    head = [c.value for c in ws[1]]
    check("엑셀 파일 이름·열", d.value.suggested_filename == "처리기록_국회요구자료.xlsx" and head == ["일시", "작업", "문항", "과", "지금상태"], f"{d.value.suggested_filename} {head}")
    check("엑셀 행 수 = 골라 본 건수", ws.max_row - 1 == n, f"엑셀 {ws.max_row - 1} · 화면 {n}")
    check("엑셀 첫 행 = 화면 첫 행", [str(c.value) for c in ws[2]][:3] == [rows.nth(0).locator("td").nth(k).inner_text() for k in range(3)])

    # ② 문항 = 의원K-01 → 접수 · 배분 · 재배정요청 · 배분 (최근 것이 위)
    pg.select_option("#fDept", "")
    pg.fill("#fCase", "의원K-01")
    works = [pg.locator("#log tr").nth(i).locator("td").nth(1).inner_text() for i in range(pg.locator("#log tr").count())]
    check("문항=의원K-01 → 배분 · 재배정요청 · 배분(+접수)", works == ["배분", "재배정요청", "배분", "접수"], works)
    now_state = pg.locator("#log tr").nth(0).locator("td").nth(4).inner_text()
    check("지금 상태 열 = 그 문항의 현재 상태", now_state == "배분확정", now_state)
    pg.fill("#fCase", "의원K-0")
    ids = {pg.locator("#log tr").nth(i).locator("td").nth(2).inner_text() for i in range(pg.locator("#log tr").count())}
    check("문항 앞부분 일치(의원K-0 → 의원K-01~09, 접수 기록 포함)", ids == {f"의원K-0{k}" for k in range(1, 10)}, sorted(ids))

    # ③ 일시가 한국시간인가
    first = pg.locator("#log tr").nth(0).locator("td").nth(0).inner_text()
    kst_now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    diff = abs((datetime.datetime.strptime(first, "%Y-%m-%d %H:%M").replace(tzinfo=kst_now.tzinfo) - kst_now).total_seconds())
    check("일시 = 한국시간(지금과 5분 안)", re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", first) and diff < 300, f"{first} · 차이 {int(diff)}초")
    check("UTC 저장값은 한국시간으로 바꿔 보여 줌", pg.evaluate("kst('2026-11-11T01:05:00Z')") == "2026-11-11 10:05" and pg.evaluate("kst('2026-11-11 10:05')") == "2026-11-11 10:05")
    b.close()

check("콘솔 오류 없음", not errs, errs)
print(f"\n통과 {ok} · 실패 {fail}")
sys.exit(1 if fail else 0)
