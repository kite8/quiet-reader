'use strict';

// No browser, packages, or real network requests. Execute the actual reader
// functions inside a small VM with controlled network and DOM boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/reader.js'), 'utf8');

function extract(start, end) {
  const first = source.indexOf(start);
  assert.notEqual(first, -1, `Missing source start: ${start}`);
  const last = source.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `Missing source end: ${end}`);
  return source.slice(first, last);
}

const likeHelpers = extract('  function likeInfo(', '  function parseTopicHref(');
const footerCode = extract('  function patchCoreLike(', '  function updateCommentsHeader(');
const automaticLikeCode = extract('      async likePost(postId) {', "      close(reason = 'user')")
  .trim().replace(/^async /, 'async function ').replace(/,\s*$/, '');
const readCode = extract('    function loadMore() {', '\n\n    try {\n      const results = await Promise.all');
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function testLikeStateAndLock() {
  const requests = [];
  let finishRequest;
  const post = {
    id: 10101, post_number: 1,
    actions_summary: [{ id: 2, count: 0, can_act: true, acted: false }],
  };
  const button = {
    disabled: false,
    classList: { toggle() {} },
    querySelector() { return {}; },
    addEventListener(name, callback) {
      assert.equal(name, 'click');
      this.clickHandler = callback;
    },
  };
  const count = { textContent: '0' };
  const controller = new AbortController();
  const context = {
    BASE: 'https://fixture.invalid', ICONS: { like: '' },
    LDR: { settings: { get: () => true } },
    ctx: {
      postMap: new Map([[1, post]]), nodeMap: new Map(),
      signal: controller.signal, assertActive() {},
    },
    signal: controller.signal,
    overlay: { querySelector(selector) { return selector === '.ldp-f-like' ? button : count; } },
    updatePostReactions() {},
    async apiSend(url, method) {
      requests.push(method);
      if (requests.length === 1) await new Promise((resolve) => { finishRequest = resolve; });
      return {};
    },
    alert(message) { throw new Error(message); },
  };
  vm.createContext(context);
  vm.runInContext(`${likeHelpers}\n${footerCode}\n${automaticLikeCode}
    this.bind = bindFooterLike; this.like = likePost;`, context);
  context.bind(button, count, post, context.ctx);

  const inFlight = context.like(post.id);
  assert.equal(button.disabled, true, 'Automatic requests disable the footer');
  assert.equal(post._qrLikePending, true);
  await button.clickHandler(); // Also test a synthetic click that bypasses native disabled behavior.
  assert.deepEqual(requests, ['POST'], 'The footer cannot submit during an automatic request');
  finishRequest();
  assert.equal(await inFlight, true);
  assert.equal(count.textContent, 1);
  assert.equal(button.disabled, false);
  assert.equal(post._qrLikePending, undefined);

  await button.clickHandler();
  assert.deepEqual(requests, ['POST', 'DELETE'], 'The footer reads the new liked state');
  assert.equal(count.textContent, 0);
  assert.equal(post.actions_summary[0].count, 0);
  assert.equal(post.actions_summary[0].acted, false);
}

function makeNode(number) {
  return {
    dataset: { postId: String(number), postNumber: String(number) },
    classList: { add() {} },
    querySelector() { return { style: { display: 'none' } }; },
    getBoundingClientRect() { return { top: number * 100 }; },
  };
}

function createReadContext() {
  const stream = Array.from({ length: 100 }, (_, index) => index + 1);
  const nodes = new Map(stream.slice(0, 20).map((number) => [number, makeNode(number)]));
  const context = {
    Promise, DOMException, Number, Set, Map,
    PAGE_SIZE: 20, BASE: 'https://fixture.invalid', signal: new AbortController().signal,
    session: { closed: false, ready: true, getPosts: () => [] },
    ctx: { nodeMap: nodes, childLoads: new Map(), streamMode: true, assertActive() {} },
    body: {
      scrollTop: 0, scrollHeight: 10000, clientHeight: 800,
      style: { overflowAnchor: '' }, getBoundingClientRect() { return { top: 0 }; },
    },
    downTip: { classList: { add() {}, remove() {} } },
    upTip: { classList: { add() {}, remove() {} } },
    overlay: { dataset: {} }, topicEl: { appendChild() {} }, commentsEl: { appendChild() {} },
    renderStream(posts) {
      for (const post of posts) nodes.set(post.post_number, makeNode(post.post_number));
    },
    remember() {}, applyReaderSettings() {}, updateBottom() {}, clearLoadError() {},
    showLoadError(error) { throw error; }, resolveTargetPostNumber: (number) => number,
  };
  vm.createContext(context);
  vm.runInContext(`
    let stream = ${JSON.stringify(stream)};
    let downCursor = 20, upCursor = 0, rootsPage = 0, mode = 'stream';
    let moreRoots = false, loadingInitial = false, topicId = 101;
    let downPromise = null, upPromise = null, expandPromise = null, navigationPromise = null;
    ${readCode}
    this.more = loadMore; this.go = navigateFloor; this.expand = expandReplies;
    this.state = () => ({ downCursor, upCursor, navigating: !!navigationPromise });
  `, context);
  return { context, stream };
}

async function testNavigationWaitsForPagination() {
  const { context, stream } = createReadContext();
  const calls = [];
  let releasePage;
  context.fetchPosts = async (ids) => {
    calls.push(`page:${ids[0]}`);
    if (ids[0] === 21) {
      await new Promise((resolve) => { releasePage = resolve; });
      calls.push('page-finished');
    }
    return ids.map((number) => ({ id: number, post_number: number }));
  };
  context.fetchJSON = async () => {
    calls.push('anchor');
    return { post_stream: {
      stream,
      posts: Array.from({ length: 20 }, (_, index) => ({ id: 60 + index, post_number: 60 + index })),
    } };
  };

  const page = context.more();
  const navigation = context.go(60);
  await nextTurn();
  assert.deepEqual(calls, ['page:21'], 'Navigation must not race the existing page request');
  assert.equal(context.state().navigating, true);
  releasePage();
  await Promise.all([page, navigation]);
  assert.deepEqual(calls, ['page:21', 'page-finished', 'anchor']);
  assert.equal(context.state().downCursor, 79);
  assert.equal(context.state().navigating, false);

  await context.more();
  assert.equal(calls.at(-1), 'page:80', 'The old page cannot overwrite the new window cursor');
  assert.equal(context.state().downCursor, 99);
}

async function testEarlierExpandedContentIsRevisited() {
  const { context } = createReadContext();
  const oldNode = makeNode(2);
  oldNode.querySelector = () => ({ style: { display: 'block' } });
  const newNode = makeNode(3);
  let added = false;
  context.ctx.nodeMap = new Map([[2, oldNode]]);
  context.body.scrollTop = 500;
  context.body.getBoundingClientRect = () => ({ top: 100 });
  context.loadAllChildren = async () => {
    assert.equal(context.body.style.overflowAnchor, 'none', 'Anchoring is suspended while old branches grow');
    context.ctx.nodeMap.set(3, newNode);
    added = true;
  };
  context.session.getPosts = () => [
    { node: oldNode, content: { getBoundingClientRect: () => ({ top: 20 }) } },
    ...(added ? [{ node: newNode, content: { getBoundingClientRect: () => ({ top: 50 }) } }] : []),
  ];
  vm.runInContext("mode = 'nested'; ctx.streamMode = false;", context);

  await context.expand();
  assert.equal(context.body.scrollTop, 438, 'New content above the viewport must be passed again');
  assert.equal(context.body.style.overflowAnchor, '', 'The original anchoring style is restored');
}

(async () => {
  for (const test of [testLikeStateAndLock, testNavigationWaitsForPagination, testEarlierExpandedContentIsRevisited]) {
    await test();
    console.log(`PASS ${test.name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
