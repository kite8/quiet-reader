// ==UserScript==
// @name         LinuxDo 增强阅读
// @namespace    https://linux.do/
// @version      2.0.0
// @license      MIT
// @description  在 LINUX DO 列表页点击标题即可弹窗预览整帖，楼中楼展示、点赞、回复、收藏、原图灯箱一应俱全，并按真实阅读节奏上报已读进度——无需离开列表页，也无需反复返回。
// @author       Fashion
// @match        https://linux.do/*
// @icon         https://cdn3.ldstatic.com/optimized/4X/6/a/6/6a6affc7b1ce8140279e959d32671304db06d5ab_2_180x180.png
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

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
})();
