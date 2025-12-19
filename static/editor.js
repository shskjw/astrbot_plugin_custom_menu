/**
 * Miao Menu Editor Logic
 * v8.4 Final
 */

// ================= 全局状态 =================
const appData = {
    menu: {
        groups: [], custom_widgets: [],
        title_align: "center", layout_columns: 3,
        // 颜色
        title_color: "#FFFFFF", subtitle_color: "#DDDDDD",
        group_title_color: "#FFFFFF", item_name_color: "#FFFFFF", item_desc_color: "#AAAAAA",
        // 字体
        title_font: "title.ttf", text_font: "text.ttf",
        // 字号
        title_size: 60, group_title_size: 30, item_name_size: 26, item_desc_size: 16
    },
    assets: { backgrounds: [], icons: [], fonts: [] }
};

let editState = { groupIdx: -1, itemIdx: -1, isGroupEdit: false };
let dragData = { active: false, mode: 'move', startX: 0, startY: 0, initialLeft: 0, initialTop: 0, initialSize: 0, widgetIdx: -1 };
let selectedWidgetIdx = -1;

// ================= 初始化 =================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([loadAssets(), loadFonts(), loadMenu()]);
        ensureDataIntegrity(); // 兜底
        initFonts();
        renderAll();

        // 全局拖拽事件
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('mousemove', doDrag);
    } catch (e) {
        if (e.status === 401) window.location.href = "/login";
        console.error("Init:", e);
    }
});

function ensureDataIntegrity() {
    const m = appData.menu;
    if (!m.groups) m.groups = [];
    if (!m.custom_widgets) m.custom_widgets = [];
    if (!m.layout_columns) m.layout_columns = 3;
    if (!appData.assets.fonts) appData.assets.fonts = [];
}

// ================= API =================
async function api(url, method = "GET", body = null) {
    const opts = { method };
    if (body) {
        if (body instanceof FormData) opts.body = body;
        else { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
    }
    const res = await fetch("/api" + url, opts);
    if (!res.ok) throw res; return res.json();
}
async function loadMenu() { appData.menu = await api("/menu"); }
async function loadAssets() { appData.assets = await api("/assets"); }
async function loadFonts() { try { appData.assets.fonts = await api("/fonts"); } catch { appData.assets.fonts = []; } }

// ================= UI 渲染 =================
function renderAll() {
    renderSidebar();
    renderCanvas();
    updateFormInputs();
    updateWidgetEditor();
}

function updateFormInputs() {
    const m = appData.menu;
    setValue("mainTitleInput", m.title);
    setValue("subTitleInput", m.sub_title);
    setValue("titleSizeInput", m.title_size || 60);
    setValue("columnSelect", m.layout_columns || 3);
    setValue("alignSelect", m.title_align || "center");

    renderSelect("bgSelect", appData.assets.backgrounds, m.background, "无背景");
    renderSelect("titleFontSelect", appData.assets.fonts, m.title_font || "title.ttf");
    renderSelect("textFontSelect", appData.assets.fonts, m.text_font || "text.ttf");

    syncAllColors();
}

function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val || ""; }
function renderSelect(id, opts, sel, def) {
    const el = document.getElementById(id); if(!el) return;
    let html = def ? `<option value="">${def}</option>` : '';
    html += opts.map(o => `<option value="${o}">${o}</option>`).join('');
    el.innerHTML = html; el.value = sel || "";
}

function syncAllColors() {
    const map = {
        'title_color': ['colTitleP', 'colTitleT'], 'subtitle_color': ['colSubP', 'colSubT'],
        'group_title_color': ['colGrpP', 'colGrpT'], 'item_name_color': ['colNameP', 'colNameT'],
        'item_desc_color': ['colDescP', 'colDescT']
    };
    for (const [k, ids] of Object.entries(map)) {
        const val = appData.menu[k] || "#FFFFFF";
        ids.forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = val; });
    }
}

// 渲染左侧分组列表
function renderSidebar() {
    const list = document.getElementById("groupList");
    list.innerHTML = "";
    appData.menu.groups.forEach((g, idx) => {
        const div = document.createElement("div");
        div.className = "group-item";
        div.innerHTML = `
            <span style="font-weight:500; flex:1; overflow:hidden; text-overflow:ellipsis;">${g.title}</span>
            <div class="group-actions">
                <span class="icon-btn" onclick="moveGroup(${idx}, -1)" title="上移">↑</span>
                <span class="icon-btn" onclick="moveGroup(${idx}, 1)" title="下移">↓</span>
                <span class="icon-btn" style="color:#f56c6c; border-color:#f56c6c" onclick="deleteGroup(${idx})" title="删除">×</span>
            </div>`;
        div.querySelector("span").onclick = () => openModal(idx, -1);
        list.appendChild(div);
    });
}

// 渲染右侧画布
function renderCanvas() {
    const cvs = document.getElementById("canvas");
    const m = appData.menu;
    cvs.style.backgroundImage = m.background ? `url('/raw_assets/backgrounds/${m.background}')` : 'none';

    const tFont = cssFont(m.title_font);
    const cFont = cssFont(m.text_font);
    const cols = m.layout_columns || 3;
    const gridStyle = `grid-template-columns: repeat(${cols}, 1fr);`;

    const alignStyle = {
        left: "text-align: left; padding-left: 50px;",
        right: "text-align: right; padding-right: 50px;",
        center: "text-align: center;"
    }[m.title_align] || "text-align: center;";

    let html = `
        <div class="header-area" style="${alignStyle}">
            <div class="main-title" onclick="editGlobalTitle()"
                 style="color:${m.title_color}; font-family:'${tFont}'; font-size:${m.title_size}px">
                 ${m.title}
            </div>
            <div class="sub-title" onclick="editGlobalTitle()"
                 style="color:${m.subtitle_color}; font-family:'${tFont}'; font-size:${Math.floor(m.title_size * 0.5)}px">
                 ${m.sub_title}
            </div>
        </div>
    `;

    m.groups.forEach((g, gIdx) => {
        html += `
        <div class="group-box">
            <div class="group-header" onclick="openModal(${gIdx}, -1)"
                 style="color:${m.group_title_color}; font-family:'${cFont}'; font-size:${m.group_title_size}px">
                 ${g.title}
            </div>
            <div class="grid-container" style="${gridStyle}">
        `;
        g.items.forEach((item, iIdx) => {
            const iconUrl = item.icon ? `/raw_assets/icons/${item.icon}` : '';
            const noIconClass = item.icon ? '' : 'no-icon';
            html += `
            <div class="grid-item ${noIconClass}" onclick="openModal(${gIdx}, ${iIdx})">
                <img src="${iconUrl}" onerror="this.style.opacity=0">
                <div class="item-text">
                    <h4 style="color:${m.item_name_color}; font-family:'${tFont}'; font-size:${m.item_name_size}px">${item.name}</h4>
                    <p style="color:${m.item_desc_color}; font-family:'${cFont}'; font-size:${m.item_desc_size}px">${item.desc}</p>
                </div>
            </div>`;
        });
        html += `<div class="grid-item" style="justify-content:center; opacity:0.5; border:1px dashed #666" onclick="addItem(${gIdx})"><h4 style="color:${m.item_name_color}">+</h4></div></div></div>`;
    });

    cvs.innerHTML = html;
    renderWidgets(cvs);
}

function cssFont(fontName) { return fontName ? fontName.replace(/\./g, '_') : 'sans-serif'; }

function renderWidgets(container) {
    if (!appData.menu.custom_widgets) return;
    appData.menu.custom_widgets.forEach((wid, idx) => {
        const el = document.createElement("div");
        el.className = "draggable-widget";
        if (dragData.widgetIdx === idx) el.classList.add("selected");
        el.innerText = wid.text;
        el.style.left = wid.x + "px"; el.style.top = wid.y + "px";
        el.style.fontSize = wid.size + "px"; el.style.color = wid.color;
        if (wid.font) el.style.fontFamily = cssFont(wid.font);

        el.onmousedown = (e) => startDrag(e, idx, 'move');
        const handle = document.createElement("div"); handle.className = "resize-handle";
        handle.onmousedown = (e) => startDrag(e, idx, 'resize');
        el.appendChild(handle); container.appendChild(el);
    });
}

// ================= 拖拽逻辑 =================
function startDrag(e, idx, mode) {
    e.preventDefault(); e.stopPropagation();
    dragData.active = true; dragData.mode = mode; dragData.widgetIdx = idx;
    dragData.startX = e.clientX; dragData.startY = e.clientY;
    const wid = appData.menu.custom_widgets[idx];
    dragData.initialLeft = wid.x; dragData.initialTop = wid.y; dragData.initialSize = wid.size;
    selectedWidgetIdx = idx;
    renderCanvas(); updateWidgetEditor();
}

function doDrag(e) {
    if (!dragData.active) return;
    const deltaX = e.clientX - dragData.startX;
    const deltaY = e.clientY - dragData.startY;
    const wid = appData.menu.custom_widgets[dragData.widgetIdx];

    // 直接操作 DOM，不重绘 Canvas (性能优化)
    const el = document.querySelectorAll(".draggable-widget")[dragData.widgetIdx];
    if (dragData.mode === 'move') {
        wid.x = dragData.initialLeft + deltaX;
        wid.y = dragData.initialTop + deltaY;
        if(el) { el.style.left = wid.x + "px"; el.style.top = wid.y + "px"; }
    } else {
        let newSize = dragData.initialSize + deltaY;
        if (newSize < 10) newSize = 10;
        wid.size = newSize;
        if(el) el.style.fontSize = wid.size + "px";
        const input = document.getElementById("widSize");
        if(input) input.value = newSize;
    }
}

function stopDrag() {
    if (dragData.active) { dragData.active = false; if(dragData.mode === 'resize') updateWidgetEditor(); }
}

// ================= 逻辑操作 =================
function updateMeta(key, val) { appData.menu[key] = val; renderCanvas(); }
function updateBg(val) { appData.menu.background = val; renderCanvas(); }
function updateColor(key, val, source) {
    if (source === 'text' && !val.startsWith('#')) val = '#' + val;
    appData.menu[key] = val;
    syncAllColors(); renderCanvas();
}
function updateFont(key, val) {
    if (key === 'title') appData.menu.title_font = val;
    if (key === 'text') appData.menu.text_font = val;
    initFonts(); renderCanvas();
}

// --- 🚀 分组操作修复：自动滚动 ---
function addGroup() {
    appData.menu.groups.push({ title: "新分组", items: [] });
    renderSidebar(); renderCanvas();
    // 强制滚动到底部
    setTimeout(() => {
        const content = document.querySelector(".sidebar-content");
        if(content) content.scrollTop = content.scrollHeight;
    }, 50);
}
function deleteGroup(idx) { if (confirm("删除分组？")) { appData.menu.groups.splice(idx, 1); renderAll(); } }
function moveGroup(idx, dir) {
    const groups = appData.menu.groups;
    if (idx + dir < 0 || idx + dir >= groups.length) return;
    [groups[idx], groups[idx + dir]] = [groups[idx + dir], groups[idx]];
    renderSidebar(); renderCanvas();
}

// 组件增删
function addCustomWidget() {
    appData.menu.custom_widgets.push({ text: "自定义文本", x: 100, y: 100, size: 40, color: "#FFFFFF", font: appData.menu.title_font });
    selectedWidgetIdx = appData.menu.custom_widgets.length - 1;
    renderCanvas(); updateWidgetEditor();
}
function deleteWidget() {
    if (dragData.widgetIdx === -1) return;
    appData.menu.custom_widgets.splice(dragData.widgetIdx, 1);
    dragData.widgetIdx = -1; selectedWidgetIdx = -1;
    renderCanvas(); updateWidgetEditor();
}
function updateWidget(key, val) {
    if (dragData.widgetIdx === -1) return;
    const wid = appData.menu.custom_widgets[dragData.widgetIdx];
    if (key === 'size') wid.size = parseInt(val); else wid[key] = val;
    renderCanvas();
}
function updateWidgetEditor() {
    const editor = document.getElementById("widgetEditor");
    if (selectedWidgetIdx === -1) { editor.style.display = "none"; return; }
    editor.style.display = "block";
    const wid = appData.menu.custom_widgets[selectedWidgetIdx];
    document.getElementById("widText").value = wid.text;
    document.getElementById("widSize").value = wid.size;
    document.getElementById("widColor").value = wid.color;
    renderSelect("widFont", appData.assets.fonts, wid.font);
}

// 弹窗与上传
function openModal(gIdx, iIdx) {
    if (dragData.active) return;
    editState = { groupIdx: gIdx, itemIdx: iIdx, isGroupEdit: iIdx === -1 };
    renderSelect("editIcon", appData.assets.icons, "", "无图标");
    const m = document.querySelector(".modal-overlay");
    if (editState.isGroupEdit) {
        document.getElementById("modalTitle").innerText = "编辑分组标题";
        document.getElementById("editName").value = appData.menu.groups[gIdx].title;
        document.getElementById("rowDesc").style.display = "none";
        document.getElementById("rowIcon").style.display = "none";
    } else {
        document.getElementById("modalTitle").innerText = "编辑功能项";
        const item = appData.menu.groups[gIdx].items[iIdx];
        document.getElementById("editName").value = item.name;
        document.getElementById("editDesc").value = item.desc;
        document.getElementById("editIcon").value = item.icon;
        document.getElementById("rowDesc").style.display = "block";
        document.getElementById("rowIcon").style.display = "block";
    }
    m.style.display = "flex";
}
function closeModal() { document.querySelector(".modal-overlay").style.display = "none"; }
function saveModal() {
    const name = document.getElementById("editName").value;
    const g = appData.menu.groups[editState.groupIdx];
    if (editState.isGroupEdit) { g.title = name; renderSidebar(); }
    else {
        const item = g.items[editState.itemIdx];
        item.name = name;
        item.desc = document.getElementById("editDesc").value;
        item.icon = document.getElementById("editIcon").value;
    }
    renderCanvas(); closeModal();
}
function deleteCurrentItem() {
    if (editState.isGroupEdit) return;
    if (confirm("删除此项？")) {
        appData.menu.groups[editState.groupIdx].items.splice(editState.itemIdx, 1);
        renderCanvas(); closeModal();
    }
}
function addItem(gIdx) {
    appData.menu.groups[gIdx].items.push({ name: "新功能", desc: "...", icon: "" });
    renderCanvas(); openModal(gIdx, appData.menu.groups[gIdx].items.length - 1);
}
async function uploadFile(type, inp) {
    const f = inp.files[0]; if (!f) return;
    const d = new FormData(); d.append("type", type); d.append("file", f);
    const res = await api("/upload", "POST", d);
    if (res.status === 'ok') {
        alert("上传成功");
        if (type === 'font') await loadFonts(); else await loadAssets();
        updateFormInputs(); initFonts(); inp.value = "";
    }
}
async function saveAll() { const res = await api("/menu", "POST", appData.menu); if (res.status === 'ok') alert("✅ 已保存"); }
function initFonts() { [appData.menu.title_font, appData.menu.text_font].forEach(injectFont); }
function injectFont(n) {
    if (!n) return; const id = "f-" + n; if (document.getElementById(id)) return;
    const s = document.createElement("style"); s.id = id;
    s.textContent = `@font-face { font-family: '${cssFont(n)}'; src: url('/fonts/${n}'); }`;
    document.head.appendChild(s);
}
function cssFont(n) { return n ? n.replace(/\./g, '_') : 'sans-serif'; }