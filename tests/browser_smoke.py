#!/usr/bin/env python3
"""Browser integration checks against an isolated, fully mocked forum.

No requests reach the real service. The test-only __qr handle is injected in
memory and is never included in dist. Run build.py before this file.
"""

import asyncio
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://linux.do"
SETTINGS_KEY = "quiet_reader_settings_v1"

HTML = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="csrf-token" content="fixture-only-token"><title>Quiet Reader · Demo</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f6f4;color:#203c33;font:16px/1.6 system-ui,sans-serif}
header{background:white;border-bottom:1px solid #dce6df;padding:23px 7%;font-size:22px;font-weight:650}
main{max-width:1080px;margin:42px auto;background:white;border:1px solid #e1e8e3;border-radius:14px;padding:28px}
h1{font-size:24px;margin:0 0 8px}p{color:#667b6f}table{width:100%;border-collapse:collapse}td{padding:19px 10px;border-top:1px solid #e6ede8}
a{color:#256f55;text-decoration:none}.count{color:#8a9b91;text-align:right}.notifications,.search-results{margin-top:12px;font-size:13px}
</style><header>Quiet Reader <small style="font-size:13px;font-weight:400;margin-left:15px">阅读空间 · 演示数据</small></header>
<main><h1>慢慢读，随时停</h1><p>点击标题打开阅读窗口。右下角可随时调整阅读功能。</p>
<table class="topic-list"><tr><td><a class="title" href="/t/example/101">给阅读留一点安静的时间</a></td><td class="count">6 楼</td></tr>
<tr><td><a class="title" href="/t/example/102">日常记录：工作之外的小发现</a></td><td class="count">4 楼</td></tr>
<tr><td><a class="title" href="/t/example/103">关于工具，也关于习惯</a></td><td class="count">5 楼</td></tr></table>
<div class="notifications"><a href="/t/example/101/3">通知中的楼层</a></div>
<div class="search-results"><a class="search-link" href="/t/example/102">搜索结果示例</a></div></main>
<script src="/quiet-reader-test.js"></script></html>"""


class Fixture:
    def __init__(self):
        self.requests = []
        self.errors = []
        self.sizes = {101: 6, 102: 4, 103: 5}
        self.initial = 2
        self.fail_topics = set()
        self.fail_pages = set()
        self.delay_topics = {}
        self.tall = False
        self.script = (ROOT / "dist/quiet-reader.user.js").read_text(encoding="utf-8")
        marker = "  LDR.ui.init();"
        assert self.script.count(marker) == 1
        self.script = self.script.replace(marker, "  window.__qr = LDR;\n" + marker)

    def post(self, topic, number):
        height = 1350 if self.tall and number == 1 else 125
        text = ["给阅读留一点安静的时间", "日常记录：工作之外的小发现", "关于工具，也关于习惯"][(topic - 101) % 3]
        cooked = f'<div style="min-height:{height}px"><p>{text}</p><p>这是第 {number} 楼的演示正文，用于检验停留、滚动、分页和控制面板。</p></div>'
        if number == 1:
            cooked += '<p><span class="spoiler">这是一段折叠的示例内容</span></p><a class="lightbox" href="/demo.png"><img src="/demo.png" width="80" height="50" alt="测试图片"></a>'
        return {
            "id": topic * 100 + number, "topic_id": topic, "post_number": number,
            "username": "reader" if number == 1 else "visitor", "name": "阅读者" if number == 1 else "来访者",
            "cooked": cooked, "created_at": "2026-11-19T06:00:00.000Z",
            "trust_level": 2, "can_boost": True, "boosts": [], "reactions": [],
            "actions_summary": [{"id": 2, "count": 0, "can_act": True, "acted": False}],
            "children": [], "direct_reply_count": 0, "reply_count": 0,
        }

    def topic(self, topic, posts=None):
        size = self.sizes.get(topic, 3)
        return {
            "id": topic, "title": f"阅读示例 #{topic}", "posts_count": size,
            "highest_post_number": size, "last_read_post_number": 0, "views": 42,
            "category_id": 1, "tags": ["随笔"], "bookmarked": False,
            "details": {"created_by": {"username": "reader"}},
            "post_stream": {"stream": [topic * 100 + n for n in range(1, size + 1)],
                            "posts": posts or [self.post(topic, n) for n in range(1, min(self.initial, size) + 1)]},
        }

    async def route(self, route):
        request = route.request
        parsed = urlparse(request.url)
        path, query = parsed.path, parse_qs(parsed.query)
        self.requests.append({"method": request.method, "path": path, "query": parsed.query, "body": request.post_data})
        if parsed.netloc != "linux.do":
            await route.fulfill(status=200, content_type="text/plain", body="")
            return
        status, data = 200, {}
        if path == "/quiet-reader-test.js":
            await route.fulfill(content_type="text/javascript", body=self.script)
            return
        if path == "/demo.png":
            await route.fulfill(content_type="image/svg+xml", body='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" rx="6" fill="#cce8d6"/></svg>')
            return
        if path == "/session/current.json":
            data = {"current_user": {"username": "tester"}}
        elif path in ("/latest.json", "/new.json", "/unread.json"):
            data = {"topic_list": {"topics": [{"id": k, "title": f"示例{k}"} for k in self.sizes]}}
        elif re.fullmatch(r"/t/\d+/posts.json", path):
            topic = int(path.split("/")[2])
            if topic in self.fail_pages:
                status, data = 503, {"errors": ["fixture page failure"]}
            else:
                ids = query.get("post_ids[]", [])
                data = {"post_stream": {"posts": [self.post(topic, int(i) - topic * 100) for i in ids]}}
        elif re.fullmatch(r"/t/\d+.json", path):
            topic = int(path.split("/")[2].split(".")[0])
            if topic in self.delay_topics:
                await asyncio.sleep(self.delay_topics[topic])
            if topic in self.fail_topics:
                status, data = 503, {"errors": ["fixture topic failure"]}
            else:
                data = self.topic(topic)
        elif re.fullmatch(r"/n/-/\d+.json", path):
            topic = int(path.split("/")[3].split(".")[0])
            if topic in self.fail_topics:
                status, data = 503, {"errors": ["fixture topic failure"]}
            else:
                roots = [self.post(topic, n) for n in range(2, self.sizes.get(topic, 3) + 1)]
                if len(roots) > 1:
                    roots[0]["children"] = [roots.pop(1)]
                    roots[0]["direct_reply_count"] = 1
                data = {"op_post": self.post(topic, 1), "roots": roots, "topic": self.topic(topic), "has_more_roots": False, "page": 0}
        elif "/children/" in path:
            data = {"children": [], "has_more": False, "page": 0}
        elif re.fullmatch(r"/u/[^/]+/card.json", path):
            data = {"user": {"username": "reader", "name": "阅读者", "trust_level": 2, "bio_cooked": "<p>测试资料卡</p>"}, "badges": [], "user_badges": []}
        elif path == "/post_actions" and request.method == "POST":
            data = {"id": int(parse_qs(request.post_data or "").get("id", [10101])[0]), "actions_summary": [{"id": 2, "count": 1, "acted": True, "can_undo": True}]}
        elif request.method == "GET" and not (path.endswith(".json") or "/emoji" in path):
            await route.fulfill(content_type="text/html", body=HTML)
            return
        await route.fulfill(status=status, content_type="application/json", body=json.dumps(data))

    async def new_page(self, browser, settings=None, mobile=False):
        context = await browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 1000}, locale="zh-CN")
        await context.route("**/*", self.route)
        if settings:
            await context.add_init_script("localStorage.setItem(" + json.dumps(SETTINGS_KEY) + ", " + json.dumps(json.dumps(settings)) + ");")
        page = await context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        await page.goto(ORIGIN + "/latest")
        await page.wait_for_selector("#quiet-reader-controls")
        return context, page


async def config(page, **values):
    await page.evaluate("values => Object.entries(values).forEach(([key,value]) => __qr.settings.set(key,value))", values)


async def current(page):
    return await page.evaluate("__qr.automation.getState()")


async def advance(page, milliseconds):
    # Clock fast-forwards browser timers; fixture network dispatch is given real turns.
    for _ in range(max(1, milliseconds // 500)):
        await page.clock.run_for(min(500, milliseconds))
        await asyncio.sleep(0.015)


async def test_panel(browser):
    fixture = Fixture()
    context, page = await fixture.new_page(browser)
    defaults = await page.evaluate("__qr.settings.all()")
    assert all(defaults[k] is False for k in ("autoScroll", "autoNext", "autoLike", "scheduleEnabled"))
    assert (await current(page))["state"] == "idle"
    assert not any(r["method"] != "GET" for r in fixture.requests)
    await page.get_by_role("button", name="打开阅读控制台", exact=True).click()
    await page.get_by_role("checkbox", name="楼中楼排版", exact=True).uncheck()
    assert await page.evaluate("__qr.settings.get('nestedReplies')") is False
    await page.reload()
    await page.wait_for_selector("#quiet-reader-controls")
    assert await page.evaluate("__qr.settings.get('nestedReplies')") is False
    await config(page, panelOpen=False)
    await page.locator("a.title").first.click()
    await page.wait_for_function("__qr.reader.getCurrent()?.ready")
    assert await page.locator(".ldp-post").count() == 6
    # Feature toggles hide controls without destroying the user's draft.
    await page.locator(".ldp-f-reply").click()
    textarea = page.locator(".ldp-post textarea").first
    await textarea.fill("保留这段未发送的草稿")
    await config(page, showReply=False, showReactions=False, showBoost=False, showBookmark=False, floorNavigator=False, stickyToolbar=False)
    assert not await page.locator(".ldp-comments .ldp-like").first.is_visible()
    assert not await page.locator(".ldp-post .ldp-replybtn").first.is_visible()
    assert not await page.locator(".ldp-footer").is_visible()
    assert not await page.locator(".ldp-slider").is_visible()
    await config(page, showReply=True, showReactions=True, showBoost=True, showBookmark=True, floorNavigator=True, stickyToolbar=True)
    assert await textarea.input_value() == "保留这段未发送的草稿"
    assert await page.locator(".ldp-comments .ldp-like").first.is_visible()
    # Escape inside the panel must not close the reader behind it.
    await page.get_by_role("button", name="打开阅读控制台", exact=True).click()
    await page.get_by_role("button", name="收起控制台", exact=True).press("Escape")
    assert await page.locator(".ldp-overlay").count() == 1
    await config(page, popupEnabled=False)
    assert await textarea.input_value() == "保留这段未发送的草稿"
    await page.locator(".ldp-close").click()
    await page.locator("a.title").first.click()
    await page.wait_for_url("**/t/example/101")
    assert await page.locator(".ldp-overlay").count() == 0
    assert not fixture.errors, fixture.errors
    await context.close()


async def test_automatic(browser):
    fixture = Fixture()
    context, page = await fixture.new_page(browser, {"autoScroll": True, "autoNext": True, "speed": "fast", "maxTopics": 2, "pauseOnInteraction": False})
    await page.clock.install()
    await page.evaluate("__qr.automation.start()")
    await advance(page, 1500)
    await page.wait_for_function("__qr.reader.getCurrent()?.ready")
    assert await page.evaluate("__qr.reader.getCurrent().automatic") is True
    before = await page.evaluate("window.scrollY")
    await advance(page, 6500)
    assert await page.evaluate("__qr.reader.getCurrent().body.scrollTop") > 0
    assert await page.evaluate("window.scrollY") == before
    await page.evaluate("__qr.automation.pause()")
    assert (await current(page))["state"] == "paused"
    top = await page.evaluate("__qr.reader.getCurrent().body.scrollTop")
    await advance(page, 4000)
    assert await page.evaluate("__qr.reader.getCurrent().body.scrollTop") == top
    await page.evaluate("__qr.automation.resume()")
    for _ in range(18):
        await advance(page, 4000)
        if (await current(page))["state"] in ("finished", "error"):
            break
    state = await current(page)
    assert state["state"] == "finished", state
    assert state["completedTopics"] == 2, state
    assert state["likedPosts"] == 0
    assert not any(r["method"] != "GET" and "post_actions" in r["path"] for r in fixture.requests)
    assert any(r["path"] == "/t/101/posts.json" for r in fixture.requests)
    assert not fixture.errors, fixture.errors
    await context.close()


async def test_stop_and_errors(browser):
    fixture = Fixture()
    context, page = await fixture.new_page(browser, {"autoScroll": True, "autoNext": True})
    await page.clock.install()
    await page.evaluate("__qr.automation.start()")
    await advance(page, 1500)
    await page.wait_for_function("__qr.reader.getCurrent()?.ready")
    await page.evaluate("__qr.automation.stop('测试停止')")
    topic = await page.evaluate("__qr.reader.getCurrent().topicId")
    top = await page.evaluate("__qr.reader.getCurrent().body.scrollTop")
    await advance(page, 12000)
    assert (await current(page))["state"] == "stopped"
    assert await page.evaluate("__qr.reader.getCurrent().topicId") == topic
    assert await page.evaluate("__qr.reader.getCurrent().body.scrollTop") == top
    await page.evaluate("__qr.reader.close()")
    fixture.fail_topics.add(101)
    await page.evaluate("__qr.automation.start()")
    await advance(page, 2500)
    state = await current(page)
    assert state["state"] == "error", state
    assert state["completedTopics"] == 0
    await context.close()


async def test_tracking_and_visibility(browser):
    fixture = Fixture()
    fixture.tall = True
    context, page = await fixture.new_page(browser, {"autoScroll": True})
    await page.clock.install()
    await page.evaluate("__qr.reader.open(101, 1, {automatic:true})")
    await advance(page, 6500)
    timings = [r for r in fixture.requests if r["path"] == "/topics/timings"]
    assert timings, "Tall posts must be tracked when their content is visible"
    await config(page, readTracking=False)
    count = len(timings)
    await advance(page, 6500)
    assert len([r for r in fixture.requests if r["path"] == "/topics/timings"]) == count
    await page.evaluate("__qr.automation.start()")
    await advance(page, 2000)
    await page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable:true,get:()=> 'hidden'}); document.dispatchEvent(new Event('visibilitychange'))")
    assert (await current(page))["state"] == "paused"
    await page.evaluate("__qr.automation.stop()")
    await page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable:true,get:()=> 'visible'}); document.dispatchEvent(new Event('visibilitychange'))")
    await advance(page, 2000)
    assert (await current(page))["state"] == "stopped", "Returning to foreground must not undo Stop"
    assert not fixture.errors, fixture.errors
    await context.close()


async def test_schedule(browser):
    fixture = Fixture()
    context, page = await fixture.new_page(browser, {"autoScroll": True})
    await page.clock.install()
    await page.evaluate("__qr.settings.set('scheduleTime', new Date().toTimeString().slice(0,5)); __qr.settings.set('scheduleEnabled', true)")
    await advance(page, 1500)
    assert (await current(page))["state"] == "running"
    await page.evaluate("__qr.automation.stop()")
    assert await page.evaluate("__qr.settings.get('scheduleEnabled')") is True
    await advance(page, 20000)
    assert (await current(page))["state"] == "stopped", "A daily schedule must not re-run on the same day"
    await config(page, scheduleEnabled=False)
    assert not fixture.errors, fixture.errors
    await context.close()


async def screenshots(browser):
    folder = ROOT / "qa"
    folder.mkdir(exist_ok=True)
    fixture = Fixture()
    context, page = await fixture.new_page(browser, {"panelOpen": True})
    await page.screenshot(path=str(folder / "panel-desktop.png"))
    await context.close()
    context, page = await fixture.new_page(browser, {"panelOpen": True}, mobile=True)
    assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    await page.screenshot(path=str(folder / "panel-mobile.png"))
    await context.close()


async def main():
    async with async_playwright() as playwright:
        executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
        options = {"headless": True, "args": ["--no-sandbox"]}
        if executable:
            options["executable_path"] = executable
        browser = await playwright.chromium.launch(**options)
        results = []
        try:
            for test in (test_panel, test_automatic, test_stop_and_errors, test_tracking_and_visibility, test_schedule):
                await test(browser)
                results.append(test.__name__)
                print("PASS", test.__name__, flush=True)
            await screenshots(browser)
            print("PASS desktop/mobile layout screenshots", flush=True)
        finally:
            await browser.close()
        (ROOT / "qa").mkdir(exist_ok=True)
        (ROOT / "qa/results.json").write_text(json.dumps({"passed": results, "network": "all routes mocked; no real site requests"}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
