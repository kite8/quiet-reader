  /* Optional browsing controls. All navigation stays inside the reader. */
  LDR.automation = (() => {
    const LEASE_KEY = 'quiet_reader_run_lease_v1';
    const SCHEDULE_KEY = 'quiet_reader_schedule_last_v1';
    const tabId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    const SPEEDS = {
      slow: { gap: 2400, fraction: 0.22 },
      normal: { gap: 1700, fraction: 0.32 },
      fast: { gap: 1200, fraction: 0.42 },
    };
    let initialized = false;
    let generation = 0;
    let phaseAbort = null;
    let run = null;
    let leaseToken = '';
    let heartbeatTimer = null;
    let schedulerTimer = null;
    let scheduledStart = false;
    let lastPublishedAt = 0;
    const view = {
      state: 'idle', reason: '尚未开始', completedTopics: 0, readPosts: 0,
      likedPosts: 0, currentTopicId: null, elapsedMs: 0,
    };

    function setting(key) { return LDR.settings.get(key); }
    function abortError() { return new DOMException('操作已取消', 'AbortError'); }
    function isAbort(error) { return error && error.name === 'AbortError'; }
    function ownerActive(owner, token) {
      return run === owner && generation === token && view.state === 'running'
        && phaseAbort && !phaseAbort.signal.aborted;
    }
    function assertActive(owner, token) {
      if (!ownerActive(owner, token)) throw abortError();
    }
    function activeElapsed(owner) {
      return owner.activeMs + (owner.activeAt ? Date.now() - owner.activeAt : 0);
    }
    function topicElapsed(owner) {
      return owner.topicMs + (owner.topicAt ? Date.now() - owner.topicAt : 0);
    }
    function freezeClocks(owner) {
      if (owner.activeAt) owner.activeMs += Date.now() - owner.activeAt;
      if (owner.topicAt) owner.topicMs += Date.now() - owner.topicAt;
      owner.activeAt = 0;
      owner.topicAt = 0;
      view.elapsedMs = owner.activeMs;
    }
    function publish(force = false) {
      if (run) view.elapsedMs = activeElapsed(run);
      if (!force && Date.now() - lastPublishedAt < 700) return;
      lastPublishedAt = Date.now();
      LDR.emit('automation:state', { ...view });
    }
    function getState() {
      return { ...view, elapsedMs: run ? activeElapsed(run) : view.elapsedMs };
    }
    function cancelPhase() {
      generation++;
      if (phaseAbort) phaseAbort.abort();
      phaseAbort = null;
    }
    function wait(ms, owner, token) {
      assertActive(owner, token);
      const signal = phaseAbort.signal;
      return new Promise((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(abortError()); };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', cancel);
          try { assertActive(owner, token); resolve(); } catch (error) { reject(error); }
        }, Math.max(0, ms));
        signal.addEventListener('abort', cancel, { once: true });
      });
    }
    function guarded(promise, owner, token, timeoutMs = 30000) {
      assertActive(owner, token);
      const signal = phaseAbort.signal;
      return new Promise((resolve, reject) => {
        let done = false;
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', cancel);
        };
        const finish = (error, value) => {
          if (done) return;
          done = true;
          cleanup();
          if (error) reject(error);
          else {
            try { assertActive(owner, token); resolve(value); } catch (failure) { reject(failure); }
          }
        };
        const cancel = () => finish(abortError());
        const timer = setTimeout(() => finish(new Error('加载超时，请手动检查当前帖子')), timeoutMs);
        signal.addEventListener('abort', cancel, { once: true });
        Promise.resolve(promise).then(value => finish(null, value), error => finish(error));
      });
    }

    function readLease() {
      try {
        const value = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
        return value && value.expires > Date.now() ? value : null;
      } catch (_) { return null; }
    }
    function acquireLease() {
      const old = readLease();
      if (old && old.tabId !== tabId) {
        return '另一个标签页正在自动阅读，请先在那里停止';
      }
      const token = tabId + ':' + Date.now() + ':' + Math.random().toString(36).slice(2);
      try {
        localStorage.setItem(LEASE_KEY, JSON.stringify({ tabId, token, expires: Date.now() + 120000 }));
        if (readLease()?.token !== token) return '其他标签页刚刚开始阅读，请稍后再试';
      } catch (_) {
        return '无法保存运行锁，请允许本地存储后再开启自动阅读';
      }
      leaseToken = token;
      return '';
    }
    function releaseLease() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      try {
        if (leaseToken && readLease()?.token === leaseToken) localStorage.removeItem(LEASE_KEY);
      } catch (_) { /* A storage failure must not prevent stopping. */ }
      leaseToken = '';
    }
    function ownsLease() {
      return !!leaseToken && readLease()?.token === leaseToken;
    }
    function startHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (view.state !== 'running') return;
        if (!ownsLease()) {
          stop('运行锁已由其他标签页接管');
          return;
        }
        try {
          localStorage.setItem(LEASE_KEY, JSON.stringify({
            tabId, token: leaseToken, expires: Date.now() + 120000,
          }));
        } catch (_) { stop('无法续期运行锁，已停止'); }
      }, 5000);
    }
    function localDay() {
      const date = new Date();
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
        + '-' + String(date.getDate()).padStart(2, '0');
    }
    function markScheduledDay() {
      try { localStorage.setItem(SCHEDULE_KEY, localDay()); } catch (_) { /* lease already guards this run */ }
    }
    function addQueue(owner, topics) {
      for (const item of topics || []) {
        const id = Number(item.id);
        if (!Number.isSafeInteger(id) || id <= 0 || owner.queued.has(id) || owner.attempted.has(id)) continue;
        owner.queued.add(id);
        owner.queue.push({ id, title: String(item.title || ''), url: String(item.url || '') });
      }
    }
    function safeListUrl(path) {
      const url = new URL(path, location.origin);
      if (url.origin !== location.origin) throw new Error('列表来源必须属于当前网站');
      if (!url.pathname.endsWith('.json')) url.pathname += '.json';
      return url.href;
    }
    async function fetchListPage(owner, token, path) {
      const url = safeListUrl(path);
      const response = await guarded(fetch(url, {
        credentials: 'same-origin', headers: { Accept: 'application/json' },
        signal: phaseAbort.signal,
      }), owner, token);
      if (!response.ok) throw new Error('读取话题列表失败（HTTP ' + response.status + '）');
      const data = await guarded(response.json(), owner, token);
      if (!Array.isArray(data?.topic_list?.topics)) throw new Error('话题列表返回格式不正确');
      addQueue(owner, data.topic_list.topics);
      const next = data.topic_list.more_topics_url;
      owner.cursor = typeof next === 'string' && next ? safeListUrl(next) : null;
      if (owner.cursor === url || owner.listPages.has(owner.cursor)) owner.cursor = null;
      owner.listPages.add(url);
    }
    async function takeNext(owner, token) {
      assertActive(owner, token);
      if (!owner.queue.length && owner.scope === 'current') {
        addQueue(owner, LDR.reader.listTopics());
      }
      let pages = 0;
      while (!owner.queue.length && owner.cursor && pages < 3) {
        const path = owner.cursor;
        // Keep the cursor until the page succeeds, so pause/resume can retry it.
        await fetchListPage(owner, token, path);
        pages++;
      }
      assertActive(owner, token);
      const topic = owner.queue.shift() || null;
      if (topic) {
        owner.queued.delete(topic.id);
        owner.attempted.add(topic.id);
      }
      return topic;
    }
    async function initializeQueue(owner, token) {
      if (owner.queueInitialized) return;
      assertActive(owner, token);
      if (owner.scope === 'current') addQueue(owner, LDR.reader.listTopics());
      else await fetchListPage(owner, token, '/' + owner.scope + '.json');
      assertActive(owner, token);
      owner.queueInitialized = true;
    }
    function attachSession(owner, session) {
      if (!session || session.closed) return;
      if (owner.session === session && owner.topicStarted) return;
      owner.session = session;
      owner.attempted.add(Number(session.topicId));
      owner.queue = owner.queue.filter(item => item.id !== Number(session.topicId));
      owner.queued.delete(Number(session.topicId));
      owner.topicStarted = true;
      owner.topicMs = 0;
      owner.topicAt = view.state === 'running' ? Date.now() : 0;
      owner.visibleSince.clear();
      owner.seenFloors.clear();
      owner.likeDecisions.clear();
      owner.bottomSince = 0;
      owner.lastExpandHeight = -1;
      view.currentTopicId = Number(session.topicId);
      view.reason = '正在阅读当前帖子';
      publish(true);
    }
    async function openTopic(owner, token, topic) {
      assertActive(owner, token);
      owner.openingTopic = topic.id;
      view.currentTopicId = topic.id;
      view.reason = '正在打开帖子';
      publish(true);
      const promise = Promise.resolve(LDR.reader.open(topic.id, 0, { automatic: true }));
      owner.openPromise = promise;
      promise.then(session => {
        if (run !== owner) {
          if (!session.closed && run?.session !== session && LDR.reader.getCurrent() === session) session.close('stopped');
          return;
        }
        // A second Next action may have replaced this pending open already.
        if (owner.openPromise === promise && LDR.reader.getCurrent() === session) attachSession(owner, session);
      }, () => {}).finally(() => {
        if (owner.openPromise === promise) {
          owner.openPromise = null;
          owner.openingTopic = null;
        }
      });
      const session = await guarded(promise, owner, token);
      attachSession(owner, session);
      return session;
    }
    function visiblePosts(session) {
      const root = session.body.getBoundingClientRect();
      return session.getPosts().filter(post => {
        const node = post.content || post.node;
        if (!node || !node.isConnected) return false;
        const rect = node.getBoundingClientRect();
        const visible = Math.min(rect.bottom, root.bottom) - Math.max(rect.top, root.top);
        const target = Math.min(60, Math.max(8, rect.height * 0.35));
        return rect.height > 0 && rect.width > 0 && visible >= target;
      });
    }
    async function observePosts(owner, token, session) {
      const now = Date.now();
      const posts = visiblePosts(session);
      const visibleIds = new Set();
      for (const post of posts) {
        const key = Number(post.id) || 'floor-' + Number(post.number);
        visibleIds.add(key);
        owner.seenFloors.add(Number(post.number));
        if (!owner.visibleSince.has(key)) owner.visibleSince.set(key, now);
      }
      for (const key of owner.visibleSince.keys()) {
        if (!visibleIds.has(key)) owner.visibleSince.delete(key);
      }
      if (!setting('autoLike') || !setting('showReactions') || setting('maxLikes') <= 0
        || owner.likeBudgetUsed >= setting('maxLikes') || Date.now() - owner.lastLikeAt < 5000) return;
      for (const post of posts) {
        assertActive(owner, token);
        const key = Number(post.id);
        if (!key || owner.likeDecisions.has(key) || (setting('likeMainOnly') && Number(post.number) !== 1)) continue;
        if (now - (owner.visibleSince.get(key) || now) < 1800) continue;
        owner.likeDecisions.add(key);
        if (Math.random() * 100 >= setting('likeProbability')) continue;
        if (!setting('autoLike') || owner.likeBudgetUsed >= setting('maxLikes')) return;
        owner.lastLikeAt = Date.now();
        owner.pendingLikes++;
        owner.likeBudgetUsed++;
        const request = (async () => {
          assertActive(owner, token);
          return session.likePost(key);
        })();
        // A request already sent can finish after pause. Keep its slot reserved
        // until the result is known, without scheduling any further action.
        request.then(liked => {
          owner.pendingLikes--;
          if (liked) owner.likedPosts++;
          else owner.likeBudgetUsed--;
          if (run === owner) {
            view.likedPosts = owner.likedPosts;
            publish(true);
          }
        }, () => {
          owner.pendingLikes--;
          // A failed/aborted response can be ambiguous; retain this budget slot.
        });
        try {
          await guarded(request, owner, token, 15000);
        } catch (error) {
          if (isAbort(error)) throw error;
          LDR.log('本次自动点赞未完成：' + error.message, 'warn');
          if (/429|403|频繁|rate.?limit/i.test(error.message || '')) {
            pause('自动点赞遇到限制，请检查页面后手动继续');
            throw abortError();
          }
        }
        break;
      }
    }
    function finish(reason, error = false) {
      const owner = run;
      if (owner) freezeClocks(owner);
      cancelPhase();
      releaseLease();
      run = null;
      view.state = error ? 'error' : 'finished';
      view.reason = reason;
      LDR.log(reason, error ? 'warn' : 'info');
      publish(true);
    }
    async function completeTopic(owner, token, why) {
      assertActive(owner, token);
      const session = owner.session;
      if (session?.getState().failed) throw new Error('当前帖子加载失败，未计为完成');
      if (!owner.completed.has(Number(session.topicId))) {
        owner.completed.add(Number(session.topicId));
        view.completedTopics = owner.completed.size;
        LDR.log('已处理第 ' + view.completedTopics + ' 个帖子：' + why);
      }
      publish(true);
      if (view.completedTopics >= setting('maxTopics')) {
        finish('已达到本轮帖子数量上限');
        return false;
      }
      if (!setting('autoNext')) {
        finish('当前帖子已完成，自动换帖未开启');
        return false;
      }
      await wait(setting('randomPacing') ? 800 + Math.random() * 800 : 1000, owner, token);
      if (!setting('autoNext')) {
        finish('当前帖子已完成，自动换帖已关闭');
        return false;
      }
      const topic = await takeNext(owner, token);
      if (!setting('autoNext')) {
        finish('当前帖子已完成，自动换帖已关闭');
        return false;
      }
      if (view.completedTopics >= setting('maxTopics') || activeElapsed(owner) >= setting('maxMinutes') * 60000) {
        finish('已达到本轮阅读上限');
        return false;
      }
      if (!topic) {
        finish('当前队列已完成');
        return false;
      }
      assertActive(owner, token);
      // reader.open performs the draft check before closing the current modal.
      await openTopic(owner, token, topic);
      return true;
    }
    async function loop(owner, token) {
      try {
        await wait(90, owner, token);
        if (!ownsLease()) throw new Error('其他标签页已经取得运行权');
        if (owner.openPromise) {
          const session = await guarded(owner.openPromise, owner, token);
          attachSession(owner, session);
        }
        await initializeQueue(owner, token);
        if (!owner.session || owner.session.closed) {
          const topic = await takeNext(owner, token);
          if (!topic) { finish('没有找到可阅读的话题，请先打开一个帖子或切换列表来源'); return; }
          await openTopic(owner, token, topic);
        }
        while (ownerActive(owner, token)) {
          if (!setting('popupEnabled')) { stop('弹窗阅读已关闭'); return; }
          if (setting('pauseWhenHidden') && document.visibilityState !== 'visible') {
            pause('hidden');
            return;
          }
          if (!ownsLease()) throw new Error('运行锁已由其他标签页接管');
          if (activeElapsed(owner) >= setting('maxMinutes') * 60000) {
            finish('已达到本轮时长上限');
            return;
          }
          const session = owner.session;
          if (!session || session.closed || LDR.reader.getCurrent() !== session) {
            stop('阅读窗口已关闭或切换');
            return;
          }
          const status = session.getState();
          if (status.failed) throw new Error('当前帖子加载失败，自动浏览已停止');
          if (status.closed) { stop('阅读窗口已关闭'); return; }
          if (!status.ready || status.loading) {
            if (topicElapsed(owner) >= setting('topicTimeoutSeconds') * 1000) {
              throw new Error('等待帖子内容超时，未计为完成');
            }
            view.reason = '正在等待内容加载';
            publish();
            await wait(250, owner, token);
            continue;
          }
          await observePosts(owner, token, session);
          assertActive(owner, token);
          const maxFloors = Number(setting('maxFloors'));
          if (maxFloors > 0 && owner.seenFloors.size >= maxFloors) {
            await wait(1600, owner, token);
            if (!await completeTopic(owner, token, '达到每帖楼层上限')) return;
            continue;
          }
          if (topicElapsed(owner) >= setting('topicTimeoutSeconds') * 1000) {
            if (!await completeTopic(owner, token, '达到单帖停留上限')) return;
            continue;
          }
          const body = session.body;
          const nearBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 140;
          const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 8;
          if (nearBottom && status.hasMore) {
            view.reason = '正在加载后续楼层';
            publish();
            await guarded(session.loadMore(), owner, token);
            owner.bottomSince = 0;
            await wait(150, owner, token);
            continue;
          }
          if (atBottom && !status.hasMore) {
            // Existing manual tree views may still have collapsed child branches.
            if (!session.automatic && session.expandReplies && owner.lastExpandHeight !== body.scrollHeight) {
              owner.lastExpandHeight = body.scrollHeight;
              await guarded(session.expandReplies(), owner, token);
              assertActive(owner, token);
              if (body.scrollTop + body.clientHeight < body.scrollHeight - 8 || session.getState().hasMore) {
                owner.bottomSince = 0;
                continue;
              }
            }
            if (!owner.bottomSince) owner.bottomSince = Date.now();
            if (Date.now() - owner.bottomSince >= 1800 && !session.getState().loading) {
              if (!await completeTopic(owner, token, '已到达内容末尾')) return;
              continue;
            }
            await wait(300, owner, token);
            continue;
          }
          owner.bottomSince = 0;
          if (!setting('autoScroll')) {
            view.reason = '自动滚动已关闭，等待当前内容进入视野';
            publish();
            await wait(300, owner, token);
            continue;
          }
          const speed = SPEEDS[setting('speed')] || SPEEDS.normal;
          const scale = setting('randomPacing') ? 0.85 + Math.random() * 0.3 : 1;
          view.reason = '正在阅读当前帖子';
          publish();
          await wait(speed.gap * scale, owner, token);
          assertActive(owner, token);
          if (!setting('autoScroll')) continue;
          // Only the reader's scrollable body is moved. No document/window scrolling.
          const distance = Math.max(40, Math.round(body.clientHeight * speed.fraction * scale));
          body.scrollTop = Math.min(body.scrollHeight - body.clientHeight, body.scrollTop + distance);
        }
      } catch (error) {
        if (isAbort(error) || !ownerActive(owner, token)) return;
        finish(error?.message || '自动浏览发生错误，已停止', true);
      }
    }
    function launchPhase(owner) {
      freezeClocks(owner);
      cancelPhase();
      phaseAbort = new AbortController();
      const token = generation;
      owner.activeAt = Date.now();
      if (owner.session) owner.topicAt = Date.now();
      view.state = 'running';
      startHeartbeat();
      publish(true);
      // Every rejected promise is handled in loop; the UI is never blocked for the whole run.
      void loop(owner, token);
    }
    async function begin(source) {
      if (view.state === 'running') return;
      if (view.state === 'paused' && source === 'manual') return resume();
      if (!setting('popupEnabled')) {
        view.state = 'stopped'; view.reason = '请先开启弹窗阅读'; publish(true); return;
      }
      if (!setting('autoScroll') && !setting('autoNext') && !setting('autoLike')) {
        view.state = 'stopped'; view.reason = '请先开启自动滚动、自动换帖或自动点赞'; publish(true); return;
      }
      if (setting('pauseWhenHidden') && document.visibilityState !== 'visible') {
        view.state = 'stopped'; view.reason = '请回到当前标签页后开始'; publish(true); return;
      }
      const lockError = acquireLease();
      if (lockError) {
        view.state = 'stopped'; view.reason = lockError; LDR.log(lockError, 'warn'); publish(true); return;
      }
      const owner = {
        queue: [], queued: new Set(), attempted: new Set(), completed: new Set(),
        readKeys: new Set(), listPages: new Set(), cursor: null,
        scope: setting('queueScope'), queueInitialized: false,
        session: null, openPromise: null, openingTopic: null, topicStarted: false,
        activeMs: 0, activeAt: 0, topicMs: 0, topicAt: 0,
        seenFloors: new Set(), visibleSince: new Map(), likeDecisions: new Set(),
        likedPosts: 0, pendingLikes: 0, likeBudgetUsed: 0,
        lastLikeAt: 0, bottomSince: 0, lastExpandHeight: -1, pauseReason: '',
      };
      run = owner;
      Object.assign(view, {
        state: 'running', reason: '准备开始', completedTopics: 0, readPosts: 0,
        likedPosts: 0, currentTopicId: null, elapsedMs: 0,
      });
      const existing = LDR.reader.getCurrent();
      if (existing && !existing.closed && existing.getState().ready) attachSession(owner, existing);
      markScheduledDay();
      LDR.log(source === 'schedule' ? '定时启动本轮阅读' : '开始本轮阅读');
      launchPhase(owner);
    }
    function start() { return begin('manual'); }
    function pause(reason = 'manual') {
      if (!run || view.state !== 'running') return;
      const owner = run;
      freezeClocks(owner);
      owner.pauseReason = reason;
      cancelPhase();
      releaseLease();
      view.state = 'paused';
      view.reason = reason === 'hidden' ? '标签页已切到后台，自动浏览已暂停'
        : reason === 'interaction' ? '你已手动接管，点击继续可恢复'
          : reason === 'manual' ? '已暂停' : String(reason);
      owner.bottomSince = 0;
      owner.visibleSince.clear();
      publish(true);
    }
    async function resume() {
      if (!run || view.state !== 'paused') return;
      if (!setting('popupEnabled')) { stop('弹窗阅读已关闭'); return; }
      if (setting('pauseWhenHidden') && document.visibilityState !== 'visible') return;
      const lockError = acquireLease();
      if (lockError) { view.reason = lockError; publish(true); return; }
      run.pauseReason = '';
      view.reason = '继续阅读';
      launchPhase(run);
    }
    function stop(reason = '已停止') {
      const owner = run;
      if (owner) freezeClocks(owner);
      cancelPhase();
      releaseLease();
      run = null;
      if (owner?.session && !owner.session.ready && !owner.session.closed) {
        owner.session.close('stopped');
      }
      view.state = 'stopped';
      view.reason = String(reason);
      LDR.log(view.reason);
      publish(true);
    }
    async function next() {
      if (!run || (view.state !== 'running' && view.state !== 'paused')) {
        LDR.log('请先开始一轮阅读，再切换下一帖');
        return;
      }
      const owner = run;
      const wasPaused = view.state === 'paused';
      freezeClocks(owner);
      cancelPhase();
      if (wasPaused) {
        const lockError = acquireLease();
        if (lockError) { view.reason = lockError; publish(true); return; }
      }
      phaseAbort = new AbortController();
      const token = generation;
      view.state = 'running';
      owner.activeAt = Date.now();
      startHeartbeat();
      try {
        if (!ownsLease()) throw new Error('其他标签页已经取得运行权');
        await initializeQueue(owner, token);
        const topic = await takeNext(owner, token);
        if (!topic) { finish('没有下一帖'); return; }
        assertActive(owner, token);
        await openTopic(owner, token, topic);
        if (wasPaused) pause('manual');
        else launchPhase(owner);
      } catch (error) {
        if (!isAbort(error) && ownerActive(owner, token)) finish(error.message, true);
      }
    }
    function fromPanel(event) {
      return event.composedPath().some(node => node instanceof Element
        && (node.id === 'quiet-reader-controls' || node.hasAttribute('data-quiet-reader-ui')));
    }
    function onUserInteraction(event) {
      if (!event.isTrusted || !run || view.state !== 'running' || !setting('pauseOnInteraction') || fromPanel(event)) return;
      // Manual scrolling is expected when only next-topic or likes are enabled.
      // Editing/clicking an interactive control still hands control to the user.
      if (!setting('autoScroll')) {
        const target = event.target instanceof Element ? event.target : null;
        const interactive = !!target?.closest('a,button,input,textarea,select,[contenteditable="true"]');
        const scrollKey = event.type === 'keydown' && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key);
        if (event.type === 'wheel' || event.type === 'touchstart' || (!interactive && (scrollKey || event.type === 'pointerdown'))) return;
      }
      if (event.type === 'keydown' && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Escape', 'Enter'].includes(event.key)) return;
      const session = run.session;
      if (session && (event.type === 'keydown' || event.composedPath().includes(session.overlay))) pause('interaction');
    }
    function checkSchedule() {
      if (scheduledStart || !setting('scheduleEnabled') || view.state === 'running' || view.state === 'paused') return;
      if (setting('pauseWhenHidden') && document.visibilityState !== 'visible') return;
      const match = /^(\d{2}):(\d{2})$/.exec(String(setting('scheduleTime')));
      if (!match) return;
      const hours = Number(match[1]), minutes = Number(match[2]);
      if (hours > 23 || minutes > 59) return;
      const now = new Date();
      const delta = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() - hours * 3600 - minutes * 60;
      if (delta < 0 || delta >= 120) return;
      try { if (localStorage.getItem(SCHEDULE_KEY) === localDay()) return; } catch (_) { return; }
      scheduledStart = true;
      Promise.resolve(begin('schedule')).finally(() => { scheduledStart = false; });
    }
    function updateScheduler() {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
      if (!setting('scheduleEnabled')) return;
      schedulerTimer = setInterval(checkSchedule, 15000);
      checkSchedule();
    }
    function init() {
      if (initialized) return;
      initialized = true;
      LDR.on('reader:opened', ({ session }) => {
        if (!run || !session) return;
        if (run.openingTopic === Number(session.topicId)) {
          run.session = session;
          run.topicStarted = false;
        } else if (run.session !== session && (view.state === 'running' || view.state === 'paused')) {
          stop('已手动切换帖子，自动浏览已停止');
        }
      });
      LDR.on('reader:closed', ({ session, reason }) => {
        if (!run || session !== run.session || reason === 'next') return;
        stop(reason === 'settings' ? '阅读设置已改变，请重新开始' : '阅读窗口已关闭');
      });
      LDR.on('reader:read', ({ topicId, postNumber }) => {
        if (!run || !run.attempted.has(Number(topicId))) return;
        const key = String(topicId) + ':' + String(postNumber);
        run.readKeys.add(key);
        view.readPosts = run.readKeys.size;
        publish();
      });
      LDR.on('reader:error', ({ session, error }) => {
        if (!run || session !== run.session || isAbort(error)) return;
        finish(error?.message || '阅读窗口加载失败', true);
      });
      LDR.on('settings:changed', ({ key, value }) => {
        if (key === 'popupEnabled' && !value && run) stop('弹窗阅读已关闭');
        if (key === 'scheduleEnabled' || key === 'scheduleTime') updateScheduler();
        if (key === 'pauseWhenHidden' && value && document.visibilityState !== 'visible' && run) pause('hidden');
        publish(true);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' && setting('pauseWhenHidden')) pause('hidden');
        else if (document.visibilityState === 'visible' && run?.pauseReason === 'hidden') void resume();
        if (document.visibilityState === 'visible') checkSchedule();
      });
      window.addEventListener('focus', checkSchedule);
      for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        document.addEventListener(name, onUserInteraction, { capture: true, passive: true });
      }
      window.addEventListener('storage', event => {
        if (event.key === LEASE_KEY && view.state === 'running' && leaseToken && !ownsLease()) {
          stop('其他标签页已开始阅读，本页已停止');
        }
      });
      window.addEventListener('pagehide', () => {
        stop('页面已离开，自动浏览已停止');
      });
      updateScheduler();
      publish(true);
    }
    return { init, start, pause, resume, stop, next, getState };
  })();
