/**
 * Miao Menu Editor Logic v4.0
 * Fixed Bugs, Detailed Fonts/Colors, Horizontal Subtitle
 */

const appState = {
    fullConfig: { menus: [] },
    currentMenuId: null,
    assets: { backgrounds: [], icons: [], widget_imgs: [], fonts: [] }
};

let editState = { groupIdx: -1, itemIdx: -1, isGroupEdit: false };
let dragData = { active: false, mode: 'move', startX: 0, startY: 0, initialLeft: 0, initialTop: 0, initialSizeW: 0, initialSizeH: 0, widgetIdx: -1 };
let selectedWidgetIdx = -1;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([loadAssets(), loadConfig()]);
        initFonts();
        if (appState.fullConfig.menus.length > 0) switchMenu(appState.fullConfig.menus[0].id);
        else createNewMenu();
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('mousemove', doDrag);
    } catch (e) {
        console.error("Init error:", e);
        if (e.status === 401) window.location.href = "/login";
    }
});

function getCurrentMenu() { return appState.fullConfig.menus.find(m => m.id === appState.currentMenuId) || appState.fullConfig.menus[0]; }

async function api(url, method = "GET", body = null) {
    const opts = { method };
    if (body) {
        if (body instanceof FormData) opts.body = body;
        else { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
    }
    const res = await fetch("/api" + url, opts);
    if (!res.ok) throw res;
    if (res.headers.get("content-type")?.includes("json")) return res.json();
    return res;
}
async function loadConfig() { appState.fullConfig = await api("/config"); }
async function loadAssets() { appState.assets = await api("/assets"); }
async function saveAll() { await api("/config", "POST", appState.fullConfig); alert("✅ 已保存"); }
async function exportImage() {
    await api("/config", "POST", appState.fullConfig);
    const menu = getCurrentMenu();
    const res = await fetch("/api/export_image", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(menu)
    });
    if(res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${menu.name}.png`; a.click();
    } else alert("导出失败");
}

function switchMenu(id) {
    appState.currentMenuId = id; selectedWidgetIdx = -1;
    renderMenuSelect(); renderAll();
}

function createNewMenu() {
    const newMenu = {
        id: "m_" + Date.now(), name: "新菜单", enabled: true,
        title: "标题", groups: [], custom_widgets: [],
        layout_columns: 3, box_bg_color: "#000000", box_bg_alpha: 120, box_blur_radius: 0,
        title_font: "title.ttf", text_font: "text.ttf",
        group_title_font: "text.ttf", group_sub_font: "text.ttf", item_name_font: "title.ttf", item_desc_font: "text.ttf"
    };
    appState.fullConfig.menus.push(newMenu);
    switchMenu(newMenu.id);
}

function deleteMenu() {
    if (appState.fullConfig.menus.length <= 1) return alert("至少保留一个");
    if (!confirm("确定删除？")) return;
    appState.fullConfig.menus = appState.fullConfig.menus.filter(m => m.id !== appState.currentMenuId);
    switchMenu(appState.fullConfig.menus[0].id);
}
function toggleEnable() { const m = getCurrentMenu(); m.enabled = !m.enabled; renderMenuSelect(); }

function renderMenuSelect() {
    const sel = document.getElementById("menuSelect");
    sel.innerHTML = appState.fullConfig.menus.map(m => `<option value="${m.id}" ${m.id === appState.currentMenuId ? 'selected' : ''}>${m.enabled?'':'[停] '}${m.name}</option>`).join('');
    document.getElementById("menuNameInput").value = getCurrentMenu().name;
    const btn = document.getElementById("enableBtn");
    btn.innerText = getCurrentMenu().enabled ? "已启用" : "已停用";
    btn.style.color = getCurrentMenu().enabled ? "#4caf50" : "#f56c6c";
}

function renderAll() {
    const m = getCurrentMenu();
    updateFormInputs(m); renderSidebar(m); renderCanvas(m); updateWidgetEditor(m);
}

function updateFormInputs(m) {
    setValue("mainTitleInput", m.title); setValue("subTitleInput", m.sub_title);
    setValue("columnInput", m.layout_columns || 3); setValue("alignSelect", m.title_align || "center");
    setValue("canvasMode", m.use_canvas_size); setValue("cvsW", m.canvas_width || 1000); setValue("cvsH", m.canvas_height || 2000);
    setValue("cvsColorP", m.canvas_color || "#1e1e1e"); setValue("cvsColorT", m.canvas_color || "#1e1e1e");

    renderSelect("bgSelect", appState.assets.backgrounds, m.background, "无背景");
    setValue("bgFit", m.bg_fit_mode || "cover_w"); setValue("bgW", m.bg_custom_width || 1000); setValue("bgH", m.bg_custom_height || 1000);
    setValue("bgAlignX", m.bg_align_x || "center"); setValue("bgAlignY", m.bg_align_y || "top");

    setValue("boxColor", m.box_bg_color || "#000000"); setValue("boxBlur", m.box_blur_radius || 0);
    setValue("boxAlpha", m.box_bg_alpha !== undefined ? m.box_bg_alpha : 120); document.getElementById("alphaVal").innerText = m.box_bg_alpha;

    // 字体绑定
    renderSelect("fTitle", appState.assets.fonts, m.title_font || "title.ttf");
    renderSelect("fGTitle", appState.assets.fonts, m.group_title_font || m.text_font || "text.ttf");
    renderSelect("fGSub", appState.assets.fonts, m.group_sub_font || m.text_font || "text.ttf");
    renderSelect("fIName", appState.assets.fonts, m.item_name_font || m.title_font || "title.ttf");
    renderSelect("fIDesc", appState.assets.fonts, m.item_desc_font || m.text_font || "text.ttf");

    syncAllColors(m);
}

function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function renderSelect(id, opts, sel, def) {
    const el = document.getElementById(id); if(!el) return;
    let html = def ? `<option value="">${def}</option>` : '';
    html += opts.map(o => `<option value="${o}">${o}</option>`).join('');
    el.innerHTML = html; el.value = sel || "";
}

function syncAllColors(m) {
    const map = {
        'title_color': ['cTitleP', 'cTitleT'], 'subtitle_color': ['cSubP', 'cSubT'],
        'group_title_color': ['cGTitleP', 'cGTitleT'], 'group_sub_color': ['cGSubP', 'cGSubT'],
        'item_name_color': ['cItemNameP', 'cItemNameT'], 'item_desc_color': ['cItemDescP', 'cItemDescT']
    };
    for (const [k, ids] of Object.entries(map)) {
        const val = m[k] || "#FFFFFF";
        ids.forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = val; });
    }
}

function renderCanvas(m) {
    const cvs = document.getElementById("canvas");
    const useFixed = m.use_canvas_size;
    const w = useFixed ? (m.canvas_width || 1000) : 1000;
    const h = useFixed ? (m.canvas_height || 2000) : "auto";
    cvs.style.width = w + "px"; cvs.style.minHeight = (h==="auto"?800:h) + "px"; cvs.style.height = useFixed ? h + "px" : "auto";
    cvs.style.backgroundColor = m.canvas_color || "#1e1e1e";

    if (m.background) {
        cvs.style.backgroundImage = `url('/raw_assets/backgrounds/${m.background}')`;
        cvs.style.backgroundRepeat = "no-repeat";
        if (m.bg_fit_mode === "custom") cvs.style.backgroundSize = `${m.bg_custom_width}px ${m.bg_custom_height}px`;
        else cvs.style.backgroundSize = "100% auto";
        cvs.style.backgroundPosition = `${m.bg_align_x||'center'} ${m.bg_align_y||'top'}`;
    } else cvs.style.backgroundImage = "none";

    // 字体
    const fTitle = cssFont(m.title_font);
    const fGTitle = cssFont(m.group_title_font || m.text_font);
    const fGSub = cssFont(m.group_sub_font || m.text_font);
    const fIName = cssFont(m.item_name_font || m.title_font);
    const fIDesc = cssFont(m.item_desc_font || m.text_font);

    const cols = m.layout_columns || 3;
    const gridStyle = `grid-template-columns: repeat(${cols}, 1fr);`;

    const hex = m.box_bg_color || "#000000";
    const alpha = (m.box_bg_alpha !== undefined ? m.box_bg_alpha : 120) / 255;
    const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
    const boxRgba = `rgba(${r},${g},${b},${alpha})`;
    const backdrop = (m.box_blur_radius > 0) ? `backdrop-filter: blur(${m.box_blur_radius}px);` : '';

    const alignStyle = { left: "text-align:left;padding-left:50px;", right: "text-align:right;padding-right:50px;", center: "text-align:center;" }[m.title_align] || "text-align:center;";

    let html = `
        <div class="header-area" style="${alignStyle}">
            <div style="color:${m.title_color}; font-family:'${fTitle}'; font-size:${m.title_size||60}px">${m.title||''}</div>
            <div style="color:${m.subtitle_color}; font-family:'${fTitle}'; font-size:${(m.title_size||60)*0.5}px">${m.sub_title||''}</div>
        </div>
    `;

    (m.groups||[]).forEach((g, gIdx) => {
        // 横向副标题布局
        html += `
        <div class="group-box">
            <div class="group-header-wrap" onclick="openModal(${gIdx}, -1)" style="display:flex; align-items:baseline; padding:10px 10px 5px 10px; cursor:pointer;">
                <div style="color:${m.group_title_color}; font-family:'${fGTitle}'; font-size:${m.group_title_size||30}px">${g.title}</div>
                ${g.subtitle ? `<div style="color:${m.group_sub_color||'#aaa'}; font-family:'${fGSub}'; font-size:${m.group_sub_size||18}px; margin-left:15px;">${g.subtitle}</div>` : ''}
            </div>
            <div class="grid-container" style="${gridStyle}; background-color:${boxRgba}; ${backdrop}">
        `;
        (g.items||[]).forEach((item, iIdx) => {
            const iconUrl = item.icon ? `/raw_assets/icons/${item.icon}` : '';
            const noIconClass = item.icon ? '' : 'no-icon';
            html += `
            <div class="grid-item ${noIconClass}" onclick="openModal(${gIdx}, ${iIdx})">
                <img src="${iconUrl}" onerror="this.style.opacity=0">
                <div class="item-text">
                    <div class="text-scale-wrap"><h4 style="color:${m.item_name_color}; font-family:'${fIName}'; font-size:${m.item_name_size}px">${item.name}</h4></div>
                    <div class="text-scale-wrap"><p style="color:${m.item_desc_color}; font-family:'${fIDesc}'; font-size:${m.item_desc_size}px">${item.desc}</p></div>
                </div>
            </div>`;
        });
        html += `<div class="grid-item" style="justify-content:center; opacity:0.5; border:1px dashed #666" onclick="addItem(${gIdx})"><h4 style="color:${m.item_name_color}">+</h4></div></div></div>`;
    });

    cvs.innerHTML = html;
    setTimeout(applyTextScaling, 10);
    renderWidgets(cvs, m);
}

function applyTextScaling() {
    document.querySelectorAll('.text-scale-wrap').forEach(wrap => {
        const child = wrap.firstElementChild;
        if (!child) return;
        child.style.transform = 'none';
        const wrapW = wrap.offsetWidth; const childW = child.scrollWidth;
        if (childW > wrapW) {
            const scale = (wrapW / childW) * 0.95;
            child.style.transformOrigin = wrap.parentElement.parentElement.classList.contains('no-icon') ? 'center' : 'left';
            child.style.transform = `scale(${scale})`;
            child.style.width = `${childW}px`;
        }
    });
}

function renderSidebar(m) {
    const list = document.getElementById("groupList");
    list.innerHTML = "";
    (m.groups||[]).forEach((g, idx) => {
        const div = document.createElement("div"); div.className = "group-item";
        div.innerHTML = `
            <div style="flex:1;overflow:hidden;"><div style="font-weight:500;">${g.title}</div><div style="font-size:10px;color:#888;">${g.subtitle||''}</div></div>
            <div class="group-actions"><span class="icon-btn" onclick="moveGroup(${idx},-1)">↑</span><span class="icon-btn" onclick="moveGroup(${idx},1)">↓</span><span class="icon-btn" style="color:#f56c6c;border-color:#f56c6c" onclick="deleteGroup(${idx})">×</span></div>`;
        div.firstElementChild.onclick = () => openModal(idx, -1);
        list.appendChild(div);
    });
}

function openModal(gIdx, iIdx) {
    if (dragData.active) return;
    const m = getCurrentMenu();
    editState = { groupIdx: gIdx, itemIdx: iIdx, isGroupEdit: iIdx === -1 };
    renderSelect("editIcon", appState.assets.icons, "", "无图标");
    const overlay = document.querySelector(".modal-overlay");

    // 安全获取元素，防止 ID 不存在报错
    const elTitle = document.getElementById("modalTitle");
    const elName = document.getElementById("editName");
    const elSub = document.getElementById("editSub");
    const elDesc = document.getElementById("editDesc");
    const elIcon = document.getElementById("editIcon");
    const rowSub = document.getElementById("rowSub");
    const rowDesc = document.getElementById("rowDesc");
    const rowIcon = document.getElementById("rowIcon");

    if (!elTitle || !rowSub) return console.error("Modal DOM missing");

    if (editState.isGroupEdit) {
        elTitle.innerText = "编辑分组";
        elName.value = m.groups[gIdx].title;
        elSub.value = m.groups[gIdx].subtitle || "";
        rowSub.style.display = "block";
        rowDesc.style.display = "none";
        rowIcon.style.display = "none";
    } else {
        elTitle.innerText = "编辑功能项";
        const item = m.groups[gIdx].items[iIdx];
        elName.value = item.name;
        elDesc.value = item.desc;
        elIcon.value = item.icon;
        rowSub.style.display = "none";
        rowDesc.style.display = "block";
        rowIcon.style.display = "block";
    }
    overlay.style.display = "flex";
}
function closeModal() { document.querySelector(".modal-overlay").style.display = "none"; }
function saveModal() {
    const name = document.getElementById("editName").value;
    const g = getCurrentMenu().groups[editState.groupIdx];
    if (editState.isGroupEdit) { g.title = name; g.subtitle = document.getElementById("editSub").value; renderSidebar(getCurrentMenu()); }
    else { const item = g.items[editState.itemIdx]; item.name = name; item.desc = document.getElementById("editDesc").value; item.icon = document.getElementById("editIcon").value; }
    renderCanvas(getCurrentMenu()); closeModal();
}
function deleteCurrentItem() { if (editState.isGroupEdit) return; getCurrentMenu().groups[editState.groupIdx].items.splice(editState.itemIdx, 1); renderCanvas(getCurrentMenu()); closeModal(); }
function addItem(gIdx) { getCurrentMenu().groups[gIdx].items.push({ name: "新功能", desc: "...", icon: "" }); renderCanvas(getCurrentMenu()); openModal(gIdx, getCurrentMenu().groups[gIdx].items.length - 1); }

function renderWidgets(container, m) {
    (m.custom_widgets||[]).forEach((wid, idx) => {
        const el = document.createElement("div"); el.className = "draggable-widget";
        if (dragData.widgetIdx === idx) el.classList.add("selected");
        el.style.left = wid.x + "px"; el.style.top = wid.y + "px";
        if (wid.type === 'image') {
            const imgUrl = wid.content ? `/raw_assets/widgets/${wid.content}` : '';
            el.innerHTML = imgUrl ? `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover;pointer-events:none">` : `<div style="background:#444;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff">无图</div>`;
            el.style.width = (wid.width || 100) + "px"; el.style.height = (wid.height || 100) + "px";
        } else {
            el.innerText = wid.text || "Text"; el.style.fontSize = (wid.size || 40) + "px"; el.style.color = wid.color || "#FFF";
            // 简单预览字体，暂不一一匹配
            if (m.title_font) el.style.fontFamily = cssFont(m.title_font);
        }
        el.onmousedown = (e) => startDrag(e, idx, 'move');
        const handle = document.createElement("div"); handle.className = "resize-handle";
        handle.onmousedown = (e) => startDrag(e, idx, 'resize');
        el.appendChild(handle); container.appendChild(el);
    });
}
function startDrag(e, idx, mode) {
    e.preventDefault(); e.stopPropagation(); const m = getCurrentMenu();
    dragData = { active: true, mode, widgetIdx: idx, startX: e.clientX, startY: e.clientY, initialLeft: m.custom_widgets[idx].x||0, initialTop: m.custom_widgets[idx].y||0, initialSizeW: m.custom_widgets[idx].width||100, initialSizeH: m.custom_widgets[idx].height||100, initialSizeText: m.custom_widgets[idx].size||40 };
    selectedWidgetIdx = idx; renderCanvas(m); updateWidgetEditor(m);
}
function doDrag(e) {
    if (!dragData.active) return; const m = getCurrentMenu();
    const deltaX = e.clientX - dragData.startX; const deltaY = e.clientY - dragData.startY;
    const wid = m.custom_widgets[dragData.widgetIdx]; const el = document.querySelectorAll(".draggable-widget")[dragData.widgetIdx];
    if (dragData.mode === 'move') {
        wid.x = dragData.initialLeft + deltaX; wid.y = dragData.initialTop + deltaY;
        if(el) { el.style.left = wid.x + "px"; el.style.top = wid.y + "px"; }
    } else {
        if (wid.type === 'image') {
            wid.width = Math.max(20, dragData.initialSizeW + deltaX); wid.height = Math.max(20, dragData.initialSizeH + deltaY);
            if(el) { el.style.width = wid.width + "px"; el.style.height = wid.height + "px"; }
            document.getElementById("widW").value = wid.width; document.getElementById("widH").value = wid.height;
        } else {
            let newSize = dragData.initialSizeText + deltaY; if (newSize < 10) newSize = 10; wid.size = newSize;
            if(el) el.style.fontSize = wid.size + "px"; document.getElementById("widSize").value = newSize;
        }
    }
}
function stopDrag() { dragData.active = false; }
function addGroup() { const m = getCurrentMenu(); if (!m.groups) m.groups = []; m.groups.push({ title: "新分组", subtitle: "", items: [] }); renderAll(); }
function deleteGroup(idx) { if (confirm("删除此分组？")) { getCurrentMenu().groups.splice(idx, 1); renderAll(); } }
function moveGroup(idx, dir) { const g = getCurrentMenu().groups; if (idx + dir < 0 || idx + dir >= g.length) return; [g[idx], g[idx + dir]] = [g[idx + dir], g[idx]]; renderAll(); }
async function uploadFile(type, inp) {
    const f = inp.files[0]; if (!f) return;
    const d = new FormData(); d.append("type", type); d.append("file", f);
    const res = await api("/upload", "POST", d);
    if (res.status === 'ok') { alert("上传成功"); if (type === 'font') initFonts(); await loadAssets(); const m = getCurrentMenu(); if (type === 'widget_img' && selectedWidgetIdx !== -1) updateWidget('content', res.filename); renderAll(); inp.value = ""; }
}
function addWidget(type) { const m = getCurrentMenu(); if (type === 'image') m.custom_widgets.push({ type: 'image', content: '', x: 50, y: 50, width: 100, height: 100 }); else m.custom_widgets.push({ type: 'text', text: "新文本", x: 50, y: 50, size: 40, color: "#FFFFFF" }); selectedWidgetIdx = m.custom_widgets.length - 1; renderAll(); }
function updateWidget(key, val) { if (selectedWidgetIdx === -1) return; const m = getCurrentMenu(); const wid = m.custom_widgets[selectedWidgetIdx]; if (['size','width','height'].includes(key)) wid[key] = parseInt(val); else wid[key] = val; renderCanvas(m); }
function updateWidgetEditor(m) {
    const editor = document.getElementById("widgetEditor"); const tEdit = document.getElementById("wEdit-text"); const iEdit = document.getElementById("wEdit-image");
    if (selectedWidgetIdx === -1) { editor.style.display = "none"; return; }
    editor.style.display = "block"; const wid = m.custom_widgets[selectedWidgetIdx];
    if (wid.type === 'image') { tEdit.style.display = "none"; iEdit.style.display = "block"; document.getElementById("widW").value = wid.width; document.getElementById("widH").value = wid.height; renderSelect("widImgSelect", appState.assets.widget_imgs, wid.content, "选择图片"); }
    else { iEdit.style.display = "none"; tEdit.style.display = "block"; document.getElementById("widText").value = wid.text; document.getElementById("widSize").value = wid.size; document.getElementById("widColor").value = wid.color; }
}
function deleteWidget() { const m = getCurrentMenu(); if (selectedWidgetIdx === -1) return; m.custom_widgets.splice(selectedWidgetIdx, 1); selectedWidgetIdx = -1; renderAll(); }
function updateMenuMeta(key, val) { const m = getCurrentMenu(); m[key] = val; renderCanvas(m); }
function updateBg(val) { updateMenuMeta('background', val); }
function updateColor(key, val, source) { if (source === 'text' && !val.startsWith('#')) val = '#' + val; updateMenuMeta(key, val); syncAllColors(getCurrentMenu()); }
function initFonts() { (appState.assets.fonts || []).forEach(n => { const id = "f-" + n; if (!document.getElementById(id)) { const s = document.createElement("style"); s.id = id; s.textContent = `@font-face { font-family: '${cssFont(n)}'; src: url('/fonts/${n}'); }`; document.head.appendChild(s); } }); }
function cssFont(n) { return n ? n.replace(/\./g, '_') : 'sans-serif'; }