# 🎨 AstrBot Custom Menu Pro (可视化菜单编辑器)

> **版本**: v8.4 Ultimate  
> **架构**: Multiprocessing (Spawn) + Quart + Pillow  
> **适配**: AstrBot (Star 协议)

**拒绝手写 JSON，拒绝繁琐配置！**  
这是一个为 [AstrBot](https://github.com/Soulter/AstrBot) 量身打造的高级可视化功能菜单生成器。通过 Web 界面**所见即所得**地设计你的机器人菜单，支持**拖拽布局**、**自由缩放**、**自定义字体**与**全配色管理**。

---

## ✨ 核心特性

*   **🖥️ Web 可视化编辑器**：内置独立 Web 后台，实时预览，修改即保存。
*   **🖱️ 自由拖拽交互**：
    *   支持**鼠标拖拽**任意改变文本位置。
    *   支持**右下角手柄**拖动缩放字号。
*   **🎨 全自定义外观**：
    *   **背景图**：支持上传自定义背景，**长图自动适应**，不截断。
    *   **字体库**：Web 端直接上传 `.ttf/.otf` 字体，浏览器与生成图实时同步。
    *   **全配色**：主标题、副标题、分组、功能名、描述均可独立设色。
*   **🛡️ 工业级稳定性**：
    *   采用 `multiprocessing (spawn)` 独立进程架构。
    *   彻底解决 Linux/Docker 环境下主线程死锁导致的卡顿问题。
*   **⚡ 动静分离**：
    *   Web 端只负责编辑，生成配置后自动渲染为静态图片。
    *   关闭后台后，Bot 依然可以毫秒级发送菜单，**零内存占用**。
*   **🔐 权限控制**：只有配置文件中指定的管理员 (`admins_id`) 才能开启后台。

---

## 📂 目录结构 (安装前必看)

请确保你的插件目录结构如下，否则可能无法启动：

```text
astrbot_plugin_custom_menu/
├── main.py
├── web_server.py
├── storage.py
├── _conf_schema.json
├── README.md
│
├── fonts/              <--  title.ttf 和 text.ttf (初始可随便找两个字体放入)
│
├── renderer/
│   └── menu.py
│
├── static/             <-- 存放 css 和 js
│   ├── style.css
│   └── editor.js
│
└── templates/          <-- 存放 html
    ├── index.html
    └── login.html