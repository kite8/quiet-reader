'use strict';

// Exercise the real controller through its public API. No browser, network or
// third-party dependencies are needed; reader sessions and time are controlled.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/automation.js'), 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function page(topics, more) {
  return { ok: true, json: async () => ({ topic_list: { topics, more_topics_url: more } }) };
}

function visiblePost(id, number = 1) {
  const content = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 40 + number * 100, bottom: 130 + number * 100, height: 90, width: 500 }),
  };
  return { id, number, node: content, content, post: {} };
}

function harness(overrides = {}) {
  let now = 1700000000000, nextTimerId = 1, current;
  const timers = new Map(), storage = new Map(), events = new Map(), inputs = new Map();
  const settings = {
    popupEnabled: true, autoScroll: false, autoNext: false, autoLike: false,
    showReactions: true, maxLikes: 5, likeMainOnly: true, likeProbability: 50,
    maxTopics: 20, maxMinutes: 30, maxFloors: 0, topicTimeoutSeconds: 180,
    speed: 'normal', randomPacing: false, pauseWhenHidden: true,
    pauseOnInteraction: true, queueScope: 'current', scheduleEnabled: false,
    scheduleTime: '09:00', ...overrides,
  };
  const env = {
    opened: [], requests: [], likes: [],
    fetchPage: async () => page([]),
    likePost: async () => true,
  };
  const LDR = {
    settings: {
      get: key => settings[key],
      set(key, value) {
        const previous = settings[key];
        settings[key] = value;
        LDR.emit('settings:changed', { key, value, previous });
      },
    },
    on(name, callback) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(callback);
      return () => events.get(name).delete(callback);
    },
    emit(name, payload) { for (const callback of events.get(name) || []) callback(payload); },
    log() {},
  };
  function makeSession(topicId) {
    const session = {
      topicId, automatic: true, ready: true, closed: false, overlay: {}, posts: [],
      body: {
        scrollTop: 0, clientHeight: 600, scrollHeight: 3000,
        getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
      },
      getPosts: () => session.posts,
      getState: () => ({ ready: session.ready, closed: session.closed, loading: false, failed: false, hasMore: false }),
      loadMore: async () => {},
      likePost(id) { env.likes.push(id); return env.likePost(id); },
      close(reason) {
        session.closed = true;
        if (current === session) current = null;
        LDR.emit('reader:closed', { session, reason });
      },
    };
    return session;
  }
  current = makeSession(1);
  LDR.reader = {
    getCurrent: () => current,
    listTopics: () => [{ id: 1 }, { id: 2 }, { id: 3 }],
    async open(id) {
      // The real reader checks drafts before closing. Verify that the controller
      // lets this check run, rather than closing the session itself first.
      if (current?.draft) throw new Error('当前弹窗有未发送的草稿');
      current?.close('next');
      current = makeSession(id);
      env.opened.push(id);
      LDR.emit('reader:opened', { session: current });
      return current;
    },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class InputElement {
    constructor(interactive) { this.interactive = interactive; }
    closest() { return this.interactive ? this : null; }
    hasAttribute() { return false; }
  }
  function addTimer(callback, delay, interval = false) {
    const id = nextTimerId++;
    timers.set(id, { callback, due: now + delay, delay, interval });
    return id;
  }
  const context = {
    LDR, Date: ClockDate, Math: Object.assign(Object.create(Math), { random: () => 0.01 }),
    DOMException, AbortController, URL, Element: InputElement,
    location: { origin: 'https://example.test' },
    document: { visibilityState: 'visible', addEventListener: (name, callback) => inputs.set(name, callback) },
    window: { addEventListener() {} },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    setTimeout: (callback, delay) => addTimer(callback, delay),
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => addTimer(callback, delay, true),
    clearInterval: id => timers.delete(id),
    fetch(url, options) { env.requests.push(url); return env.fetchPage(url, options); },
  };
  // setImmediate lets promise continuations drain without using the fake clock.
  const flush = () => new Promise(resolve => setImmediate(resolve));
  async function tick(milliseconds) {
    const end = now + milliseconds;
    let count = 0;
    await flush();
    while (true) {
      let next;
      for (const item of timers) {
        if (item[1].due <= end && (!next || item[1].due < next[1].due)) next = item;
      }
      if (!next) break;
      assert.ok(++count < 10000, 'controller should not spin indefinitely');
      const [id, timer] = next;
      now = timer.due;
      if (timer.interval) timer.due += timer.delay;
      else timers.delete(id);
      timer.callback();
      await flush();
    }
    now = end;
    await flush();
  }
  async function until(predicate, message) {
    for (let elapsed = 0; elapsed < 20000 && !predicate(); elapsed += 100) await tick(100);
    assert.ok(predicate(), message);
  }
  vm.runInNewContext(source, context, { filename: 'src/automation.js' });
  LDR.automation.init();
  return Object.assign(env, {
    LDR, tick, until,
    getSession: () => current,
    api: LDR.automation,
    set: (key, value) => LDR.settings.set(key, value),
    input(type, interactive = false, key) {
      const target = new InputElement(interactive);
      inputs.get(type)?.({ type, target, key, isTrusted: true, composedPath: () => [target, current?.overlay] });
    },
  });
}

test('enabled controls do not start a run without Start', async () => {
  const h = harness({ autoScroll: true, autoLike: true });
  h.getSession().posts = [visiblePost(101)];
  await h.tick(20000);
  assert.equal(h.api.getState().state, 'idle');
  assert.equal(h.getSession().body.scrollTop, 0);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.likes, []);
});

test('pause and stop cancel queued scrolling; resume explicitly restarts it', async () => {
  const h = harness({ autoScroll: true });
  await h.api.start();
  await h.tick(100);
  h.api.pause();
  await h.tick(6000);
  assert.equal(h.getSession().body.scrollTop, 0);
  assert.equal(h.api.getState().state, 'paused');
  await h.api.resume();
  await h.until(() => h.getSession().body.scrollTop > 0, 'resume should scroll the modal');
  h.api.stop();
  const position = h.getSession().body.scrollTop;
  await h.tick(6000);
  assert.equal(h.getSession().body.scrollTop, position);
  assert.equal(h.api.getState().state, 'stopped');
  assert.deepEqual(h.opened, []);
});

test('disabling autoNext during its delay prevents the queued navigation', async () => {
  const h = harness({ autoScroll: true, autoNext: true });
  h.getSession().body.scrollHeight = 600;
  await h.api.start();
  await h.until(() => h.api.getState().completedTopics === 1, 'short topic should finish without likes');
  h.set('autoNext', false);
  await h.tick(5000);
  assert.equal(h.api.getState().state, 'finished');
  assert.equal(h.api.getState().likedPosts, 0);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.likes, []);
});

test('disabling autoNext while its next list page loads prevents navigation', async () => {
  const h = harness({ autoNext: true, queueScope: 'latest' });
  h.getSession().body.scrollHeight = 600;
  const pending = deferred();
  h.fetchPage = url => url.includes('page=') ? pending.promise : Promise.resolve(page([{ id: 1 }], '/latest?page=1'));
  await h.api.start();
  await h.until(() => h.requests.length === 2, 'the next page should be requested');
  h.set('autoNext', false);
  pending.resolve(page([{ id: 2 }]));
  await h.tick(5000);
  assert.equal(h.api.getState().state, 'finished');
  assert.deepEqual(h.opened, []);
});

test('paused pagination retries its cursor when resumed', async () => {
  const h = harness({ autoNext: true, queueScope: 'latest' });
  h.getSession().body.scrollHeight = 600;
  let pages = 0;
  h.fetchPage = (url, options) => {
    if (!url.includes('page=')) return Promise.resolve(page([{ id: 1 }], '/latest?page=1'));
    if (++pages > 1) return Promise.resolve(page([{ id: 2 }]));
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    });
  };
  await h.api.start();
  await h.until(() => pages === 1, 'pagination should begin');
  h.api.pause();
  await h.tick(5000);
  assert.equal(pages, 1);
  assert.deepEqual(h.opened, []);
  await h.api.resume();
  await h.until(() => h.opened.length === 1, 'resume should retry and open the queued topic');
  assert.equal(pages, 2);
  assert.equal(h.requests[1], h.requests[2]);
  assert.deepEqual(h.opened, [2]);
  h.api.stop();
});

test('next preserves a draft when reader.open rejects the transition', async () => {
  const h = harness({ autoNext: true });
  const original = h.getSession();
  original.body.scrollHeight = 600;
  original.draft = true;
  await h.api.start();
  await h.until(() => h.api.getState().state === 'error', 'draft should block navigation');
  assert.equal(h.getSession(), original);
  assert.equal(original.closed, false);
  assert.match(h.api.getState().reason, /草稿/);
  assert.deepEqual(h.opened, []);
});

test('autoLike can run alone and remains bounded without scrolling or next', async () => {
  const h = harness({ autoLike: true, likeMainOnly: false, maxLikes: 1 });
  h.getSession().posts = [visiblePost(101), visiblePost(102, 2)];
  await h.api.start();
  await h.until(() => h.api.getState().likedPosts === 1, 'visible post should receive a like');
  await h.tick(12000);
  assert.equal(h.api.getState().state, 'running');
  assert.deepEqual(h.likes, [101]);
  assert.equal(h.getSession().body.scrollTop, 0);
  assert.deepEqual(h.opened, []);
  h.api.stop();
});

test('manual scroll works with only next or likes; interactive controls still pause', async () => {
  for (const feature of ['autoNext', 'autoLike']) {
    const h = harness({ [feature]: true });
    await h.api.start();
    await h.tick(100);
    h.input('wheel');
    h.input('touchstart');
    h.input('keydown', false, 'ArrowDown');
    await h.tick(500);
    assert.equal(h.api.getState().state, 'running', `${feature} should allow manual scrolling`);
    h.input('pointerdown', true);
    assert.equal(h.api.getState().state, 'paused', 'clicking an interactive control hands control to the user');
    await h.api.resume();
    h.set('autoScroll', true);
    h.input('wheel');
    assert.equal(h.api.getState().state, 'paused', 'manual scrolling takes over an automatic scroll run');
    h.api.stop();
  }
});

test('pause cancels queued likes and a late result cannot restart automation', async () => {
  const h = harness({ autoLike: true, likeMainOnly: false, maxLikes: 2 });
  h.getSession().posts = [visiblePost(101), visiblePost(102, 2)];
  const pending = deferred();
  h.likePost = id => id === 101 ? pending.promise : Promise.resolve(true);
  await h.api.start();
  await h.tick(1000);
  h.api.pause();
  await h.tick(10000);
  assert.deepEqual(h.likes, []);
  await h.api.resume();
  await h.until(() => h.likes.length === 1, 'resuming should permit the first like');
  h.api.pause();
  pending.resolve(true);
  await h.tick(12000);
  assert.equal(h.api.getState().state, 'paused');
  assert.equal(h.api.getState().likedPosts, 1);
  assert.deepEqual(h.likes, [101]);
  assert.deepEqual(h.opened, []);
  await h.api.resume();
  await h.until(() => h.api.getState().likedPosts === 2, 'explicit resume should permit the second like');
  h.api.stop();
  await h.tick(12000);
  assert.deepEqual(h.likes, [101, 102]);
  assert.equal(h.getSession().body.scrollTop, 0);
});
