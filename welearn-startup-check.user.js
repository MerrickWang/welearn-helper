// ==UserScript==
// @name         WE Learn 启动检测
// @namespace    local.welearn.startup-check
// @version      1.0.0
// @description  仅显示启动提示，用于检查 Tampermonkey 能否在 WE Learn 和课件页面执行脚本。
// @match        https://welearn.sflep.com/*
// @match        https://courseres.sflep.com/*
// @match        https://centercourseware.sflep.com/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_info
// ==/UserScript==

(function () {
  'use strict';
  if (document.getElementById('welearn-startup-check')) return;
  var box = document.createElement('div');
  box.id = 'welearn-startup-check';
  box.style.cssText = 'position:fixed!important;top:12px!important;left:12px!important;z-index:2147483647!important;background:#166534!important;color:#fff!important;padding:14px!important;border:2px solid #fff!important;border-radius:8px!important;font:15px/1.7 sans-serif!important;box-shadow:0 2px 12px #0005!important;max-width:80vw!important';
  box.appendChild(document.createTextNode('WE Learn 启动检测成功 · ' + location.hostname));
  box.appendChild(document.createElement('br'));
  box.appendChild(document.createTextNode('油猴已执行此检测脚本；本提示不代表答题脚本已正常运行。'));
  var close = document.createElement('button');
  close.type = 'button';
  close.textContent = '关闭提示';
  close.style.cssText = 'margin-left:12px!important;padding:3px 8px!important;color:#166534!important;background:#fff!important;border:1px solid #fff!important;cursor:pointer!important';
  close.addEventListener('click', function () { box.remove(); });
  box.appendChild(close);
  (document.body || document.documentElement).appendChild(box);
}());
