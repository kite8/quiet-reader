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
const reactionCode = extract('  async function toggleReaction(', '  function reactionPanelHtml(');
const reactionUiCode = extract('  function updatePostReactions(', '  /* ============ 2.6.2');
const findPostCode = extract('  function findPostForNode(', '  function findPollForNode(');
const actionsCode = extract('  function bindActions(', '  /* ============ 12.');
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function createLikeContext(number = 1) {
  const requests = [], alerts = [], floorCount = { textContent: 0 }, footerCount = { textContent: 0 };
  let finishRequest, rejectRequest, onClick;
  const post = { id: 10100 + number, post_number: number,
    actions_summary: [{ id: 2, count: 0, can_act: true, acted: false }] };
  const button = (count) => ({
    disabled: false, dataset: { acted: '0' }, classList: { toggle() {} },
    querySelector: (selector) => selector === '.ldp-like-count' ? count : {},
    addEventListener(name, callback) { if (name === 'click') this.clickHandler = callback; },
  });
  const floor = button(floorCount), footer = button(footerCount), reaction = button({});
  reaction.getAttribute = () => 'smile';
  const overlay = { querySelector: (selector) => selector === '.ldp-f-like' ? footer : footerCount };
  const node = { dataset: { postId: String(post.id), postNumber: String(number) },
    querySelector: (selector) => selector === '.ldp-like' ? floor : null,
    closest: (selector) => selector === '.ldp-overlay' ? overlay : null };
  const signal = new AbortController().signal;
  const context = {
    BASE: 'https://fixture.invalid', ICONS: { like: '' },
    LDR: { settings: { get: () => true } }, idToPost: new Map(),
    ctx: { postMap: new Map([[number, post]]), nodeMap: new Map([[number, node]]), signal, assertActive() {} },
    signal, overlay, renderReactions: () => '', refreshEmojiUrls() {},
    reactionImgHtml: () => '', closeReactionPanel() {}, alert: (message) => alerts.push(message),
    async apiSend(url, method) {
      requests.push(method);
      if (requests.length === 1) return new Promise((resolve, reject) => { finishRequest = resolve; rejectRequest = reject; });
      return context.reply || {};
    },
  };
  vm.createContext(context);
  vm.runInContext(`${likeHelpers}\n${footerCode}\n${automaticLikeCode}
    ${reactionCode}\n${reactionUiCode}\n${findPostCode}\n${actionsCode}
    this.bind = bindFooterLike; this.like = likePost; this.bindActions = bindActions;`, context);
  if (number === 1) context.bind(footer, footerCount, post, context.ctx);
  context.bindActions({ addEventListener(name, callback) { if (name === 'click') onClick = callback; } }, context.ctx);
  return { context, post, floor, footer, floorCount, footerCount, requests, alerts,
    finish: (response = {}) => finishRequest(response), fail: () => rejectRequest(new Error('fixture failure')),
    click: (kind) => onClick({ target: { closest(selector) {
      if (selector === '.ldp-post') return node;
      if (selector === '.ldp-like' && kind === 'core') return floor;
      if (selector === '.ldp-reaction' && kind === 'reaction') return reaction;
      return null;
    } }, preventDefault() {}, stopPropagation() {} }),
  };
}

async function testLikeStateAndLock() {
  const f = createLikeContext();
  const inFlight = f.context.like(f.post.id);
  assert.equal(f.footer.disabled, true);
  await f.footer.clickHandler(); // Synthetic click bypasses native disabled behavior.
  assert.deepEqual(f.requests, ['POST']);
  f.finish();
  assert.equal(await inFlight, true);
  assert.equal(f.footerCount.textContent, 1);
  assert.equal(f.footer.disabled, false);
  await f.footer.clickHandler();
  assert.deepEqual(f.requests, ['POST', 'DELETE'], 'The footer reads the current liked state');
  assert.equal(f.footerCount.textContent, 0);
  assert.equal(f.post.actions_summary[0].count, 0);
}

async function testAutomaticBlocksFloorCore() {
  const f = createLikeContext(2);
  const inFlight = f.context.like(f.post.id);
  assert.equal(f.floor.disabled, false, 'Exercise the model lock even when a stale button is enabled');
  await f.click('core');
  assert.deepEqual(f.requests, ['POST'], 'A manual reply like cannot race an automatic like');
  f.finish(); await inFlight;
  assert.equal(f.floorCount.textContent, 1);
  assert.equal(f.post.actions_summary[0].count, 1);
  assert.equal(f.post._qrLikePending, undefined);
}

async function testFloorCoreBlocksAutomatic() {
  const f = createLikeContext(2);
  const inFlight = f.click('core');
  assert.equal(await f.context.like(f.post.id), false);
  assert.deepEqual(f.requests, ['POST'], 'Automatic likes cannot race a manual reply like');
  f.finish(); await inFlight;
  assert.equal(f.floorCount.textContent, 1);
  assert.equal(f.floor.dataset.acted, '1');
  assert.equal(f.floor.disabled, false);
  assert.equal(f.post._qrLikePending, undefined);
}

async function testCustomReactionSharesLockWithoutFooterReentry() {
  const f = createLikeContext();
  const inFlight = f.click('reaction');
  assert.equal(await f.context.like(f.post.id), false);
  await f.click('core'); await f.footer.clickHandler();
  assert.deepEqual(f.requests, ['PUT'], 'All other entry points respect a pending custom reaction');
  f.finish({ current_user_reaction: { id: 'smile' }, reactions: [{ id: 'smile', count: 1 }] });
  await inFlight;
  assert.equal(f.floorCount.textContent, 1);
  assert.equal(f.footerCount.textContent, 1);
  f.context.reply = { current_user_reaction: null, reactions: [] };
  await f.footer.clickHandler();
  assert.deepEqual(f.requests, ['PUT', 'PUT'], 'The footer delegates before acquiring the reaction lock');
  assert.equal(f.post._qrLikePending, undefined);
  assert.equal(f.footer.disabled, false);
  assert.equal(f.footerCount.textContent, 0);
}

async function testReactionLocksReleaseAfterFailure() {
  for (const entry of ['auto', 'core', 'reaction', 'footer']) {
    const f = createLikeContext();
    const inFlight = entry === 'auto' ? f.context.like(f.post.id)
      : entry === 'footer' ? f.footer.clickHandler() : f.click(entry);
    f.fail(); await inFlight.catch(() => {});
    assert.equal(f.post._qrLikePending, undefined, `${entry} releases its lock`);
    assert.equal(f.floor.disabled, false);
    assert.equal(f.footer.disabled, false);
    assert.equal(f.post.actions_summary[0].count, 0);
  }
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
  for (const test of [testLikeStateAndLock, testAutomaticBlocksFloorCore, testFloorCoreBlocksAutomatic,
    testCustomReactionSharesLockWithoutFooterReentry, testReactionLocksReleaseAfterFailure,
    testNavigationWaitsForPagination, testEarlierExpandedContentIsRevisited]) {
    await test();
    console.log(`PASS ${test.name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
