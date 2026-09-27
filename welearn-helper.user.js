// ==UserScript==
// @name         WE Learn HTML 答案填入助手
// @namespace    local.welearn.html-helper
// @version      0.3.2
// @description  支持外教社课件 iframe、ChooseBox 分类选项填空、自定义选择题及主观题参考答案。
// @match        https://welearn.sflep.com/*
// @match        https://courseres.sflep.com/*
// @match        https://centercourseware.sflep.com/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_info
// ==/UserScript==

(() => {
  'use strict';
  try {
    startHelper();
  } catch (error) {
    console.error('[WE Learn HTML 助手] 启动失败', error);
    const notice = document.createElement('div');
    notice.id = 'welearn-html-helper-startup-error';
    notice.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647;background:#991b1b;color:white;padding:14px;border:2px solid white;border-radius:8px;font:14px/1.6 sans-serif;max-width:80vw;white-space:pre-wrap';
    notice.textContent = `WE Learn 助手 v0.3.2 启动失败（${location.hostname}）\n${error?.name || 'Error'}: ${error?.message || String(error)}\n请复制此提示用于排查。`;
    (document.body || document.documentElement).appendChild(notice);
  }

  function startHelper() {
    if (document.getElementById('welearn-html-helper')) return;

    // 外教社 ADL 课件结构已按“新时代研究生学术英语：综合教程2”核对。
    const COURSE_QUESTIONS = '[data-controltype="filling"], [data-controltype="fillinglong"], [data-controltype="choice"], [data-controltype="multichoice"], [data-controltype="tf"]';
    const COURSE_CHOICES = '[data-controltype="choice"], [data-controltype="multichoice"], [data-controltype="tf"]';
    const CONFIG = {
      question: `${COURSE_QUESTIONS}, [data-question-id], [data-qid], .question, .question-item, .quiz-question, .exercise-item`,
      answerAttributes: ['data-correct-answer', 'data-right-answer', 'data-answer', 'answer'],
      answerNodes: '.correct-answer, .right-answer, [data-role="answer"]',
      jsonScripts: 'script[type="application/json"]',
      jsonIdKeys: ['questionId', 'question_id', 'qid', 'id'],
      jsonAnswerKeys: ['correctAnswer', 'correct_answer', 'rightAnswer', 'answer'],
      fields: 'input:not([type]), input[type="text"], textarea, [contenteditable="true"], [contenteditable="plaintext-only"], input[type="radio"], input[type="checkbox"], select',
      debounceMs: 700,
    };

    const panel = document.createElement('div');
    panel.id = 'welearn-html-helper';
    panel.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:calc(100vw - 36px)';
    const ui = panel.attachShadow({ mode: 'open' });
    ui.innerHTML = `
      <style>
        :host{all:initial;font:14px/1.5 system-ui,sans-serif;color:#16233a}
        details{width:350px;max-width:calc(100vw - 36px);background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 10px 35px #0002;overflow:hidden}
        summary{cursor:pointer;padding:12px 16px;background:#163b63;color:white;font-weight:700}
        .body{padding:12px 14px}p{margin:0 0 10px;font-size:12px;color:#475569}
        .actions{display:flex;gap:8px;margin-bottom:10px}button{font:inherit;border:0;border-radius:6px;padding:7px 10px;cursor:pointer;background:#e2e8f0;color:#16233a}
        #fill{background:#176c55;color:white}label{display:block;margin:7px 0;font-size:13px}
        input{vertical-align:middle}#status{white-space:pre-wrap;margin:10px 0;font-size:12px}
        ol{padding-left:22px;margin:0;max-height:240px;overflow:auto;font-size:12px}
        li{padding:5px 0;overflow-wrap:anywhere}.ok{color:#176c55}.skip{color:#925719}
      </style>
      <details open><summary>WE Learn · HTML 答案助手 v0.3.2</summary><div class="body">
        <p>支持课件 iframe、分类/选项填空、自定义选择题和已有主观题参考答案。</p>
        <div class="actions"><button id="scan" type="button">读取 / 预览</button><button id="fill" type="button">填入答案</button></div>
        <label><input id="auto" type="checkbox"> 自动填入当前页面及新加载的题目</label>
        <label><input id="overwrite" type="checkbox"> 覆盖已有作答</label>
        <div id="status" role="status" aria-live="polite">点击“读取 / 预览”检查题目匹配。</div>
        <ol id="results"></ol>
      </div></details>`;
    (document.body || document.documentElement).append(panel);
    const $ = id => ui.getElementById(id);
    let timer;
    let busy = false;
    const attempted = new WeakMap();

    function normalized(value) {
      return String(value).replace(/\s+/g, ' ').trim();
    }

    function courseProse(value) {
      // HTML 属性内的单次换行通常来自源码排版；空白行作为段落边界保留。
      return String(value).replace(/\r\n?/g, '\n').trim()
        .split(/\n[\t \u00a0]*\n(?:[\t \u00a0]*\n)*/)
        .map(normalized).filter(Boolean).join('\n\n');
    }

    function decode(raw) {
      if (typeof raw !== 'string') return raw;
      const value = raw.trim();
      if (/^[\[\{"]/.test(value)) {
        try { return JSON.parse(value); } catch { /* 普通文本保持原样。 */ }
      }
      return value;
    }

    function fields(root) {
      if (root.matches(COURSE_CHOICES)) {
        return [...root.querySelectorAll('[data-itemtype="options"] > *')].filter(el => el.closest(COURSE_CHOICES) === root);
      }
      const items = root.matches(CONFIG.fields) ? [root] : [...root.querySelectorAll(CONFIG.fields)];
      return items.filter(el => !el.closest(CONFIG.answerNodes) &&
        (el === root || el.closest(CONFIG.question) === root) &&
        !el.parentElement?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]'));
    }

    function visible(el) {
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      if (!el.isConnected || !el.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') return false;
      // 课件横向切页时，上一页可能还留在 DOM 中；只处理当前页。
      const page = el.closest('[data-controltype="page"]');
      if (page) {
        const rect = page.getBoundingClientRect();
        if (rect.right <= 0 || rect.left >= el.ownerDocument.defaultView.innerWidth) return false;
      }
      return true;
    }

    function writable(el) {
      const context = chooseContext(el);
      // ChooseBox 的只读/隐藏 input 是数据载体，通过可点击的 myresult 操作。
      return controlVisible(el) && !el.matches(':disabled') && (!el.readOnly || !!context) && el.getAttribute('aria-disabled') !== 'true' &&
        (!context || !context.root.hasAttribute('data-submitted') || context.root.hasAttribute('data-submittednotlock'));
    }

    function chooseContext(el) {
      if (!el.matches('input[data-itemtype="input"], textarea[data-itemtype="textarea"]')) return null;
      const root = el.closest('[data-controltype="filling"], [data-controltype="fillinglong"]');
      const group = root?.closest('.ChooseBox');
      const opener = root?.querySelector('[data-itemtype="myresult"]');
      return group && opener && el.hasAttribute('data-index') ? { root, group, opener } : null;
    }

    function controlVisible(el) {
      return visible(chooseContext(el)?.opener || el);
    }

    function chooseText(option) {
      const separator = option.parentElement.getAttribute('data-snchar');
      let text = option.textContent;
      if (separator !== null) text = text.split(separator).slice(1).join(separator);
      return normalized(text);
    }

    function sameChoiceText(a, b) {
      return normalized(a).toLowerCase() === normalized(b).toLowerCase();
    }

    function choosePlan(root, controls, answer, overwrite) {
      if (controls.length !== 1 || Array.isArray(answer) && answer.length !== 1) throw new Error('选项填空的输入框和答案数量不符');
      const input = controls[0];
      const context = chooseContext(input);
      const desired = Array.isArray(answer) ? answer[0] : answer;
      if (!['string', 'number'].includes(typeof desired)) throw new Error('选项填空答案格式不支持');
      if (!overwrite && normalized(input.value)) throw new Error('已有作答，未开启覆盖');
      const sheetId = context.group.closest('[data-choosebox]')?.getAttribute('data-choosebox');
      const sheets = [...root.ownerDocument.querySelectorAll('.AnswerSheet')].filter(sheet => !sheetId || sheet.id === sheetId);
      if (sheets.length !== 1) throw new Error('无法唯一对应此空格的选项卡');
      const sheet = sheets[0];
      const options = [...sheet.querySelectorAll('.ChooseSheet_cell li')].filter(option => sameChoiceText(chooseText(option), desired));
      if (options.length !== 1) throw new Error(`选项“${desired}”无法唯一对应`);
      const option = options[0];
      if (!sheet.hasAttribute('data-multi') && !overwrite) {
        const occupied = [...context.group.querySelectorAll('[data-itemtype="input"], [data-itemtype="textarea"]')].some(other => other !== input && normalized(other.value) && sameChoiceText(other.value, chooseText(option)));
        if (occupied) throw new Error('所需选项已被其他空格使用，未开启覆盖');
      }
      return { root, controls, type: '选项/分类填空', choose: { ...context, sheet, option }, actions: [{ el: input, property: 'chooseBox', value: String(desired) }] };
    }

    function actionMatches({ el, property, value }) {
      if (!el.isConnected) return false;
      if (property === 'courseChoice') return el.hasAttribute('data-choiced') === value;
      if (property === 'chooseBox') return sameChoiceText(el.value, value) && sameChoiceText(chooseContext(el)?.opener.textContent || '', el.value);
      return el[property] === value;
    }

    function identifier(root) {
      return root.getAttribute('data-id') || root.getAttribute('data-question-id') || root.getAttribute('data-qid') || root.id || root.getAttribute('name') || '';
    }

    function jsonIndex() {
      const index = new Map();
      let invalid = 0;
      let remaining = 20000;
      function walk(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 30 || --remaining < 0) return;
        if (!Array.isArray(value)) {
          const idKey = CONFIG.jsonIdKeys.find(key => Object.hasOwn(value, key));
          if (idKey && ['string', 'number'].includes(typeof value[idKey])) {
            for (const key of CONFIG.jsonAnswerKeys) {
              if (!Object.hasOwn(value, key)) continue;
              const id = String(value[idKey]);
              if (!index.has(id)) index.set(id, []);
              index.get(id).push({ value: decode(value[key]), source: `JSON.${key}` });
            }
          }
        }
        for (const child of Object.values(value)) walk(child, depth + 1);
      }
      for (const script of document.querySelectorAll(CONFIG.jsonScripts)) {
        try { walk(JSON.parse(script.textContent)); } catch { invalid++; }
      }
      return { index, invalid };
    }

    function localAnswers(el) {
      const found = [];
      for (const attr of CONFIG.answerAttributes) {
        if (el.hasAttribute(attr)) found.push({ value: decode(el.getAttribute(attr)), source: attr });
      }
      return found;
    }

    function uniqueAnswer(candidates) {
      const usable = candidates.filter(item => item.value !== null && item.value !== undefined && item.value !== '');
      const distinct = new Map(usable.map(item => [JSON.stringify(item.value), item]));
      if (distinct.size > 1) throw new Error('多个答案来源内容不同，需确认读取规则');
      return distinct.size ? [...distinct.values()][0] : null;
    }

    function readAnswer(root, controls, index) {
      if (root.matches(COURSE_CHOICES)) {
        const correct = controls.filter(el => el.hasAttribute('data-solution'));
        return correct.length ? { value: correct.map(el => controls.indexOf(el)), source: '课件选项 data-solution' } : null;
      }
      if (root.matches('[data-controltype="filling"], [data-controltype="fillinglong"]')) {
        const values = controls.map(el => {
          const raw = el.getAttribute('data-solution')?.trim();
          if (!raw) return null;
          // 仅遵循课件明确给出的可接受答案分隔符，普通文本中的斜杠不拆分。
          const sep = root.getAttribute('isblur') || root.closest('[data-blur]')?.getAttribute('data-blur');
          const answer = (sep ? raw.split(sep === 'true' ? '.' : sep)[0] : raw).trim();
          return root.matches('[data-controltype="fillinglong"]') ? courseProse(answer) : answer;
        });
        if (values.length && values.every(value => value !== null && value !== '')) {
          return { value: values.length === 1 ? values[0] : values, source: '课件输入框 data-solution' };
        }
        if (controls.length === 1 && root.matches('[data-controltype="fillinglong"]')) {
          const result = [...root.querySelectorAll('[data-itemtype="result"]')].find(el => el.closest(COURSE_QUESTIONS) === root);
          const reference = normalized(result?.textContent || '').replace(/^\(?Answers? may vary\.?\)?\s*/i, '').trim();
          if (reference) return { value: reference, source: '课件 result 参考答案' };
        }
        return null;
      }
      const candidates = [...localAnswers(root)];
      for (const node of root.querySelectorAll(CONFIG.answerNodes)) {
        if (node.closest(CONFIG.question) !== root) continue;
        const attrs = localAnswers(node);
        candidates.push(...(attrs.length ? attrs : [{ value: decode(node.value ?? node.textContent), source: '答案节点' }]));
      }
      candidates.push(...(index.get(identifier(root)) || []));
      const textFields = controls.filter(el => !['radio', 'checkbox'].includes(el.type) && el.tagName !== 'SELECT');
      if (textFields.length === controls.length && textFields.length) {
        const perField = textFields.map(el => uniqueAnswer(localAnswers(el)));
        if (perField.every(Boolean)) candidates.push({ value: perField.length === 1 ? perField[0].value : perField.map(a => a.value), source: '每个空的答案属性' });
      }
      return uniqueAnswer(candidates);
    }

    function textValue(el) { return el.isContentEditable ? el.textContent : el.value; }

    function optionAliases(el) {
      const result = new Set();
      for (const attr of ['data-option-label', 'data-label', 'data-key']) {
        if (el.hasAttribute(attr)) result.add(normalized(el.getAttribute(attr)));
      }
      if (el.hasAttribute('value') && el.value !== '') result.add(normalized(el.value));
      const labels = el.tagName === 'OPTION' ? [el.textContent] : [...(el.labels || [])].map(label => label.textContent);
      for (const label of labels) {
        const clean = normalized(label);
        result.add(clean);
        const match = clean.match(/^([A-Z])(?:[.、:：)）]|\s)\s*/);
        if (match) {
          result.add(match[1]);
          result.add(clean.slice(match[0].length));
        }
      }
      return result;
    }

    function chooseOptions(options, answer, multiple) {
      function matches(value) {
        if (!['string', 'number'].includes(typeof value)) throw new Error('选项答案必须是文字或数字');
        const token = normalized(value);
        return options.filter(el => optionAliases(el).has(token));
      }
      let tokens = Array.isArray(answer) ? answer : [answer];
      if (multiple && typeof answer === 'string' && matches(answer).length === 0) {
        tokens = answer.split(/[,，;；|\s]+/).filter(Boolean);
      }
      if (!tokens.length || (!multiple && tokens.length !== 1)) throw new Error('答案数量与选择题类型不符');
      return new Set(tokens.map(token => {
        const matched = matches(token);
        if (matched.length !== 1) throw new Error(`选项“${String(token)}”无法唯一对应，需适配选项标签`);
        return matched[0];
      }));
    }

    function makePlan(root, controls, answer) {
      if (!controls.length) throw new Error('没有可识别的输入控件');
      if (!controls.every(writable)) throw new Error('有控件不可见、只读或已禁用');
      const radios = controls.filter(el => el.type === 'radio');
      const checks = controls.filter(el => el.type === 'checkbox');
      const selects = controls.filter(el => el.tagName === 'SELECT');
      const overwrite = $('overwrite').checked;
      if (root.matches(COURSE_QUESTIONS) && root.hasAttribute('data-submitted') && !root.hasAttribute('data-submittednotlock')) throw new Error('该题已提交并锁定');
      if (controls.some(el => chooseContext(el))) return choosePlan(root, controls, answer, overwrite);
      if (root.matches(COURSE_CHOICES)) {
        const multiple = root.getAttribute('data-controltype') === 'multichoice';
        if (!Array.isArray(answer) || !answer.length || (!multiple && answer.length !== 1)) throw new Error('正确选项标记数量与题型不符');
        if (!overwrite && controls.some(el => el.hasAttribute('data-choiced'))) throw new Error('已有选择，未开启覆盖');
        const max = Number(root.getAttribute('data-maxcount'));
        if (max > 0 && answer.length > max) throw new Error('正确选项数超过课件允许的选择数');
        return { root, controls, type: multiple ? '课件多选' : '课件单选', actions: controls.map((el, i) => ({ el, property: 'courseChoice', value: answer.includes(i) })) };
      }
      let actions;
      let type;
      if (radios.length || checks.length) {
        const options = radios.length ? radios : checks;
        if (options.length !== controls.length) throw new Error('混合题型或多个控件组，需要更精确的题目选择器');
        if (radios.length && new Set(radios.map(el => el.name)).size !== 1) throw new Error('题目容器包含多组单选题');
        if (radios.length && !radios[0].name) throw new Error('单选控件缺少分组名称，需要课程专用适配');
        if (radios.length) {
          const group = [...document.querySelectorAll('input[type="radio"]')].filter(el => el.name === radios[0].name && el.form === radios[0].form);
          if (group.some(el => !options.includes(el))) throw new Error('单选分组跨题目容器，已跳过');
        }
        const selected = chooseOptions(options, answer, !!checks.length);
        if (!overwrite && options.some(el => el.checked)) throw new Error('已有选择，未开启覆盖');
        actions = options.map(el => ({ el, property: 'checked', value: selected.has(el) }));
        type = checks.length ? '多选' : '单选';
      } else if (selects.length) {
        if (controls.length !== 1) throw new Error('多个下拉框需要课程专用映射');
        const el = selects[0];
        if (!overwrite && [...el.selectedOptions].some(opt => opt.value !== '')) throw new Error('下拉框已有选择，未开启覆盖');
        const selected = chooseOptions([...el.options].filter(opt => !opt.disabled && !opt.parentElement.disabled), answer, el.multiple);
        actions = [...el.options].map(opt => ({ el: opt, property: 'selected', value: selected.has(opt) }));
        type = '下拉选择';
      } else {
        const values = Array.isArray(answer) ? answer : [answer];
        if (values.length !== controls.length) throw new Error(`答案有 ${values.length} 项，输入框有 ${controls.length} 个`);
        if (!values.every(value => ['string', 'number'].includes(typeof value))) throw new Error('答案结构需要适配，暂不自动转换对象或嵌套数组');
        if (!overwrite && controls.some(el => normalized(textValue(el)))) throw new Error('已有作答，未开启覆盖');
        actions = controls.map((el, i) => ({ el, property: el.isContentEditable ? 'textContent' : 'value', value: String(values[i]) }));
        type = controls.some(el => el.tagName === 'TEXTAREA' || el.isContentEditable) ? '主观题' : '填空';
      }
      return { root, controls, actions, type };
    }

    function scan() {
      const { index, invalid } = jsonIndex();
      const roots = [...document.querySelectorAll(CONFIG.question)];
      // 兼容答案直接附在输入框上、没有题目容器的页面。
      for (const field of document.querySelectorAll(CONFIG.fields)) {
        if (!field.closest(CONFIG.question) && localAnswers(field).length) roots.push(field);
      }
      const rows = [];
      for (const root of new Set(roots)) {
        const controls = fields(root);
        if (!controls.length || !controls.some(controlVisible)) continue;
        const row = { label: identifier(root) || `题目 ${rows.length + 1}` };
        try {
          const answer = readAnswer(root, controls, index);
          if (!answer) throw new Error('未找到已有答案，需要实际 HTML 适配');
          row.answer = answer.value;
          row.preview = root.matches(COURSE_CHOICES) ? answer.value.map(i => `第 ${i + 1} 项：${normalized(controls[i].textContent)}`) : answer.value;
          row.source = answer.source;
          row.plan = makePlan(root, controls, answer.value);
          row.message = `${row.plan.type} · ${JSON.stringify(row.preview)} · ${answer.source}`;
        } catch (error) { row.message = error.message; }
        rows.push(row);
      }
      // 同一选项池不允许重复使用的题，避免后一个空的点击清掉前一个空。
      const assignments = new Map();
      for (const row of rows) {
        const choice = row.plan?.choose;
        if (!choice || choice.sheet.hasAttribute('data-multi')) continue;
        if (!assignments.has(choice.group)) assignments.set(choice.group, new Map());
        const group = assignments.get(choice.group);
        const key = chooseText(choice.option).toLowerCase();
        if (!group.has(key)) group.set(key, []);
        group.get(key).push(row);
      }
      for (const group of assignments.values()) for (const duplicates of group.values()) {
        if (duplicates.length < 2) continue;
        for (const row of duplicates) { row.plan = null; row.message = '多个空格需要同一选项，但课件禁止重复使用，已跳过'; }
      }
      return { rows, invalid };
    }

    function setNative(el, property, value) {
      if (property === 'textContent') { el.textContent = value; return; }
      const proto = el.ownerDocument.defaultView[el.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, property)?.set;
      if (!setter) throw new Error(`不支持写入 ${el.tagName}.${property}`);
      setter.call(el, value);
    }

    function emitChange(el) {
      const EventClass = el.ownerDocument.defaultView.Event;
      el.dispatchEvent(new EventClass('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new EventClass('change', { bubbles: true, composed: true }));
    }

    function apply(plan) {
      if (!plan.controls.every(writable)) throw new Error('页面已变化，请重新读取');
      if (plan.choose) {
        const { opener, sheet, option, root, group } = plan.choose;
        const input = plan.controls[0];
        // 填写前重新检查占用，避免前一题的点击让“保留已有作答”失效。
        if (!$('overwrite').checked && !sheet.hasAttribute('data-multi') && [...group.querySelectorAll('[data-itemtype="input"], [data-itemtype="textarea"]')].some(other => other !== input && normalized(other.value) && sameChoiceText(other.value, chooseText(option)))) throw new Error('选项已被其他空格占用');
        if (!plan.actions.every(actionMatches)) {
          opener.click();
          if (!root.classList.contains('myresult_cur') || normalized(sheet.querySelector('.currentIndex')?.textContent || '') !== input.getAttribute('data-index')) throw new Error('课件未激活该空格，请稍后重试');
          // 课件 slideDown 的动画队列可能尚未展开父选项卡；currentIndex 和
          // myresult_cur 已确认目标空格。只排除选项自身被过滤/禁用的情况。
          const optionStyle = option.ownerDocument.defaultView.getComputedStyle(option);
          if (optionStyle.display === 'none' || option.hasAttribute('hidden') || option.getAttribute('aria-disabled') === 'true') throw new Error('正确选项当前被过滤或禁用');
          option.click();
        }
      } else if (plan.type === '课件单选' || plan.type === '课件多选') {
        // 使用课件自己的点击处理器更新 data-choiced 和本地作答缓存。
        // 先取消多选中的错误项，避免触发 data-maxcount 上限。
        const actions = plan.type === '课件单选' ? plan.actions.filter(a => a.value) : [...plan.actions].sort((a, b) => Number(a.value) - Number(b.value));
        for (const action of actions) {
          if (!writable(action.el)) throw new Error('选项在填写过程中变化');
          if (action.el.hasAttribute('data-choiced') !== action.value) action.el.click();
        }
      } else if (plan.type === '下拉选择') {
        for (const action of plan.actions) action.el.selected = action.value;
        emitChange(plan.controls[0]);
      } else if (plan.type === '单选' || plan.type === '多选') {
        // 原生 click 会触发框架通常监听的 click/input/change，并遵循单选分组规则。
        // 单选只点击正确项，避免“取消选中旧项”造成额外切换。
        for (const action of plan.actions) {
          if (plan.type === '单选' && !action.value) continue;
          if (action.el.checked !== action.value) action.el.click();
        }
      } else {
        for (const { el, property, value } of plan.actions) {
          if (!writable(el)) throw new Error('填写过程中题目已重新渲染，请重新读取');
          setNative(el, property, value);
          emitChange(el);
        }
      }
      if (!plan.actions.every(actionMatches)) {
        throw new Error('页面未保留写入结果，需要课程专用事件适配');
      }
    }

    function render(rows, status) {
      $('results').replaceChildren();
      for (const row of rows) {
        const li = document.createElement('li');
        li.className = row.ready ? 'ok' : 'skip';
        li.textContent = `${row.label}：${row.message}`;
        $('results').append(li);
      }
      $('status').textContent = status;
    }

    // 跨域课件不能由外层 document.querySelectorAll 访问。每个匹配域名的
    // iframe 各自运行脚本，再通过验证来源的 postMessage 汇总到外层面板。
    const CHANNEL = 'welearn-html-helper-v2';
    const allowedHosts = new Set(['welearn.sflep.com', 'courseres.sflep.com', 'centercourseware.sflep.com']);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const childStates = new Map();
    const watchedFrames = new WeakSet();
    let parentRequest = null;
    let localReport = { rows: [], filled: 0, invalid: 0, fill: false };
    let reportTimer;
    let requestCounter = 0;

    function trustedOrigin(origin) {
      try {
        const url = new URL(origin);
        return url.protocol === 'https:' && allowedHosts.has(url.hostname) ||
          ['http:', 'https:'].includes(url.protocol) && localHosts.has(location.hostname) && localHosts.has(url.hostname);
      } catch { return false; }
    }

    function frameOrigin(frame) {
      try {
        const url = new URL(frame.getAttribute('src') || location.href, location.href);
        return url.protocol === 'about:' ? location.origin : url.origin;
      } catch { return ''; }
    }

    function publish() {
      const rows = [...localReport.rows];
      let filled = localReport.filled;
      let pending = 0;
      const warnings = [];
      for (const [frame, state] of childStates) {
        if (!frame.isConnected || !visible(frame)) {
          if (frame.isConnected && frame.contentWindow) frame.contentWindow.postMessage({ channel: CHANNEL, type: 'command', requestId: `${Date.now()}-stop-${++requestCounter}`, fill: false, automatic: true, auto: false, overwrite: false }, state.origin);
          childStates.delete(frame);
          continue;
        }
        if (!state.report) {
          if (Date.now() - state.started < 4000) pending++;
          else warnings.push(`课件 ${state.origin} 未响应：请确认油猴已启用 v0.3.2，并刷新整个学习页。`);
          continue;
        }
        rows.push(...state.report.rows.map(row => ({ ...row, label: `课件 / ${row.label}` })));
        filled += state.report.filled || 0;
        pending += state.report.pending || 0;
        warnings.push(...(state.report.warnings || []));
      }
      let status = rows.length ? `识别 ${rows.length} 题，可填入 ${rows.filter(r => r.ready).length} 题。` : '当前文档未识别到题目。';
      if (localReport.fill) status = `检查 ${rows.length} 题，已填入 ${filled} 题。`;
      if (pending) status += ` 正在连接 ${pending} 个课件框架…`;
      if (!rows.length && !pending && !warnings.length) {
        const unknownFrames = [...document.querySelectorAll('iframe')].filter(visible);
        status += unknownFrames.length ? '请进入题目页；若仍无结果，请提供课件 iframe 的 src 及题目 HTML。' : '请打开一道题后重试。';
      }
      if (localReport.invalid) status += ` ${localReport.invalid} 个 JSON 节点解析失败。`;
      if (warnings.length) status += '\n' + warnings.join('\n');
      render(rows, status);
      if (parentRequest) window.parent.postMessage({ channel: CHANNEL, type: 'result', requestId: parentRequest.id, report: { rows, filled, pending, warnings } }, parentRequest.origin);
    }

    function commandFrame(frame, fill, automatic) {
      const origin = frameOrigin(frame);
      if (!trustedOrigin(origin) || !frame.contentWindow || !visible(frame)) return;
      const id = `${Date.now()}-${++requestCounter}`;
      childStates.set(frame, { id, origin, started: Date.now(), report: null });
      frame.contentWindow.postMessage({ channel: CHANNEL, type: 'command', requestId: id, fill, automatic, auto: $('auto').checked, overwrite: $('overwrite').checked }, origin);
      if (!watchedFrames.has(frame)) {
        watchedFrames.add(frame);
        frame.addEventListener('load', () => {
          commandFrame(frame, $('auto').checked, true);
          publish();
        });
      }
      clearTimeout(reportTimer);
      reportTimer = setTimeout(publish, 4200);
    }

    window.addEventListener('message', event => {
      const data = event.data;
      if (!trustedOrigin(event.origin) || !data || data.channel !== CHANNEL) return;
      if (data.type === 'command' && window.parent !== window && event.source === window.parent && typeof data.requestId === 'string') {
        parentRequest = { origin: event.origin, id: data.requestId };
        panel.style.display = 'none';
        $('auto').checked = !!data.auto;
        $('overwrite').checked = !!data.overwrite;
        run(!!data.fill, !!data.automatic);
        return;
      }
      const frame = [...document.querySelectorAll('iframe')].find(el => el.contentWindow === event.source && frameOrigin(el) === event.origin);
      if (!frame || !visible(frame)) return;
      if (data.type === 'ready') {
        commandFrame(frame, $('auto').checked, true);
        publish();
      } else if (data.type === 'result') {
        const state = childStates.get(frame);
        const report = data.report;
        if (!state || state.id !== data.requestId || !report || !Array.isArray(report.rows)) return;
        state.report = { rows: report.rows.slice(0, 1000).filter(row => typeof row.label === 'string' && typeof row.message === 'string').map(row => ({ label: row.label, message: row.message, ready: !!row.ready })), filled: Math.max(0, Number(report.filled) || 0), pending: Math.max(0, Number(report.pending) || 0), warnings: Array.isArray(report.warnings) ? report.warnings.filter(w => typeof w === 'string').slice(0, 20) : [] };
        publish();
      }
    });

    function run(fill = false, automatic = false) {
      if (busy) return;
      busy = true;
      try {
        const { rows, invalid } = scan();
        let filled = 0;
        for (const row of rows) {
          if (!fill || !row.plan) continue;
          const signature = JSON.stringify([row.answer, $('overwrite').checked]);
          const previous = attempted.get(row.plan.root);
          if (automatic && previous?.signature === signature && row.plan.controls.every((el, i) => el === previous.controls[i])) {
            const retained = row.plan.actions.every(actionMatches);
            if (retained) {
              filled++;
              row.message = `已填入 ${row.plan.type}：${JSON.stringify(row.preview)}`;
            } else row.message = '自动模式已尝试此答案；如需重试，请点击“填入答案”';
            continue;
          }
          attempted.set(row.plan.root, { signature, controls: row.plan.controls });
          try {
            apply(row.plan);
            filled++;
            row.message = `已填入 ${row.plan.type}：${JSON.stringify(row.preview)}`;
          } catch (error) { row.message = `填写未完成：${error.message}`; row.plan = null; }
        }
        localReport = { rows: rows.map(row => ({ label: row.label, message: row.message, ready: !!row.plan })), filled, invalid, fill };
        for (const frame of document.querySelectorAll('iframe')) commandFrame(frame, fill, automatic);
        publish();
      } catch (error) { $('status').textContent = `读取失败：${error.message}`; }
      finally { busy = false; }
    }

    $('scan').addEventListener('click', () => run());
    $('fill').addEventListener('click', () => run(true));
    $('auto').addEventListener('change', () => {
      clearTimeout(timer);
      timer = null;
      run($('auto').checked, true);
    });
    $('overwrite').addEventListener('change', () => {
      run($('auto').checked, true);
    });
    const observer = new MutationObserver(records => {
      if (busy || records.every(record => record.target === panel || panel.contains(record.target))) return;
      if (timer) return;
      timer = setTimeout(() => { timer = null; run($('auto').checked, true); }, CONFIG.debounceMs);
    });
    const observe = () => observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...CONFIG.answerAttributes, 'data-solution', 'data-submitted', 'isblur', 'src', 'class', 'style', 'hidden', 'disabled', 'readonly'] });
    observe();
    window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); clearTimeout(reportTimer); });
    window.addEventListener('pageshow', event => { if (event.persisted) { observe(); run(); } });
    setTimeout(() => {
      run();
      if (window.parent !== window && document.referrer) {
        try {
          const origin = new URL(document.referrer).origin;
          if (trustedOrigin(origin)) window.parent.postMessage({ channel: CHANNEL, type: 'ready' }, origin);
        } catch { /* 无可用父页地址时等待父页发起连接。 */ }
      }
    }, 0);
  }
})();
