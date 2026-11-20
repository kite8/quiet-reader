  // Quiet Reader: settings, events and isolated control panel.
  const LDR = (() => {
    const VERSION = '__QUIET_READER_VERSION__';
    const STORAGE_KEY = 'quiet_reader_settings_v1';
    const defaults = Object.freeze({
      popupEnabled: true, interceptNotifications: true, interceptSearch: true, resumeReading: true,
      nestedReplies: true, imageLightbox: true, userCards: true, mathRendering: true,
      videoPlayer: true, spoilerProtection: true, showReactions: true, showReply: true,
      showBoost: true, showBookmark: true, showPolls: true, floorNavigator: true,
      stickyToolbar: true, readTracking: true,
      autoScroll: false, autoNext: false, randomPacing: false, speed: 'normal',
      maxTopics: 20, maxMinutes: 30, maxFloors: 0, topicTimeoutSeconds: 180,
      autoLike: false, likeMainOnly: true, likeProbability: 10, maxLikes: 5,
      pauseWhenHidden: true, pauseOnInteraction: true,
      scheduleEnabled: false, scheduleTime: '09:00', queueScope: 'current',
      excludedCategories: '', panelOpen: false,
    });
    const ranges = {
      maxTopics: [1, 500], maxMinutes: [1, 240], maxFloors: [0, 10000],
      topicTimeoutSeconds: [30, 1800], likeProbability: [1, 50], maxLikes: [0, 100],
    };
    const choices = {
      speed: ['slow', 'normal', 'fast'], queueScope: ['current', 'latest', 'new', 'unread'],
    };
    const handlers = new Map();
    const logs = [];
    let storageAvailable = true;
    let storageWarningShown = false;

    function normalize(key, value, fallback = defaults[key]) {
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) return undefined;
      if (typeof defaults[key] === 'boolean') {
        if (value === true || value === false) return value;
        if (value === 'true' || value === 1) return true;
        if (value === 'false' || value === 0) return false;
        return fallback;
      }
      if (ranges[key]) {
        if (value === '' || value === null || (typeof value !== 'number' && typeof value !== 'string')) return fallback;
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(ranges[key][0], Math.min(ranges[key][1], Math.trunc(n))) : fallback;
      }
      if (choices[key]) return choices[key].includes(value) ? value : fallback;
      if (key === 'scheduleTime') return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
      if (key === 'excludedCategories') return typeof value === 'string' ? value.slice(0, 1000) : fallback;
      return fallback;
    }

    function readStored() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const result = JSON.parse(raw);
        return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
      } catch (error) {
        // A corrupt value is ignored; storage access failure falls back to memory.
        if (!(error instanceof SyntaxError)) storageAvailable = false;
        return {};
      }
    }

    const stored = readStored();
    const values = Object.fromEntries(Object.keys(defaults).map(key => [key, normalize(key, stored[key])]));

    function on(name, callback) {
      if (typeof callback !== 'function') return () => {};
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(callback);
      return () => {
        const group = handlers.get(name);
        if (!group) return;
        group.delete(callback);
        if (!group.size) handlers.delete(name);
      };
    }

    function emit(name, payload) {
      const group = handlers.get(name);
      if (!group) return;
      for (const callback of [...group]) {
        try { callback(payload); }
        catch (error) { console.warn('[Quiet Reader] Event handler failed:', name, error); }
      }
    }

    function log(message, level = 'info') {
      const entry = {
        time: Date.now(), level: ['info', 'warn', 'error'].includes(level) ? level : 'info',
        message: String(message ?? '').slice(0, 1200),
      };
      logs.push(entry);
      if (logs.length > 100) logs.splice(0, logs.length - 100);
      emit('log', { entry, entries: logs.slice() });
    }

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
        storageAvailable = true;
      } catch (error) {
        storageAvailable = false;
        if (!storageWarningShown) {
          storageWarningShown = true;
          log('浏览器未允许保存设置，本页内仍可使用，刷新后设置可能恢复默认。', 'warn');
        }
      }
      emit('storage:state', { available: storageAvailable });
    }

    const settings = {
      get(key) { return Object.prototype.hasOwnProperty.call(defaults, key) ? values[key] : undefined; },
      all() { return { ...values }; },
      set(key, value) {
        if (!Object.prototype.hasOwnProperty.call(defaults, key)) return false;
        const next = normalize(key, value, values[key]);
        const previous = values[key];
        if (Object.is(previous, next)) return false;
        values[key] = next;
        persist();
        emit('settings:changed', { key, value: next, previous });
        return true;
      },
      reset() {
        const changes = [];
        for (const key of Object.keys(defaults)) {
          if (Object.is(values[key], defaults[key])) continue;
          changes.push({ key, value: defaults[key], previous: values[key] });
          values[key] = defaults[key];
        }
        persist();
        changes.forEach(change => emit('settings:changed', change));
      },
    };

    window.addEventListener('storage', event => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const incoming = readStored();
      for (const key of Object.keys(defaults)) {
        // Each tab controls its own panel; other preferences follow shared storage.
        if (key === 'panelOpen') continue;
        const next = normalize(key, incoming[key]);
        const previous = values[key];
        if (Object.is(previous, next)) continue;
        values[key] = next;
        emit('settings:changed', { key, value: next, previous });
      }
    });

    const featureGroups = [
      {
        title: '打开与续读', subtitle: '选择哪些链接使用阅读弹窗。',
        items: [
          ['popupEnabled', '标题弹窗预览', '关闭后恢复普通页面跳转，并停止自动阅读。'],
          ['interceptNotifications', '通知中的帖子也用弹窗', '对通知入口即时生效。'],
          ['interceptSearch', '搜索结果也用弹窗', '对搜索结果入口即时生效。'],
          ['resumeReading', '从未读位置接着读', '下次打开帖子生效。'],
        ],
      },
      {
        title: '内容显示', subtitle: '控制阅读窗口中的内容增强。',
        items: [
          ['nestedReplies', '楼中楼排版', '开启嵌套缩进；关闭后使用平铺排版。'],
          ['imageLightbox', '原图灯箱', '点击图片时使用大图查看器。'],
          ['userCards', '用户资料卡', '点击头像或名字时显示资料卡。'],
          ['mathRendering', '数学公式渲染', '对新加载内容生效；当前公式不重建。'],
          ['videoPlayer', '弹窗内播放视频', '允许点击视频封面启动播放器。'],
          ['spoilerProtection', '剧透内容遮罩', '先遮住剧透内容，点击后展开。'],
          ['floorNavigator', '楼层导航条', '在阅读窗口旁显示楼层跳转控件。'],
          ['stickyToolbar', '底部固定工具栏', '在阅读窗口底部保留互动入口。'],
        ],
      },
      {
        title: '互动与进度', subtitle: '控制弹窗入口；自动点赞另有独立开关。',
        items: [
          ['showReactions', '点赞与表情按钮', '显示楼层表情和点赞入口。'],
          ['showReply', '回复入口', '显示回复框入口和发送控件。'],
          ['showBoost', 'Boost 入口', '显示简短互动内容与发送入口。'],
          ['showBookmark', '收藏入口', '显示整帖收藏按钮。'],
          ['showPolls', '可操作的投票', '下次打开帖子生效；关闭后保留原始内容。'],
          ['readTracking', '记录已读进度', '按可见停留时间上报；关闭后停止新的上报。'],
        ],
      },
    ];

    const icons = {
      book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
      close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>',
      chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
    };
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    function checkbox(key, label, hint = '', compact = false) {
      return `<label class="switch-row${compact ? ' compact' : ''}"><span class="setting-copy"><span class="setting-label">${escape(label)}</span>${hint ? `<span class="setting-hint">${escape(hint)}</span>` : ''}</span><input type="checkbox" data-setting="${key}" aria-label="${escape(label)}"><span class="switch" aria-hidden="true"></span></label>`;
    }

    function numberInput(key, label, unit, hint = '') {
      const [min, max] = ranges[key];
      return `<label class="field-row"><span class="setting-copy"><span class="setting-label">${escape(label)}</span>${hint ? `<span class="setting-hint">${escape(hint)}</span>` : ''}</span><span class="input-with-unit"><input type="number" inputmode="numeric" data-setting="${key}" min="${min}" max="${max}" step="1" aria-label="${escape(label)}"><span>${escape(unit)}</span></span></label>`;
    }

    function section(title, subtitle, body) {
      return `<section class="setting-section"><header class="section-heading"><h3>${escape(title)}</h3>${subtitle ? `<p>${escape(subtitle)}</p>` : ''}</header>${body}</section>`;
    }

    function renderMarkup() {
      const reading = featureGroups.map(group => section(group.title, group.subtitle, group.items.map(item => checkbox(...item)).join(''))).join('');
      const automatic = section('阅读节奏', '设置不会自行开始运行，点击上方“开始”后生效。',
        `<label class="field-row"><span class="setting-label">阅读速度</span><select data-setting="speed" aria-label="阅读速度"><option value="slow">慢速</option><option value="normal">正常</option><option value="fast">快速</option></select></label>` +
        checkbox('randomPacing', '轻微变化阅读节奏', '在选定速度附近调整停留时间。') +
        checkbox('pauseWhenHidden', '切到后台时暂停', '回到页面后可继续；后台不累计阅读时间。') +
        checkbox('pauseOnInteraction', '手动操作时暂停', '你滚轮、触屏或输入时让出控制权。')) +
        section('浏览范围与停止条件', '帖子来源在下一轮生效；速度和各项上限即时生效。',
          `<label class="field-row"><span class="setting-label">帖子来源</span><select data-setting="queueScope" aria-label="帖子来源"><option value="current">当前列表</option><option value="latest">最新帖子</option><option value="new">新帖列表</option><option value="unread">未读列表</option></select></label>` +
          numberInput('maxTopics', '最多浏览', '帖') + numberInput('maxMinutes', '本轮时长上限', '分钟') +
          numberInput('maxFloors', '每帖楼层上限', '楼', '0 表示不设楼层上限。') +
          numberInput('topicTimeoutSeconds', '单帖停留上限', '秒', '避免在单个帖子中一直等待。')) +
        section('自动点赞', '默认关闭。点赞数量不会成为必须完成的阅读目标。',
          checkbox('autoLike', '允许自动点赞', '仅在自动阅读运行期间生效。') +
          `<div data-depends="autoLike">${checkbox('likeMainOnly', '只赞主帖', '不对回复自动点赞。')}${numberInput('likeProbability', '点赞概率', '%')}${numberInput('maxLikes', '本轮最多点赞', '次', '0 表示不执行任何自动点赞。')}</div>`);
      const schedule = section('每日计划', '仅在浏览器页面保持打开时检查，使用浏览器本地时间。',
        checkbox('scheduleEnabled', '定时启动', '关闭仅取消未来启动，不会停止当前这一轮。') +
        `<label class="field-row" data-depends="scheduleEnabled"><span class="setting-label">每日开始时间</span><input type="time" data-setting="scheduleTime" aria-label="每日开始时间"></label>` +
        '<p class="section-note">计划不会在重新打开浏览器后补跑很久之前的任务。停止本轮后，后续日期的计划仍按开关执行。</p>') +
        section('本页运行日志', '最多保留最近 100 条；日志不会发送到其他服务。',
          '<div class="log-box" role="log" aria-live="off" aria-label="运行日志"><p class="empty-log">暂无运行记录</p></div><button type="button" class="secondary full" data-action="copy-log">复制日志</button>') +
        section('设置', '开关自动保存到当前浏览器，各标签页共享功能设置。',
          '<button type="button" class="secondary full" data-action="reset">恢复默认设置</button><p class="section-note">恢复默认会停止本轮，并关闭自动滚动、自动换帖、定时启动和自动点赞。</p>');
      return `
        <button type="button" class="launcher" title="打开阅读控制台" aria-label="打开阅读控制台" aria-expanded="false">${icons.book}<span class="launcher-dot" hidden></span></button>
        <section class="panel" role="dialog" aria-label="阅读控制台" aria-modal="false" hidden>
          <header class="panel-header"><span class="brand-mark">${icons.book}</span><div class="brand"><strong>Quiet Reader</strong><span>阅读控制台 <small>v${VERSION}</small></span></div><button type="button" class="icon-button" data-action="close" title="收起控制台" aria-label="收起控制台">${icons.close}</button></header>
          <div class="run-area"><div class="state-line"><span class="state-badge" data-state="idle"><i></i><span class="state-label">未开始</span></span><span class="elapsed">00:00</span></div><p class="status-reason" aria-live="polite">选择功能后，按需要开始阅读。</p>
            <div class="run-actions"><button type="button" class="primary" data-action="start">开始</button><button type="button" class="secondary" data-action="pause">暂停</button><button type="button" class="danger" data-action="stop">停止</button><button type="button" class="secondary next" data-action="next">下一帖 ${icons.chevron}</button></div>
            <div class="quick-settings">${checkbox('autoScroll', '自动滚动', '', true)}${checkbox('autoNext', '自动下一帖', '', true)}</div>
            <p class="start-hint">启用一项自动功能后，点击“开始”。</p>
            <div class="progress-grid"><div><strong data-metric="completedTopics">0</strong><span>已完成帖子</span></div><div><strong data-metric="readPosts">0</strong><span>已上报楼层</span></div><div><strong data-metric="likedPosts">0</strong><span>自动点赞</span></div></div>
          </div>
          <div class="tabs" role="tablist" aria-label="控制台设置"><button type="button" role="tab" aria-selected="true" aria-controls="qr-tab-reading" id="qr-tab-btn-reading" data-tab="reading">阅读功能</button><button type="button" role="tab" aria-selected="false" aria-controls="qr-tab-auto" id="qr-tab-btn-auto" data-tab="auto" tabindex="-1">自动阅读</button><button type="button" role="tab" aria-selected="false" aria-controls="qr-tab-plan" id="qr-tab-btn-plan" data-tab="plan" tabindex="-1">计划与日志</button></div>
          <div class="settings-body"><div role="tabpanel" id="qr-tab-reading" aria-labelledby="qr-tab-btn-reading" data-page="reading">${reading}</div><div role="tabpanel" id="qr-tab-auto" aria-labelledby="qr-tab-btn-auto" data-page="auto" hidden>${automatic}</div><div role="tabpanel" id="qr-tab-plan" aria-labelledby="qr-tab-btn-plan" data-page="plan" hidden>${schedule}</div></div>
          <footer><span class="save-message">设置自动保存 · 不重建未发送草稿</span><span class="storage-warning" hidden>设置仅在本页有效</span></footer>
          <div class="toast" role="status" hidden></div>
        </section>`;
    }

    const css = `
      :host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;pointer-events:none;color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;color:#202b35;line-height:1.5;text-align:left;letter-spacing:normal}
      *,*::before,*::after{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.42}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #6fb8a2;outline-offset:3px}button{touch-action:manipulation}[hidden]{display:none!important}svg{display:block;width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}h3,p{margin:0}
      .launcher{pointer-events:auto;display:grid;place-items:center;position:relative;width:54px;height:54px;margin-left:auto;border:1px solid #267c69;border-radius:18px;color:#fff;background:#176c59;box-shadow:0 5px 22px #17392d40;transition:background .15s,transform .15s}.launcher:hover{background:#105947;transform:translateY(-2px)}.launcher svg{width:26px;height:26px}.launcher-dot{position:absolute;right:7px;top:7px;width:9px;height:9px;border-radius:50%;background:#b8f6a1;border:2px solid #176c59}
      .panel{pointer-events:auto;position:absolute;right:0;bottom:66px;display:flex;flex-direction:column;width:448px;max-width:calc(100vw - 32px);height:min(760px,calc(100dvh - 110px));min-height:290px;border:1px solid #d8e3df;border-radius:18px;background:#fff;overflow:hidden;box-shadow:0 18px 64px #183b3238,0 2px 8px #183b3214}
      .panel-header{display:flex;align-items:center;gap:11px;flex:none;padding:15px 17px;background:#f7faf9;border-bottom:1px solid #e6edeb}.brand-mark{display:grid;place-items:center;width:38px;height:38px;background:#e2f0ea;border-radius:12px;color:#176c59}.brand{display:flex;flex-direction:column;flex:1;min-width:0}.brand strong{font-size:17px;line-height:1.25;letter-spacing:.1px}.brand>span{font-size:14px;color:#61716b}.brand small{margin-left:6px;font-size:14px;color:#83918b}.icon-button{display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:9px;background:transparent;color:#61716b}.icon-button:hover{background:#e9f0ed}
      .run-area{padding:13px 17px 12px;flex:none;border-bottom:1px solid #e6edeb}.state-line{display:flex;justify-content:space-between;align-items:center;gap:10px}.state-badge{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:650;color:#566961}.state-badge i{width:7px;height:7px;border-radius:50%;background:#9aa9a3}.state-badge[data-state=running]{color:#176c59}.state-badge[data-state=running] i{background:#219373;box-shadow:0 0 0 3px #e1f2eb}.state-badge[data-state=paused]{color:#9b641b}.state-badge[data-state=paused] i{background:#c18c3f}.state-badge[data-state=error]{color:#a44444}.state-badge[data-state=error] i{background:#c35f5f}.elapsed{font-variant-numeric:tabular-nums;font-size:14px;color:#6d7b75}.status-reason{font-size:14px;color:#6b7873;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:20px;margin-top:5px}.run-actions{display:grid;grid-template-columns:1fr 1fr 1fr 1.2fr;gap:7px;margin-top:11px}
      .primary,.secondary,.danger{display:flex;align-items:center;justify-content:center;min-height:36px;padding:6px 9px;border-radius:9px;font-size:14px;font-weight:600;border:1px solid transparent;white-space:nowrap}.primary{background:#176c59;color:white}.primary:hover:not(:disabled){background:#105947}.secondary{background:#f7f9f8;border-color:#dbe4df;color:#40554b}.secondary:hover:not(:disabled){background:#edf3ef}.danger{color:#a54646;background:#fff7f6;border-color:#f0d6d4}.danger:hover:not(:disabled){background:#feeae7}.next{gap:2px}.next svg{width:16px;height:16px}.full{width:100%;margin-top:10px}
      .quick-settings{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-top:9px}.switch-row{display:flex;position:relative;align-items:center;gap:12px;min-height:55px;padding:10px 0;cursor:pointer;border-bottom:1px solid #edf1ef}.switch-row:last-child{border-bottom:0}.switch-row.compact{min-height:36px;padding:4px 0;border:0;gap:7px}.compact .setting-label{font-size:14px}.setting-copy{display:flex;flex:1;min-width:0;flex-direction:column}.setting-label{font-size:14px;line-height:1.45;color:#293d33;font-weight:500}.setting-hint{font-size:14px;line-height:1.55;color:#77877e;margin-top:3px}.switch-row>input{position:absolute;right:0;width:38px;height:24px;margin:0;opacity:0;cursor:pointer;z-index:1}.switch{position:relative;display:block;flex:none;width:36px;height:21px;border-radius:20px;background:#cad4ce;transition:background .16s}.switch::after{content:"";position:absolute;width:15px;height:15px;left:3px;top:3px;border-radius:50%;background:white;box-shadow:0 1px 3px #243e302b;transition:transform .16s}.switch-row>input:checked+.switch{background:#248468}.switch-row>input:checked+.switch::after{transform:translateX(15px)}.switch-row>input:focus-visible+.switch{outline:3px solid #6fb8a2;outline-offset:3px}.switch-row>input:disabled+.switch{opacity:.4}.switch-row:has(input:disabled){cursor:not-allowed}.start-hint{font-size:14px;line-height:1.5;color:#8b6a33;padding-top:1px}.progress-grid{display:grid;grid-template-columns:repeat(3,1fr);margin-top:8px;background:#f5f8f6;border-radius:10px;padding:8px 0}.progress-grid>div{display:flex;flex-direction:column;align-items:center;border-right:1px solid #e2e9e5}.progress-grid>div:last-child{border:0}.progress-grid strong{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.25;color:#294c3d}.progress-grid span{font-size:14px;color:#7b8b82;line-height:1.5}
      .tabs{display:flex;gap:3px;padding:8px 12px 0;background:#fff;flex:none;border-bottom:1px solid #e6edeb}.tabs button{flex:1;border:0;background:none;color:#74837b;padding:9px 5px 10px;font-weight:550;font-size:14px;border-bottom:2px solid transparent;outline-offset:-3px}.tabs button[aria-selected=true]{color:#176c59;border-bottom-color:#248468}.tabs button:hover{background:#f7faf8}
      .settings-body{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#c6d5cc transparent;padding:0 17px 15px}.setting-section{padding-top:17px}.setting-section+.setting-section{margin-top:11px;border-top:1px solid #e5ece8}.section-heading{margin-bottom:4px}.section-heading h3{font-size:14px;color:#1e5742;font-weight:650}.section-heading p,.section-note{font-size:14px;line-height:1.6;color:#7a887f;margin-top:4px}.section-note{padding:8px 0 3px}.field-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:9px 0;border-bottom:1px solid #edf1ef}.field-row:last-child{border:0}.input-with-unit{display:flex;align-items:center;flex:none;gap:6px}.input-with-unit>span{font-size:14px;min-width:25px;color:#74877c}input[type=number],input[type=time],select{height:35px;min-width:0;padding:5px 8px;border:1px solid #d4e0d9;border-radius:8px;background:#fafcfb;color:#2c493a;font-size:14px}input[type=number]{width:77px;font-variant-numeric:tabular-nums}input[type=time]{width:112px}select{max-width:155px}.dependent-off{opacity:.56}.dependent-off input,.dependent-off select{cursor:not-allowed}.log-box{max-height:190px;overflow:auto;margin:10px 0 3px;border:1px solid #e2eae5;border-radius:9px;background:#f7faf8;padding:8px 10px}.log-entry,.empty-log{font-size:14px;line-height:1.65;overflow-wrap:anywhere;white-space:pre-wrap;color:#60746a}.log-entry+.log-entry{margin-top:5px;padding-top:5px;border-top:1px solid #e5ece7}.log-entry time{color:#8a9990;margin-right:7px;font-variant-numeric:tabular-nums}.log-entry[data-level=warn]{color:#956b29}.log-entry[data-level=error]{color:#a04b49}.empty-log{color:#95a39a}
      footer{display:flex;gap:8px;align-items:center;justify-content:space-between;flex:none;padding:9px 17px;background:#f7faf8;border-top:1px solid #e6edeb;font-size:14px;color:#839187}.storage-warning{color:#ae7730}.toast{position:absolute;left:20px;right:20px;bottom:40px;pointer-events:none;padding:10px 13px;border-radius:10px;background:#234c3eea;color:white;box-shadow:0 3px 12px #0002;font-size:14px;text-align:center}
      @media(max-width:520px){:host{right:12px;bottom:12px}.panel{right:0;bottom:64px;max-width:calc(100vw - 24px);width:calc(100vw - 24px);height:calc(100dvh - 100px);border-radius:15px}.launcher{width:50px;height:50px;border-radius:16px}.panel-header{padding:12px 14px}.run-area{padding:10px 14px}.settings-body{padding-left:14px;padding-right:14px}.status-reason{font-size:14px}.run-actions{gap:5px}.primary,.secondary,.danger{padding:6px 5px}.setting-hint{font-size:14px}.quick-settings{gap:10px}.progress-grid strong{font-size:17px}}
      @media(max-height:620px){.panel{height:calc(100dvh - 92px);bottom:62px;min-height:240px}.panel-header{padding-top:8px;padding-bottom:8px}.run-area{padding-top:8px;padding-bottom:8px}.progress-grid{display:none}.status-reason{display:none}.tabs{padding-top:2px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;scroll-behavior:auto!important}}
    `;

    let host = null;
    let shadow = null;
    let activeTab = 'reading';
    let toastTimer = null;
    let state = { state: 'idle', reason: '', completedTopics: 0, readPosts: 0, likedPosts: 0, currentTopicId: null, elapsedMs: 0 };
    const readKeys = new Set();
    let previousFocus = null;
    let settingsNoticeTimer = null;

    function toast(message) {
      if (!shadow) return;
      const node = shadow.querySelector('.toast');
      node.textContent = String(message);
      node.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { node.hidden = true; }, 2800);
    }

    function setPanelOpen(open, focus = false) {
      if (!shadow) return;
      const panel = shadow.querySelector('.panel');
      const launcher = shadow.querySelector('.launcher');
      const wasOpen = !panel.hidden;
      if (open && !wasOpen) previousFocus = document.activeElement;
      panel.hidden = !open;
      launcher.setAttribute('aria-expanded', String(open));
      launcher.title = open ? '收起阅读控制台' : '打开阅读控制台';
      launcher.setAttribute('aria-label', launcher.title);
      if (focus && open) shadow.querySelector('[data-action="close"]').focus();
      if (!open && wasOpen) {
        if (previousFocus && previousFocus !== host && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
        else launcher.focus();
      }
    }

    function syncSettings() {
      if (!shadow) return;
      shadow.querySelectorAll('[data-setting]').forEach(input => {
        const value = settings.get(input.dataset.setting);
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = String(value ?? '');
      });
      shadow.querySelectorAll('[data-depends]').forEach(group => {
        const enabled = Boolean(settings.get(group.dataset.depends));
        group.classList.toggle('dependent-off', !enabled);
        group.querySelectorAll('input,select').forEach(input => { input.disabled = !enabled; });
      });
      setPanelOpen(settings.get('panelOpen'));
      updateState();
      shadow.querySelector('.storage-warning').hidden = storageAvailable;
    }

    function updateState(update) {
      if (update && typeof update === 'object') {
        const previous = state.state;
        state = { ...state, ...update };
        if (state.state === 'running' && ['idle', 'stopped', 'finished', 'error'].includes(previous)) readKeys.clear();
      }
      if (!shadow) return;
      const names = { idle: '未开始', running: '正在阅读', paused: '已暂停', stopped: '已停止', finished: '本轮完成', error: '需要处理' };
      const badge = shadow.querySelector('.state-badge');
      badge.dataset.state = state.state;
      shadow.querySelector('.state-label').textContent = names[state.state] || '未开始';
      const reason = String(state.reason || (state.state === 'idle' ? '选择功能后，按需要开始阅读。' : ''));
      const reasonEl = shadow.querySelector('.status-reason');
      reasonEl.textContent = reason;
      reasonEl.title = reason;
      const running = state.state === 'running';
      const paused = state.state === 'paused';
      const active = running || paused;
      const hasAutomaticFeature = settings.get('autoScroll') || settings.get('autoNext') || settings.get('autoLike');
      shadow.querySelector('[data-action="start"]').disabled = active || !settings.get('popupEnabled') || !hasAutomaticFeature;
      const pauseButton = shadow.querySelector('[data-action="pause"]');
      pauseButton.textContent = paused ? '继续' : '暂停';
      pauseButton.disabled = !active;
      shadow.querySelector('[data-action="stop"]').disabled = !active;
      shadow.querySelector('[data-action="next"]').disabled = !active;
      shadow.querySelector('.launcher-dot').hidden = !active;
      const elapsed = Math.max(0, Math.floor((Number(state.elapsedMs) || 0) / 1000));
      shadow.querySelector('.elapsed').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
      shadow.querySelectorAll('[data-metric]').forEach(node => {
        const key = node.dataset.metric;
        const number = Number(state[key]);
        node.textContent = String(Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0);
      });
      const hint = shadow.querySelector('.start-hint');
      if (!settings.get('popupEnabled')) hint.textContent = '先开启“阅读功能 → 标题弹窗预览”。';
      else if (!hasAutomaticFeature) hint.textContent = '启用自动滚动、自动下一帖或自动点赞后，点击“开始”。';
      else if (!settings.get('autoScroll') && settings.get('autoNext')) hint.textContent = '由你手动滚动，读完后按所选范围继续下一帖。';
      else if (!settings.get('autoScroll')) hint.textContent = '由你手动滚动，本轮仅按设置尝试自动点赞。';
      else if (settings.get('autoNext')) hint.textContent = '读完当前帖子后，按所选范围继续下一帖。';
      else hint.textContent = '本轮只阅读当前帖子，不会自动换帖。';
    }

    function switchTab(name, focus = false) {
      if (!shadow || !['reading', 'auto', 'plan'].includes(name)) return;
      activeTab = name;
      shadow.querySelectorAll('[data-tab]').forEach(button => {
        const active = button.dataset.tab === name;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        if (active && focus) button.focus();
      });
      shadow.querySelectorAll('[data-page]').forEach(page => { page.hidden = page.dataset.page !== name; });
      shadow.querySelector('.settings-body').scrollTop = 0;
    }

    function updateLogs() {
      if (!shadow) return;
      const box = shadow.querySelector('.log-box');
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 16;
      box.replaceChildren();
      if (!logs.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-log'; empty.textContent = '暂无运行记录'; box.appendChild(empty);
        return;
      }
      for (const entry of logs) {
        const row = document.createElement('p');
        row.className = 'log-entry'; row.dataset.level = entry.level;
        const time = document.createElement('time');
        time.textContent = new Date(entry.time).toLocaleTimeString([], { hour12: false });
        row.append(time, document.createTextNode(entry.message));
        box.appendChild(row);
      }
      if (atBottom) box.scrollTop = box.scrollHeight;
    }

    async function copyLogs() {
      const text = logs.length ? logs.map(entry => `${new Date(entry.time).toLocaleTimeString([], { hour12: false })} [${entry.level}] ${entry.message}`).join('\n') : '暂无运行记录';
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          toast('日志已复制');
          return;
        }
      } catch (error) { /* Fall back to a user-triggered text selection. */ }
      const textarea = document.createElement('textarea');
      textarea.value = text; textarea.setAttribute('aria-label', '复制运行日志');
      textarea.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
      shadow.appendChild(textarea);
      textarea.focus(); textarea.select();
      try { toast(document.execCommand('copy') ? '日志已复制' : '浏览器未允许复制，请从日志区域选择文字复制。'); }
      catch (error) { toast('浏览器未允许复制，请从日志区域选择文字复制。'); }
      finally { textarea.remove(); }
    }

    async function runAction(action) {
      const controller = api.automation;
      if (action === 'close') { settings.set('panelOpen', false); return; }
      if (action === 'copy-log') { await copyLogs(); return; }
      if (action === 'reset') {
        if (!window.confirm('恢复全部默认设置？当前自动阅读会停止，自动化选项会关闭。')) return;
        controller?.stop('恢复默认设置');
        settings.reset();
        log('已恢复默认设置。');
        return;
      }
      if (!controller) { toast('阅读控制器尚未就绪，请刷新页面。'); return; }
      try {
        if (action === 'start') await controller.start();
        else if (action === 'pause') {
          if (controller.getState().state === 'paused') await controller.resume();
          else controller.pause('manual');
        } else if (action === 'stop') controller.stop('手动停止');
        else if (action === 'next') await controller.next();
        updateState(controller.getState());
      } catch (error) {
        if (error?.name === 'AbortError') return;
        const message = error?.message || '操作未完成，请查看日志。';
        log(message, 'error'); toast(message);
      }
    }

    const ui = {
      init() {
        if (host?.isConnected) return;
        // Guard duplicate injection; existing reader/controller should retain ownership.
        if (document.getElementById('quiet-reader-controls')) return;
        host = document.createElement('div');
        host.id = 'quiet-reader-controls';
        host.dataset.quietReader = 'controls';
        host.setAttribute('data-quiet-reader-ui', '');
        shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style'); style.textContent = css;
        shadow.appendChild(style);
        const content = document.createElement('div'); content.innerHTML = renderMarkup();
        shadow.appendChild(content);
        document.body.appendChild(host);
        shadow.querySelector('.launcher').addEventListener('click', () => {
          settings.set('panelOpen', !settings.get('panelOpen'));
          setPanelOpen(settings.get('panelOpen'), true);
        });
        shadow.addEventListener('click', event => {
          const target = event.target.closest?.('[data-action], [data-tab]');
          if (!target) return;
          event.stopPropagation();
          if (target.dataset.tab) switchTab(target.dataset.tab);
          else if (!target.disabled) void runAction(target.dataset.action);
        });
        shadow.addEventListener('change', event => {
          const input = event.target.closest?.('[data-setting]');
          if (!input) return;
          const key = input.dataset.setting;
          settings.set(key, input.type === 'checkbox' ? input.checked : input.value);
          // Restore normalized values even if invalid input did not change a setting.
          syncSettings();
        });
        shadow.addEventListener('keydown', event => {
          // Prevent the reader's document-level Escape handler from closing its modal.
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault(); settings.set('panelOpen', false); setPanelOpen(false, true);
            return;
          }
          if (event.target.matches?.('[data-tab]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const tabs = ['reading', 'auto', 'plan'];
            const index = tabs.indexOf(activeTab);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
            switchTab(tabs[next], true);
          }
        });
        on('settings:changed', ({ key }) => {
          syncSettings();
          if (key === 'panelOpen') return;
          const notice = shadow.querySelector('.save-message');
          notice.textContent = '设置已保存';
          clearTimeout(settingsNoticeTimer);
          settingsNoticeTimer = setTimeout(() => { notice.textContent = '设置自动保存 · 不重建未发送草稿'; }, 1600);
        });
        on('storage:state', ({ available }) => { shadow.querySelector('.storage-warning').hidden = available; });
        on('automation:state', updateState);
        on('reader:read', ({ topicId, postNumber }) => {
          readKeys.add(`${topicId}:${postNumber}`);
          // The controller owns per-run totals. In manual mode show confirmed reports.
          if (!['running', 'paused'].includes(state.state)) {
            state.readPosts = readKeys.size; updateState();
          }
        });
        on('log', updateLogs);
        syncSettings(); updateLogs();
        if (api.automation?.getState) updateState(api.automation.getState());
        if (!storageAvailable && !storageWarningShown) {
          storageWarningShown = true;
          log('浏览器未允许保存设置，本页内仍可使用，刷新后设置可能恢复默认。', 'warn');
        }
      },
      open() { settings.set('panelOpen', true); setPanelOpen(true, true); },
      close() { settings.set('panelOpen', false); setPanelOpen(false, true); },
      toast,
    };

    const api = { version: VERSION, defaults, settings, on, emit, log, ui, reader: null, automation: null };
    return api;
  })();
