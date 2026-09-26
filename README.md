# WE Learn HTML 答案填入助手

用于 WE Learn 网页端的 Tampermonkey 用户脚本：读取页面 HTML 中已有的答案，预览匹配结果，再填入对应控件。支持课件 iframe、普通填空、ChooseBox 分类题、自定义选择题和已有参考答案的主观题。

**当前版本：v0.3.1。** 无需构建、后端服务或 API Key。

> 兼容性以已观察到的外教社 ADL 课件结构为基础，并非覆盖所有 WE Learn 课程。v0.3.1 已通过本地验证，实际 Edge 中的完整答题脚本运行情况仍待确认。

## 功能与题型

| 题型 / 功能 | 支持情况 |
| --- | --- |
| 普通填空、多空题 | 读取答案属性，检查答案数量与输入框数量 |
| ChooseBox 编号分类 / 选项填空 | 通过可见空格与课件原生选项点击填入隐藏输入框 |
| 单选、多选、判断 | 支持原生表单及 ADL 自定义选项 |
| 下拉选择 | 按选项值或文本匹配，跳过无法唯一匹配的选项 |
| 主观题 | 填入页面已有参考答案；不生成答案 |
| 跨域课件 iframe | 在匹配域名的框架内独立运行，向外层面板汇总 |
| 动态加载的题目 | 监听页面变化，可选自动填入 |
| 已有作答 | 默认保留；勾选“覆盖已有作答”后允许替换 |
| 冲突、无答案、只读或锁定题目 | 跳过并显示原因；ChooseBox 的隐藏数据控件单独适配 |

脚本不主动调用答案接口、不上传题目到外部服务，也不点击提交按钮。填写时会触发网页输入和选择事件，课件自身可能保存作答。

## 安装

1. 在浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开本仓库的 [welearn-helper.user.js](welearn-helper.user.js)，点击 **Raw** 查看完整代码。
3. 如果油猴弹出安装页，选择安装；否则复制完整代码，进入油猴 → **添加新脚本**，用 `Ctrl+A` 替换默认模板，再按 `Ctrl+S` 保存。
4. 确认脚本已启用，并允许扩展访问以下站点：

   ```text
   https://welearn.sflep.com/*
   https://courseres.sflep.com/*
   https://centercourseware.sflep.com/*
   ```

5. 返回学习页，刷新整个页面。右下角应出现 **WE Learn · HTML 答案助手 v0.3.1** 面板。

Edge 中的“允许用户脚本”与扩展“站点访问”是两个不同设置。若脚本没有启动，打开 `edge://extensions` → Tampermonkey → 详细信息检查。具体选项随浏览器版本变化，参见[油猴官方执行权限说明](https://www.tampermonkey.net/faq.php?locale=zh&q=Q209)。

### 更新已有脚本

进入油猴管理面板，编辑原脚本，完整替换为本仓库最新代码后保存，再刷新学习页。不要把代码追加在旧脚本末尾，也不要同时启用多份答题脚本。

## 使用

1. 打开具体题目页，点击 **读取 / 预览**。
2. 查看识别题数、答案预览及跳过原因。
3. 点击 **填入答案**，检查页面上的填写结果。
4. 若需要处理后续动态加载的题目，勾选 **自动填入当前页面及新加载的题目**。刷新整个页面后需要重新开启。
5. 只有需要替换现有作答时，才勾选 **覆盖已有作答**。提交由使用者在网页中操作。

## 常见问题

### 油猴显示“没有运行中的脚本”

先确认安装、保存、启用、执行权限和站点访问，再检查脚本设置中的自定义排除规则。

可以临时安装 [welearn-startup-check.user.js](welearn-startup-check.user.js)：它只在左上角显示绿色的“WE Learn 启动检测成功”提示，不读取或填写题目。

- **出现绿色提示**：检测脚本可以执行，继续检查答题脚本是否完整保存、是否启用，以及注入环境是否一致。
- **没有提示**：优先检查扩展权限、站点访问和油猴站点黑名单。
- 检测后禁用或删除“WE Learn 启动检测”，避免重复显示提示。

启动检测成功不等于答题脚本已正常运行。v0.3.1 使用与检测脚本相同的 `@sandbox DOM` 配置；同步初始化出错时会显示红色提示。排查时请提供完整错误文字。

### 面板显示“课件未响应”

题目可能位于跨域 iframe 内。脚本必须在外层页面及课件域名同时运行；确认已允许访问 `centercourseware.sflep.com` 和 `courseres.sflep.com`，然后刷新整个学习页。

### “当前文档未识别到题目”或“未找到已有答案”

先进入具体题目页并重新预览。页面可能尚未加载题目，也可能使用未适配的控件结构，或 HTML 本身没有答案。此时需要根据实际题目 HTML 增加适配规则。

### 分类题的白色空格不是普通输入框

ChooseBox 使用可见的 `data-itemtype="myresult"` 作为点击入口，底层 `input` 可以隐藏或只读。脚本通过课件自己的空格和选项事件填写，并核对底层值与显示文本；不会直接移除控件的只读设置。

### 部分题目被跳过

可能原因包括：已有作答、已提交锁定、答案来源冲突、答案数量不符、选项匹配不唯一、控件不可用，或选项不允许重复使用。面板会显示具体原因。

## 项目结构

```text
welearn-helper/
├── welearn-helper.user.js         # 主脚本
├── welearn-startup-check.user.js  # 独立启动检测
├── demo.html                     # 通用表单模拟与 16 项检查
├── course-frame.html             # ADL 控件模拟与 7 项检查
├── frame-demo.html               # 跨域 iframe 演示入口
├── README.md
├── CHANGELOG.md
├── .gitattributes
└── .gitignore
```

本仓库发布自编脚本与模拟页面。用于本地研究的第三方课件源码、课程快照和调试材料保留在被 Git 忽略的 `inspection/` 中，不随仓库发布。

## 本地验证

运行主脚本无需 Node.js 或 Python；下面的工具仅用于开发验证。

```bash
git clone https://github.com/MerrickWang/welearn-helper.git
cd welearn-helper
node --check welearn-helper.user.js
node --check welearn-startup-check.user.js
python -m http.server 8765 --bind 127.0.0.1
```

- 打开 `http://127.0.0.1:8765/demo.html`，点击面板的“填入答案”，再点击页面的“检查默认填入结果”，应看到 16 项 `PASS`。
- 打开 `http://127.0.0.1:8765/frame-demo.html`，通过外层面板读取、填写模拟课件，再使用框架内的检查按钮验证。框架来自 `localhost`，与外层的 `127.0.0.1` 不同源。
- 演示页面直接通过 `<script>` 加载脚本，不需要给油猴添加 localhost 匹配规则。

已有验证覆盖普通填空、选择题、主观题参考答案、已有作答保护、冲突跳过、事件触发、提交锁定与 iframe 通信。v0.3.1 的通用演示 16 项检查通过，模拟初始化异常时也能显示错误提示。

上述本地演示不会验证 Tampermonkey 在真实 Edge 中的注入环境，也不验证平台服务端的保存结果。未通过此项目验证真实课程提交。

## 适配方式与限制

主脚本中的 `CONFIG` 保存通用选择器、答案属性和 JSON 字段规则；ADL 课件适配使用 `data-controltype`、`data-solution`、`data-itemtype` 等标记。

- 填空按课件声明的 `isblur` / `data-blur` 分隔符处理可接受答案。
- 主观题先读取 `data-solution`，为空时尝试同题参考答案节点；只有“Answers may vary.”提示时跳过。
- ChooseBox 根据 `data-choosebox` 查找对应选项池，检查当前空格、选项复用约束和填写结果。
- iframe 消息校验来源域名、窗口和请求标识；默认仅匹配上述三个外教社域名。

专用拖拽、排序、录音及写作编辑器尚未适配。课程改版、答案缺失或控件结构变化都可能需要更新规则。

## 反馈问题

请在 [Issues](https://github.com/MerrickWang/welearn-helper/issues) 中提供脚本版本、浏览器和油猴版本、题型、面板提示及最小题目 HTML。分享材料前删除姓名、学号、班级信息、登录凭据和其他个人数据。

版本变化见 [CHANGELOG.md](CHANGELOG.md)。
