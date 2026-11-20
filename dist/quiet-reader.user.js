// ==UserScript==
// @name         Quiet Reader · 阅读控制台
// @namespace    https://github.com/kite8/quiet-reader
// @version      2.1.1
// @description  弹窗阅读、独立功能开关与可暂停的连续浏览。
// @author       Fashion; kite8
// @license      MIT
// @match        https://linux.do/*
// @homepageURL  https://github.com/kite8/quiet-reader
// @supportURL   https://github.com/kite8/quiet-reader/issues
// @downloadURL  https://raw.githubusercontent.com/kite8/quiet-reader/main/dist/quiet-reader.user.js
// @updateURL    https://raw.githubusercontent.com/kite8/quiet-reader/main/dist/quiet-reader.meta.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
Reader foundation: Fashion, MIT. Source and revision are recorded in NOTICE.

MIT License

Copyright (c) 2026 Fashion
Copyright (c) 2026 kite8 (modifications)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(function () {
  'use strict';

  // Quiet Reader: settings, events and isolated control panel.
  const LDR = (() => {
    const VERSION = '2.1.1';
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


  const BASE = location.origin;
  const PAGE_SIZE = 20;          // 每次请求帖子数（与 Discourse 默认一致），也是 loadUp/loadDown 每次追加的数量
  const READ_THRESHOLD = 1500;
  const FLUSH_INTERVAL = 5000;
  let ME_USERNAME = null;

  // --- 嵌套树 API 状态管理 ---
  const idToPost = new Map();     // postId → post 数据（混合索引）
  let nestedTreeRoots = [];       // 顶层回复数组
  let nestedHasMoreRoots = false; // 是否有更多顶层回复
  let nestedRootsPage = 0;        // 当前已加载的分页号

  const MENU_PANEL_SEL = '.menu-panel, .user-menu, .quick-access-panel, .notifications';
  const SEARCH_SEL = '.search-results, .fps-result, .search-menu, .search-menu-container, .search-result-topic';

  /* ============ 1. 样式 ============ */
  const style = document.createElement('style');
  style.textContent = `
    .ldp-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;
      align-items:center;justify-content:center;background:rgba(0,0,0,.55);}
    .ldp-modal{position:relative;display:flex;flex-direction:column;
      width:90%;max-width:1000px;height:90vh;
      border-radius:12px;overflow:hidden;font-size:16px;
      line-height:1.65;background:var(--secondary,#fff);color:var(--primary,#222);
      box-shadow:0 16px 50px rgba(0,0,0,.4);}
    .ldp-header{display:flex;align-items:flex-start;gap:10px;padding:16px 20px;
      border-bottom:1px solid var(--primary-low,#e5e5e5);}
    .ldp-title{margin:0;font-size:18px;font-weight:700;}
    .ldp-topic-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;}
    .ldp-topic-tags[hidden]{display:none;}
    .ldp-topic-category,.ldp-topic-tag{max-width:100%;padding:1px 7px;border-radius:4px;
      font-size:11px;line-height:18px;background:var(--primary-low,#eee);
      color:var(--primary-medium,#666);overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap;}
    .ldp-topic-category{background:rgba(8,132,255,.1);color:var(--tertiary,#08c);
      font-weight:600;}
    .ldp-meta{font-size:12px;opacity:.7;margin-top:4px;}
    .ldp-head-btns{display:flex;gap:8px;align-items:center;}
    .ldp-close{cursor:pointer;border:none;background:transparent;font-size:22px;
      line-height:1;color:inherit;padding:0 4px;}
    .ldp-body{flex:1;min-height:0;position:relative;
      padding:8px 20px 20px;overflow-y:auto;overscroll-behavior:contain;}

    /* 楼层滑动跳转条（仿 L 站原生） */
    .ldp-slider{position:absolute;top:0;right:0;bottom:0;width:22px;z-index:8;
      display:flex;flex-direction:column;align-items:center;}
    .ldp-slider[hidden]{display:none;}
    .ldp-slider-track{position:absolute;top:8px;bottom:8px;left:50%;
      width:4px;transform:translateX(-50%);border-radius:2px;
      background:var(--primary-low,#ddd);}
    .ldp-slider-thumb{position:absolute;left:50%;width:auto;min-width:18px;
      height:18px;padding:0 5px;border-radius:9px;background:var(--tertiary,#08c);
      transform:translate(-50%,-50%);cursor:grab;pointer-events:auto;
      box-shadow:0 1px 4px rgba(0,0,0,.3);transition:transform .1s;
      border:2px solid var(--secondary,#fff);color:#fff;font-size:10px;font-weight:700;
      line-height:18px;text-align:center;white-space:nowrap;user-select:none;}
    .ldp-slider-thumb:active{cursor:grabbing;transform:translate(-50%,-50%) scale(1.1);}
    .ldp-slider-tip{position:absolute;right:28px;background:var(--primary,#222);
      color:var(--secondary,#fff);font-size:12px;font-weight:600;padding:3px 8px;
      border-radius:4px;white-space:nowrap;transform:translateY(-50%);opacity:0;
      transition:opacity .15s;pointer-events:none;}
    .ldp-slider-tip.show{opacity:1;}
    .ldp-slider-tip::after{content:"";position:absolute;right:-5px;top:50%;
      transform:translateY(-50%);border:4px solid transparent;
      border-left-color:var(--primary,#222);}

    /* 底部悬浮操作栏 */
    .ldp-footer{flex:none;display:flex;align-items:center;justify-content:space-around;
      padding:12px 24px;border-top:1px solid var(--primary-low,#eee);
      background:var(--secondary,#fff);}
    .ldp-fbtn{background:transparent;border:none;cursor:pointer;display:flex;
      align-items:center;gap:8px;font-size:.95rem;color:var(--primary-medium,#666);
      padding:8px 16px;border-radius:6px;transition:all .2s ease;font-weight:600;
      white-space:nowrap;text-decoration:none;}
    .ldp-fbtn:hover{background:var(--primary-low,#f0f0f0);color:var(--tertiary,#3b82f6);}
    .ldp-fbtn svg{width:18px;height:18px;fill:currentColor;flex:none;}
    .ldp-fbtn:disabled{cursor:default;opacity:.5;pointer-events:none;}
    .ldp-fbtn.loading{opacity:.6;pointer-events:none;}
    .ldp-fbtn.liked{color:#e74c3c;}
    .ldp-fbtn.liked svg{fill:#e74c3c;}
    .ldp-fbtn.bookmarked{color:var(--tertiary,#3b82f6);}
    .ldp-fbtn.bookmarked svg{fill:var(--tertiary,#3b82f6);}

    /* 楼主帖自身的点赞/回复按钮已挪到底部操作栏，这里隐藏原位置 */
    .ldp-topic > .ldp-post > .ldp-actions{display:none;}

    /* 骨架屏 */
    .ldp-loadmask{position:absolute;inset:0;z-index:5;
      padding:8px 20px 20px;overflow:hidden;
      background:var(--secondary,#fff);color:inherit;}
    .ldp-loadmask.hide{opacity:0;pointer-events:none;transition:opacity .25s ease;}
    .ldp-sk{position:relative;overflow:hidden;border-radius:6px;
      background:var(--primary-low,#e9e9e9);}
    .ldp-sk::after{content:"";position:absolute;inset:0;
      transform:translateX(-100%);
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);
      animation:ldp-shimmer 1.2s infinite;}
    @keyframes ldp-shimmer{100%{transform:translateX(100%);}}
    .ldp-sk-title{height:18px;width:55%;border-radius:6px;
      display:inline-block;vertical-align:middle;}
    .ldp-sk-meta{height:11px;width:35%;border-radius:5px;
      display:inline-block;}
    .ldp-sk-head{display:flex;align-items:center;gap:10px;margin:12px 0 10px;}
    .ldp-sk-avatar{width:32px;height:32px;border-radius:50%;flex:none;}
    .ldp-sk-line{height:12px;}
    .ldp-sk-w30{width:30%;}.ldp-sk-w40{width:40%;}.ldp-sk-w60{width:60%;}
    .ldp-sk-w80{width:80%;}.ldp-sk-w90{width:90%;}.ldp-sk-w100{width:100%;}
    .ldp-sk-para .ldp-sk-line{margin-bottom:8px;}
    .ldp-sk-divider{height:1px;background:var(--primary-low,#e0e0e0);margin:16px 0 12px;}
    .ldp-sk-comment{display:flex;gap:10px;margin-bottom:18px;}
    .ldp-sk-comment .ldp-sk-avatar{width:28px;height:28px;}
    .ldp-sk-cbody{flex:1;}

    /* 楼主帖区块 */
    .ldp-topic{padding:4px 0 14px;}
    .ldp-topic .ldp-post{border-bottom:none;}

    /* 评论区分隔 + 左上角"评论"标题 */
    .ldp-comments-header{display:flex;align-items:center;gap:8px;
      margin:6px 0 2px;padding-top:14px;border-top:2px solid var(--primary-low,#e0e0e0);
      font-size:16px;font-weight:700;letter-spacing:.5px;}
    .ldp-comments-header::before{content:"💬";font-size:14px;}
    .ldp-comments-count{font-size:12px;font-weight:500;opacity:.6;}
    .ldp-comments{padding-top:4px;}
    .ldp-comments-empty{padding:18px 0;text-align:center;opacity:.5;font-size:13px;}

    .ldp-post{padding:12px 0 12px 12px;border-bottom:1px solid var(--primary-low,#eee);}
    .ldp-post.ldp-flash{animation:ldp-flash-bg 1.6s ease;}
    @keyframes ldp-flash-bg{
      0%{background:rgba(8,132,255,.16);}
      100%{background:transparent;}
    }
    .ldp-post-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
    .ldp-avatar{width:28px;height:28px;border-radius:50%;}
    .ldp-user-link{display:inline-flex;align-items:center;gap:8px;color:inherit;
      text-decoration:none;min-width:0;}
    .ldp-user-link:hover{color:var(--tertiary,#08c);}
    .ldp-overlay a.ldp-user-link:visited{color:inherit;}
    .ldp-overlay a.ldp-user-link:visited:hover{color:var(--tertiary,#08c);}
    .ldp-user-link .ldp-avatar{transition:opacity .15s,transform .15s;}
    .ldp-user-link:hover .ldp-avatar{opacity:.82;transform:scale(1.05);}

    /* 用户资料卡 */
    .ldp-uc{position:fixed;z-index:2147483500;box-sizing:border-box;
      width:360px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);
      overflow:auto;background:var(--secondary,#fff);color:var(--primary,#222);
      border:1px solid var(--primary-low,#ddd);
      border-radius:var(--d-border-radius-large,12px);
      box-shadow:var(--shadow-dropdown,0 8px 30px rgba(0,0,0,.22));
      font-size:14px;line-height:1.5;text-align:left;
      animation:ldp-uc-in .14s ease;}
    .ldp-uc:focus{outline:none;}
    .ldp-uc [hidden]{display:none!important;}
    @keyframes ldp-uc-in{
      from{opacity:0;transform:translateY(-4px);}
      to{opacity:1;transform:none;}
    }
    @media (prefers-reduced-motion:reduce){.ldp-uc{animation:none;}}
    .ldp-uc-head{display:flex;align-items:flex-start;gap:14px;padding:16px 16px 12px;}
    .ldp-uc-avatar{width:72px;height:72px;border-radius:50%;flex:none;
      object-fit:cover;background:var(--primary-very-low,#f2f2f2);}
    .ldp-uc-names{flex:1;min-width:0;padding-top:3px;}
    .ldp-uc-name{display:block;overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap;color:var(--primary,#222);font-size:18px;
      font-weight:700;line-height:1.3;text-decoration:none;}
    .ldp-uc-name:hover{color:var(--tertiary,#08c);}
    .ldp-overlay a.ldp-uc-name:visited{color:var(--primary,#222);}
    .ldp-overlay a.ldp-uc-name:visited:hover{color:var(--tertiary,#08c);}
    .ldp-uc-username{display:block;overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap;color:var(--primary-medium,#777);font-size:13px;}
    .ldp-uc-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;}
    .ldp-uc-level{flex:none;padding:1px 6px;border-radius:4px;
      background:var(--tertiary,#08c);color:#fff;font-size:11px;font-weight:700;}
    .ldp-uc-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      color:var(--primary-medium,#777);font-size:12px;}
    .ldp-uc-section{padding:0 16px 12px;}
    .ldp-uc-bio{overflow-wrap:anywhere;color:var(--primary-high,#444);font-size:13px;}
    .ldp-uc-bio p:first-child{margin-top:0;}
    .ldp-uc-bio p:last-child{margin-bottom:0;}
    .ldp-uc-bio img{max-width:100%;height:auto;}
    .ldp-uc-bio a{color:var(--tertiary,#08c);text-decoration:none;}
    .ldp-uc-bio a:hover{text-decoration:underline;}
    .ldp-uc-meta{display:flex;flex-wrap:wrap;gap:4px 12px;overflow-wrap:anywhere;
      color:var(--primary-medium,#777);font-size:12px;}
    .ldp-uc-meta a{color:var(--tertiary,#08c);text-decoration:none;}
    .ldp-uc-meta a:hover{text-decoration:underline;}
    .ldp-uc-stats{display:flex;gap:8px;margin:0 16px 12px;padding:9px 0;
      border-top:1px solid var(--primary-low,#eee);
      border-bottom:1px solid var(--primary-low,#eee);}
    .ldp-uc-stat{flex:1;min-width:0;text-align:center;}
    .ldp-uc-stat b{display:block;overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap;color:var(--primary,#222);font-size:13px;}
    .ldp-uc-stat span{display:block;color:var(--primary-medium,#888);font-size:11px;}
    .ldp-uc-badges{display:flex;flex-wrap:wrap;gap:6px;}
    .ldp-uc-badge{display:inline-flex;align-items:center;gap:5px;max-width:100%;
      padding:3px 8px 3px 4px;border:1px solid var(--primary-low,#e3e3e3);
      border-radius:999px;background:var(--primary-very-low,#f2f2f2);
      color:var(--primary,#222);font-size:11px;line-height:1.4;}
    .ldp-uc-badge img{width:16px;height:16px;object-fit:contain;flex:none;}
    .ldp-uc-badge span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .ldp-uc-loading,.ldp-uc-error{padding:0 16px 12px;font-size:12px;}
    .ldp-uc-loading{color:var(--primary-medium,#888);}
    .ldp-uc-error{color:var(--danger,#cc4b4b);}
    .ldp-uc-footer{display:flex;align-items:center;gap:8px;padding:0 16px 14px;}
    .ldp-uc-follow{display:inline-flex;align-items:center;justify-content:center;
      margin-right:auto;padding:5px 13px;border:1px solid var(--primary-low,#ccc);
      border-radius:6px;background:var(--secondary,#fff);color:var(--primary-high,#444);
      font:inherit;font-size:13px;font-weight:600;line-height:1.4;cursor:pointer;}
    .ldp-uc-follow:hover{background:var(--primary-very-low,#f2f2f2);}
    .ldp-uc-follow:disabled{cursor:default;opacity:.55;}
    .ldp-uc-follow-error{flex:1;min-width:0;color:var(--danger,#cc4b4b);
      font-size:12px;line-height:1.4;text-align:right;overflow-wrap:anywhere;}
    .ldp-uc-profile{display:inline-flex;align-items:center;justify-content:center;
      padding:6px 14px;border:1px solid var(--tertiary,#08c);border-radius:6px;
      background:var(--tertiary,#08c);color:#fff;font-size:13px;
      font-weight:600;text-decoration:none;}
    .ldp-uc-profile:hover{filter:brightness(1.06);}
    .ldp-overlay a.ldp-uc-profile:visited{color:#fff;}
    .ldp-overlay a.ldp-uc-profile:visited:hover{color:#fff;}

    .ldp-boost-avatar-link{display:inline-flex;align-items:center;flex:none;
      border-radius:50%;line-height:0;}
    .ldp-boost-avatar-link:hover .ldp-b-avatar{opacity:.82;transform:scale(1.08);}
    .ldp-b-avatar{transition:opacity .15s,transform .15s;}
    .ldp-author{font-weight:600;}
    .ldp-op{font-size:11px;font-weight:700;color:#fff;background:var(--tertiary,#08c);
      border-radius:4px;padding:1px 6px;letter-spacing:.5px;}
    .ldp-me{font-size:11px;font-weight:700;color:#fff;background:#3ea66b;
      border-radius:4px;padding:1px 6px;letter-spacing:.5px;}
    .ldp-user{font-size:12px;opacity:.6;}
    .ldp-level{font-size:11px;opacity:.5;}
    .ldp-time{font-size:12px;opacity:.55;}
    .ldp-floor{font-size:12px;opacity:.5;margin-left:auto;
      padding-left:8px;white-space:nowrap;}
    .ldp-content img{max-width:100%;height:auto;cursor:zoom-in;border-radius:4px;}
    .ldp-content .ldp-deleted{color:var(--primary-medium,#888);}
    .ldp-content .video-placeholder-container{max-width:100%;overflow:hidden;border-radius:6px;}
    .ldp-content .video-placeholder-container[data-video-src]:not(.ldp-video-ready){
      position:relative;background:#000;cursor:pointer;}
    .ldp-content .video-placeholder-container[data-video-src]:not(.ldp-video-ready)::before{
      content:"";position:absolute;z-index:3;left:50%;top:50%;width:62px;height:62px;
      transform:translate(-50%,-50%);border:2px solid rgba(255,255,255,.92);
      border-radius:50%;background:rgba(0,0,0,.58);pointer-events:none;
      box-shadow:0 4px 18px rgba(0,0,0,.35);transition:background .18s,transform .18s;}
    .ldp-content .video-placeholder-container[data-video-src]:not(.ldp-video-ready)::after{
      content:"";position:absolute;z-index:4;left:50%;top:50%;
      transform:translate(-35%,-50%);border-top:11px solid transparent;
      border-bottom:11px solid transparent;border-left:18px solid #fff;
      pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));}
    .ldp-content .video-placeholder-container[data-video-src]:not(.ldp-video-ready):hover::before{
      background:rgba(8,132,255,.82);transform:translate(-50%,-50%) scale(1.06);}
    .ldp-content .video-placeholder-container[data-video-src]:not(.ldp-video-ready)
      .video-placeholder-overlay{display:none;}
    .ldp-content .video-placeholder-container.ldp-video-ready{cursor:default!important;background:#000;}
    .ldp-content video{display:block;width:100%;max-width:100%;max-height:70vh;background:#000;}
    .ldp-content .ldp-spoiler{cursor:pointer;}
    .ldp-content .ldp-spoiler.ldp-spoiler-blurred{
      filter:blur(8px)!important;-webkit-filter:blur(8px)!important;
      user-select:none;}
    .ldp-content .ldp-spoiler.ldp-spoiler-expanded{cursor:default;}
    .ldp-content pre{overflow:auto;background:var(--primary-very-low,#f6f6f6);
      padding:10px;border-radius:6px;}
    .ldp-content .ldp-poll{display:grid;gap:10px;margin:12px 0;padding:12px;
      border:1px solid var(--primary-low,#ddd);border-radius:8px;
      background:var(--primary-very-low,#fafafa);}
    .ldp-poll-title{margin:0;font-size:15px;font-weight:700;}
    .ldp-poll-meta{font-size:12px;color:var(--primary-medium,#777);}
    .ldp-poll-options{display:grid;gap:8px;}
    .ldp-poll-option{position:relative;overflow:hidden;width:100%;
      display:flex;flex-direction:column;gap:6px;padding:10px 12px;
      border:1px solid var(--primary-low,#ddd);border-radius:8px;
      background:var(--secondary,#fff);color:inherit;font:inherit;
      text-align:left;cursor:pointer;}
    .ldp-poll-option[aria-pressed="true"]{
      border-color:var(--tertiary,#08c);background:rgba(8,132,255,.08);}
    .ldp-poll-option:disabled{cursor:default;opacity:.65;}
    .ldp-poll-option-content{position:relative;z-index:1;display:flex;
      align-items:baseline;justify-content:space-between;gap:12px;}
    .ldp-poll-option-html{min-width:0;overflow-wrap:anywhere;}
    .ldp-poll-option-meta{flex:none;font-size:12px;color:var(--primary-medium,#777);}
    .ldp-poll-bar{position:absolute;left:0;bottom:0;height:3px;
      background:var(--tertiary,#08c);}
    .ldp-poll-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
    .ldp-poll-submit,.ldp-poll-remove{border:1px solid var(--primary-low,#ccc);
      border-radius:6px;padding:5px 12px;background:var(--secondary,#fff);
      color:var(--primary,#222);font:inherit;font-size:13px;cursor:pointer;}
    .ldp-poll-submit:disabled,.ldp-poll-remove:disabled{
      cursor:default;opacity:.5;}
    .ldp-poll-selected-count{font-size:12px;color:var(--primary-medium,#777);}
    .ldp-poll-status{min-height:18px;font-size:12px;color:var(--primary-medium,#777);}
    .ldp-poll-status.ldp-poll-error{color:#d13c3c;}
    .ldp-poll[data-loading] .ldp-poll-option,
    .ldp-poll[data-loading] .ldp-poll-submit,
    .ldp-poll[data-loading] .ldp-poll-remove{
      cursor:default;opacity:.55;pointer-events:none;}
    .ldp-children{margin-left:22px;
      border-left:1px solid var(--tertiary,#08c);}
    .ldp-actions{display:flex;gap:14px;margin-top:8px;font-size:12px;align-items:center;}
    .ldp-btn{cursor:pointer;border:none;background:transparent;color:inherit;
      opacity:.7;display:inline-flex;align-items:center;gap:4px;padding:2px 4px;}
    .ldp-btn:hover{opacity:1;}
    .ldp-btn:disabled{cursor:default;opacity:.4;}
    .ldp-like.liked{color:var(--love,#e25822);opacity:1;font-weight:600;}
    .ldp-like-icon{display:inline-flex;align-items:center;vertical-align:middle;flex:none;}
    .ldp-like-icon .ldp-reaction-img{width:16px;height:16px;}

    .ldp-replybox{margin-top:8px;display:none;position:relative;}
    .ldp-replybox.open{display:block;}
    .ldp-replybox textarea{width:100%;min-height:90px;box-sizing:border-box;margin-bottom:0px;
      border:1px solid var(--primary-low,#ccc);border-radius:6px;padding:8px;
      font:inherit;background:var(--secondary,#fff);color:inherit;resize:vertical;}
    .ldp-replybox textarea.uploading{opacity:0.6;pointer-events:none;}
    .ldp-reply-tools{display:flex;align-items:center;gap:6px;margin-top:6px;}
    .ldp-insert-wrap{position:relative;}
    .ldp-insert-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:20;
      min-width:150px;padding:4px 0;border:1px solid var(--primary-low,#ddd);
      border-radius:6px;background:var(--secondary,#fff);
      box-shadow:0 6px 24px rgba(0,0,0,.18);list-style:none;margin:0;}
    .ldp-insert-menu[hidden]{display:none;}
    .ldp-insert-item{display:flex;align-items:center;gap:8px;width:100%;
      padding:7px 10px;border:none;background:transparent;color:inherit;
      font-size:13px;text-align:left;cursor:pointer;white-space:nowrap;}
    .ldp-insert-item:hover{background:var(--primary-low,#f0f0f0);}
    .ldp-insert-item svg{width:14px;height:14px;flex:none;fill:currentColor;}
    .ldp-send{margin-top:6px;background:var(--tertiary,#08c);color:#fff;border:none;
      border-radius:6px;padding:6px 14px;cursor:pointer;}
    .ldp-reply-tools .ldp-send{margin-top:0;}
    .ldp-reply-tip{margin-left:10px;font-size:12px;color:#3ea66b;opacity:0;
      transition:opacity .25s ease;}
    .ldp-reply-tip.show{opacity:1;}

    .ldp-loading-tip{padding:14px 0;text-align:center;font-size:13px;
      color:var(--primary-medium,#888);display:none;user-select:none;}
    .ldp-loading-tip.show{display:block;}
    .ldp-loading-tip .ldp-tip-icon{display:inline-block;margin-right:6px;
      animation:ldp-spin .9s linear infinite;}
    @keyframes ldp-spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}

    /* 上方/下方懒加载触发提示 */
    .ldp-load-up-tip,.ldp-load-down-tip{
      padding:10px 0;text-align:center;font-size:12px;
      color:var(--primary-medium,#999);user-select:none;display:none;}
    .ldp-load-up-tip.show,.ldp-load-down-tip.show{display:block;}
    .ldp-load-up-tip .ldp-tip-icon,.ldp-load-down-tip .ldp-tip-icon{
      display:inline-block;margin-right:4px;animation:ldp-spin .9s linear infinite;}

    .ldp-bottom-tip{padding:16px 0;text-align:center;font-size:13px;
      color:var(--primary-medium,#888);user-select:none;}
    .ldp-top-tip{padding:10px 0;text-align:center;font-size:13px;
      color:var(--primary-medium,#888);user-select:none;}

    /* 灯箱 */
    .ldp-lightbox{position:fixed;inset:0;z-index:2147483600;display:flex;
      flex-direction:column;background:rgba(0,0,0,.9);}
    .ldp-lb-stage{flex:1;overflow:auto;display:flex;align-items:center;
      justify-content:center;padding:20px;}
    .ldp-lb-stage img{display:block;max-width:94vw;max-height:88vh;
      width:auto;height:auto;border-radius:4px;cursor:zoom-out;
      box-shadow:0 10px 40px rgba(0,0,0,.6);}
    .ldp-lb-x{position:fixed;top:14px;right:18px;z-index:1;cursor:pointer;border:none;
      background:transparent;color:#fff;font-size:30px;line-height:1;}

    /* 楼中楼"展示更多回复"按钮 */
    .ldp-sub-actions{margin-left:22px;padding-left:14px;margin-top:2px;display:none;}
    .ldp-load-more-replies{font-size:12px;color:var(--tertiary,#08c);font-weight:600;
      opacity:.9;padding:4px 0;}
    .ldp-load-more-replies:hover{opacity:1;text-decoration:underline;}
    .ldp-sub-loading{font-size:12px;opacity:.5;margin-left:22px;padding-left:14px;
      margin-top:2px;display:none;}

    /* ============ Boost 样式 ============ */
    .ldp-boosts-list{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px;min-height:0;}
    .ldp-boost-bubble{display:inline-flex;align-items:center;gap:4px;
      padding:3px 8px 3px 4px;border:none;
      background:rgba(128,128,128,.1);border-radius:50px;
      font-size:14px;line-height:1.4;cursor:default;position:relative;
      transition:background .15s;}
    .ldp-boost-bubble:hover{background:rgba(128,128,128,.18);}
    .ldp-b-avatar{width:18px;height:18px;border-radius:50%;flex:none;display:block;}
    .ldp-boost-bubble p{margin:0;display:inline-flex;gap:2px;align-items:center;flex-wrap:wrap;}
    .ldp-boost-bubble p img.emoji{width:14px;height:14px;margin:0;vertical-align:middle;}
    .ldp-boost-del{cursor:pointer;margin-left:2px;opacity:0;font-size:13px;
      color:var(--danger,#cc4b4b);line-height:1;border:none;background:transparent;
      padding:0 2px;transition:opacity .15s;flex:none;}
    .ldp-boost-bubble:hover .ldp-boost-del{opacity:.65;}
    .ldp-boost-del:hover{opacity:1!important;}
    .ldp-boost-input-wrap{display:none;align-items:center;gap:5px;margin-top:6px;
      padding:4px 6px;border-radius:8px;
      border:1px solid var(--primary-low,#ddd);
      background:var(--secondary,#fff);}
    .ldp-boost-input-wrap.open{display:flex;}
    .ldp-boost-input{flex:1;border:none;background:transparent;outline:none;
      font-size:13px;padding:2px 4px;color:inherit;min-width:0;}
    .ldp-boost-input::placeholder{color:var(--primary-medium,#999);font-size:12px;}
    .ldp-boost-submit{width:22px;height:22px;padding:0;display:flex;flex:none;
      align-items:center;justify-content:center;border-radius:50%;
      border:1px solid #3ea66b;background:transparent;color:#3ea66b;
      cursor:pointer;font-size:14px;line-height:1;transition:all .15s;}
    .ldp-boost-submit:hover{background:#3ea66b;color:#fff;}
    .ldp-boost-submit:disabled{opacity:.5;cursor:default;pointer-events:none;}
    .ldp-boost-cancel{width:22px;height:22px;padding:0;display:flex;flex:none;
      align-items:center;justify-content:center;border-radius:50%;
      border:1px solid var(--danger,#cc4b4b);background:transparent;
      color:var(--danger,#cc4b4b);cursor:pointer;font-size:16px;line-height:1;
      transition:all .15s;}
    .ldp-boost-cancel:hover{background:var(--danger,#cc4b4b);color:#fff;}
    .ldp-btn.ldp-boost-btn{font-size:12px;}
    .ldp-btn.ldp-boost-btn:disabled{opacity:.35;cursor:default;pointer-events:none;}

    /* ============ Reactions 聚合条 ============ */
    .ldp-reactions{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px;}
    .ldp-reaction{display:inline-flex;align-items:center;gap:3px;
      padding:2px 7px 2px 4px;border-radius:50px;border:none;font:inherit;
      background:rgba(128,128,128,.1);font-size:12px;line-height:1.4;
      color:var(--primary-medium,#666);cursor:pointer;transition:background .15s;}
    .ldp-reaction:hover{background:rgba(128,128,128,.18);}
    .ldp-reaction:disabled{cursor:not-allowed;opacity:.55;}
    .ldp-reaction:disabled:hover{background:rgba(128,128,128,.1);}
    .ldp-reaction-img{width:16px;height:16px;display:block;flex:none;}
    .ldp-reaction-count{font-size:12px;font-variant-numeric:tabular-nums;}
    .ldp-reaction-mine{background:var(--tertiary-low,rgba(128,128,128,.18));
      box-shadow:inset 0 0 0 1px var(--tertiary,#08c);color:var(--primary,#333);}

    /* 表情反应选择面板 */
    .ldp-reaction-panel{z-index:2147483500;display:flex;flex-wrap:wrap;gap:4px;
      padding:8px;max-width:280px;border-radius:10px;
      background:var(--secondary,#fff);border:1px solid var(--primary-low,#ddd);
      box-shadow:0 6px 20px rgba(0,0,0,.18);}
    .ldp-reaction-opt{display:inline-flex;align-items:center;gap:2px;
      padding:3px 6px 3px 3px;border-radius:50px;border:none;background:transparent;
      cursor:pointer;transition:background .15s;}
    .ldp-reaction-opt:hover{background:rgba(128,128,128,.15);}
    .ldp-reaction-opt:disabled{cursor:not-allowed;opacity:.5;}
    .ldp-reaction-opt .ldp-reaction-img{width:20px;height:20px;}
    .ldp-reaction-opt-count{font-size:11px;color:var(--primary-medium,#666);
      font-variant-numeric:tabular-nums;min-width:10px;text-align:right;}
    .ldp-reaction-opt-mine{background:var(--tertiary-low,rgba(128,128,128,.18));
      box-shadow:inset 0 0 0 1px var(--tertiary,#08c);}

    /* ============ Emoji Picker 样式 ============ */
    .ldp-emoji-btn{width:22px;height:22px;padding:0;display:flex;flex:none;
      align-items:center;justify-content:center;border-radius:50%;
      border:1px solid var(--primary-low,#ccc);background:transparent;
      color:var(--primary-medium,#666);cursor:pointer;font-size:14px;line-height:1;
      transition:all .15s;position:relative;}
    .ldp-emoji-btn:hover{background:var(--primary-low,#f0f0f0);color:var(--tertiary,#3b82f6);}
    .ldp-emoji-btn svg{width:14px;height:14px;fill:currentColor;display:block;}
    .ldp-emoji-panel{position:fixed;z-index:2147483500;width:320px;height:360px;
      background:var(--secondary,#fff);border:1px solid var(--primary-low,#ddd);
      border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);
      display:flex;flex-direction:column;overflow:hidden;font-size:13px;}
    .ldp-emoji-search{flex:none;padding:6px 8px;border-bottom:1px solid var(--primary-low,#eee);}
    .ldp-emoji-search input{width:100%;box-sizing:border-box;border:1px solid var(--primary-low,#ccc);
      border-radius:6px;padding:5px 8px;font-size:12px;outline:none;
      background:var(--secondary,#fff);color:inherit;}
    .ldp-emoji-tabs{flex:none;display:flex;border-bottom:1px solid var(--primary-low,#eee);
      overflow-x:auto;padding:0 4px;}
    .ldp-emoji-tabs::-webkit-scrollbar{display:none;}
    .ldp-emoji-tab{flex:none;width:30px;height:30px;padding:0;cursor:pointer;
      display:flex;align-items:center;justify-content:center;font-size:16px;
      opacity:.5;border-bottom:2px solid transparent;transition:all .15s;
      background:none;border-top:none;border-left:none;border-right:none;}
    .ldp-emoji-tab img{width:20px;height:20px;display:block;}
    .ldp-emoji-tab:hover{opacity:.8;}
    .ldp-emoji-tab.active{opacity:1;border-bottom-color:var(--tertiary,#08c);}
    .ldp-emoji-grid{flex:1;overflow-y:auto;padding:6px;display:grid;
      grid-template-columns:repeat(8,1fr);gap:2px;align-content:start;}
    .ldp-emoji-grid::-webkit-scrollbar{width:5px;}
    .ldp-emoji-grid::-webkit-scrollbar-thumb{background:rgba(128,128,128,.3);border-radius:3px;}
    .ldp-emoji-item{width:100%;aspect-ratio:1;display:flex;align-items:center;
      justify-content:center;border-radius:6px;cursor:pointer;border:none;
      background:transparent;padding:2px;transition:background .1s;}
    .ldp-emoji-item:hover{background:var(--primary-low,#f0f0f0);}
    .ldp-emoji-item img{width:24px;height:24px;display:block;}
    .ldp-emoji-empty{grid-column:1/-1;text-align:center;padding:20px 0;
      color:var(--primary-medium,#999);font-size:12px;}
  `;
  document.head.appendChild(style);

  /* 图标 */
  const ICONS = {
    like: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
    reply: '<path d="M1024 640q0 94.857143-72.571429 257.714286-1.714286 4-6 13.714286t-7.714286 17.142857-7.428571 12.571429q-6.857143 9.714286-16 9.714286-8.571429 0-13.428571-5.714286t-4.857143-14.285714q0-5.142857 1.428571-15.142857t1.428571-13.428571q2.857143-38.857143 2.857143-70.285714 0-57.714286-10-103.428571t-27.714286-79.142857-45.714286-57.714286-60.285714-39.714286-76-24.285714-88-12.285714-100.285714-3.428571l-128 0 0 146.285714q0 14.857143-10.857143 25.714286t-25.714286 10.857143-25.714286-10.857143l-292.571429-292.571429q-10.857143-10.857143-10.857143-25.714286t10.857143-25.714286l292.571429-292.571429q10.857143-10.857143 25.714286-10.857143t25.714286 10.857143 10.857143 25.714286l0 146.285714 128 0q407.428571 0 500 230.285714 30.285714 76.571429 30.285714 190.285714z"/>',
    boost: '<path d="M1010.092957 38.19946a31.779551 31.779551 0 0 0-24.399655-24.399655C921.294212 0 870.914925 0 820.715635 0c-206.397081 0-330.195331 110.398439-422.574025 255.99638H189.744557A95.998643 95.998643 0 0 0 104.005769 308.975631l-98.838602 197.597206A47.999321 47.999321 0 0 0 48.146559 575.991855h207.537065l-44.939364 44.939365a63.999095 63.999095 0 0 0 0 90.49872l101.79856 101.81856a63.999095 63.999095 0 0 0 90.51872 0L448.000905 768.309136V975.986199a47.999321 47.999321 0 0 0 69.399019 42.979392l197.397208-98.778603a95.818645 95.818645 0 0 0 52.999251-85.798787V625.571154c145.177947-92.598691 255.99638-216.796934 255.99638-422.17403 0.199997-50.399287 0.199997-100.798575-13.699806-165.197664zM767.99638 335.995249a79.998869 79.998869 0 1 1 79.998869-79.998869 79.998869 79.998869 0 0 1-79.998869 79.998869z"/>',
    bookmark: '<path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>',
    newTab: '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>'
  };

  /* 表情按钮图标（复用 Discourse 内置 sprite） */
  const EMOJI_BTN_ICON = '<svg class="fa d-icon d-icon-far-face-smile svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><use href="#far-face-smile"></use></svg>';
  const INSERT_BTN_ICON = '<svg class="fa d-icon d-icon-circle-plus svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><use href="#circle-plus"></use></svg>';
  const DETAILS_ICON = '<svg class="fa d-icon d-icon-angle-right svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><use href="#angle-right"></use></svg>';
  const SPOILER_ICON = '<svg class="fa d-icon d-icon-wand-magic svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><use href="#wand-magic"></use></svg>';

  /* ============ 2. 工具函数 ============ */
  const esc = (s) => (s || '').replace(/[<>&]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function setSpoilerState(spoiler, blurred) {
    spoiler.classList.add('spoiled');
    spoiler.classList.toggle('spoiler-blurred', blurred);
    spoiler.classList.toggle('spoiler-revealed', !blurred);
    spoiler.classList.toggle('ldp-spoiler-blurred', blurred);
    spoiler.classList.toggle('ldp-spoiler-expanded', !blurred);
    spoiler.dataset.spoilerState = blurred ? 'blurred' : 'expanded';
    spoiler.setAttribute('aria-expanded', String(!blurred));
    spoiler.style.setProperty('filter', blurred ? 'blur(8px)' : 'none', 'important');
    spoiler.style.setProperty('-webkit-filter', blurred ? 'blur(8px)' : 'none', 'important');
  }

  function prepareSpoilers(root) {
    const spoilers = [];
    const selector = '.spoiler, .spoiled, .spoiler-blurred, [data-spoiler-state]';
    if (root.matches && root.matches(selector)) {
      spoilers.push(root);
    }
    spoilers.push(...root.querySelectorAll(selector));
    spoilers.forEach((spoiler) => {
      spoiler.classList.add('ldp-spoiler');
      spoiler.setAttribute('role', 'button');
      spoiler.setAttribute('tabindex', '0');
      setSpoilerState(spoiler, LDR.settings.get('spoilerProtection'));
    });
  }

  function userProfileUrl(username) {
    const name = typeof username === 'string' ? username.trim() : '';
    return name ? `${BASE}/u/${encodeURIComponent(name)}/summary` : '';
  }

  function userProfileLabel(username, displayName) {
    const label = typeof displayName === 'string' ? displayName.trim() : '';
    const account = typeof username === 'string' ? username.trim() : '';
    return label || (account ? `@${account}` : '查看用户');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = Date.now() - t;
    const min = 60000, hour = 60 * min, day = 24 * hour;
    if (diff < min) return '刚刚';
    if (diff < hour) return Math.floor(diff / min) + ' 分钟前';
    if (diff < day) return Math.floor(diff / hour) + ' 小时前';
    if (diff < 30 * day) return Math.floor(diff / day) + ' 天前';
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  const csrfToken = () =>
      (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  async function fetchJSON(url, signal) {
    const res = await fetch(url, {
      credentials: 'include', signal, headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiSend(url, method, params, extraHeaders, signal) {
    const opt = {
      method, signal,
      credentials: 'include',
      headers: Object.assign({
        'Accept': 'application/json',
        'X-CSRF-Token': csrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
      }, extraHeaders || {}),
    };
    if (params instanceof FormData) {
      opt.body = params;
    } else if (params instanceof URLSearchParams) {
      opt.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      opt.body = params.toString();
    } else if (params) {
      opt.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      const body = new URLSearchParams();
      Object.keys(params).forEach((key) => {
        const value = params[key];
        if (Array.isArray(value)) {
          value.forEach((item) => body.append(`${key}[]`, item));
        } else {
          body.append(key, value);
        }
      });
      opt.body = body.toString();
    }
    const res = await fetch(url, opt);
    if (!res.ok) {
      let message = 'HTTP ' + res.status;
      try {
        const data = await res.json();
        const errors = Array.isArray(data.errors)
            ? data.errors.map((item) =>
                typeof item === 'string' ? item : item && item.message)
                .filter((item) => typeof item === 'string' && item.trim())
            : [];
        const candidate = errors.join(' ') || data.error || data.message;
        if (typeof candidate === 'string' && candidate.trim()) message = candidate.trim();
      } catch (e) { /* keep the HTTP fallback when the response is not JSON */ }
      throw new Error(message);
    }
    return res.json().catch(() => ({}));
  }

  async function ensureMe(signal) {
    if (ME_USERNAME !== null) return ME_USERNAME;
    try {
      const s = await fetchJSON(`${BASE}/session/current.json`, signal);
      ME_USERNAME = (s.current_user && s.current_user.username) || '';
    } catch (e) { if (signal?.aborted) throw e; ME_USERNAME = ''; }
    return ME_USERNAME;
  }

  /* ============ 2.5 嵌套树 API 封装 ============ */
  /**
   * fetchNestedTree：获取话题的嵌套树形结构（权威树 API）。
   * @param {number} topicId - 话题 ID
   * @param {number} page - 分页号（0 表示第一页）
   * @returns {Promise<{roots: Array, has_more_roots: boolean, page: number, topic: object, opPost: object}>}
   */
  async function fetchNestedTree(topicId, page = 0, signal) {
    let url = `${BASE}/n/-/${topicId}.json?sort=old`;
    if (page > 0) url += `&page=${page}`;
    return await fetchJSON(url, signal);
  }

  function standardTopicToNestedTree(data) {
    const posts = Array.isArray(data.post_stream?.posts) ? data.post_stream.posts : [];
    const opPost = posts.find((post) => post.post_number === 1);
    if (!opPost) return null;

    // Discourse 会把私信的嵌套树接口重定向到标准话题接口。
    // 标准接口没有树形数据，这里转为顶层扁平结构以复用现有渲染流程。
    const roots = posts
        .filter((post) => post !== opPost)
        .map((post) => ({ ...post, children: [], direct_reply_count: 0 }));

    return {
      roots,
      op_post: opPost,
      topic: {
        id: data.id,
        title: data.title,
        category_id: data.category_id,
        tags: data.tags,
        posts_count: data.posts_count,
        highest_post_number: data.highest_post_number || data.posts_count || 1,
        bookmarked: data.bookmarked,
        bookmark_id: data.bookmark_id,
        valid_reactions: data.valid_reactions,
      },
      has_more_roots: false,
      page: 0,
    };
  }

  /**
   * fetchNestedChildren：获取指定帖子的所有直接回复（用于"展示更多"按钮）。
   * @param {number} topicId - 话题 ID
   * @param {number} postNumber - 帖子楼号
   * @returns {Promise<{children: Array, has_more: boolean, page: number}>}
   */
  async function fetchNestedChildren(topicId, postNumber, page = 0, signal) {
    const url = `${BASE}/n/-/${topicId}/children/${postNumber}.json?sort=old&page=${page}&depth=1`;
    return await fetchJSON(url, signal);
  }

  /**
   * fetchAllNestedChildren：读取指定父楼层的全部直接回复分页。
   * children API 会同时携带每条直接回复当前可用的下级 children，后续定位时
   * 再沿目标祖先链逐层补全，因此无需一次请求无限深度的整棵树。
   */
  async function fetchAllNestedChildren(topicId, postNumber, signal) {
    const children = [];
    const seenIds = new Set();
    let page = 0;

    for (let guard = 0; guard < 100; guard++) {
      const response = await fetchNestedChildren(topicId, postNumber, page, signal);
      const batch = Array.isArray(response.children) ? response.children : [];
      let added = 0;
      batch.forEach((post) => {
        if (seenIds.has(post.id)) return;
        seenIds.add(post.id);
        children.push(post);
        added++;
      });

      if (!response.has_more) return children;
      if (added === 0) throw new Error(`楼层 #${postNumber} 的子回复分页没有继续推进`);

      const responsePage = Number(response.page);
      page = Number.isFinite(responsePage) ? responsePage + 1 : page + 1;
    }

    throw new Error(`楼层 #${postNumber} 的子回复分页超过安全上限`);
  }

  /**
   * indexTree：递归将嵌套树数据索引到 idToPost Map。
   * @param {Array} posts - 帖子数组（可能包含 children）
   */
  function indexTree(posts) {
    if (!posts || !posts.length) return;
    posts.forEach(post => {
      idToPost.set(post.id, post);
      if (post.children && post.children.length > 0) {
        indexTree(post.children);
      }
    });
  }

  function indexPostsByNumber(posts, ctx) {
    if (!posts || !posts.length || !ctx.postMap) return;
    posts.forEach((post) => {
      ctx.postMap.set(post.post_number, post);
      if (post.children && post.children.length > 0) {
        indexPostsByNumber(post.children, ctx);
      }
    });
  }

  function likeInfo(p) {
    const like = (p.actions_summary || []).find((a) => a.id === 2) || {};
    return { count: like.count || 0, acted: !!like.acted, canAct: !!like.can_act };
  }

  /** 我的反应对应的图标：有反应 → 该表情；无 → 默认 ♥ */
  function likeIconHtml(p) {
    const mine = p && p.current_user_reaction;
    if (mine && mine.id) return reactionImgHtml(mine.id);
    return `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;vertical-align:middle;">${ICONS.like}</svg>`;
  }

  /** 按钮是否处于“已反应”状态（core 点赞或任意表情反应） */
  function likeActed(p) {
    if (!p) return false;
    return !!p.current_user_reaction || !!likeInfo(p).acted;
  }

  /** 图标对应的数量：有反应 → 该表情数量；无 → core 点赞数 */
  function likeDisplayCount(p) {
    const mine = p && p.current_user_reaction;
    if (mine && mine.id) {
      const r = (p.reactions || []).find((x) => x && x.id === mine.id);
      if (r) return Number(r.count) || 0;
    }
    return likeInfo(p).count;
  }

  /* ============ 2.5 通知链接解析 ============ */
  /**
   * 解析当前页面 URL 或传入的 href，提取 topicId 和可选的 targetPostNumber。
   * 支持格式：
   *   /t/slug/123           → topicId=123, target=null（首次/已读跳转）
   *   /t/slug/123/456       → topicId=123, target=456
   *   /t/123                → topicId=123
   *   /t/123/456            → topicId=123, target=456
   */
  function parseTopicHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, BASE);
      if (url.origin !== BASE || !/^https?:$/.test(url.protocol)) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 't') return null;
      const numeric = /^\d+$/;
      const index = numeric.test(parts[1] || '') ? 1 : 2;
      if (!numeric.test(parts[index] || '')) return null;
      const topicId = Number(parts[index]);
      const floor = parts[index + 1];
      if (!Number.isSafeInteger(topicId) || topicId < 1) return null;
      return { topicId, targetPostNumber: numeric.test(floor || '') ? Number(floor) : null };
    } catch { return null; }
  }

  /* ============ 2.55 Emoji Picker ============ */
  const EMOJI_CACHE_KEY = 'ldp_recent_emojis';
  const EMOJI_RECENT_MAX = 10;
  let emojiDataCache = null;
  let emojiDataLoading = null;

  function getRecentEmojis() {
    try { return JSON.parse(localStorage.getItem(EMOJI_CACHE_KEY)) || []; }
    catch { return []; }
  }
  function addRecentEmoji(name) {
    let list = getRecentEmojis().filter(n => n !== name);
    list.unshift(name);
    if (list.length > EMOJI_RECENT_MAX) list = list.slice(0, EMOJI_RECENT_MAX);
    localStorage.setItem(EMOJI_CACHE_KEY, JSON.stringify(list));
  }

  let _emojiSet = 'twemoji';
  (function detectEmojiSet() {
    const img = document.querySelector('img.emoji[src*="/images/emoji/"]');
    if (img) { const m = img.src.match(/\/images\/emoji\/([^/]+)\//); if (m) _emojiSet = m[1]; }
  })();

  /** emojiUrlMap: name -> url (populated by fetchEmojiData) */
  const emojiUrlMap = new Map();

  function emojiUrl(name) {
    if (emojiUrlMap.has(name)) return emojiUrlMap.get(name);
    return `https://cdn.ldstatic.com/images/emoji/${_emojiSet}/${name}.png`;
  }

  async function fetchEmojiData() {
    if (emojiDataCache) return emojiDataCache;
    if (emojiDataLoading) return emojiDataLoading;
    emojiDataLoading = (async () => {
      const CACHE_NAME = 'ldp-emoji-v2';
      const CACHE_URL  = `${BASE}/emojis.json`;
      let raw;
      try {
        const cache = await caches.open(CACHE_NAME);
        let cached = await cache.match(CACHE_URL);
        if (!cached) {
          const res = await fetch(CACHE_URL, { credentials: 'include' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          await cache.put(CACHE_URL, res.clone());
          cached = res;
        }
        raw = await cached.json();
      } catch {
        // Cache API unavailable (e.g. non-secure context): fall back to plain fetch
        const res = await fetch(CACHE_URL, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        raw = await res.json();
      }
      // Parse: { group: [ {name, url, tonable}, ... ] }
      const groups = {};
      for (const [gKey, arr] of Object.entries(raw)) {
        if (!Array.isArray(arr)) continue;
        groups[gKey] = arr.map(e => {
          const name = (e && e.name) ? e.name : String(e);
          if (e && e.url) {
            let url = e.url;
            if (url.startsWith('//')) url = 'https:' + url;          // protocol-relative (custom emoji on S3)
            else if (!url.startsWith('http')) url = BASE + url;      // site-relative (standard emoji)
            emojiUrlMap.set(name, url.replace('https://linux.do', 'https://cdn.ldstatic.com'));
          }
          return name;
        });
      }
      emojiDataCache = groups;
      emojiDataLoading = null;
      return groups;
    })().catch(err => { emojiDataLoading = null; throw err; });
    return emojiDataLoading;
  }

  function buildEmojiPanel(onPick) {
    const panel = document.createElement('div');
    panel.className = 'ldp-emoji-panel';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'ldp-emoji-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '\u641C\u7D22\u8868\u60C5\u2026';
    searchWrap.appendChild(searchInput);
    panel.appendChild(searchWrap);
    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'ldp-emoji-tabs';
    panel.appendChild(tabsWrap);
    const grid = document.createElement('div');
    grid.className = 'ldp-emoji-grid';
    panel.appendChild(grid);
    let currentGroup = 'recent';
    let allGroups = null;
    function renderGrid(names, groupKey) {
      grid.innerHTML = '';
      if (!names || !names.length) {
        grid.innerHTML = '<div class="ldp-emoji-empty">' +
          (groupKey === 'recent' ? '\u6682\u65E0\u6700\u8FD1\u4F7F\u7528\u7684\u8868\u60C5' : '\u6CA1\u6709\u627E\u5230\u8868\u60C5') + '</div>';
        return;
      }
      const frag = document.createDocumentFragment();
      for (const name of names) {
        const btn = document.createElement('button');
        btn.className = 'ldp-emoji-item';
        btn.title = ':' + name + ':';
        btn.innerHTML = `<img src="${emojiUrl(name)}" alt="${esc(name)}" loading="lazy">`;
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); addRecentEmoji(name); onPick(':' + name + ':'); });
        frag.appendChild(btn);
      }
      grid.appendChild(frag);
    }
    function switchTab(groupKey) {
      currentGroup = groupKey;
      tabsWrap.querySelectorAll('.ldp-emoji-tab').forEach(t => t.classList.toggle('active', t.dataset.group === groupKey));
      if (groupKey === 'recent') { renderGrid(getRecentEmojis(), 'recent'); }
      else if (allGroups && allGroups[groupKey]) { renderGrid(allGroups[groupKey], groupKey); }
    }
    function doSearch(q) {
      if (!allGroups) return;
      q = q.toLowerCase().trim();
      if (!q) { switchTab(currentGroup); return; }
      tabsWrap.querySelectorAll('.ldp-emoji-tab').forEach(t => t.classList.remove('active'));
      const results = [];
      for (const [gk, names] of Object.entries(allGroups)) {
        for (const n of names) { if (n.toLowerCase().includes(q)) results.push({ name: n, group: gk }); }
      }
      grid.innerHTML = '';
      if (!results.length) { grid.innerHTML = '<div class="ldp-emoji-empty">\u6CA1\u6709\u627E\u5230\u8868\u60C5</div>'; return; }
      const frag = document.createDocumentFragment();
      for (const r of results) {
        const btn = document.createElement('button');
        btn.className = 'ldp-emoji-item';
        btn.title = ':' + r.name + ':';
        btn.innerHTML = `<img src="${emojiUrl(r.name)}" alt="${esc(r.name)}" loading="lazy">`;
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); addRecentEmoji(r.name); onPick(':' + r.name + ':'); });
        frag.appendChild(btn);
      }
      grid.appendChild(frag);
    }
    grid.innerHTML = '<div class="ldp-emoji-empty">\u52A0\u8F7D\u4E2D\u2026</div>';
    fetchEmojiData().then(groups => {
      allGroups = groups;
      // Build tabs entirely from the API groups, with "recent" pinned first.
      // Each tab icon is the group's first emoji for a recognizable visual.
      const RECENT_ICON = 'https://cdn.ldstatic.com/images/emoji/twemoji/star.png?v=15';
      const tabList = [{ key: 'recent', label: '\u6700\u8FD1', iconUrl: RECENT_ICON }];
      for (const gKey of Object.keys(groups)) {
        if (!groups[gKey].length) continue;
        tabList.push({ key: gKey, label: gKey, first: groups[gKey][0] });
      }
      tabsWrap.innerHTML = '';
      for (const g of tabList) {
        const tab = document.createElement('button');
        tab.className = 'ldp-emoji-tab' + (g.key === 'recent' ? ' active' : '');
        tab.dataset.group = g.key;
        tab.title = g.label;
        const img = document.createElement('img');
        img.src = g.iconUrl || emojiUrl(g.first);
        img.alt = g.label;
        img.loading = 'lazy';
        tab.appendChild(img);
        tab.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); searchInput.value = ''; switchTab(g.key); });
        tabsWrap.appendChild(tab);
      }
      switchTab('recent');
    }).catch(() => { grid.innerHTML = '<div class="ldp-emoji-empty">\u8868\u60C5\u52A0\u8F7D\u5931\u8D25</div>'; });
    let searchTimer = null;
    searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(searchInput.value), 200); });
    panel._ldpCleanup = () => clearTimeout(searchTimer);
    return panel;
  }

  function toggleEmojiPanel(triggerBtn, inputEl) {
    const enabled = () => LDR.settings.get(inputEl.classList.contains('ldp-boost-input') ? 'showBoost' : 'showReply');
    if (!enabled() || !triggerBtn.isConnected) return;
    const existing = triggerBtn._ldpEmojiPanel;
    if (existing?.isConnected) { existing.ldpClose?.(); return; }
    const panel = buildEmojiPanel((code) => {
      if (!enabled() || !inputEl.isConnected) { close(); return; }
      const start = inputEl.selectionStart || 0;
      const end = inputEl.selectionEnd || 0;
      const before = inputEl.value.substring(0, start);
      const insertion = before && !/[\s\u200b\p{P}]/u.test(before.slice(-1)) ? ' ' + code : code;
      inputEl.value = before + insertion + inputEl.value.substring(end);
      inputEl.selectionStart = inputEl.selectionEnd = start + insertion.length;
      inputEl.focus();
      close();
    });
    const outside = (event) => {
      if (!panel.contains(event.target) && !triggerBtn.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key !== 'Escape' || isControlPanelEvent(event)) return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    const close = () => {
      panel._ldpCleanup?.();
      panel.remove();
      triggerBtn._ldpEmojiPanel = null;
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
    panel.ldpClose = close;
    triggerBtn._ldpEmojiPanel = panel;
    placePanel(panel, triggerBtn);
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', escape, true);
  }

  function renderBoosts(boosts) {
    if (!boosts || !boosts.length) return '';
    return boosts.map((b) => {
      const bAvatar = b.user && b.user.avatar_template
          ? BASE + b.user.avatar_template.replace('{size}', '36') : '';
      const bProfileUrl = userProfileUrl(b.user && b.user.username);
      const bProfileLabel = userProfileLabel(b.user && b.user.username, b.user && (b.user.name || b.user.display_name));
      const bUsername = (b.user && b.user.username) || '';
      const bCardName = String(
          (b.user && (b.user.name || b.user.display_name)) || bUsername || ''
      );
      const bCardAttrs = bUsername
          ? ` data-username="${escAttr(bUsername)}" data-name="${escAttr(bCardName)}"`
          : '';
      const canDel = !!b.can_delete;
      return `<div class="ldp-boost-bubble" data-boost-id="${b.id}">` +
          (bAvatar ? (bProfileUrl
            ? `<a class="ldp-boost-avatar-link" href="${bProfileUrl}" target="_blank" rel="noopener noreferrer" title="${escAttr(bProfileLabel)}"${bCardAttrs}><img class="ldp-b-avatar" src="${bAvatar}" alt=""${bCardAttrs}></a>`
            : `<img class="ldp-b-avatar" src="${bAvatar}" alt=""${bCardAttrs}>`) : '') +
          `<p>${b.cooked || ''}</p>` +
          (canDel ? `<button class="ldp-boost-del" title="删除此Boost">×</button>` : '') +
          `</div>`;
    }).join('');
  }

  /* ============ 2.6.1 Reactions 聚合条 ============ */
  function reactionImgHtml(name) {
    const n = String(name || '');
    return `<img class="ldp-reaction-img" data-ldp-emoji="${escAttr(n)}" src="${escAttr(emojiUrl(n))}" alt="${escAttr(n)}" loading="lazy" decoding="async">`;
  }

  function renderReactions(p) {
    const list = Array.isArray(p && p.reactions) ? p.reactions : [];
    const mine = p && p.current_user_reaction;
    const mineId = mine && mine.id;
    const items = list
      .filter(r => r && r.id && Number(r.count) > 0)
      .sort((a, b) => (Number(b.count) - Number(a.count)) || String(a.id).localeCompare(String(b.id)));
    if (!items.length) return '';
    const html = items.map((r) => {
      const isMine = !!mineId && r.id === mineId;
      const noUndo = isMine && mine && mine.can_undo === false;
      const cls = 'ldp-reaction' + (isMine ? ' ldp-reaction-mine' : '') + (noUndo ? ' ldp-reaction-disabled' : '');
      const title = noUndo ? '已超过可撤销时间' : `${':' + r.id + ':'} ${r.count}`;
      return `<button type="button" class="${cls}" data-reaction="${escAttr(r.id)}"` +
        `${noUndo ? ' disabled' : ''} title="${escAttr(title)}">` +
        reactionImgHtml(r.id) +
        `<span class="ldp-reaction-count">${Number(r.count)}</span>` +
        `</button>`;
    }).join('');
    return `<div class="ldp-reactions">${html}</div>`;
  }

  /** emoji 数据异步到位后，回填聚合条里自定义 emoji 的真实 URL */
  function refreshEmojiUrls(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('img[data-ldp-emoji]').forEach((img) => {
      const url = emojiUrl(img.getAttribute('data-ldp-emoji'));
      if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
    });
  }

  /** 切换反应后，只刷新该楼层的聚合条与点赞按钮，不重建整个节点 */
  function updatePostReactions(postNode, p) {
    const html = renderReactions(p);
    let bar = postNode.querySelector('.ldp-reactions');
    if (html) {
      if (bar) bar.innerHTML = html;
      else {
        bar = document.createElement('div');
        bar.className = 'ldp-reactions';
        bar.innerHTML = html;
        const content = postNode.querySelector('.ldp-content');
        if (content) content.after(bar);
      }
    } else if (bar) {
      bar.remove();
    }
    refreshEmojiUrls(postNode);
    const likeBtn = postNode.querySelector('.ldp-like');
    if (likeBtn) {
      const { canAct } = likeInfo(p);
      const acted = likeActed(p);
      likeBtn.classList.toggle('liked', acted);
      likeBtn.dataset.acted = acted ? '1' : '0';
      likeBtn.disabled = !(canAct || acted);
      const iconEl = likeBtn.querySelector('.ldp-like-icon');
      if (iconEl) iconEl.innerHTML = likeIconHtml(p);
      const countEl = likeBtn.querySelector('.ldp-like-count');
      if (countEl) countEl.textContent = likeDisplayCount(p);
    }
  }

  /* ============ 2.6.2 表情反应切换 / 选择面板 ============ */
  let openReactionTrigger = null;   // 当前打开面板的 ♥ 按钮（全局单面板）
  let reactionHoverBtn = null;      // 鼠标当前悬停的 ♥ 按钮
  let reactionCloseTimer = null;

  function cancelReactionClose() {
    if (reactionCloseTimer) { clearTimeout(reactionCloseTimer); reactionCloseTimer = null; }
  }

  function scheduleReactionClose() {
    cancelReactionClose();
    reactionCloseTimer = setTimeout(closeReactionPanel, 150);
  }

  function closeReactionPanel() {
    cancelReactionClose();
    if (openReactionTrigger) {
      const panel = openReactionTrigger._ldpReactionPanel;
      if (panel && panel.parentNode) panel.remove();
      // 关键：面板可能被定时器/点 ♥/关弹窗关掉，此时必须解绑当初注册的 mousedown closer，
      // 否则残留的 closer 会在下次点击新面板时把它误关（mousedown/up 不同元素 → click 不触发）。
      if (openReactionTrigger._ldpReactionCloser) {
        document.removeEventListener('mousedown', openReactionTrigger._ldpReactionCloser, true);
        openReactionTrigger._ldpReactionCloser = null;
      }
      openReactionTrigger._ldpReactionPanel = null;
    }
    openReactionTrigger = null;
    reactionHoverBtn = null;
  }

  /** hover ♥ 时打开表情选择面板（立即，无延迟） */
  function openReactionPanel(triggerBtn, postNode, ctx) {
    if (!LDR.settings.get('showReactions') || ctx.signal?.aborted) return;
    if (openReactionTrigger === triggerBtn) return;
    if (!Array.isArray(ctx.validReactions) || !ctx.validReactions.length) return;
    closeReactionPanel();
    const post = findPostForNode(postNode, ctx);
    if (!post) return;
    const panel = document.createElement('div');
    panel.className = 'ldp-reaction-panel';
    panel.innerHTML = reactionPanelHtml(post, ctx.validReactions);
    placePanel(panel, triggerBtn);
    refreshEmojiUrls(panel);
    triggerBtn._ldpReactionPanel = panel;
    openReactionTrigger = triggerBtn;

    // 鼠标从 ♥ 移进面板（中间有间隙）时取消待关闭
    panel.addEventListener('mouseenter', cancelReactionClose);
    panel.addEventListener('mouseleave', scheduleReactionClose);

    panel.addEventListener('click', async (e) => {
      const opt = e.target.closest('.ldp-reaction-opt');
      if (!opt || opt.disabled) return;
      const target = await toggleReaction(postNode, ctx, opt.getAttribute('data-reaction'), opt);
      if (target) {
        panel.innerHTML = reactionPanelHtml(target, ctx.validReactions);
        refreshEmojiUrls(panel);
      }
    });

    setTimeout(() => {
      if (!panel.isConnected || openReactionTrigger !== triggerBtn) return;
      const closer = (e) => {
        if (panel.contains(e.target)) return;
        closeReactionPanel();
      };
      triggerBtn._ldpReactionCloser = closer;
      document.addEventListener('mousedown', closer, true);
    }, 0);
  }

  async function toggleReaction(postNode, ctx, name, clickedEl) {
    if (!LDR.settings.get('showReactions') || ctx.signal?.aborted) return null;
    const postId = postNode.dataset.postId;
    const postNumber = +postNode.dataset.postNumber;
    const post = findPostForNode(postNode, ctx);
    if (!post || post._qrLikePending) return null;
    post._qrLikePending = true;
    if (clickedEl) clickedEl.disabled = true;
    try {
      const updated = await apiSend(
          `${BASE}/discourse-reactions/posts/${postId}/custom-reactions/${encodeURIComponent(name)}/toggle`,
          'PUT', null, null, ctx.signal);
      ctx.assertActive?.();
      Object.assign(post, updated);
      if (ctx.postMap) ctx.postMap.set(postNumber, post);
      idToPost.set(Number(postId), post);
      return post;
    } catch (err) {
      if (err.name !== 'AbortError') alert('操作失败：' + err.message);
      return null;
    } finally {
      delete post._qrLikePending;
      if (clickedEl) clickedEl.disabled = false;
      updatePostReactions(postNode, post);
      if (postNumber === 1) {
        const overlay = postNode.closest('.ldp-overlay');
        const footer = overlay?.querySelector('.ldp-f-like');
        if (footer) syncFooterLike(footer, overlay.querySelector('.ldp-f-like-count'), post);
      }
    }
  }

  function reactionPanelHtml(p, validReactions) {
    const counts = new Map();
    (p && Array.isArray(p.reactions) ? p.reactions : []).forEach((r) => {
      if (r && r.id) counts.set(r.id, Number(r.count) || 0);
    });
    const mine = p && p.current_user_reaction;
    return (validReactions || []).map((name) => {
      const count = counts.get(name) || 0;
      const isMine = !!(mine && mine.id === name);
      const noUndo = isMine && mine && mine.can_undo === false;
      const title = ':' + name + ':' + (count ? ' ' + count : '');
      return `<button type="button" class="ldp-reaction-opt${isMine ? ' ldp-reaction-opt-mine' : ''}"` +
        ` data-reaction="${escAttr(name)}"${noUndo ? ' disabled' : ''} title="${escAttr(title)}">` +
        reactionImgHtml(name) +
        (count ? `<span class="ldp-reaction-opt-count">${count}</span>` : '') +
        `</button>`;
    }).join('');
  }

  /** 面板用 fixed 定位，约束在弹窗内，优先显示在触发按钮上方 */
  function placePanel(panel, triggerBtn) {
    panel.style.position = 'fixed';
    (triggerBtn.closest('.ldp-overlay') || document.body).appendChild(panel);
    const gap = 6;
    const panelW = panel.offsetWidth, panelH = panel.offsetHeight;
    const btnRect = triggerBtn.getBoundingClientRect();
    const modal = triggerBtn.closest('.ldp-modal');
    const bounds = modal ? modal.getBoundingClientRect()
                         : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
    let top = (btnRect.top - panelH - gap >= bounds.top) ? btnRect.top - panelH - gap : btnRect.bottom + gap;
    if (top + panelH > bounds.bottom) top = bounds.bottom - panelH;
    if (top < bounds.top) top = bounds.top;
    let left = btnRect.right - panelW;
    if (left < bounds.left) left = bounds.left;
    if (left + panelW > bounds.right) left = bounds.right - panelW;
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
  }

  /* ============ 2.7 用户资料卡 ============ */
  const userCardCache = new Map();
  let CURRENT_USER_CARD = null;

  function resolveUserCardAvatar(template, size = 96) {
    if (typeof template !== 'string' || !template.trim()) return '';
    const value = template.trim().replace('{size}', String(size));
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return 'https:' + value;
    return value.startsWith('/') ? BASE + value : BASE + '/' + value;
  }

  function resolveUserCardAsset(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    const value = url.trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return 'https:' + value;
    return value.startsWith('/') ? BASE + value : BASE + '/' + value;
  }

  function safeWebsiteUrl(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return '';
    try { return new URL(url.trim()).href; } catch { return ''; }
  }

  function fmtMonth(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function fmtReadDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 3600) return `${Math.max(1, Math.round(value / 60))} 分钟`;
    const hours = Math.round(value / 3600);
    if (hours < 48) return `${hours} 小时`;
    return `${Math.round(hours / 24)} 天`;
  }

  function loadUserCard(username, signal) {
    if (!userCardCache.has(username)) {
      const request = fetchJSON(`${BASE}/u/${encodeURIComponent(username)}/card.json`, signal)
          .then((data) => {
            const user = data && (data.user || data);
            if (!user || typeof user !== 'object') throw new Error('用户资料为空');
            if (data && data.user) {
              if ((!Array.isArray(user.user_badges) || !user.user_badges.length)
                  && Array.isArray(data.user_badges)) {
                user.user_badges = data.user_badges;
              }
              if ((!Array.isArray(user.badges) || !user.badges.length)
                  && Array.isArray(data.badges)) {
                user.badges = data.badges;
              }
            }
            return user;
          })
          .catch((err) => {
            userCardCache.delete(username);
            throw err;
          });
      userCardCache.set(username, request);
    }
    return userCardCache.get(username);
  }

  function collectUserCardBadges(data) {
    const userBadges = Array.isArray(data.user_badges) ? data.user_badges : [];
    const badgeDefs = Array.isArray(data.badges) ? data.badges : [];
    const badgeById = new Map();
    badgeDefs.forEach((badge) => {
      if (badge && badge.id != null) badgeById.set(String(badge.id), badge);
    });
    userBadges.forEach((userBadge) => {
      if (userBadge && userBadge.badge && userBadge.badge.id != null) {
        badgeById.set(String(userBadge.badge.id), userBadge.badge);
      }
    });

    const result = [];
    const seen = new Set();
    const addBadge = (badge) => {
      if (!badge || (!badge.name && badge.id == null)) return;
      const key = badge.id != null ? `id:${badge.id}` : `name:${badge.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(badge);
    };
    const addUserBadge = (userBadge) => {
      if (!userBadge) return;
      const badgeId = userBadge.badge_id != null
          ? userBadge.badge_id
          : (userBadge.badge && userBadge.badge.id);
      const badge = badgeId != null ? badgeById.get(String(badgeId)) : null;
      if (badge) addBadge(badge);
      else if (userBadge.badge) addBadge(userBadge.badge);
      else if (userBadge.name) addBadge(userBadge);
    };

    const featuredIds = Array.isArray(data.featured_user_badge_ids)
        ? data.featured_user_badge_ids : [];
    featuredIds.forEach((id) => {
      const userBadge = userBadges.find((item) => item && String(item.id) === String(id));
      if (userBadge) addUserBadge(userBadge);
      else {
        const badge = badgeById.get(String(id));
        if (badge) addBadge(badge);
      }
    });

    const featured = Array.isArray(data.featured_user_badges)
        ? data.featured_user_badges : [];
    featured.forEach((item) => {
      if (typeof item === 'number' || typeof item === 'string') {
        const hit = userBadges.find((userBadge) => userBadge && String(userBadge.id) === String(item));
        if (hit) addUserBadge(hit);
        else {
          const badge = badgeById.get(String(item));
          if (badge) addBadge(badge);
        }
        return;
      }
      addUserBadge(item);
    });
    if (result.length) return result.slice(0, 4);

    userBadges.forEach(addUserBadge);
    if (result.length) return result.slice(0, 4);
    badgeDefs.forEach(addBadge);
    return result.slice(0, 4);
  }

  function createUserCard(info) {
    const displayName = info.name || info.username;
    const profileUrl = userProfileUrl(info.username);
    const card = document.createElement('div');
    card.className = 'ldp-uc';
    card.tabIndex = -1;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `用户资料：${displayName}`);
    card.innerHTML = `
      <div class="ldp-uc-head">
        ${info.avatar
          ? `<img class="ldp-uc-avatar" src="${escAttr(info.avatar)}" alt="" loading="lazy" decoding="async">`
          : '<div class="ldp-uc-avatar"></div>'}
        <div class="ldp-uc-names">
          <a class="ldp-uc-name" href="${escAttr(profileUrl)}" target="_blank" rel="noopener noreferrer">${esc(displayName)}</a>
          <span class="ldp-uc-username">@${esc(info.username)}</span>
          <div class="ldp-uc-tags">
            ${Number.isFinite(info.trustLevel)
              ? `<span class="ldp-uc-level">Lv.${escAttr(String(info.trustLevel))}</span>` : ''}
            <span class="ldp-uc-title" hidden></span>
          </div>
        </div>
      </div>
      <div class="ldp-uc-bio ldp-uc-section" hidden></div>
      <div class="ldp-uc-meta ldp-uc-section" hidden></div>
      <div class="ldp-uc-stats" hidden></div>
      <div class="ldp-uc-section ldp-uc-badges-wrap" hidden>
        <div class="ldp-uc-badges"></div>
      </div>
      <div class="ldp-uc-loading">正在加载用户资料…</div>
      <div class="ldp-uc-error" hidden></div>
      <div class="ldp-uc-footer">
        <button class="ldp-uc-follow" type="button" aria-pressed="false" hidden>关注</button>
        <span class="ldp-uc-follow-error" role="status" hidden></span>
        <a class="ldp-uc-profile" href="${escAttr(profileUrl)}" target="_blank" rel="noopener noreferrer">查看资料</a>
      </div>`;
    return card;
  }

  function updateUserCardFollow(card, data) {
    const button = card.querySelector('.ldp-uc-follow');
    if (!button) return;
    const followed = data.is_followed === true;
    button.hidden = !(followed || data.can_follow === true);
    button.textContent = followed ? '取消关注' : '关注';
    button.setAttribute('aria-pressed', followed ? 'true' : 'false');
  }

  function applyUserCardData(card, data, basic) {
    const username = String(data.username || basic.username || '').trim();
    const displayName = String(
        data.name || data.display_name || basic.name || username || ''
    ).trim();
    const profileUrl = userProfileUrl(username);

    const avatar = resolveUserCardAvatar(data.avatar_template, 96);
    const avatarEl = card.querySelector('.ldp-uc-avatar');
    if (avatar && avatarEl) {
      if (avatarEl.tagName === 'IMG') {
        avatarEl.src = avatar;
      } else {
        const img = document.createElement('img');
        img.className = 'ldp-uc-avatar';
        img.src = avatar;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        avatarEl.replaceWith(img);
      }
    }

    const nameEl = card.querySelector('.ldp-uc-name');
    if (nameEl) {
      nameEl.textContent = displayName || username;
      if (profileUrl) nameEl.href = profileUrl;
    }
    const usernameEl = card.querySelector('.ldp-uc-username');
    if (usernameEl) usernameEl.textContent = '@' + username;
    const profileEl = card.querySelector('.ldp-uc-profile');
    if (profileEl && profileUrl) profileEl.href = profileUrl;
    card.setAttribute('aria-label', `用户资料：${displayName || username}`);
    card.dataset.username = username;

    const followButton = card.querySelector('.ldp-uc-follow');
    const followError = card.querySelector('.ldp-uc-follow-error');
    followButton.addEventListener('click', async () => {
      const target = String(data.username || username).trim();
      if (!LDR.settings.get('userCards') || !card.isConnected || !target || followButton.disabled) return;
      const wasFollowed = data.is_followed === true;
      followButton.disabled = true;
      followButton.setAttribute('aria-busy', 'true');
      followError.hidden = true;
      try {
        await apiSend(
            `${BASE}/follow/${encodeURIComponent(target)}.json`,
            wasFollowed ? 'DELETE' : 'PUT'
        );
        data.is_followed = !wasFollowed;
        const current = CURRENT_USER_CARD;
        if (current && current.el && current.el.dataset.username === target) {
          updateUserCardFollow(current.el, data);
        }
      } catch (err) {
        if (!card.isConnected) return;
        followError.textContent = `${wasFollowed ? '取消关注' : '关注'}失败：${err.message}`;
        followError.hidden = false;
        const current = CURRENT_USER_CARD;
        if (current && current.el === card) positionUserCard(card, current.trigger);
      } finally {
        followButton.disabled = false;
        followButton.removeAttribute('aria-busy');
      }
    });
    updateUserCardFollow(card, data);

    const tagsEl = card.querySelector('.ldp-uc-tags');
    let levelEl = card.querySelector('.ldp-uc-level');
    const trustValue = data.trust_level != null ? Number(data.trust_level) : basic.trustLevel;
    if (Number.isFinite(trustValue)) {
      if (!levelEl) {
        levelEl = document.createElement('span');
        levelEl.className = 'ldp-uc-level';
        tagsEl.prepend(levelEl);
      }
      levelEl.textContent = `Lv.${trustValue}`;
    } else if (levelEl) {
      levelEl.remove();
    }

    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const titleEl = card.querySelector('.ldp-uc-title');
    titleEl.textContent = title;
    titleEl.hidden = !title;

    const bioEl = card.querySelector('.ldp-uc-bio');
    const bio = typeof data.bio_excerpt === 'string' ? data.bio_excerpt.trim() : '';
    if (bio) {
      bioEl.innerHTML = bio;
      bioEl.querySelectorAll('a[href]').forEach((link) => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      });
      bioEl.hidden = false;
    } else {
      bioEl.textContent = '';
      bioEl.hidden = true;
    }

    const metaEl = card.querySelector('.ldp-uc-meta');
    metaEl.textContent = '';
    const location = typeof data.location === 'string' ? data.location.trim() : '';
    if (location) {
      const item = document.createElement('span');
      item.textContent = `所在地：${location}`;
      metaEl.appendChild(item);
    }
    const website = safeWebsiteUrl(data.website);
    if (website) {
      const item = document.createElement('span');
      item.textContent = '网站：';
      const link = document.createElement('a');
      link.href = website;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = (typeof data.website_name === 'string' && data.website_name.trim())
          || website.replace(/^https?:\/\//i, '');
      item.appendChild(link);
      metaEl.appendChild(item);
    }
    metaEl.hidden = !metaEl.children.length;

    const statsEl = card.querySelector('.ldp-uc-stats');
    statsEl.textContent = '';
    const stats = [
      ['加入', fmtMonth(data.created_at)],
      ['最近活跃', fmtTime(data.last_seen_at)],
      ['阅读', fmtReadDuration(data.time_read)],
    ].filter((entry) => entry[1]);
    stats.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'ldp-uc-stat';
      const strong = document.createElement('b');
      strong.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      item.appendChild(strong);
      item.appendChild(span);
      statsEl.appendChild(item);
    });
    statsEl.hidden = !stats.length;

    const badges = collectUserCardBadges(data);
    const badgesWrap = card.querySelector('.ldp-uc-badges-wrap');
    const badgesEl = card.querySelector('.ldp-uc-badges');
    badgesEl.textContent = '';
    badges.forEach((badge) => {
      const item = document.createElement('span');
      item.className = 'ldp-uc-badge';
      const image = resolveUserCardAsset(badge.image_url);
      if (image) {
        const img = document.createElement('img');
        img.src = image;
        img.alt = '';
        img.loading = 'lazy';
        item.appendChild(img);
      }
      const label = document.createElement('span');
      label.textContent = badge.name || '徽章';
      item.appendChild(label);
      badgesEl.appendChild(item);
    });
    badgesWrap.hidden = !badges.length;

    card.querySelector('.ldp-uc-loading').hidden = true;
    card.querySelector('.ldp-uc-error').hidden = true;
  }

  function positionUserCard(card, trigger) {
    if (!card || !trigger || !trigger.isConnected) return;
    const modal = trigger.closest('.ldp-modal');
    const bounds = modal ? modal.getBoundingClientRect() : {
      top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight,
    };
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const width = Math.max(200, Math.min(360, bounds.width - margin * 2));
    card.style.width = `${width}px`;
    card.style.maxHeight = `${Math.max(180, bounds.height - margin * 2)}px`;

    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    let left = Math.min(
        Math.max(rect.left, bounds.left + margin),
        bounds.right - margin - cardWidth
    );
    if (left < bounds.left + margin) left = bounds.left + margin;

    const below = rect.bottom + gap;
    const above = rect.top - gap - cardHeight;
    let top;
    if (below + cardHeight <= bounds.bottom - margin) {
      top = below;
    } else if (above >= bounds.top + margin) {
      top = above;
    } else {
      top = Math.max(bounds.top + margin, bounds.bottom - margin - cardHeight);
    }
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  function getUserCardInfo(trigger) {
    const username = (trigger.dataset.username || '').trim();
    if (!username) return null;
    const avatarEl = trigger.matches('img') ? trigger : trigger.querySelector('img');
    const trustText = trigger.dataset.trustLevel;
    const trustValue = trustText != null && trustText !== '' ? Number(trustText) : NaN;
    return {
      username,
      name: (trigger.dataset.name || '').trim(),
      avatar: avatarEl ? (avatarEl.getAttribute('src') || '') : '',
      trustLevel: Number.isFinite(trustValue) ? trustValue : null,
    };
  }

  function closeUserCard() {
    const current = CURRENT_USER_CARD;
    if (!current) return;
    CURRENT_USER_CARD = null;
    current.cleanup();
    current.el.remove();
  }

  function openUserCard(trigger, info) {
    if (!LDR.settings.get('userCards') || !info || !info.username) return;
    if (CURRENT_USER_CARD && CURRENT_USER_CARD.trigger === trigger) {
      closeUserCard();
      return;
    }
    closeUserCard();

    const overlay = trigger.closest('.ldp-overlay');
    if (!overlay) return;
    const card = createUserCard(info);
    overlay.appendChild(card);
    positionUserCard(card, trigger);

    const body = trigger.closest('.ldp-body');
    const onOutside = (event) => {
      if (!CURRENT_USER_CARD || CURRENT_USER_CARD.el !== card) return;
      if (card.contains(event.target) || trigger.contains(event.target)) return;
      closeUserCard();
    };
    const onEsc = (event) => {
      if (event.key !== 'Escape' || isControlPanelEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      closeUserCard();
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    };
    const onScroll = () => closeUserCard();
    const onResize = () => closeUserCard();
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
    if (body) body.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    const cleanup = () => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onEsc, true);
      if (body) body.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
    CURRENT_USER_CARD = { el: card, trigger, cleanup };
    card.focus({ preventScroll: true });

    loadUserCard(info.username, CURRENT_SESSION?.overlay === overlay ? CURRENT_SESSION.signal : undefined).then((data) => {
      if (!CURRENT_USER_CARD || CURRENT_USER_CARD.el !== card) return;
      applyUserCardData(card, data, info);
      positionUserCard(card, trigger);
    }).catch(() => {
      if (!CURRENT_USER_CARD || CURRENT_USER_CARD.el !== card) return;
      const loading = card.querySelector('.ldp-uc-loading');
      if (loading) loading.hidden = true;
      const error = card.querySelector('.ldp-uc-error');
      if (error) {
        error.textContent = '暂时无法加载更多资料';
        error.hidden = false;
      }
      positionUserCard(card, trigger);
    });
  }

  /* ============ 3. 单图灯箱 ============ */
  function openLightbox(src) {
    if (!LDR.settings.get('imageLightbox') || !src) return;
    document.querySelectorAll('.ldp-lightbox').forEach((item) => item.ldpClose?.());
    const lb = document.createElement('div');
    lb.className = 'ldp-lightbox';
    lb.innerHTML = `
      <button class="ldp-lb-x" title="关闭（Esc）">×</button>
      <div class="ldp-lb-stage"><img alt=""></div>`;
    const stage = lb.querySelector('.ldp-lb-stage');
    const img = lb.querySelector('.ldp-lb-stage img');
    img.src = src;
    const close = () => { lb.remove(); document.removeEventListener('keydown', onKey, true); };
    lb.ldpClose = close;
    function onKey(e) { if (e.key === 'Escape' && !isControlPanelEvent(e)) { e.preventDefault(); e.stopPropagation(); close(); } }
    lb.querySelector('.ldp-lb-x').addEventListener('click', close);
    img.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    stage.addEventListener('click', (e) => { if (e.target === stage) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(lb);
  }

  function resolveOriginalSrc(imgEl) {
    const a = imgEl.closest('a.lightbox, a[href]');
    if (a && a.getAttribute('href')) {
      const href = a.getAttribute('href');
      if (/\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i.test(href) || a.classList.contains('lightbox')) {
        return href;
      }
    }
    return imgEl.getAttribute('data-large-src') || imgEl.currentSrc || imgEl.src;
  }

  function activateVideoPlaceholder(container) {
    if (!LDR.settings.get('videoPlayer')) return null;
    if (!container) return null;
    const existingVideo = container.querySelector('video');
    if (existingVideo) return existingVideo;

    const src = container.dataset.videoSrc;
    if (!src) return null;

    const video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.style.display = 'block';
    video.style.width = '100%';
    video.style.maxHeight = '70vh';
    video.style.background = '#000';

    container._qrVideoMarkup = container.innerHTML;
    container.classList.add('video-container', 'ldp-video-ready');
    container.style.cursor = '';
    container.replaceChildren(video);

    const playPromise = video.play();
    if (playPromise?.catch) playPromise.catch(() => {});
    return video;
  }

  /* ============ 4. 已读追踪器 ============ */
  function createReadTracker(topicId, scrollRoot) {
    const contents = new Map();
    const visible = new Set();
    const dwell = new Map();
    const reported = new Map();
    const announced = new Set();
    let lastTick = performance.now();
    let elapsed = 0, reportedElapsed = 0;
    let tickTimer = null, flushTimer = null, inFlight = null;
    let started = false, stopped = false;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
    }, { root: scrollRoot, threshold: [0] });

    const tick = () => {
      const now = performance.now();
      const delta = Math.max(0, Math.min(1200, now - lastTick));
      lastTick = now;
      if (stopped || !LDR.settings.get('readTracking') || document.visibilityState !== 'visible') return;
      const root = scrollRoot.getBoundingClientRect();
      let active = false;
      visible.forEach((content) => {
        if (!content.isConnected) { visible.delete(content); return; }
        const rect = content.getBoundingClientRect();
        const overlap = Math.max(0, Math.min(rect.bottom, root.bottom) - Math.max(rect.top, root.top));
        const required = Math.min(rect.height, root.height) * 0.5;
        if (required <= 0 || overlap < required || rect.right <= root.left || rect.left >= root.right) return;
        const pn = contents.get(content);
        if (!pn) return;
        dwell.set(pn, (dwell.get(pn) || 0) + delta);
        active = true;
      });
      // Topic duration is elapsed visible time, not a sum of overlapping posts.
      if (active) elapsed += delta;
    };
    const onVisibility = () => { lastTick = performance.now(); };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = LDR.on('settings:changed', ({ key, value }) => {
      if (key !== 'readTracking') return;
      lastTick = performance.now();
      if (!value) {
        dwell.clear();
        reported.forEach((ms, pn) => dwell.set(pn, ms));
        elapsed = reportedElapsed;
      }
    });
    const flush = () => {
      if (inFlight) return inFlight;
      if (!LDR.settings.get('readTracking')) return Promise.resolve();
      const snapshot = new Map();
      const params = { topic_id: topicId };
      dwell.forEach((ms, pn) => {
        const increment = Math.floor(ms - (reported.get(pn) || 0));
        if (ms >= READ_THRESHOLD && increment > 0) {
          params[`timings[${pn}]`] = increment;
          snapshot.set(pn, ms);
        }
      });
      if (!snapshot.size) return Promise.resolve();
      const elapsedSnapshot = elapsed;
      params.topic_time = Math.max(0, Math.floor(elapsedSnapshot - reportedElapsed));
      // Timings intentionally use no session AbortSignal: close sends a final flush.
      inFlight = apiSend(`${BASE}/topics/timings`, 'POST', params, { 'X-SILENCE-LOGGER': 'true' })
        .then(() => {
          reportedElapsed = Math.max(reportedElapsed, elapsedSnapshot);
          snapshot.forEach((ms, pn) => {
            reported.set(pn, Math.max(reported.get(pn) || 0, ms));
            if (!LDR.settings.get('readTracking')) return;
            scrollRoot.querySelector(`.ldp-post[data-post-number="${pn}"]`)?.classList.add('ldp-read');
            if (!announced.has(pn)) {
              announced.add(pn);
              LDR.emit('reader:read', { topicId: Number(topicId), postNumber: pn });
            }
          });
        })
        .catch((error) => { LDR.log(`阅读进度暂未提交：${error.message}`, 'warn'); })
        .finally(() => { inFlight = null; });
      return inFlight;
    };
    return {
      observe(node) {
        const content = node?.querySelector(':scope > .ldp-content');
        if (!content || contents.has(content)) return;
        contents.set(content, Number(node.dataset.postNumber));
        io.observe(content);
      },
      start() {
        if (started || stopped) return;
        started = true;
        lastTick = performance.now();
        tickTimer = setInterval(tick, 1000);
        flushTimer = setInterval(flush, FLUSH_INTERVAL);
      },
      stop() {
        if (stopped) return inFlight || Promise.resolve();
        tick();
        stopped = true;
        clearInterval(tickTimer);
        clearInterval(flushTimer);
        io.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        unsubscribe();
        // Wait for an older submission before flushing any newer dwell once.
        return Promise.resolve(inFlight).then(flush);
      },
    };
  }


  /* ============ 6. 树形递归渲染 ============ */
  /**
   * renderNestedTree：递归渲染嵌套树结构。
   * @param {Array} posts - 帖子数组（可能包含 children）
   * @param {HTMLElement} container - DOM 容器
   * @param {object} ctx - 全局上下文
   * @param {number} depth - 当前树深度（用于缩进）
   */
  function renderNestedTree(posts, container, ctx, depth = 0) {
    if (!posts || !posts.length || ctx.signal?.aborted) return;

    posts.forEach(post => {
      idToPost.set(post.id, post);
      if (ctx.postMap) ctx.postMap.set(Number(post.post_number), post);
      const node = ctx.nodeMap.get(Number(post.post_number)) || renderPost(post, depth > 0, ctx, depth);
      if (node.parentElement !== container) container.appendChild(node);
      ctx.tracker.observe(node);
      ctx.nodeMap.set(Number(post.post_number), node);

      // 递归渲染子回复
      if (post.children && post.children.length > 0) {
        const childrenEl = node.querySelector('.ldp-children');
        renderNestedTree(post.children, childrenEl, ctx, depth + 1);
      }

      // 渲染"展示更多"按钮
      const remaining = (post.direct_reply_count || 0) - (post.children?.length || 0);
      if (remaining > 0) {
        renderLoadMoreButton(post, node, remaining, depth);
      }
    });
  }

  /**
   * renderLoadMoreButton：渲染"展示更多回复"按钮。
   * @param {object} post - 父帖子数据
   * @param {HTMLElement} node - 父帖子 DOM 节点
   * @param {number} remaining - 剩余未加载数量
   * @param {number} depth - 树深度
   */
  function renderLoadMoreButton(post, node, remaining, depth) {
    const actionsEl = node.querySelector(':scope > .ldp-sub-actions');
    if (!actionsEl) return;

    actionsEl.style.display = 'block';
    const btn = actionsEl.querySelector('.ldp-load-more-replies');
    if (btn) {
      btn.textContent = `展示更多回复（还剩 ${remaining} 条） ↓`;
    }
  }

  function isRenderablePoll(poll) {
    if (!poll || (poll.type !== 'regular' && poll.type !== 'multiple')) return false;
    if (!Array.isArray(poll.options) || !poll.options.length) return false;
    return poll.options.every((option) =>
      option && option.id != null && String(option.id) !== '' && typeof option.html === 'string');
  }

  function pollResultsVisible(poll) {
    return Array.isArray(poll.options) && poll.options.length > 0
        && poll.options.every((option) =>
          option && typeof option.votes === 'number' && Number.isFinite(option.votes));
  }

  function isPollClosed(poll) {
    if (poll.status === 'closed') return true;
    const close = typeof poll.close === 'string' ? Date.parse(poll.close) : NaN;
    return Number.isFinite(close) && close <= Date.now();
  }

  function canVotePoll(poll) {
    return !isPollClosed(poll) && poll.can_vote !== false && poll.canVote !== false;
  }

  function pollBounds(poll) {
    const optionCount = poll.options.length;
    const minValue = Number(poll.min);
    const maxValue = Number(poll.max);
    const min = Number.isFinite(minValue) && minValue > 0
        ? Math.floor(minValue) : 1;
    const max = Number.isFinite(maxValue) && maxValue > 0
        ? Math.min(Math.floor(maxValue), optionCount) : optionCount;
    return { min, max };
  }

  function currentPollVotes(post, pollName) {
    const votes = post.polls_votes && post.polls_votes[pollName];
    return Array.isArray(votes) ? votes.map((optionId) => String(optionId)) : [];
  }

  function renderPoll(poll, post, titleHtml = '') {
    const node = document.createElement('div');
    const selectedVotes = currentPollVotes(post, poll.name);
    const closed = isPollClosed(poll);
    const canVote = canVotePoll(poll);
    const resultsVisible = pollResultsVisible(poll);
    const { min, max } = pollBounds(poll);

    node.className = 'ldp-poll';
    node.dataset.pollName = String(poll.name);
    node.dataset.type = poll.type;
    node.dataset.votable = canVote ? '1' : '0';
    node.dataset.closed = closed ? '1' : '0';

    const title = document.createElement('div');
    title.className = 'ldp-poll-title';
    if (titleHtml) {
      title.innerHTML = titleHtml;
    } else if (typeof poll.title === 'string' && poll.title) {
      title.textContent = poll.title;
    }
    if (titleHtml || (typeof poll.title === 'string' && poll.title)) node.appendChild(title);

    const meta = document.createElement('div');
    const metaItems = [];
    if (poll.type === 'multiple') metaItems.push(`多选（可选 ${min}-${max} 项）`);
    if (closed) metaItems.push('已关闭');
    if (resultsVisible && Number.isFinite(Number(poll.voters))) {
      metaItems.push(`${Number(poll.voters)} 人投票`);
    } else if (selectedVotes.length) {
      metaItems.push('已选择');
    }
    meta.className = 'ldp-poll-meta';
    meta.textContent = metaItems.join(' · ');
    node.appendChild(meta);

    const optionList = document.createElement('div');
    optionList.className = 'ldp-poll-options';
    poll.options.forEach((option) => {
      const optionId = String(option.id);
      const selected = selectedVotes.includes(optionId);
      const voters = Number(poll.voters);
      const percent = resultsVisible && Number.isFinite(voters) && voters > 0
          ? Math.round((option.votes / voters) * 100) : 0;

      const optionButton = document.createElement('button');
      optionButton.type = 'button';
      optionButton.className = 'ldp-poll-option' + (selected ? ' selected' : '');
      optionButton.dataset.optionId = optionId;
      optionButton.setAttribute('aria-pressed', String(selected));
      optionButton.disabled = !canVote;

      const content = document.createElement('span');
      content.className = 'ldp-poll-option-content';
      const optionHtml = document.createElement('span');
      optionHtml.className = 'ldp-poll-option-html';
      optionHtml.innerHTML = option.html;
      content.appendChild(optionHtml);
      if (resultsVisible) {
        const optionMeta = document.createElement('span');
        optionMeta.className = 'ldp-poll-option-meta';
        optionMeta.textContent = `${option.votes} 票 · ${percent}%`;
        content.appendChild(optionMeta);
      }
      optionButton.appendChild(content);
      if (resultsVisible) {
        const bar = document.createElement('span');
        bar.className = 'ldp-poll-bar';
        bar.style.width = `${percent}%`;
        optionButton.appendChild(bar);
      }
      optionList.appendChild(optionButton);
    });
    node.appendChild(optionList);

    const actions = document.createElement('div');
    actions.className = 'ldp-poll-actions';
    if (poll.type === 'multiple') {
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'ldp-poll-submit';
      submit.textContent = selectedVotes.length ? '更新投票' : '投票';
      submit.disabled = !canVote || selectedVotes.length < min || selectedVotes.length > max;
      actions.appendChild(submit);

      const selectedCount = document.createElement('span');
      selectedCount.className = 'ldp-poll-selected-count';
      selectedCount.textContent = `已选 ${selectedVotes.length}/${max} 项`;
      actions.appendChild(selectedCount);
    }
    if (selectedVotes.length && canVote) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ldp-poll-remove';
      remove.textContent = '撤销投票';
      remove.disabled = !canVote;
      actions.appendChild(remove);
    }
    node.appendChild(actions);

    const status = document.createElement('div');
    status.className = 'ldp-poll-status';
    node.appendChild(status);
    return node;
  }

  function renderPolls(content, post) {
    if (!content || !Array.isArray(post.polls)) return;
    content.querySelectorAll('.poll').forEach((placeholder) => {
      const pollName = placeholder.dataset.pollName || 'poll';
      const poll = post.polls.find((item) => item && item.name === pollName);
      if (!isRenderablePoll(poll)) return;
      const titleNode = placeholder.querySelector('.poll-title');
      placeholder.replaceWith(renderPoll(poll, post, titleNode ? titleNode.innerHTML : ''));
    });
  }

  function updateMultiplePollState(pollNode, poll) {
    const selectedCount = pollNode.querySelectorAll('.ldp-poll-option[aria-pressed="true"]').length;
    const { min, max } = pollBounds(poll);
    const submit = pollNode.querySelector('.ldp-poll-submit');
    if (submit) {
      submit.disabled = pollNode.dataset.votable !== '1'
          || selectedCount < min || selectedCount > max;
    }
    const count = pollNode.querySelector('.ldp-poll-selected-count');
    if (count) count.textContent = `已选 ${selectedCount}/${max} 项`;
  }

  function setPollLoading(pollNode, text) {
    pollNode.dataset.loading = 'true';
    pollNode.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    const status = pollNode.querySelector('.ldp-poll-status');
    if (status) {
      status.classList.remove('ldp-poll-error');
      status.textContent = text;
    }
  }

  function finishPollLoading(pollNode, poll, errorMessage) {
    delete pollNode.dataset.loading;
    const canVote = pollNode.dataset.votable === '1';
    pollNode.querySelectorAll('.ldp-poll-option, .ldp-poll-remove')
        .forEach((button) => { button.disabled = !canVote; });
    if (poll && poll.type === 'multiple') updateMultiplePollState(pollNode, poll);
    const status = pollNode.querySelector('.ldp-poll-status');
    if (status) {
      status.classList.toggle('ldp-poll-error', !!errorMessage);
      status.textContent = errorMessage ? `投票失败：${errorMessage}` : '';
    }
  }

  function showPollStatus(pollNode, text, isError) {
    const status = pollNode.querySelector('.ldp-poll-status');
    if (!status) return;
    status.classList.toggle('ldp-poll-error', !!isError);
    status.textContent = text;
  }

  function findPostForNode(postNode, ctx) {
    const postNumber = Number(postNode.dataset.postNumber);
    return ctx.postMap?.get(postNumber) || idToPost.get(Number(postNode.dataset.postId));
  }

  function findPollForNode(post, pollNode) {
    const pollName = pollNode.dataset.pollName;
    return (post.polls || []).find((poll) => poll && poll.name === pollName) || null;
  }

  function responseVoteOptions(vote) {
    const options = Array.isArray(vote) ? vote : vote && vote.options;
    return Array.isArray(options) ? options.map((optionId) => String(optionId)) : null;
  }

  function updatePostPoll(post, poll, response, removeVote) {
    const polls = Array.isArray(post.polls) ? post.polls : (post.polls = []);
    const index = polls.indexOf(poll);
    const nextPoll = Object.assign({}, poll, response.poll);
    if (index >= 0) polls[index] = nextPoll;
    else polls.push(nextPoll);

    const votes = post.polls_votes || (post.polls_votes = {});
    if (removeVote) {
      delete votes[poll.name];
    } else {
      votes[poll.name] = responseVoteOptions(response.vote) || [];
    }
    return nextPoll;
  }

  async function requestPollVote(pollNode, post, poll, optionIds, removeVote, ctx) {
    if (!LDR.settings.get('showPolls') || ctx?.signal.aborted || !pollNode.isConnected) return;
    setPollLoading(pollNode, removeVote ? '取消投票中…' : '投票中…');
    try {
      const params = removeVote
          ? { post_id: post.id, poll_name: poll.name }
          : { post_id: post.id, poll_name: poll.name, options: optionIds };
      const data = await apiSend(
          `${BASE}/polls/vote`,
          removeVote ? 'DELETE' : 'PUT',
          params, null, ctx?.signal
      );
      ctx?.assertActive?.();
      if (!data || !data.poll) throw new Error('响应缺少投票数据');
      if (!removeVote && !responseVoteOptions(data.vote)) {
        throw new Error('响应缺少投票选择');
      }

      const titleNode = pollNode.querySelector('.ldp-poll-title');
      const nextPoll = updatePostPoll(post, poll, data, removeVote);
      pollNode.replaceWith(renderPoll(
          nextPoll,
          post,
          titleNode ? titleNode.innerHTML : ''
      ));
    } catch (err) {
      finishPollLoading(pollNode, poll, err.message);
    }
  }

  async function handlePollControl(control, ctx) {
    if (!LDR.settings.get('showPolls') || ctx.signal?.aborted) return;
    const pollNode = control.closest('.ldp-poll');
    const postNode = control.closest('.ldp-post');
    if (!pollNode || !postNode) return;

    const post = findPostForNode(postNode, ctx);
    if (!post) {
      showPollStatus(pollNode, '投票失败：未找到帖子数据', true);
      return;
    }
    const poll = findPollForNode(post, pollNode);
    if (!poll) {
      showPollStatus(pollNode, '投票失败：未找到投票数据', true);
      return;
    }

    if (control.classList.contains('ldp-poll-option')) {
      if (poll.type === 'multiple') {
        const selected = control.getAttribute('aria-pressed') === 'true';
        const selectedCount = pollNode
            .querySelectorAll('.ldp-poll-option[aria-pressed="true"]').length;
        const { max } = pollBounds(poll);
        if (!selected && selectedCount >= max) {
          showPollStatus(pollNode, `最多可选 ${max} 项`, false);
          return;
        }
        control.classList.toggle('selected', !selected);
        control.setAttribute('aria-pressed', String(!selected));
        showPollStatus(pollNode, '', false);
        updateMultiplePollState(pollNode, poll);
        return;
      }

      const optionId = control.dataset.optionId;
      const currentVotes = currentPollVotes(post, poll.name);
      await requestPollVote(
          pollNode,
          post,
          poll,
          currentVotes.includes(optionId) ? null : [optionId],
          currentVotes.includes(optionId), ctx
      );
      return;
    }

    if (control.classList.contains('ldp-poll-submit')) {
      const optionIds = Array.from(
          pollNode.querySelectorAll('.ldp-poll-option[aria-pressed="true"]')
      ).map((option) => option.dataset.optionId);
      await requestPollVote(pollNode, post, poll, optionIds, false, ctx);
      return;
    }

    if (control.classList.contains('ldp-poll-remove')) {
      await requestPollVote(pollNode, post, poll, null, true, ctx);
    }
  }

  /* ============ 7. 楼层归位（已废弃，保留用于扁平流降级） ============ */
  function attachPost(p, ctx) {
    if (ctx.postMap) ctx.postMap.set(p.post_number, p);
    if (p.post_number === 1) {
      // 1 楼永久常驻：已存在则跳过（防止重复渲染）
      if (ctx.topicEl.querySelector('.ldp-post')) return;
      const node = renderPost(p, false, ctx);
      ctx.topicEl.appendChild(node);
      ctx.tracker.observe(node);
      return;
    }
    if (ctx.nodeMap.has(p.post_number)) return;

    const parentNum = p.reply_to_post_number;
    const node = renderPost(p, !!(parentNum && parentNum !== 1), ctx);
    ctx.nodeMap.set(p.post_number, node);

    const parentNode = parentNum && parentNum !== 1 ? ctx.nodeMap.get(parentNum) : null;
    if (parentNum && parentNum !== 1 && !parentNode) {
      ctx.pending.push({ num: p.post_number, parent: parentNum });
      ctx.commentsEl.appendChild(node);
    } else if (parentNode) {
      parentNode.querySelector(':scope > .ldp-children').appendChild(node);
    } else {
      ctx.commentsEl.appendChild(node);
    }
    ctx.tracker.observe(node);
    if (p.reply_count > 0) ctx.repliesIO.observe(node);
  }

  /* ============ 7. 渲染单条 ============ */
  /**
   * renderPost：渲染单个帖子节点。
   * @param {object} p - 帖子数据
   * @param {boolean} isReply - 是否是回复（已废弃，兼容性保留）
   * @param {object} ctx - 全局上下文
   * @param {number} depth - 树深度（用于缩进）
   */
  function renderPost(p, isReply, ctx, depth = 0) {
    // 检测已删除的评论（缺少作者信息或内容）
    const isDeleted = !p.username || !p.cooked || p.deleted_at || p.user_deleted === true;

    // 正常评论的渲染逻辑
    const username = p.username || '';
    const displayName = p.name || p.display_name || p.display_username || username;
    const avatar = p.avatar_template
        ? BASE + p.avatar_template.replace('{size}', '48') : '';
    const { canAct } = likeInfo(p);
    const acted = likeActed(p);
    const likeCount = likeDisplayCount(p);
    const isOP = ctx.op && username === ctx.op;
    const isME = ME_USERNAME && username === ME_USERNAME;
    const time = fmtTime(p.created_at);
    const profileUrl = userProfileUrl(p.username);
    const profileLabel = userProfileLabel(username, displayName);
    const userCardAttrs = username
        ? ` data-username="${escAttr(username)}" data-name="${escAttr(displayName)}"`
          + (p.trust_level != null
            ? ` data-trust-level="${escAttr(String(p.trust_level))}"` : '')
        : '';

    let cooked = isDeleted
        ? '<p class="ldp-deleted">（帖子已被作者删除）</p>'
        : p.cooked || '';
    cooked = (() => {
      const tmp = document.createElement('div');
      tmp.innerHTML = cooked;
      tmp.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const isImageLink = /\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i.test(href);
        const isLightbox = a.classList.contains('lightbox');
        if (!isImageLink && !isLightbox) {
          if (!a.getAttribute('target')) a.setAttribute('target', '_blank');
        }
      });
      return tmp.innerHTML;
    })();

    const boostsHtml = isDeleted ? '' : renderBoosts(p.boosts || []);
    const reactionsHtml = isDeleted ? '' : renderReactions(p);
    const canBoost = !isDeleted && p.can_boost === true;
    const canDelete = !isDeleted && isME && p.post_number !== 1;
    const actionsHtml = isDeleted ? '' : `
      <div class="ldp-actions">
        <button class="ldp-btn ldp-like ${acted ? 'liked' : ''}"
          data-acted="${acted ? '1' : '0'}" ${canAct || acted ? '' : 'disabled'} title="点赞">
            <span class="ldp-like-icon">${likeIconHtml(p)}</span>
          <span class="ldp-like-count">${likeCount}</span>
        </button>
        <button class="ldp-btn ldp-replybtn" title="回复">
            <svg viewBox="0 0 1024 1024" style="width:12px;height:12px;fill:currentColor;vertical-align:middle;">${ICONS.reply}</svg>
        </button>
        <button class="ldp-btn ldp-boost-btn" ${canBoost ? '' : 'disabled'} title="Boost">
            <svg viewBox="0 0 1024 1024" style="width:12px;height:12px;fill:currentColor;vertical-align:middle;">${ICONS.boost}</svg>
        </button>
        ${canDelete ? `<button class="ldp-btn ldp-deletebtn" title="删除">
          <svg class="fa d-icon d-icon-trash-can svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><use href="#trash-can"></use></svg>
        </button>` : ''}
      </div>
    `;

    const node = document.createElement('div');
    node.className = 'ldp-post' + (depth > 0 ? ' ldp-reply' : '');
    node.dataset.postId = p.id;
    node.dataset.postNumber = p.post_number;
    node.innerHTML = `
      <div class="ldp-post-head">
        ${profileUrl ? `<a class="ldp-user-link" href="${profileUrl}" target="_blank" rel="noopener noreferrer" title="${escAttr(profileLabel)}"${userCardAttrs}>` : ''}
        ${avatar ? `<img class="ldp-avatar" src="${avatar}" alt="" loading="lazy" decoding="async">` : ''}
        ${displayName ? `<span class="ldp-author">${esc(displayName)}</span>` : ''}
        ${username ? `<span class="ldp-user">@${esc(username)}</span>` : ''}
        ${profileUrl ? '</a>' : ''}
        ${p.trust_level != null ? `<span class="ldp-level">Lv.${p.trust_level}</span>` : ''}
        ${isOP ? '<span class="ldp-op">OP</span>' : ''}
        ${isME ? '<span class="ldp-me">ME</span>' : ''}
        ${time ? `<span class="ldp-time">· ${esc(time)}</span>` : ''}
        <span class="ldp-floor">#${p.post_number}</span>
      </div>
      <div class="ldp-content">${cooked}</div>
      ${reactionsHtml}
      <div class="ldp-boosts-list">${boostsHtml}</div>
      <div class="ldp-boost-input-wrap">
        <input type="text" class="ldp-boost-input" maxlength="50"
          placeholder="Boost ${esc(p.username)}… (最多16字符)">
        <button class="ldp-emoji-btn ldp-boost-emoji" type="button" title="表情">${EMOJI_BTN_ICON}</button>
        <button class="ldp-boost-submit" title="发送">✓</button>
        <button class="ldp-boost-cancel" title="取消">×</button>
      </div>
      ${actionsHtml}
      <div class="ldp-children"></div>
      <div class="ldp-sub-loading">加载楼中楼中…</div>
      <div class="ldp-sub-actions"><button class="ldp-btn ldp-load-more-replies">展示更多回复 ↓</button></div>
    `;
    if (!LDR.settings.get('videoPlayer')) node.querySelectorAll('video').forEach((video) => video.removeAttribute('autoplay'));
    renderPolls(node.querySelector('.ldp-content'), p);
    prepareSpoilers(node.querySelector('.ldp-content'));
    renderMath(node);
    if (reactionsHtml) fetchEmojiData().then(() => refreshEmojiUrls(node)).catch(() => {});
    return node;
  }

  function markPostDeleted(postNode, ctx) {
    const postNumber = Number(postNode.dataset.postNumber);
    const post = ctx.postMap?.get(postNumber) || idToPost.get(Number(postNode.dataset.postId));
    if (post) {
      post.deleted_at = post.deleted_at || new Date().toISOString();
      post.user_deleted = true;
    }

    const content = postNode.querySelector(':scope > .ldp-content');
    if (content) content.innerHTML = '<p class="ldp-deleted">（帖子已被作者删除）</p>';
    postNode.style.opacity = '';
    postNode.querySelectorAll(
      ':scope > .ldp-boosts-list, :scope > .ldp-boost-input-wrap, :scope > .ldp-actions, :scope > .ldp-reactions'
    ).forEach((el) => el.remove());
  }

  /* ============ 7.1 公式渲染（KaTeX） ============ */
  /**
   * Discourse 的 cooked 中公式只是 <span class="math"> / <div class="math">
   * 包裹的原始 LaTeX，真正的渲染由站点 discourse-math 插件在客户端完成；
   * 本脚本自建 DOM 绕过了该流程，因此需自行调用 KaTeX。
   * 优先复用站点已加载的 KaTeX（window.katex），否则加载站点自带资源，
   * 最后回退到 jsdelivr CDN（站点可能使用 MathJax 等其它渲染器）。
   */
  const KATEX_CDN_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
  const KATEX_CDN_JS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
  const KATEX_CDN_MHCHEM = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/mhchem.min.js';
  let katexLoading = null;

  function loadAsset(kind, url) {
    return new Promise((resolve, reject) => {
      if (kind === 'css') {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error('CSS 加载失败: ' + url));
        document.head.appendChild(link);
      } else {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('JS 加载失败: ' + url));
        document.head.appendChild(script);
      }
    });
  }

  function loadKatex() {
    if (window.katex) return Promise.resolve();
    if (katexLoading) return katexLoading;
    katexLoading = (async () => {
      let loaded = false;
      try {
        // 1) 站点自带 KaTeX 资源（与 discourse-math 插件一致，同源最快）
        await loadAsset('css', `${BASE}/plugins/discourse-math/katex/katex.min.css`);
        await loadAsset('js', `${BASE}/plugins/discourse-math/katex/katex.min.js`);
        await loadAsset('js', `${BASE}/plugins/discourse-math/katex/mhchem.min.js`);
        loaded = !!window.katex;
      } catch (err) {
        loaded = false;
      }
      if (!loaded) {
        // 2) 站点未提供 KaTeX 时回退到公共 CDN
        await loadAsset('css', KATEX_CDN_CSS);
        await loadAsset('js', KATEX_CDN_JS);
        await loadAsset('js', KATEX_CDN_MHCHEM);
      }
      if (!window.katex) throw new Error('KaTeX 加载失败');
    })();
    katexLoading.catch(() => { katexLoading = null; });
    return katexLoading;
  }

  function renderMath(root) {
    if (!LDR.settings.get('mathRendering')) return;
    const mathEls = root.querySelectorAll('.math');
    if (!mathEls.length) return;

    loadKatex().then(() => {
      if (!LDR.settings.get('mathRendering') || !root.isConnected) return;
      mathEls.forEach((el) => {
        if (el.dataset.appliedKatex) return;
        el.dataset.appliedKatex = true;

        // 类名与选项对齐 discourse-math 插件，保证站点 KaTeX CSS 生效
        const isBlock = el.tagName === 'DIV';
        el.classList.add('math-container', isBlock ? 'block-math' : 'inline-math', 'katex-math');
        const text = el.textContent;
        el.dataset.qrMathSource = text;
        el.textContent = '';
        try {
          window.katex.render(text, el, {
            trust: (context) => ['\\htmlId', '\\href'].includes(context.command),
            macros: {
              '\\eqref': '\\href{###1}{(\\text{#1})}',
              '\\ref': '\\href{###1}{\\text{#1}}',
              '\\label': '\\htmlId{#1}{}',
            },
            displayMode: isBlock,
            throwOnError: false,
          });
        } catch (err) {
          el.textContent = text; // 渲染失败时保留原始公式文本
        }
      });
    }).catch((err) => {
      console.warn('[LinuxDo 增强阅读] KaTeX 加载失败，公式将以文本显示:', err);
    });
  }

  /* ============ 8. 回复框 ============ */
  function ensureReplyBox(post) {
    let box = post.querySelector(':scope > .ldp-replybox');
    if (box) return box;
    const username = (post.querySelector(':scope > .ldp-post-head .ldp-user')?.textContent || '').replace(/^@/, '');
    box = document.createElement('div');
    box.className = 'ldp-replybox';
    box.innerHTML = `<textarea placeholder="回复 @${esc(username)} …"></textarea><div class="ldp-reply-tools"><div class="ldp-insert-wrap"><button class="ldp-emoji-btn ldp-reply-insert" type="button" title="插入模板" aria-haspopup="true" aria-expanded="false">${INSERT_BTN_ICON}</button><div class="ldp-insert-menu" hidden><button class="ldp-insert-item ldp-reply-details" type="button">${DETAILS_ICON}<span>隐藏详细信息</span></button><button class="ldp-insert-item ldp-reply-spoiler" type="button">${SPOILER_ICON}<span>模糊剧透</span></button></div></div><button class="ldp-emoji-btn ldp-reply-emoji" type="button" title="表情">${EMOJI_BTN_ICON}</button><button class="ldp-send">发送</button><span class="ldp-reply-tip">✓ 已发送</span></div>`;
    const textarea = box.querySelector('textarea');
    bindPasteEvent(textarea);
    const emojiBtn = box.querySelector('.ldp-reply-emoji');
    emojiBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleEmojiPanel(emojiBtn, textarea); });
    const insertBtn = box.querySelector('.ldp-reply-insert');
    const insertMenu = box.querySelector('.ldp-insert-menu');
    const onInsertMenuOutside = (e) => {
      if (!insertMenu.contains(e.target) && !insertBtn.contains(e.target)) closeInsertMenu();
    };
    const closeInsertMenu = () => {
      insertMenu.hidden = true;
      insertBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onInsertMenuOutside, true);
    };
    box.ldpCleanup = closeInsertMenu;
    insertBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (insertMenu.hidden) {
        insertMenu.hidden = false;
        insertBtn.setAttribute('aria-expanded', 'true');
        document.addEventListener('mousedown', onInsertMenuOutside, true);
      } else {
        closeInsertMenu();
      }
    });
    box.querySelector('.ldp-reply-details').addEventListener('click', () => {
      insertAtCursor(textarea, '[details="总结"]\n此文本将被隐藏\n[/details]');
      closeInsertMenu();
    });
    box.querySelector('.ldp-reply-spoiler').addEventListener('click', () => {
      insertAtCursor(textarea, '[spoiler]此文本将被模糊处理[/spoiler]');
      closeInsertMenu();
    });
    const actions = post.querySelector(':scope > .ldp-actions');
    if (actions) actions.after(box);
    else post.appendChild(box);
    return box;
  }

  /* ============ 文件粘贴上传 ============ */
  const MULTIPART_UPLOAD_CONCURRENCY = 6;
  const MULTIPART_RETRY_DELAYS = [0, 1000, 3000, 5000];
  const HUGE_FILE_CHECKSUM_LIMIT = 100 * 1024 * 1024;
  const DISCOURSE_IMAGE_SIZE_LIMIT = 4 * 1024 * 1024;
  const OFFICIAL_MEDIA_WORKER_URL = 'https://cdn3.ldstatic.com/assets/br/chunk-bgg7iqfw.digested.js';
  const IMAGE_MAGICK_CDN = 'https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@0.0.43/dist/index.js';
  const IMAGE_MAGICK_WASM = 'https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@0.0.43/dist/x86/magick.wasm';
  const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'ico', 'webp', 'avif', 'heic', 'heif', 'jxl']);
  const AUDIO_EXTENSIONS = new Set(['mp3', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'm4b', 'm4p', 'm4r', 'aac', 'flac']);
  const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'webm', 'ogv', 'm4v', '3gp', 'avi', 'mpeg']);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function fileExtension(filename) {
    const match = (filename || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  async function fileSha1(file) {
    if (!window.isSecureContext || !file.arrayBuffer || !window.crypto?.subtle?.digest) return '';
    if (file.size > HUGE_FILE_CHECKSUM_LIMIT) return '';
    try {
      const buffer = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest('SHA-1', buffer);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch (err) {
      return '';
    }
  }

  function multipartChunkSize(fileSize) {
    if (fileSize >= 500 * 1024 * 1024) return 20 * 1024 * 1024;
    if (fileSize >= 100 * 1024 * 1024) return 10 * 1024 * 1024;
    return 5 * 1024 * 1024;
  }

  function webpFileName(fileName) {
    const baseName = (fileName || 'clipboard-file').replace(/\.[^.]+$/, '');
    return `${baseName || 'clipboard-file'}.webp`;
  }

  let imageMagickReady;

  async function ensureImageMagick() {
    if (!imageMagickReady) {
      imageMagickReady = (async () => {
        const { initializeImageMagick } = await import(IMAGE_MAGICK_CDN);
        await initializeImageMagick(new URL(IMAGE_MAGICK_WASM));
      })();
    }
    return imageMagickReady;
  }

  async function convertAnimatedGifWithOfficialWorker(file) {
    const input = await file.arrayBuffer();
    // Blob Worker 只是官方 chunk 的入口包装，chunk 内相对 WASM 路径仍会解析到 L 站 CDN。
    const worker = new Worker(URL.createObjectURL(new Blob([
      `import '${OFFICIAL_MEDIA_WORKER_URL}';`,
    ], { type: 'text/javascript' })), { type: 'module' });

    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = (event) => {
          const message = event.data;
          if (message.type === 'file') {
            const blob = new Blob([message.file], { type: message.outputType });
            resolve(blob.size < file.size && blob.size <= DISCOURSE_IMAGE_SIZE_LIMIT
              ? new File([blob], webpFileName(file.name), { type: message.outputType })
              : null);
          } else if (message.type === 'skipped') {
            resolve(null);
          } else {
            reject(new Error('官方图片处理 Worker 返回异常'));
          }
        };
        worker.onerror = () => reject(new Error('官方图片处理 Worker 加载失败'));
        worker.onmessageerror = () => reject(new Error('官方图片处理 Worker 消息解析失败'));

        worker.postMessage({
          type: 'convertAnimated',
          file: input,
          fileName: file.name || 'clipboard-file',
          fileId: `${file.name}-${file.size}`,
          originalFileSize: file.size,
          settings: { encode_quality: 75, debug_mode: false },
        }, [input]);
      });
    } finally {
      worker.terminate();
    }
  }

  async function preprocessImage(file) {
    if (file.size <= DISCOURSE_IMAGE_SIZE_LIMIT) return file;
    if (!file.type.startsWith('image/') && !IMAGE_EXTENSIONS.has(fileExtension(file.name))) return file;

    if (file.type === 'image/gif' || fileExtension(file.name) === 'gif') {
      try {
        const converted = await convertAnimatedGifWithOfficialWorker(file);
        if (converted) return converted;
        console.warn('[LinuxDo 增强阅读] 官方 Worker 未产出更小的 WebP，将尝试上传原 GIF');
        return file;
      } catch (err) {
        console.warn('[LinuxDo 增强阅读] 官方 GIF 预处理失败，将回退 ImageMagick:', err);
      }
    }

    try {
      await ensureImageMagick();
      const { ImageMagick, MagickFormat } = await import(IMAGE_MAGICK_CDN);
      const input = new Uint8Array(await file.arrayBuffer());
      const output = await ImageMagick.readCollection(input, async images => {
        images.forEach(image => { image.quality = 75; });
        return await images.write(MagickFormat.WebP, data => data);
      });
      const blob = new Blob([output], { type: 'image/webp' });
      if (blob.size >= file.size || blob.size > DISCOURSE_IMAGE_SIZE_LIMIT) return file;
      return new File([blob], webpFileName(file.name), { type: 'image/webp' });
    } catch (err) {
      console.warn('[LinuxDo 增强阅读] 图片 ImageMagick 预处理失败，将尝试上传原文件:', err);
      return file;
    }
  }

  async function createMultipartUpload(file) {
    const params = new URLSearchParams();
    params.set('file_name', file.name || 'clipboard-file');
    params.set('file_size', String(file.size));
    params.set('upload_type', 'composer');
    const sha1 = await fileSha1(file);
    if (sha1) params.set('metadata[sha1-checksum]', sha1);
    return apiSend(`${BASE}/uploads/create-multipart.json`, 'POST', params);
  }

  async function presignMultipartParts(uniqueIdentifier, partNumbers) {
    const params = new URLSearchParams();
    params.set('unique_identifier', uniqueIdentifier);
    partNumbers.forEach((partNumber) => params.append('part_numbers[]', String(partNumber)));
    return apiSend(`${BASE}/uploads/batch-presign-multipart-parts.json`, 'POST', params);
  }

  async function uploadMultipartPart(file, partNumber, start, end, url) {
    for (let attempt = 0; attempt < MULTIPART_RETRY_DELAYS.length; attempt++) {
      try {
        const res = await fetch(url, { method: 'PUT', body: file.slice(start, end) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const etag = res.headers.get('ETag');
        if (!etag) throw new Error('S3 未返回 ETag');
        return { part_number: partNumber, etag };
      } catch (err) {
        if (attempt === MULTIPART_RETRY_DELAYS.length - 1) throw err;
        await sleep(MULTIPART_RETRY_DELAYS[attempt + 1]);
      }
    }
    return null;
  }

  async function uploadMultipartParts(file, uniqueIdentifier) {
    const chunkSize = multipartChunkSize(file.size);
    const totalParts = Math.ceil(file.size / chunkSize);
    const parts = new Array(totalParts);

    for (let partNumber = 1; partNumber <= totalParts; partNumber += MULTIPART_UPLOAD_CONCURRENCY) {
      const batchNumbers = [];
      for (let n = partNumber; n < Math.min(partNumber + MULTIPART_UPLOAD_CONCURRENCY, totalParts + 1); n++) {
        batchNumbers.push(n);
      }
      const { presigned_urls: presignedUrls } = await presignMultipartParts(uniqueIdentifier, batchNumbers);
      const uploadedParts = await Promise.all(batchNumbers.map((n) => uploadMultipartPart(
        file,
        n,
        (n - 1) * chunkSize,
        Math.min(n * chunkSize, file.size),
        presignedUrls[n],
      )));
      uploadedParts.forEach((part) => { parts[part.part_number - 1] = part; });
    }
    return parts;
  }

  async function completeMultipartUpload(uniqueIdentifier, parts) {
    const res = await fetch(`${BASE}/uploads/complete-multipart.json`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=UTF-8',
        'X-CSRF-Token': csrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ unique_identifier: uniqueIdentifier, parts, pasted: true }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json().catch(() => ({}));
  }

  async function abortMultipartUpload(uploadId) {
    return apiSend(`${BASE}/uploads/abort-multipart.json`, 'POST', {
      external_upload_identifier: uploadId,
    });
  }

  async function uploadFile(file) {
    let uploadId;
    try {
      const created = await createMultipartUpload(file);
      if (!created?.unique_identifier || !created?.external_upload_identifier) {
        throw new Error('上传初始化返回数据异常');
      }
      uploadId = created.external_upload_identifier;
      const parts = await uploadMultipartParts(file, created.unique_identifier);
      return await completeMultipartUpload(created.unique_identifier, parts);
    } catch (err) {
      if (uploadId) await abortMultipartUpload(uploadId).catch(() => {});
      throw err;
    }
  }

  function uploadMarkdown(res) {
    const label = (res.original_filename || '附件').replace(/[\[\]\|]/g, '');
    const extension = fileExtension(res.original_filename);
    if (IMAGE_EXTENSIONS.has(extension)) {
      return res.width && res.height
        ? `![${label}|${res.width}x${res.height}](${res.short_url})`
        : `![${label}](${res.short_url})`;
    }
    if (AUDIO_EXTENSIONS.has(extension)) return `![${label}|audio](${res.short_url})`;
    if (VIDEO_EXTENSIONS.has(extension)) return `![${label}|video](${res.short_url})`;
    return `[${label}|attachment](${res.short_url})${res.human_filesize ? ` (${res.human_filesize})` : ''}`;
  }

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    textarea.value = val.substring(0, start) + text + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
  }

  function bindPasteEvent(textarea) {
    textarea.addEventListener('paste', async (e) => {
      if (!LDR.settings.get('showReply') || !textarea.isConnected) return;
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (const item of items) {
        if (item.kind === 'file') {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const placeholder = `[正在上传文件 ${file.name} ...]`;
          insertAtCursor(textarea, placeholder);
          textarea.classList.add('uploading');
          try {
            const uploadableFile = await preprocessImage(file);
            if (!LDR.settings.get('showReply') || !textarea.isConnected) throw new Error('回复已关闭');
            const res = await uploadFile(uploadableFile);
            if (res && res.short_url) {
              textarea.value = textarea.value.replace(placeholder, uploadMarkdown(res));
            } else {
              throw new Error('上传返回数据异常');
            }
          } catch (err) {
            textarea.value = textarea.value.replace(placeholder, `[文件上传失败: ${err.message}]`);
          } finally {
            textarea.classList.remove('uploading');
          }
        }
      }
    });
  }

  /* ============ 9. 加载剩余子回复 ============ */
  /**
   * loadAllChildren：加载指定帖子的所有剩余子回复。
   * @param {number} postId - 帖子 ID
   * @param {number} postNumber - 帖子楼号
   * @param {HTMLElement} button - "展示更多"按钮
   * @param {object} ctx - 全局上下文
   */
  async function loadAllChildren(postId, postNumber, button, ctx, silent = false) {
    if (ctx.signal?.aborted || ctx.streamMode) return [];
    if (!ctx.childLoads) ctx.childLoads = new Map();
    if (ctx.childLoads.has(postNumber)) return ctx.childLoads.get(postNumber);
    const work = (async () => {
      if (button) { button.disabled = true; button.textContent = '加载中…'; }
      try {
        const children = await fetchAllNestedChildren(ctx.topicId, postNumber, ctx.signal);
        ctx.assertActive?.();
        if (ctx.streamMode) return [];
        const postNode = ctx.nodeMap.get(postNumber);
        if (!postNode) throw new Error(`父楼层 #${postNumber} 尚未渲染`);
        const post = ctx.postMap.get(postNumber);
        if (post) post.children = children;
        indexTree(children);
        let depth = 1;
        let parent = postNode.parentElement;
        while (parent && parent !== ctx.commentsEl) {
          if (parent.classList.contains('ldp-children')) depth++;
          parent = parent.parentElement;
        }
        renderNestedTree(children, postNode.querySelector(':scope > .ldp-children'), ctx, depth);
        const actions = postNode.querySelector(':scope > .ldp-sub-actions');
        if (actions) actions.style.display = 'none';
        postNode.dataset.repliesLoaded = '1';
        return children;
      } catch (error) {
        if (button && button.isConnected) { button.disabled = false; button.textContent = '加载失败，点击重试 ↓'; }
        if (error.name !== 'AbortError' && !silent) LDR.log(`子回复加载失败：${error.message}`, 'error');
        if (silent) throw error;
        return [];
      } finally { ctx.childLoads.delete(postNumber); }
    })();
    ctx.childLoads.set(postNumber, work);
    return work;
  }

  /* ============ 9. 楼层归位辅助函数 ============ */
  /**
   * reflowPending：重新组织等待父节点的帖子。
   * 当子帖子的父节点还未渲染时，会先放到 pending 数组，
   * 父节点渲染后调用此函数重新组织DOM结构。
   */
  function reflowPending(ctx) {
    if (!ctx.pending || !ctx.pending.length) return;
    const rest = [];
    ctx.pending.forEach((it) => {
      const child = ctx.nodeMap.get(it.num);
      const parent = ctx.nodeMap.get(it.parent);
      if (child && parent) {
        parent.querySelector(':scope > .ldp-children').appendChild(child);
      } else {
        rest.push(it);
      }
    });
    ctx.pending = rest;
  }

  /* ============ 10. 事件委托 ============ */
  function bindActions(modal, ctx) {
    modal.addEventListener('click', async (e) => {
      if (ctx.signal?.aborted) return;
      const spoiler = LDR.settings.get('spoilerProtection') && e.target.closest('.ldp-spoiler');
      if (spoiler && spoiler.classList.contains('ldp-spoiler-blurred')) {
        e.preventDefault();
        e.stopPropagation();
        setSpoilerState(spoiler, false);
        return;
      }
      if (spoiler && spoiler.classList.contains('ldp-spoiler-expanded')
          && !e.target.closest('a, button, input, video, img')) {
        e.preventDefault();
        e.stopPropagation();
        setSpoilerState(spoiler, true);
        return;
      }
      const videoPlaceholder = e.target.closest('.video-placeholder-container[data-video-src]');
      if (LDR.settings.get('videoPlayer') && videoPlaceholder && !videoPlaceholder.querySelector('video')) {
        e.preventDefault();
        e.stopPropagation();
        activateVideoPlaceholder(videoPlaceholder);
        return;
      }

      const userCardTrigger = e.target.closest(
          '.ldp-user-link, .ldp-boost-avatar-link, .ldp-b-avatar'
      );
      if (LDR.settings.get('userCards') && userCardTrigger && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        const info = getUserCardInfo(userCardTrigger);
        if (info) {
          e.preventDefault();
          e.stopPropagation();
          openUserCard(userCardTrigger, info);
          return;
        }
      }

      const anchor = e.target.closest('a');
      if (anchor && anchor.target === '_blank') return;

      const pollControl = e.target.closest(
          '.ldp-poll-option, .ldp-poll-submit, .ldp-poll-remove'
      );
      if (pollControl) {
        e.preventDefault();
        e.stopPropagation();
        if (pollControl.disabled || pollControl.closest('.ldp-poll')?.hasAttribute('data-loading')) return;
        await handlePollControl(pollControl, ctx);
        return;
      }

      const img = e.target.closest('.ldp-content img');
      if (LDR.settings.get('imageLightbox') && img) { e.preventDefault(); e.stopPropagation(); openLightbox(resolveOriginalSrc(img)); return; }

      const moreBtn = e.target.closest('.ldp-load-more-replies');
      if (moreBtn) {
        const post = moreBtn.closest('.ldp-post');
        const postId = +post.dataset.postId;
        const postNumber = +post.dataset.postNumber;
        await loadAllChildren(postId, postNumber, moreBtn, ctx);
        return;
      }

      const postNode = e.target.closest('.ldp-post');
      if (!postNode) return;
      const postId = postNode.dataset.postId, postNumber = +postNode.dataset.postNumber;

      const likeBtn = e.target.closest('.ldp-like');
      if (likeBtn && !likeBtn.disabled) {
        closeReactionPanel();
        // 已有反应（任意表情）→ 点 ♥ = 取消当前反应；否则沿用 core 点赞开关
        const curPost = findPostForNode(postNode, ctx);
        if (!LDR.settings.get('showReactions') || !curPost || curPost._qrLikePending) return;
        const cur = curPost.current_user_reaction;
        if (cur && cur.id) { await toggleReaction(postNode, ctx, cur.id, likeBtn); return; }
        const { acted, canAct } = likeInfo(curPost);
        if (!acted && !canAct) return;
        curPost._qrLikePending = true;
        likeBtn.disabled = true;
        try {
          if (!acted) {
            await apiSend(`${BASE}/post_actions`, 'POST', { id: postId, post_action_type_id: 2, flag_topic: false }, null, ctx.signal);
            ctx.assertActive?.();
            patchCoreLike(curPost, true);
          } else {
            await apiSend(`${BASE}/post_actions/${postId}?post_action_type_id=2`, 'DELETE', null, null, ctx.signal);
            ctx.assertActive?.();
            patchCoreLike(curPost, false);
          }
        } catch (err) {
          if (err.name !== 'AbortError') alert('操作失败：' + err.message);
        } finally {
          delete curPost._qrLikePending;
          updatePostReactions(postNode, curPost);
          if (postNumber === 1) {
            const overlay = postNode.closest('.ldp-overlay');
            const footer = overlay?.querySelector('.ldp-f-like');
            if (footer) syncFooterLike(footer, overlay.querySelector('.ldp-f-like-count'), curPost);
          }
        }
        return;
      }

      const reactionBtn = e.target.closest('.ldp-reaction');
      if (reactionBtn && !reactionBtn.disabled) {
        const name = reactionBtn.getAttribute('data-reaction');
        if (!name) return;
        await toggleReaction(postNode, ctx, name, reactionBtn);
        return;
      }

      const replyBtn = e.target.closest('.ldp-replybtn');
      if (replyBtn) {
        const box = ensureReplyBox(postNode);
        box.classList.toggle('open');
        if (box.classList.contains('open')) box.querySelector('textarea').focus();
        return;
      }

      const boostBtn = e.target.closest('.ldp-boost-btn');
      const boostEmojiBtn = e.target.closest('.ldp-boost-emoji');
      if (boostEmojiBtn) {
        e.preventDefault();
        e.stopPropagation();
        const wrap = boostEmojiBtn.closest('.ldp-boost-input-wrap');
        const input = wrap && wrap.querySelector('.ldp-boost-input');
        if (input) toggleEmojiPanel(boostEmojiBtn, input);
        return;
      }

      if (boostBtn && !boostBtn.disabled) {
        const wrap = postNode.querySelector(':scope > .ldp-boost-input-wrap');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        wrap.classList.toggle('open', opening);
        if (opening) wrap.querySelector('.ldp-boost-input').focus();
        return;
      }

      const deleteBtn = e.target.closest('.ldp-deletebtn');
      if (deleteBtn && !deleteBtn.disabled) {
        deleteBtn.disabled = true;
        try {
          await apiSend(`${BASE}/posts/${postId}`, 'DELETE', {
            context: `/t/topic/${ctx.topicId}/${postNumber}`,
          });
          if (ctx.signal?.aborted) return;
          markPostDeleted(postNode, ctx);
        } catch (err) {
          alert('删除失败：' + err.message);
          deleteBtn.disabled = false;
        }
        return;
      }

      const boostCancel = e.target.closest('.ldp-boost-cancel');
      if (boostCancel) {
        const wrap = boostCancel.closest('.ldp-boost-input-wrap');
        if (wrap) { wrap.classList.remove('open'); wrap.querySelector('.ldp-boost-input').value = ''; }
        return;
      }

      const boostSubmit = e.target.closest('.ldp-boost-submit');
      if (boostSubmit && !boostSubmit.disabled) {
        const wrap = boostSubmit.closest('.ldp-boost-input-wrap');
        const input = wrap && wrap.querySelector('.ldp-boost-input');
        const raw = input ? input.value.trim() : '';
        if (!raw) { input && input.focus(); return; }
        if (raw.length > 16) { alert('Boost内容不能超过16个字符'); return; }
        boostSubmit.disabled = true;
        try {
          const res = await apiSend(`${BASE}/discourse-boosts/posts/${postId}/boosts`, 'POST', { raw });
          if (ctx.signal?.aborted) return;
          if (res && res.id) {
            const listEl = postNode.querySelector(':scope > .ldp-boosts-list');
            if (listEl) {
              const bAvatar = res.user && res.user.avatar_template
                  ? BASE + res.user.avatar_template.replace('{size}', '36') : '';
              const bProfileUrl = userProfileUrl(res.user && res.user.username);
              const bProfileLabel = userProfileLabel(res.user && res.user.username, res.user && (res.user.name || res.user.display_name));
              const bUsername = (res.user && res.user.username) || '';
              const bCardName = String(
                  (res.user && (res.user.name || res.user.display_name)) || bUsername || ''
              );
              const bCardAttrs = bUsername
                  ? ` data-username="${escAttr(bUsername)}" data-name="${escAttr(bCardName)}"`
                  : '';
              const newBubble = document.createElement('div');
              newBubble.className = 'ldp-boost-bubble ldp-flash';
              newBubble.dataset.boostId = res.id;
              newBubble.innerHTML =
                  (bAvatar ? (bProfileUrl
                    ? `<a class="ldp-boost-avatar-link" href="${bProfileUrl}" target="_blank" rel="noopener noreferrer" title="${escAttr(bProfileLabel)}"${bCardAttrs}><img class="ldp-b-avatar" src="${bAvatar}" alt=""${bCardAttrs}></a>`
                    : `<img class="ldp-b-avatar" src="${bAvatar}" alt=""${bCardAttrs}>`) : '') +
                  `<p>${res.cooked || ''}</p>` +
                  `<button class="ldp-boost-del" title="删除此Boost">×</button>`;
              listEl.appendChild(newBubble);
            }
            input.value = '';
            wrap.classList.remove('open');
            const btn = postNode.querySelector(':scope > .ldp-actions > .ldp-boost-btn');
            if (btn) btn.disabled = true;
            if (postNumber === 1) {
              const fBoost = ctx.scrollRoot.closest('.ldp-modal').querySelector('.ldp-f-boost');
              if (fBoost) { fBoost.disabled = true; fBoost.style.opacity = '0.4'; }
            }
          }
        } catch (err) { alert('发射失败：' + err.message); }
        finally { boostSubmit.disabled = false; }
        return;
      }

      const boostDel = e.target.closest('.ldp-boost-del');
      if (boostDel) {
        const bubble = boostDel.closest('.ldp-boost-bubble');
        const boostId = bubble && bubble.dataset.boostId;
        if (!boostId) return;
        try {
          await apiSend(`${BASE}/discourse-boosts/boosts/${boostId}`, 'DELETE');
          if (ctx.signal?.aborted) return;
          bubble.remove();
          const btn = postNode.querySelector(':scope > .ldp-actions > .ldp-boost-btn');
          if (btn) btn.disabled = false;
          if (postNumber === 1) {
            const fBoost = ctx.scrollRoot.closest('.ldp-modal').querySelector('.ldp-f-boost');
            if (fBoost) { fBoost.disabled = false; fBoost.style.opacity = '1'; }
          }
        } catch (err) { alert('删除失败：' + err.message); }
        return;
      }

      const sendBtn = e.target.closest('.ldp-send');
      if (sendBtn) {
        const box = sendBtn.closest('.ldp-replybox'),
            textarea = box.querySelector('textarea'),
            raw = textarea.value.trim();
        if (!raw) return;
        sendBtn.disabled = true;
        sendBtn.textContent = '发送中…';
        try {
          const data = await apiSend(`${BASE}/posts`, 'POST', {
            raw,
            topic_id: ctx.topicId,
            reply_to_post_number: postNumber,
            nested_post: true,
          });
          if (ctx.signal?.aborted) return;
          const postData = data && data.post ? data.post : data;
          if (postData && postData.cooked) {
            const isTopLevel = postNumber === 1;
            const newPost = {
              id: postData.id,
              post_number: postData.post_number,
              username: postData.username || ME_USERNAME,
              name: postData.name,
              avatar_template: postData.avatar_template,
              cooked: postData.cooked,
              created_at: postData.created_at || new Date().toISOString(),
              reply_to_post_number: postNumber,
              polls: postData.polls,
              polls_votes: postData.polls_votes,
              actions_summary: [],
              boosts: [],
              can_boost: true,
            };
            const newNode = renderPost(
                newPost, !isTopLevel, ctx, isTopLevel ? 0 : 1
            );
            newNode.classList.add('ldp-flash');
            if (ctx.streamMode) {
              const before = Array.from(ctx.commentsEl.children).find((item) => Number(item.dataset.postNumber) > newPost.post_number);
              ctx.commentsEl.insertBefore(newNode, before || null);
              newNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (isTopLevel) {
              ctx.commentsEl.prepend(newNode);
              newNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              const childrenContainer = postNode.querySelector(':scope > .ldp-children');
              if (childrenContainer) {
                childrenContainer.prepend(newNode);
              } else {
                console.warn('Parent post has no .ldp-children container');
              }
            }
            ctx.nodeMap.set(postData.post_number, newNode);
            ctx.postMap.set(newPost.post_number, newPost);
            idToPost.set(newPost.id, newPost);
            ctx.tracker.observe(newNode);
            ctx.totalComments = (ctx.totalComments || 0) + 1;
            updateCommentsHeader(ctx);
            const tip = box.querySelector('.ldp-reply-tip');
            if (tip) { tip.classList.add('show'); setTimeout(() => tip.classList.remove('show'), 1500); }
            box.classList.remove('open');
            textarea.value = '';
          }
        } catch (err) {
          alert('回复失败：' + err.message);
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = '发送';
        }
        return;
      }
      });

    modal.addEventListener('keydown', (e) => {
      const spoiler = LDR.settings.get('spoilerProtection') && e.target.closest('.ldp-spoiler');
      if (!spoiler || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      spoiler.click();
    });

    // hover ♥ 展开表情选择面板；移出 ♥ / 面板后延迟关闭（留出移入面板的桥接时间）
    modal.addEventListener('mouseover', (e) => {
      const likeBtn = e.target.closest('.ldp-like');
      if (!likeBtn) return;
      if (reactionHoverBtn === likeBtn) return;
      const postNode = likeBtn.closest('.ldp-post');
      if (!postNode) return;
      reactionHoverBtn = likeBtn;
      cancelReactionClose();
      openReactionPanel(likeBtn, postNode, ctx);
    });
    modal.addEventListener('mouseout', (e) => {
      const likeBtn = e.target.closest('.ldp-like');
      if (!likeBtn) return;
      if (likeBtn.contains(e.relatedTarget)) return;
      if (reactionHoverBtn === likeBtn) reactionHoverBtn = null;
      if (openReactionTrigger === likeBtn) scheduleReactionClose();
    });
  }

  /* ============ 12. 收藏 ============ */
  function bindBookmark(btn, topic) {
    let bookmarked = !!topic.bookmarked, bookmarkId = topic.bookmark_id || null;
    const sync = () => { btn.classList.toggle('bookmarked', bookmarked); };
    sync();
    btn.addEventListener('click', async () => {
      if (!LDR.settings.get('showBookmark') || !btn.isConnected) return;
      btn.disabled = true;
      try {
        if (!bookmarked) {
          const data = await apiSend(`${BASE}/bookmarks`, 'POST', { bookmarkable_id: topic.id, bookmarkable_type: 'Topic' });
          bookmarkId = data && data.id ? data.id : bookmarkId; bookmarked = true;
        } else if (bookmarkId) {
          await apiSend(`${BASE}/bookmarks/${bookmarkId}`, 'DELETE'); bookmarked = false; bookmarkId = null;
        } else {
          await apiSend(`${BASE}/t/${topic.id}/remove_bookmarks`, 'PUT'); bookmarked = false;
        }
        sync();
      } catch (err) { alert('收藏操作失败：' + err.message); } finally { btn.disabled = false; }
    });
  }

  /** 乐观更新 core 点赞的 actions_summary 条目（footer 点赞后立即反映到图标/数字） */
  function patchCoreLike(p, acted) {
    if (!p) return;
    const list = Array.isArray(p.actions_summary) ? p.actions_summary : (p.actions_summary = []);
    let like = list.find((a) => a && a.id === 2);
    if (!like) { like = { id: 2, count: 0, acted: false }; list.push(like); }
    const previouslyActed = !!like.acted;
    like.acted = acted;
    if (previouslyActed !== acted) {
      like.count = Math.max(0, (Number(like.count) || 0) + (acted ? 1 : -1));
    }
  }

  function syncFooterLike(btn, countEl, opPost) {
    if (!opPost) { btn.disabled = true; return; }
    const { canAct } = likeInfo(opPost);
    const liked = likeActed(opPost);
    countEl.textContent = likeDisplayCount(opPost);
    btn.classList.toggle('liked', liked);
    btn.disabled = !!opPost._qrLikePending || !(canAct || liked);
    const iconEl = btn.querySelector('.ldp-like-icon');
    if (iconEl) iconEl.innerHTML = likeIconHtml(opPost);
  }

  function bindFooterLike(btn, countEl, opPost, ctx) {
    if (!opPost) { btn.disabled = true; return; }
    const currentPost = () => ctx.postMap?.get(1) || opPost;
    syncFooterLike(btn, countEl, currentPost());
    btn.addEventListener('click', async () => {
      const post = currentPost();
      if (!LDR.settings.get('showReactions') || ctx.signal?.aborted || btn.disabled || post._qrLikePending) return;
      // The automatic controller and this button share both live state and an in-flight lock.
      const liked = likeActed(post);
      if (!liked && !likeInfo(post).canAct) return;
      const cur = post.current_user_reaction;
      const postNode = ctx.nodeMap.get(1);
      if (cur && cur.id && postNode) {
        // toggleReaction owns the shared lock; do not acquire it twice here.
        await toggleReaction(postNode, ctx, cur.id, btn);
        return;
      }
      post._qrLikePending = true;
      syncFooterLike(btn, countEl, post);
      try {
        if (cur && cur.id) {
          const updated = await apiSend(`${BASE}/discourse-reactions/posts/${post.id}/custom-reactions/${encodeURIComponent(cur.id)}/toggle`, 'PUT', null, null, ctx.signal);
          ctx.assertActive?.();
          Object.assign(post, updated);
        } else if (!liked) {
          await apiSend(`${BASE}/post_actions`, 'POST', { id: post.id, post_action_type_id: 2, flag_topic: false }, null, ctx.signal);
          ctx.assertActive?.();
          patchCoreLike(post, true);
        } else {
          await apiSend(`${BASE}/post_actions/${post.id}?post_action_type_id=2`, 'DELETE', null, null, ctx.signal);
          ctx.assertActive?.();
          patchCoreLike(post, false);
        }
        const opNode = ctx.nodeMap.get(1);
        if (opNode) updatePostReactions(opNode, post);
      } catch (err) {
        if (err.name !== 'AbortError') alert('操作失败：' + err.message);
      } finally {
        delete post._qrLikePending;
        syncFooterLike(btn, countEl, currentPost());
      }
    });
  }

  function updateCommentsHeader(ctx) {
    if (ctx.countEl) ctx.countEl.textContent = ctx.totalComments ? `（${ctx.totalComments}）` : '';
    if (ctx.emptyEl) ctx.emptyEl.style.display = ctx.totalComments ? 'none' : '';
    if (ctx.footerReplyCountEl) ctx.footerReplyCountEl.textContent = ctx.totalComments || 0;
  }

  /* ============ 13. 定位：递归展开楼中楼并高亮目标 ============ */
  function waitForScrollEnd(el, timeoutMs = 1200) {
    const IDLE_MS = 120;
    return new Promise((resolve) => {
      let done = false;
      let idleTimer = null;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('scroll', onScroll);
        clearTimeout(idleTimer);
        clearTimeout(safety);
        resolve();
      };
      const onScroll = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, IDLE_MS);
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      idleTimer = setTimeout(finish, IDLE_MS);
      const safety = setTimeout(finish, timeoutMs);
    });
  }

  function resolveTargetPostNumber(targetPostNumber, posts) {
    const target = Number(targetPostNumber);
    if (!Number.isFinite(target) || target <= 1) return targetPostNumber;

    const availableNumbers = (posts || [])
        .map((post) => Number(post?.post_number))
        .filter((postNumber) => Number.isFinite(postNumber) && postNumber >= 1)
        .sort((a, b) => a - b);
    if (!availableNumbers.length || availableNumbers.includes(target)) return target;

    // Discourse 删除或隐藏回复后楼号可能不连续。优先定位到下一个
    // 实际可见的楼层；如果已经到末尾，则回退到最近的前一楼。
    return availableNumbers.find((postNumber) => postNumber > target)
        ?? availableNumbers[availableNumbers.length - 1];
  }

  async function fetchPostForLocate(topicId, postNumber, ctx) {
    const cached = ctx.postMap?.get(postNumber);
    if (cached) return cached;

    const data = await fetchJSON(`${BASE}/t/${topicId}.json?post_number=${postNumber}`);
    const posts = data.post_stream?.posts || [];
    posts.forEach((post) => {
      if (ctx.postMap) ctx.postMap.set(post.post_number, post);
      idToPost.set(post.id, post);
    });
    return posts.find((post) => post.post_number === postNumber) || null;
  }

  function ensurePostPlacement(post, ctx) {
    if (!post || post.post_number === 1) return ctx.nodeMap.get(1) || null;

    if (ctx.postMap) ctx.postMap.set(post.post_number, post);
    idToPost.set(post.id, post);

    let node = ctx.nodeMap.get(post.post_number);
    if (!node) {
      attachPost(post, ctx);
      reflowPending(ctx);
      node = ctx.nodeMap.get(post.post_number);
    }
    if (!node) return null;

    const parentNumber = +post.reply_to_post_number || 1;
    if (parentNumber > 1) {
      const parentNode = ctx.nodeMap.get(parentNumber);
      const childrenEl = parentNode?.querySelector(':scope > .ldp-children');
      if (childrenEl && node.parentElement !== childrenEl) childrenEl.appendChild(node);
    } else if (node.parentElement !== ctx.commentsEl) {
      ctx.commentsEl.appendChild(node);
    }
    return node;
  }

  async function expandTargetAncestorChain(targetPostNumber, ctx) {
    const targetPost = await fetchPostForLocate(ctx.topicId, targetPostNumber, ctx);
    if (!targetPost) throw new Error(`未找到目标楼层 #${targetPostNumber}`);

    const chain = [targetPost];
    const seen = new Set([targetPostNumber]);
    let current = targetPost;

    while (+current.reply_to_post_number > 1) {
      const parentNumber = +current.reply_to_post_number;
      if (seen.has(parentNumber)) throw new Error('楼中楼祖先链存在循环引用');
      seen.add(parentNumber);

      const parent = await fetchPostForLocate(ctx.topicId, parentNumber, ctx);
      if (!parent) throw new Error(`未找到父楼层 #${parentNumber}`);
      chain.unshift(parent);
      current = parent;
    }

    // 从最外层父回复向目标逐层展开，确保多层楼中楼的每一级 DOM 都已就位。
    for (let i = 0; i < chain.length; i++) {
      const post = ctx.postMap?.get(chain[i].post_number) || chain[i];
      ensurePostPlacement(post, ctx);

      const childOnPath = chain[i + 1];
      if (!childOnPath) continue;

      await loadAllChildren(post.id, post.post_number, null, ctx, true);
      const refreshedChild = ctx.postMap?.get(childOnPath.post_number) || childOnPath;
      ensurePostPlacement(refreshedChild, ctx);
      reflowPending(ctx);
    }

    return ctx.nodeMap.get(targetPostNumber) || null;
  }

  async function locatePost(targetPostNumber, ctx) {
    if (!targetPostNumber || targetPostNumber <= 1) return false;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    let targetNode = ctx.nodeMap.get(targetPostNumber);
    let locateError = null;
    try {
      targetNode = await expandTargetAncestorChain(targetPostNumber, ctx) || targetNode;
    } catch (error) {
      // 嵌套接口不可用时保留 1.3.0 原有的扁平定位作为降级路径。
      locateError = error;
      targetNode = ctx.nodeMap.get(targetPostNumber)
          || (targetNode?.isConnected ? targetNode : null);
    }

    if (!targetNode || targetNode.isConnected === false) {
      const reason = locateError?.message ? `：${locateError.message}` : '';
      console.warn(`[LinuxDo 增强阅读] 目标楼层 #${targetPostNumber} 不可见，无法定位${reason}`);
      return false;
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
    targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await waitForScrollEnd(ctx.scrollRoot);

    const flashObserver = new IntersectionObserver((entries, observer) => {
      const visibleEntry = entries.find((entry) =>
          entry.isIntersecting && entry.intersectionRatio >= 0.5
      );
      if (!visibleEntry) return;

      observer.disconnect();
      const node = visibleEntry.target;
      node.classList.remove('ldp-flash');
      void node.offsetWidth;
      node.classList.add('ldp-flash');
      setTimeout(() => node.classList.remove('ldp-flash'), 1700);
    }, { root: ctx.scrollRoot, threshold: [0.5] });
    flashObserver.observe(targetNode);
    setTimeout(() => flashObserver.disconnect(), 1500);
    return true;
  }

  function createFloorNavigator(nav, scrollRoot, topicId, onNavigate) {
    const thumb = nav.querySelector('.ldp-slider-thumb');
    const tip = nav.querySelector('.ldp-slider-tip');
    const track = nav.querySelector('.ldp-slider-track');
    const modal = nav.parentElement;
    let currentFloor = 1;
    let totalFloors = 1;
    let dragging = false;
    let scrollRaf = 0;
    let suppressClick = false;
    let resizeHandler = null;
    let mutationObserver = null;
    let mutationTimer = null;
    let geometryTimer = null;

    const updateGeometry = () => {
      const bodyRect = scrollRoot.getBoundingClientRect();
      const modalRect = modal.getBoundingClientRect();
      nav.style.top = `${bodyRect.top - modalRect.top}px`;
      nav.style.bottom = `${modalRect.bottom - bodyRect.bottom}px`;
    };

    const getRenderedFloors = () => Array.from(
      scrollRoot.querySelectorAll('.ldp-post[data-post-number]')
    ).map((node) => Number(node.dataset.postNumber))
      .filter((floor) => Number.isFinite(floor) && floor >= 1)
      .filter((floor, index, floors) => floors.indexOf(floor) === index)
      .sort((a, b) => a - b);

    const currentFloorAt = () => {
      if (scrollRoot.scrollTop <= 2) return 1;
      const rootRect = scrollRoot.getBoundingClientRect();
      const probeY = rootRect.top + Math.min(rootRect.height * 0.35, 260);
      const heads = Array.from(scrollRoot.querySelectorAll('.ldp-post-head'))
        .map((head) => ({
          top: head.getBoundingClientRect().top,
          floor: Number(head.closest('.ldp-post')?.dataset.postNumber),
        }))
        .filter((item) => Number.isFinite(item.floor))
        .sort((a, b) => a.top - b.top);
      if (!heads.length) return 1;
      let floor = heads[0].floor;
      heads.forEach((item) => { if (item.top <= probeY) floor = item.floor; });
      return floor;
    };

    const floorFromRatio = (ratio) => Math.max(
      1, Math.min(totalFloors, Math.round(1 + ratio * (totalFloors - 1)))
    );

    const paint = (floor, showTip = false) => {
      currentFloor = Math.max(1, Math.min(totalFloors, Number(floor) || 1));
      const ratio = totalFloors > 1 ? (currentFloor - 1) / (totalFloors - 1) : 0;
      const trackHeight = track.offsetHeight || nav.offsetHeight;
      const y = 8 + Math.max(0, Math.min(1, ratio)) * trackHeight;
      thumb.style.top = `${y}px`;
      thumb.textContent = String(currentFloor);
      tip.textContent = `#${currentFloor}`;
      tip.style.top = `${y}px`;
      if (showTip) tip.classList.add('show');
    };

    const updateThumbPosition = () => {
      scrollRaf = 0;
      if (dragging || nav.hidden || !LDR.settings.get('floorNavigator')) return;
      const renderedFloors = getRenderedFloors();
      if (!renderedFloors.length) return;
      paint(currentFloorAt());
    };

    const onScroll = () => {
      if (!scrollRaf) scrollRaf = requestAnimationFrame(updateThumbPosition);
    };

    const navigateToFloor = (floor) => {
      const targetFloor = floorFromRatio(Math.max(0, Math.min(1,
        (floor - 1) / Math.max(1, totalFloors - 1))));
      if (targetFloor === currentFloor) {
        paint(currentFloor);
        return;
      }
      // 复用现有目标楼层逻辑：窗口加载、楼号修正、祖先链展开和高亮均由 openModal 完成。
      if (!LDR.settings.get('floorNavigator')) return;
      Promise.resolve(onNavigate ? onNavigate(targetFloor) : openModal(topicId, targetFloor)).catch((error) => {
        if (error.name !== 'AbortError') LDR.log(`定位失败：${error.message}`, 'error');
      });
    };

    let lastTargetFloor = 1;
    const onPointerMove = (event) => {
      if (!dragging) return;
      event.preventDefault();
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      lastTargetFloor = floorFromRatio(ratio);
      const y = 8 + ratio * rect.height;
      thumb.style.top = `${y}px`;
      thumb.textContent = String(lastTargetFloor);
      tip.textContent = `#${lastTargetFloor}`;
      tip.style.top = `${y}px`;
      tip.classList.add('show');
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      thumb.style.cursor = 'grab';
      tip.classList.remove('show');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      navigateToFloor(lastTargetFloor);
    };

    thumb.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      lastTargetFloor = currentFloor;
      thumb.style.cursor = 'grabbing';
      tip.classList.add('show');
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });

    nav.addEventListener('click', (event) => {
      if (suppressClick) { suppressClick = false; return; }
      if (event.target === thumb) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      navigateToFloor(floorFromRatio(ratio));
    });

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    mutationObserver = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        updateGeometry();
        updateThumbPosition();
      }, 100);
    });
    mutationObserver.observe(scrollRoot, { childList: true, subtree: true });
    resizeHandler = updateGeometry;
    window.addEventListener('resize', resizeHandler);
    updateGeometry();
    geometryTimer = setTimeout(updateGeometry, 100);

    return {
      setTotal(total, initialFloor = 1) {
        totalFloors = Math.max(1, Number(total) || 1);
        nav.hidden = totalFloors <= 1;
        paint(initialFloor);
      },
      refresh: updateGeometry,
      destroy() {
        scrollRoot.removeEventListener('scroll', onScroll);
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        if (resizeHandler) window.removeEventListener('resize', resizeHandler);
        if (mutationObserver) mutationObserver.disconnect();
        clearTimeout(mutationTimer);
        clearTimeout(geometryTimer);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      },
    };
  }

  const SKELETON_HTML = `
    <div class="ldp-sk-head">
      <div class="ldp-sk ldp-sk-avatar"></div>
      <div class="ldp-sk ldp-sk-line ldp-sk-w40"></div>
    </div>
    <div class="ldp-sk-para">
      <div class="ldp-sk ldp-sk-line ldp-sk-w100"></div>
      <div class="ldp-sk ldp-sk-line ldp-sk-w90"></div>
      <div class="ldp-sk ldp-sk-line ldp-sk-w80"></div>
      <div class="ldp-sk ldp-sk-line ldp-sk-w60"></div>
    </div>
    <div class="ldp-sk-divider"></div>
    <div class="ldp-sk-comment">
      <div class="ldp-sk ldp-sk-avatar"></div>
      <div class="ldp-sk-cbody ldp-sk-para">
        <div class="ldp-sk ldp-sk-line ldp-sk-w30"></div>
        <div class="ldp-sk ldp-sk-line ldp-sk-w90"></div>
        <div class="ldp-sk ldp-sk-line ldp-sk-w60"></div>
      </div>
    </div>`;

  /* ============ 14. 弹窗主体 ============ */
  let CURRENT_OVERLAY = null;

  function getTopicCategoryName(categoryId) {
    if (!categoryId) return '';
    const badge = document.querySelector(
        `.badge-category[data-category-id="${categoryId}"] .badge-category__name`
    );
    return badge ? badge.textContent.trim() : '';
  }

  function renderTopicTaxonomy(overlay, topic) {
    const wrap = overlay.querySelector('.ldp-topic-tags');
    if (!wrap) return;
    const categoryName = getTopicCategoryName(topic?.category_id);
    const tags = Array.isArray(topic?.tags) ? topic.tags : [];
    const parts = [];
    if (categoryName) {
      parts.push(`<span class="ldp-topic-category">${esc(categoryName)}</span>`);
    }
    tags.forEach((tag) => {
      if (tag?.name) parts.push(`<span class="ldp-topic-tag">${esc(tag.name)}</span>`);
    });
    wrap.innerHTML = parts.join('');
    wrap.hidden = !parts.length;
  }

  const READER_FEATURE_SELECTORS = {
    showReactions: '.ldp-reactions, .ldp-like, .ldp-f-like, .ldp-reaction-panel',
    showReply: '.ldp-replybtn, .ldp-f-reply, .ldp-replybox',
    showBoost: '.ldp-boosts-list, .ldp-boost-input-wrap, .ldp-boost-btn, .ldp-f-boost',
    showBookmark: '.ldp-f-bookmark',
    showPolls: '.ldp-poll',
    floorNavigator: '.ldp-slider',
    stickyToolbar: '.ldp-footer',
  };
  const featureStyle = document.createElement('style');
  featureStyle.textContent = Object.entries(READER_FEATURE_SELECTORS).map(([key, selectors]) =>
    selectors.split(',').map((selector) => `.ldp-overlay.qr-off-${key} ${selector.trim()}`).join(',')
    + '{display:none!important;}'
  ).join('\n') + `
    .ldp-overlay.qr-flat .ldp-children { margin-left:0!important; border-left:0!important; padding-left:0!important; }
    .ldp-overlay.qr-flat .ldp-post.ldp-reply { margin-left:0!important; }
    .ldp-overlay.qr-off-stickyToolbar .ldp-topic > .ldp-post > .ldp-actions { display:flex; }
    .ldp-pagination-error { margin:12px; padding:12px; border:1px solid #d88; border-radius:8px; }
    .ldp-pagination-error button { cursor:pointer; margin-left:12px; }
  `;
  document.head.appendChild(featureStyle);

  function isControlPanelEvent(event) {
    return event.composedPath().some((node) => node?.hasAttribute?.('data-quiet-reader-ui'));
  }

  function applyReaderSettings(overlay, changedKey) {
    Object.keys(READER_FEATURE_SELECTORS).forEach((key) => overlay.classList.toggle(`qr-off-${key}`, !LDR.settings.get(key)));
    overlay.classList.toggle('qr-flat', overlay.dataset.stream === 'true' || !LDR.settings.get('nestedReplies'));
    if (!changedKey || changedKey === 'spoilerProtection') overlay.querySelectorAll('.ldp-spoiler').forEach((node) => {
      const enabled = LDR.settings.get('spoilerProtection');
      setSpoilerState(node, enabled);
      node.tabIndex = enabled ? 0 : -1;
      if (enabled) node.setAttribute('role', 'button'); else node.removeAttribute('role');
    });
    if (LDR.settings.get('mathRendering')) renderMath(overlay);
    else overlay.querySelectorAll('[data-qr-math-source]').forEach((node) => {
      node.textContent = node.dataset.qrMathSource;
      delete node.dataset.appliedKatex;
      node.classList.remove('math-container', 'block-math', 'inline-math', 'katex-math');
    });
    if (!LDR.settings.get('videoPlayer')) {
      overlay.querySelectorAll('video').forEach((video) => video.pause());
      overlay.querySelectorAll('.ldp-video-ready').forEach((node) => {
        if (typeof node._qrVideoMarkup === 'string') node.innerHTML = node._qrVideoMarkup;
        node.classList.remove('ldp-video-ready');
      });
    }
    if (!LDR.settings.get('imageLightbox')) document.querySelectorAll('.ldp-lightbox').forEach((node) => node.ldpClose?.());
    if (!LDR.settings.get('userCards')) closeUserCard();
    if (!LDR.settings.get('showReactions')) closeReactionPanel();
    if (!LDR.settings.get('showReply') || !LDR.settings.get('showBoost')) {
      overlay.querySelectorAll('.ldp-emoji-panel').forEach((node) => node.ldpClose?.());
    }
    if (!LDR.settings.get('showReply')) overlay.querySelectorAll('.ldp-replybox').forEach((node) => node.ldpCleanup?.());
  }

  function bindFeatureGates(overlay, signal) {
    const blocked = {
      showReactions: '.ldp-like, .ldp-f-like, .ldp-reaction, .ldp-reaction-opt, .ldp-reaction-panel',
      showReply: '.ldp-replybtn, .ldp-f-reply, .ldp-replybox',
      showBoost: '.ldp-boost-input-wrap, .ldp-boost-btn, .ldp-f-boost, .ldp-boost-del',
      showBookmark: '.ldp-f-bookmark', showPolls: '.ldp-poll', floorNavigator: '.ldp-slider',
    };
    const gate = (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!target) return;
      if (signal.aborted || Object.entries(blocked).some(([key, selector]) => !LDR.settings.get(key) && target.closest(selector))) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    ['click', 'keydown', 'pointerdown', 'mousedown', 'mouseover', 'paste', 'submit'].forEach((name) =>
      overlay.addEventListener(name, gate, { capture:true, signal }));
    overlay.addEventListener('play', (event) => {
      if (!LDR.settings.get('videoPlayer')) event.target.pause?.();
    }, { capture:true, signal });
  }

  let CURRENT_SESSION = null;
  let SESSION_COUNTER = 0;

  async function openModal(topicId, targetPostNumber = 0, options = {}) {
    topicId = Number(topicId);
    if (!Number.isSafeInteger(topicId) || topicId < 1) throw new Error('无效的话题编号');
    if (!LDR.settings.get('popupEnabled')) throw new Error('请先启用弹窗阅读');
    if (CURRENT_SESSION && !CURRENT_SESSION.closed) {
      const hasDraft = Array.from(CURRENT_SESSION.overlay.querySelectorAll('.ldp-replybox textarea, .ldp-boost-input'))
        .some((input) => input.value.trim() || input.classList.contains('uploading'));
      if (hasDraft) throw new Error('当前弹窗有未发送的内容，请先发送或清空后再打开其他话题');
      CURRENT_SESSION.close(options.automatic ? 'next' : 'replace');
    }
    const abortController = new AbortController();
    const signal = abortController.signal;
    const overlay = document.createElement('div');
    overlay.className = 'ldp-overlay';
    overlay.innerHTML = `
      <div class="ldp-modal">
        <div class="ldp-header">
          <div style="flex:1">
            <h2 class="ldp-title"><span class="ldp-sk ldp-sk-title"></span></h2>
            <div class="ldp-topic-tags" hidden></div>
            <div class="ldp-meta"><span class="ldp-sk ldp-sk-meta"></span></div>
          </div>
          <div class="ldp-head-btns">
            <button class="ldp-close" title="关闭">×</button>
          </div>
        </div>
        <div class="ldp-body">
          <div class="ldp-topic"></div>
          <div class="ldp-comments-header">评论<span class="ldp-comments-count"></span></div>
          <div class="ldp-load-up-tip"><span class="ldp-tip-icon">⌛</span>正在向上加载…</div>
          <div class="ldp-up-sentinel"></div>
          <div class="ldp-comments"><div class="ldp-comments-empty">暂无评论</div></div>
          <div class="ldp-loading-tip"><span class="ldp-tip-icon">⌛</span>正在加载评论…</div>
          <div class="ldp-down-sentinel"></div>
          <div class="ldp-load-down-tip"><span class="ldp-tip-icon">⌛</span>正在向下加载…</div>
          <div class="ldp-loadmask">${SKELETON_HTML}</div>
        </div>
        <div class="ldp-footer" hidden>
          <button class="ldp-fbtn ldp-f-like" disabled title="点赞">
            <span class="ldp-like-icon"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS.like}</svg></span>
            <span class="ldp-f-like-count">0</span>
          </button>
          <button class="ldp-fbtn ldp-f-reply" title="回复帖子">
            <svg viewBox="0 0 1024 1024" fill="currentColor">${ICONS.reply}</svg>
            <span class="ldp-f-reply-count">0</span>
          </button>
          <button class="ldp-fbtn ldp-f-boost" title="给楼主发送Boost">
            <svg viewBox="0 0 1024 1024" style="width:16px;height:16px;">${ICONS.boost}</svg>
          </button>
          <button class="ldp-fbtn ldp-f-bookmark" title="加入书签">
            <svg viewBox="0 0 24 24" fill="currentColor">${ICONS.bookmark}</svg>
          </button>
          <a class="ldp-fbtn ldp-f-open" href="#" target="_blank" rel="noopener" title="打开原贴">
            <svg viewBox="0 0 24 24" fill="currentColor">${ICONS.newTab}</svg>
          </a>
        </div>
        <div class="ldp-slider" hidden>
          <div class="ldp-slider-track"></div>
          <div class="ldp-slider-thumb" title="拖动跳转楼层">1</div>
          <div class="ldp-slider-tip">#1</div>
        </div>
      </div>`;

    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '话题阅读');
    document.body.appendChild(overlay);
    CURRENT_OVERLAY = overlay;
    const modal = overlay.querySelector('.ldp-modal');
    const body = overlay.querySelector('.ldp-body');
    const topicEl = overlay.querySelector('.ldp-topic');
    const commentsEl = overlay.querySelector('.ldp-comments');
    const countEl = overlay.querySelector('.ldp-comments-count');
    const emptyEl = overlay.querySelector('.ldp-comments-empty');
    const mask = overlay.querySelector('.ldp-loadmask');
    const downTip = overlay.querySelector('.ldp-load-down-tip');
    const upTip = overlay.querySelector('.ldp-load-up-tip');
    const tracker = createReadTracker(topicId, body);
    const postCache = new Map();
    let stream = [], downCursor = 0, upCursor = 0, rootsPage = 0;
    let mode = 'stream', moreRoots = false, loadingInitial = true, failed = false;
    let downPromise = null, upPromise = null, expandPromise = null, navigationPromise = null, totalPosts = 0;
    let topicData = null, floorNavigator = null;
    const observers = [];
    const ctx = {
      topicId, op:null, topicEl, commentsEl, countEl, emptyEl, scrollRoot:body,
      nodeMap:new Map(), postMap:new Map(), childLoads:new Map(), tracker,
      totalComments:0, footerReplyCountEl:overlay.querySelector('.ldp-f-reply-count'),
      validReactions:null, signal, streamMode:true,
      assertActive() { if (signal.aborted || CURRENT_SESSION !== session) throw new DOMException('阅读已关闭', 'AbortError'); },
    };
    const session = {
      id:`reader-${Date.now()}-${++SESSION_COUNTER}`, topicId, overlay, body, signal,
      automatic:!!options.automatic, closed:false, ready:false,
      getPosts() {
        return Array.from(body.querySelectorAll('.ldp-post[data-post-number]')).map((node) => ({
          number:Number(node.dataset.postNumber), id:Number(node.dataset.postId), node,
          content:node.querySelector(':scope > .ldp-content'), post:ctx.postMap.get(Number(node.dataset.postNumber)),
        })).filter((item) => item.post && item.content);
      },
      getState() {
        return { loading:!!(loadingInitial || downPromise || upPromise || expandPromise || navigationPromise || ctx.childLoads.size),
          hasMore:!session.closed && (mode === 'nested' ? moreRoots : downCursor < stream.length),
          failed, ready:session.ready, closed:session.closed, totalPosts };
      },
      loadMore, expandReplies,
      async likePost(postId) {
        ctx.assertActive();
        if (!LDR.settings.get('showReactions')) return false;
        const post = Array.from(ctx.postMap.values()).find((item) => Number(item.id) === Number(postId));
        if (!post || likeActed(post) || !likeInfo(post).canAct || post._qrLikePending) return false;
        post._qrLikePending = true;
        if (post.post_number === 1) syncFooterLike(overlay.querySelector('.ldp-f-like'), overlay.querySelector('.ldp-f-like-count'), post);
        try {
          await apiSend(`${BASE}/post_actions`, 'POST', { id:post.id, post_action_type_id:2, flag_topic:false }, null, signal);
          ctx.assertActive();
          patchCoreLike(post, true);
          const node = ctx.nodeMap.get(post.post_number);
          if (node) updatePostReactions(node, post);
          if (post.post_number === 1) syncFooterLike(overlay.querySelector('.ldp-f-like'), overlay.querySelector('.ldp-f-like-count'), post);
          return true;
        } finally {
          delete post._qrLikePending;
          if (post.post_number === 1) syncFooterLike(overlay.querySelector('.ldp-f-like'), overlay.querySelector('.ldp-f-like-count'), post);
        }
      },
      close(reason = 'user') {
        if (session.closed) return;
        // Sample visible dwell before removing content; final timings owns its own lifetime.
        tracker.stop();
        session.closed = true;
        session.ready = false;
        abortController.abort();
        observers.forEach((observer) => observer.disconnect());
        floorNavigator?.destroy();
        closeUserCard(); closeReactionPanel();
        overlay.querySelectorAll('.ldp-replybox').forEach((node) => node.ldpCleanup?.());
        overlay.querySelectorAll('.ldp-emoji-panel').forEach((node) => node.ldpClose?.());
        document.querySelectorAll('.ldp-lightbox').forEach((node) => node.ldpClose?.());
        overlay.querySelectorAll('video, audio').forEach((node) => node.pause());
        unsubscribe();
        overlay.remove();
        if (CURRENT_SESSION === session) CURRENT_SESSION = null;
        if (CURRENT_OVERLAY === overlay) CURRENT_OVERLAY = null;
        LDR.emit('reader:closed', { session, reason });
      },
    };
    CURRENT_SESSION = session;
    idToPost.clear();
    const unsubscribe = LDR.on('settings:changed', ({ key, value }) => {
      if (session.closed) return;
      if (key === 'popupEnabled' && !value) LDR.automation?.stop('已关闭弹窗阅读');
      if (Object.hasOwn(READER_FEATURE_SELECTORS, key) || ['nestedReplies','spoilerProtection','mathRendering','videoPlayer','imageLightbox','userCards'].includes(key)) {
        applyReaderSettings(overlay, key);
        floorNavigator?.refresh();
      }
    });
    bindFeatureGates(overlay, signal);
    applyReaderSettings(overlay);
    overlay.ldpClose = session.close;
    overlay.querySelector('.ldp-close').addEventListener('click', () => session.close('user'), { signal });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) session.close('user'); }, { signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !isControlPanelEvent(event)) session.close('user');
    }, { signal });
    floorNavigator = createFloorNavigator(overlay.querySelector('.ldp-slider'), body, topicId, navigateFloor);
    bindActions(modal, ctx);
    LDR.emit('reader:opened', { session });

    function remember(posts) {
      (posts || []).forEach((post) => {
        if (!post || !Number(post.id) || !Number(post.post_number)) return;
        postCache.set(Number(post.id), post);
      });
    }
    async function fetchPosts(ids) {
      ctx.assertActive();
      const missing = ids.filter((id) => !postCache.has(id));
      if (missing.length) {
        const query = missing.map((id) => `post_ids[]=${id}`).join('&');
        const data = await fetchJSON(`${BASE}/t/${topicId}/posts.json?${query}`, signal);
        ctx.assertActive();
        if (!Array.isArray(data.post_stream?.posts)) throw new Error('帖子分页数据格式异常');
        remember(data.post_stream.posts);
      }
      return ids.map((id) => postCache.get(id)).filter(Boolean);
    }
    function renderStream(posts) {
      ctx.assertActive();
      posts.slice().sort((a,b) => a.post_number - b.post_number).forEach((post) => {
        ctx.postMap.set(Number(post.post_number), post);
        idToPost.set(Number(post.id), post);
        if (ctx.nodeMap.has(Number(post.post_number))) return;
        const node = renderPost(post, false, ctx, 0);
        const container = post.post_number === 1 ? topicEl : commentsEl;
        const before = Array.from(container.children).find((item) => Number(item.dataset.postNumber) > post.post_number);
        container.insertBefore(node, before || null);
        ctx.nodeMap.set(Number(post.post_number), node);
        tracker.observe(node);
      });
      updateCommentsHeader(ctx);
    }
    function updateBottom() {
      let tip = body.querySelector('.ldp-bottom-tip');
      const hasMore = mode === 'nested' ? moreRoots : downCursor < stream.length;
      if (hasMore) { tip?.remove(); return; }
      if (!tip) { tip = document.createElement('div'); tip.className = 'ldp-bottom-tip'; body.appendChild(tip); }
      tip.textContent = mode === 'nested' ? '顶层评论已加载完毕；楼中楼可按需展开' : '已加载全部评论';
    }
    function showLoadError(error, retry) {
      if (error.name === 'AbortError' || session.closed) return;
      failed = true;
      LDR.log(`话题加载失败：${error.message}`, 'error');
      LDR.emit('reader:error', { session, error });
      let box = body.querySelector('.ldp-pagination-error');
      if (!box) { box = document.createElement('div'); box.className = 'ldp-pagination-error'; body.appendChild(box); }
      box.textContent = `加载失败：${error.message}`;
      const button = document.createElement('button'); button.textContent = '重试';
      button.addEventListener('click', () => { button.disabled = true; Promise.resolve(retry()).catch(() => {}).finally(() => { button.disabled = false; }); }, { signal });
      box.appendChild(button);
    }
    function clearLoadError() { failed = false; body.querySelector('.ldp-pagination-error')?.remove(); }

    function loadMore() {
      if (navigationPromise) return navigationPromise.then(loadMore);
      if (downPromise) return downPromise;
      if (session.closed) return Promise.reject(new DOMException('阅读已关闭', 'AbortError'));
      if (loadingInitial || !(mode === 'nested' ? moreRoots : downCursor < stream.length)) return Promise.resolve();
      downTip.classList.add('show');
      downPromise = (async () => {
        if (mode === 'nested') {
          const response = await fetchNestedTree(topicId, rootsPage + 1, signal);
          ctx.assertActive();
          if (!Array.isArray(response.roots)) throw new Error('评论分页数据格式异常');
          const newRoots = response.roots.filter((post) => !ctx.nodeMap.has(Number(post.post_number)));
          if (response.has_more_roots && !newRoots.length) throw new Error('评论分页没有继续推进，请稍后重试');
          indexTree(response.roots);
          renderNestedTree(response.roots, commentsEl, ctx, 0);
          rootsPage = Number.isFinite(Number(response.page)) ? Number(response.page) : rootsPage + 1;
          moreRoots = !!response.has_more_roots;
        } else {
          const end = Math.min(stream.length, downCursor + PAGE_SIZE);
          const posts = await fetchPosts(stream.slice(downCursor, end));
          ctx.assertActive(); renderStream(posts); downCursor = end;
        }
        clearLoadError(); updateBottom();
      })().catch((error) => { showLoadError(error, loadMore); throw error; })
        .finally(() => { downPromise = null; downTip.classList.remove('show'); });
      return downPromise;
    }
    function loadPrevious() {
      if (navigationPromise) return navigationPromise.then(loadPrevious);
      if (upPromise) return upPromise;
      if (session.closed || loadingInitial || mode !== 'stream' || upCursor <= 0) return Promise.resolve();
      upTip.classList.add('show');
      upPromise = (async () => {
        const start = Math.max(0, upCursor - PAGE_SIZE);
        const oldHeight = body.scrollHeight, oldTop = body.scrollTop;
        const posts = await fetchPosts(stream.slice(start, upCursor));
        ctx.assertActive(); renderStream(posts); upCursor = start;
        body.scrollTop = oldTop + body.scrollHeight - oldHeight;
        clearLoadError();
      })().catch((error) => { showLoadError(error, loadPrevious); throw error; })
        .finally(() => { upPromise = null; upTip.classList.remove('show'); });
      return upPromise;
    }
    function expandReplies() {
      if (navigationPromise) return navigationPromise.then(expandReplies);
      if (expandPromise) return expandPromise;
      if (session.closed) return Promise.reject(new DOMException('阅读已关闭', 'AbortError'));
      if (mode !== 'nested' || loadingInitial) return Promise.resolve();
      const branches = Array.from(ctx.nodeMap.values()).filter((node) => node.dataset.repliesLoaded !== '1' &&
        node.querySelector(':scope > .ldp-sub-actions')?.style.display === 'block');
      if (!branches.length) return Promise.resolve();
      const previousNodes = new Set(ctx.nodeMap.values());
      const previousAnchorStyle = body.style.overflowAnchor;
      body.style.overflowAnchor = 'none';
      expandPromise = (async () => {
        for (const node of branches) {
          ctx.assertActive();
          await loadAllChildren(Number(node.dataset.postId), Number(node.dataset.postNumber), null, ctx, true);
        }
        ctx.assertActive();
        const firstNew = session.getPosts().find((item) => !previousNodes.has(item.node));
        if (firstNew) {
          const rootTop = body.getBoundingClientRect().top;
          const contentTop = firstNew.content.getBoundingClientRect().top;
          // Newly expanded branches may precede the current viewport. Make automation pass their
          // actual content before it can conclude that this topic's bottom has been reached.
          if (contentTop < rootTop + 12) body.scrollTop += contentTop - rootTop - 12;
        }
        clearLoadError();
      })().catch((error) => { showLoadError(error, expandReplies); throw error; }).finally(() => {
        body.style.overflowAnchor = previousAnchorStyle;
        expandPromise = null;
      });
      return expandPromise;
    }
    function navigateFloor(floor) {
      const previousNavigation = navigationPromise;
      const pendingReads = [downPromise, upPromise, expandPromise, ...ctx.childLoads.values()].filter(Boolean);
      const work = (async () => {
        if (previousNavigation) await previousNavigation.catch(() => {});
        if (pendingReads.length) await Promise.allSettled(pendingReads);
        ctx.assertActive();
        let node = ctx.nodeMap.get(Number(floor));
        if (!node) {
          const anchor = await fetchJSON(`${BASE}/t/${topicId}.json?post_number=${Number(floor)}`, signal);
          ctx.assertActive();
          remember(anchor.post_stream?.posts);
          if (Array.isArray(anchor.post_stream?.stream)) stream = anchor.post_stream.stream.map(Number);
          // Move existing nodes rather than reconstructing them, preserving drafts and vote choices.
          mode = 'stream'; ctx.streamMode = true; overlay.dataset.stream = 'true';
          Array.from(ctx.nodeMap.entries()).sort((a,b) => a[0]-b[0]).forEach(([number, item]) => {
            (number === 1 ? topicEl : commentsEl).appendChild(item);
            item.querySelector(':scope > .ldp-sub-actions').style.display = 'none';
          });
          renderStream(anchor.post_stream?.posts || []);
          const indices = (anchor.post_stream?.posts || []).map((post) => stream.indexOf(Number(post.id))).filter((index) => index >= 0);
          if (indices.length) { upCursor = Math.min(...indices); downCursor = Math.max(...indices) + 1; }
          node = ctx.nodeMap.get(resolveTargetPostNumber(Number(floor), anchor.post_stream?.posts || []));
          applyReaderSettings(overlay); updateBottom();
        }
        if (node) {
          body.scrollTop += node.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
          node.classList.add('ldp-flash');
        }
      })();
      const tracked = work.finally(() => {
        if (navigationPromise === tracked) navigationPromise = null;
      });
      navigationPromise = tracked;
      return tracked;
    }

    try {
      const results = await Promise.all([
        fetchJSON(`${BASE}/t/${topicId}.json`, signal), ensureMe(signal),
      ]);
      ctx.assertActive();
      topicData = results[0];
      if (!Array.isArray(topicData.post_stream?.posts)) throw new Error('话题数据格式异常');
      remember(topicData.post_stream.posts);
      stream = Array.isArray(topicData.post_stream.stream) ? [...new Set(topicData.post_stream.stream.map(Number))] : topicData.post_stream.posts.map((post) => Number(post.id));
      totalPosts = Math.max(Number(topicData.posts_count) || 0, stream.length);
      let target = Number(targetPostNumber) || 1;
      const lastRead = Number(topicData.last_read_post_number) || 0;
      if (!targetPostNumber && LDR.settings.get('resumeReading') && lastRead > 0 && lastRead < Number(topicData.highest_post_number || totalPosts)) target = lastRead + 1;
      let nested = null, anchor = topicData;
      if (!session.automatic && LDR.settings.get('nestedReplies') && target <= 1) {
        try {
          const response = await fetchNestedTree(topicId, 0, signal);
          ctx.assertActive();
          if (response.op_post && Array.isArray(response.roots)) nested = response;
          else if (Array.isArray(response.post_stream?.posts)) remember(response.post_stream.posts);
        } catch (error) {
          if (signal.aborted) throw error;
          LDR.log('树形视图暂不可用，已使用标准楼层顺序', 'warn');
        }
      }
      if (target > 1) {
        anchor = await fetchJSON(`${BASE}/t/${topicId}.json?post_number=${target}`, signal);
        ctx.assertActive(); remember(anchor.post_stream?.posts);
        if (Array.isArray(anchor.post_stream?.stream)) stream = [...new Set(anchor.post_stream.stream.map(Number))];
      }
      let opPost = nested?.op_post || Array.from(postCache.values()).find((post) => post.post_number === 1);
      if (!opPost && stream.length) opPost = (await fetchPosts([stream[0]])).find((post) => post.post_number === 1);
      ctx.assertActive();
      if (!opPost) throw new Error('话题缺少首楼内容');
      ctx.op = opPost.username;
      ctx.totalComments = Math.max(0, totalPosts - 1);
      ctx.validReactions = Array.isArray(topicData.valid_reactions) ? topicData.valid_reactions : nested?.topic?.valid_reactions || null;
      overlay.querySelector('.ldp-title').textContent = topicData.title || nested?.topic?.title || `话题 #${topicId}`;
      overlay.querySelector('.ldp-meta').textContent = `${totalPosts} 帖 · 楼主 @${ctx.op || '?'}`;
      renderTopicTaxonomy(overlay, topicData);
      renderStream([opPost]);
      if (nested) {
        mode = 'nested'; ctx.streamMode = false; overlay.dataset.stream = 'false';
        moreRoots = !!nested.has_more_roots; rootsPage = Number(nested.page) || 0;
        renderNestedTree(nested.roots, commentsEl, ctx, 0);
      } else {
        mode = 'stream'; ctx.streamMode = true; overlay.dataset.stream = 'true';
        let start = 0;
        if (target > 1) {
          const requested = resolveTargetPostNumber(target, anchor.post_stream?.posts || []);
          const targetPost = (anchor.post_stream?.posts || []).find((post) => post.post_number === requested);
          const targetIndex = targetPost ? stream.indexOf(Number(targetPost.id)) : -1;
          if (targetIndex >= 0) start = targetIndex;
        }
        upCursor = start;
        downCursor = Math.min(stream.length, start + PAGE_SIZE);
        renderStream(await fetchPosts(stream.slice(start, downCursor)));
      }
      ctx.assertActive();
      updateCommentsHeader(ctx);
      const fLike = overlay.querySelector('.ldp-f-like');
      bindFooterLike(fLike, overlay.querySelector('.ldp-f-like-count'), opPost, ctx);
      bindBookmark(overlay.querySelector('.ldp-f-bookmark'), topicData);
      overlay.querySelector('.ldp-f-open').href = `${BASE}/t/${topicId}`;
      const boost = overlay.querySelector('.ldp-f-boost');
      boost.disabled = !opPost.can_boost;
      boost.addEventListener('click', () => {
        if (!LDR.settings.get('showBoost') || boost.disabled || signal.aborted) return;
        const wrap = ctx.nodeMap.get(1)?.querySelector(':scope > .ldp-boost-input-wrap');
        if (!wrap) return;
        wrap.classList.toggle('open');
        if (wrap.classList.contains('open')) { wrap.querySelector('input').focus(); wrap.scrollIntoView({ block:'center', behavior:'smooth' }); }
      }, { signal });
      overlay.querySelector('.ldp-f-reply').addEventListener('click', () => {
        if (!LDR.settings.get('showReply') || signal.aborted) return;
        const box = ensureReplyBox(ctx.nodeMap.get(1));
        box.classList.toggle('open');
        if (box.classList.contains('open')) { box.querySelector('textarea').focus(); box.scrollIntoView({ block:'center', behavior:'smooth' }); }
      }, { signal });
      overlay.querySelector('.ldp-footer').hidden = false;
      floorNavigator.setTotal(topicData.highest_post_number || totalPosts || 1, target);
      mask.remove(); applyReaderSettings(overlay); updateBottom();
      if (target > 1) {
        const targetNode = ctx.nodeMap.get(resolveTargetPostNumber(target, Array.from(ctx.postMap.values())));
        if (targetNode) body.scrollTop += targetNode.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
      }
      loadingInitial = false; session.ready = true;
      tracker.start(); floorNavigator.refresh();
      const checkEdges = () => {
        if (!session.ready || signal.aborted || failed) return;
        if (body.scrollHeight - body.scrollTop - body.clientHeight < 350) loadMore().catch(() => {});
        if (body.scrollTop < 200) loadPrevious().catch(() => {});
      };
      body.addEventListener('scroll', checkEdges, { passive:true, signal });
      const sentinel = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !failed && session.ready) loadMore().catch(() => {});
      }, { root:body, rootMargin:'200px' });
      sentinel.observe(overlay.querySelector('.ldp-down-sentinel')); observers.push(sentinel);
      LDR.emit('reader:ready', { session });
      return session;
    } catch (error) {
      loadingInitial = false;
      if (signal.aborted) throw new DOMException('阅读已关闭', 'AbortError');
      mask.remove();
      showLoadError(error, () => openModal(topicId, targetPostNumber, options));
      throw error;
    }
  }

  LDR.reader = {
    open:openModal,
    getCurrent:() => CURRENT_SESSION && !CURRENT_SESSION.closed ? CURRENT_SESSION : null,
    close(reason = 'user') { CURRENT_SESSION?.close(reason); },
    parseTopicHref,
    listTopics() {
      const found = new Map();
      document.querySelectorAll('a.title, a.raw-topic-link, a.search-link, a.search-result-topic').forEach((anchor) => {
        if (anchor.closest('.ldp-overlay, [data-quiet-reader-ui]')) return;
        const parsed = parseTopicHref(anchor.getAttribute('href'));
        if (!parsed || found.has(parsed.topicId)) return;
        const row = anchor.closest('[data-topic-id], tr, .topic-list-item, .fps-result');
        const visible = anchor.getClientRects().length > 0;
        if (!visible) return;
        found.set(parsed.topicId, { id:parsed.topicId, title:anchor.textContent.trim(), url:new URL(anchor.href, BASE).href,
          categoryId:Number(row?.dataset.categoryId) || null });
      });
      return Array.from(found.values());
    },
  };

  /* Title/notification/search interception returns to native navigation when disabled. */
  document.addEventListener('click', (event) => {
    if (!LDR.settings.get('popupEnabled') || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || isControlPanelEvent(event)) return;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const anchor = target?.closest('a.title, a.raw-topic-link, a.search-link, a.search-result-topic, a[href*="/t/"]');
    if (!anchor || anchor.closest('.ldp-overlay') || anchor.hasAttribute('download')) return;
    const parsed = parseTopicHref(anchor.getAttribute('href'));
    if (!parsed) return;
    const inMenu = !!anchor.closest(MENU_PANEL_SEL), inSearch = !!anchor.closest(SEARCH_SEL);
    if ((inMenu && !LDR.settings.get('interceptNotifications')) || (inSearch && !LDR.settings.get('interceptSearch'))) return;
    const isTitle = anchor.matches('a.title, a.raw-topic-link, a.search-link, a.search-result-topic');
    if (!isTitle && !inMenu && !inSearch) return;
    event.preventDefault(); event.stopPropagation();
    openModal(parsed.topicId, (inMenu || inSearch) ? parsed.targetPostNumber || 0 : 0).catch((error) => {
      if (error.name !== 'AbortError') LDR.log(error.message, 'error');
    });
  }, true);
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

  LDR.ui.init();
  LDR.automation.init();
})();
