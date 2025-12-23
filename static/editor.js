const appState = {
    fullConfig: { menus: [] },
    currentMenuId: null,
    assets: { backgrounds: [], icons: [], widget_imgs: [], fonts: [] },
    clipboard: null
};

// 拖拽核心状态
let dragData = {
    active: false, isDragging: false,
    mode: 'move', type: null,
    gIdx: -1, iIdx: -1, targetIdx: -1,
    startX: 0, startY: 0,
    initialVals: {},
    elId: ''
};

let viewState = { scale: 1 };
let selectedWidgetIdx = -1;
let selectedItem = { gIdx: -1, iIdx: -1 };

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([loadAssets(), loadConfig()]);
        initFonts();
        if (appState.fullConfig.menus.length > 0) switchMenu(appState.fullConfig.menus[0].id);
        else createNewMenu();

        window.addEventListener('mouseup', handleGlobalMouseUp);
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('keydown', handleKeyDown);

        // 点击画布空白处
        const cvs = document.getElementById('canvas');
        cvs.addEventListener('mousedown', (e) => {
            if (e.target.id === 'canvas' || e.target.classList.contains('group-wrapper')) {
                clearSelection();
            }
        });
    } catch (e) { console.error("Init failed:", e); }
});

// --- API & Helpers ---
function getCurrentMenu() { return appState.fullConfig.menus.find(m => m.id === appState.currentMenuId) || appState.fullConfig.menus[0]; }
async function api(url, method = "GET", body = null) {
    const opts = { method, headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {} };
    if (body) opts.body = body instanceof FormData ? body : JSON.stringify(body);
    const res = await fetch("/api" + url, opts); if (!res.ok) throw res;
    return res.headers.get("content-type")?.includes("json") ? res.json() : res;
}
async function loadConfig() { appState.fullConfig = await api("/config"); }
async function loadAssets() { appState.assets = await api("/assets"); }
async function saveAll() { await api("/config", "POST", appState.fullConfig); alert("✅ 已保存"); }
async function exportImage() { await api("/config", "POST", appState.fullConfig); const menu = getCurrentMenu(); const res = await fetch("/api/export_image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(menu) }); if(res.ok) { const blob = await res.blob(); const a = document.createElement("a"); a.href = window.URL.createObjectURL(blob); a.download = `${menu.name}.png`; a.click(); } else alert("导出失败"); }

/**
 * 核心：样式获取函数
 * 优先读取 obj[key] (私有样式)，如果没有则读取 m[fallbackGlobalKey] (全局样式)
 */
function getStyle(obj, key, fallbackGlobalKey) {
    const m = getCurrentMenu();
    if (obj && obj[key] !== undefined && obj[key] !== "") return obj[key];
    return m[fallbackGlobalKey];
}

// --- 菜单操作 ---
function switchMenu(id) {
    appState.currentMenuId = id;
    clearSelection();
    renderMenuSelect();
    renderAll();
}
function createNewMenu() {
    appState.fullConfig.menus.push({
        id: "m_" + Date.now(), name: "新菜单", enabled: true, title: "标题", groups: [], custom_widgets: [],
        layout_columns: 3, group_bg_color: "#000000", group_bg_alpha: 50, item_bg_color: "#FFFFFF", item_bg_alpha: 20,
        use_canvas_size: false, canvas_width: 1000, canvas_height: 2000
    });
    switchMenu(appState.fullConfig.menus[appState.fullConfig.menus.length - 1].id);
}
function deleteMenu() { if(appState.fullConfig.menus.length <=1) return alert("保留一个"); if(confirm("删除?")) { appState.fullConfig.menus = appState.fullConfig.menus.filter(m=>m.id!==appState.currentMenuId); switchMenu(appState.fullConfig.menus[0].id); } }
function toggleEnable() { const m = getCurrentMenu(); m.enabled = !m.enabled; renderMenuSelect(); }

function renderMenuSelect() {
    document.getElementById("menuSelect").innerHTML = appState.fullConfig.menus.map(m => `<option value="${m.id}" ${m.id === appState.currentMenuId ? 'selected' : ''}>${m.enabled?'':'[停] '}${m.name}</option>`).join('');
    document.getElementById("menuNameInput").value = getCurrentMenu().name;
    const btn = document.getElementById("enableBtn"); btn.innerText = getCurrentMenu().enabled ? "已启用" : "已停用"; btn.style.color = getCurrentMenu().enabled ? "#4caf50" : "#f56c6c";
}

function renderAll() { const m = getCurrentMenu(); updateFormInputs(m); renderSidebarGroupList(m); renderCanvas(m); updateWidgetEditor(m); }

function updateFormInputs(m) {
    // 基础表单回填 (仅用于全局面板显示)
    setValue("columnInput", m.layout_columns || 3);
    setValue("alignSelect", m.title_align || "center");
    setValue("cvsW", m.canvas_width || 1000);
    setValue("cvsH", m.canvas_height || 2000);
    // 修复：回填画布模式下拉框
    const canvasModeSel = document.getElementById("canvasMode");
    if (canvasModeSel) canvasModeSel.value = m.use_canvas_size ? "true" : "false";

    setValue("cvsColorP", m.canvas_color || "#1e1e1e"); setValue("cvsColorT", m.canvas_color || "#1e1e1e");
    renderSelect("bgSelect", appState.assets.backgrounds, m.background, "无背景");
    setValue("bgFit", m.bg_fit_mode || "cover_w");

    // 样式回填
    setValue("boxColor", m.group_bg_color || "#000000"); setValue("boxBlur", m.group_blur_radius || 0); setValue("boxAlpha", m.group_bg_alpha !== undefined ? m.group_bg_alpha : 50); document.getElementById("alphaVal").innerText = m.group_bg_alpha;
    setValue("iboxColor", m.item_bg_color || "#FFFFFF"); setValue("iboxBlur", m.item_blur_radius || 0); setValue("iboxAlpha", m.item_bg_alpha !== undefined ? m.item_bg_alpha : 20); document.getElementById("ialphaVal").innerText = m.item_bg_alpha;

    renderSelect("fTitle", appState.assets.fonts, m.title_font); renderSelect("fGTitle", appState.assets.fonts, m.group_title_font); renderSelect("fGSub", appState.assets.fonts, m.group_sub_font); renderSelect("fIName", appState.assets.fonts, m.item_name_font); renderSelect("fIDesc", appState.assets.fonts, m.item_desc_font);

    // 颜色同步
    const map = {'title_color': ['cTitleP', 'cTitleT'], 'subtitle_color': ['cSubP', 'cSubT'], 'group_title_color': ['cGTitleP', 'cGTitleT'], 'group_sub_color': ['cGSubP', 'cGSubT'], 'item_name_color': ['cItemNameP', 'cItemNameT'], 'item_desc_color': ['cItemDescP', 'cItemDescT']};
    for (const [k, ids] of Object.entries(map)) { const val = m[k] || "#FFFFFF"; ids.forEach(id => { if (document.getElementById(id)) document.getElementById(id).value = val; }); }
}
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function renderSelect(id, opts, sel, def) { const el = document.getElementById(id); if (!el) return; el.innerHTML = (def ? `<option value="">${def}</option>` : '') + opts.map(o => `<option value="${o}" ${o===sel?'selected':''}>${o}</option>`).join(''); }

// --- 核心：渲染画布 (支持独立样式 + 修复尺寸) ---
function renderCanvas(m) {
    const cvs = document.getElementById("canvas");
    cvs.style.pointerEvents = "auto";

    // === 修复：画布尺寸逻辑 ===
    // use_canvas_size 可能是 boolean 也可能是 string (API传输)
    const useFixedSize = (String(m.use_canvas_size) === 'true');
    const fixedW = parseInt(m.canvas_width) || 1000;
    const fixedH = parseInt(m.canvas_height) || 2000;

    // 设置画布样式
    // 宽度：固定模式下用 canvas_width，否则默认 1000
    cvs.style.width = (useFixedSize ? fixedW : 1000) + "px";

    // 高度：固定模式下用 canvas_height，否则 auto
    if (useFixedSize) {
        cvs.style.height = fixedH + "px";
        cvs.style.minHeight = fixedH + "px"; // 强制
    } else {
        cvs.style.height = "auto";
        cvs.style.minHeight = "800px";
    }

    cvs.style.backgroundColor = m.canvas_color || "#1e1e1e";
    cvs.style.backgroundImage = m.background ? `url('/raw_assets/backgrounds/${m.background}')` : "none";
    if (m.background) { cvs.style.backgroundRepeat = "no-repeat"; cvs.style.backgroundSize = m.bg_fit_mode === "custom" ? `${m.bg_custom_width}px ${m.bg_custom_height}px` : "100% auto"; cvs.style.backgroundPosition = "top center"; }

    const gfTitle = cssFont(m.title_font);
    const titleAlign = m.title_align || 'center';

    let html = `
        <div class="header-area title-clickable" style="text-align:${titleAlign}"
             onclick="openContextEditor('title')" title="点击修改标题">
            <div style="color:${m.title_color}; font-family:'${gfTitle}'; font-size:${m.title_size || 60}px">${m.title || ''}</div>
            <div style="color:${m.subtitle_color}; font-family:'${gfTitle}'; font-size:${(m.title_size || 60) * 0.5}px">${m.sub_title || ''}</div>
        </div>
    `;

    (m.groups || []).forEach((g, gIdx) => {
        const gTitleFont = cssFont(getStyle(g, 'title_font', 'group_title_font'));
        const gSubFont = cssFont(getStyle(g, 'sub_font', 'group_sub_font'));
        const gTitleColor = getStyle(g, 'title_color', 'group_title_color');
        const gSubColor = getStyle(g, 'sub_color', 'group_sub_color');
        const gTitleSize = getStyle(g, 'title_size', 'group_title_size') || 30;
        const gSubSize = getStyle(g, 'sub_size', 'group_sub_size') || 18;

        const gBgColor = getStyle(g, 'bg_color', 'group_bg_color') || "#000000";
        const gBgAlpha = g.bg_alpha !== undefined ? g.bg_alpha : (m.group_bg_alpha !== undefined ? m.group_bg_alpha : 50);
        const gRgba = hexToRgba(gBgColor, gBgAlpha / 255);
        const gBlur = m.group_blur_radius > 0 ? `backdrop-filter: blur(${m.group_blur_radius}px);` : '';

        const freeMode = g.free_mode === true;
        let contentHeight = "auto";
        if (freeMode) {
            let maxBottom = 0;
            g.items.forEach(item => { const b = (parseInt(item.y)||0) + (parseInt(item.h)||100); if (b > maxBottom) maxBottom = b; });
            contentHeight = Math.max(Number(g.min_height) || 100, maxBottom + 20) + "px";
        }
        const overflowStyle = freeMode ? 'overflow:visible' : 'overflow:hidden';

        // === 修复：列数逻辑 ===
        // 优先使用分组自己的 layout_columns，如果没有，则使用全局的 layout_columns，最后默认 3
        const cols = g.layout_columns || m.layout_columns || 3;
        const gridStyle = `grid-template-columns: repeat(${cols}, 1fr);`;

        html += `
        <div class="group-wrapper" style="margin-bottom:30px;">
            <div class="group-header-wrap" onclick="openContextEditor('group', ${gIdx}, -1)" style="padding:0 0 10px 10px; cursor:pointer;">
                <span style="color:${gTitleColor}; font-family:'${gTitleFont}'; font-size:${gTitleSize}px">${g.title}</span>
                ${g.subtitle ? `<span style="color:${gSubColor}; font-family:'${gSubFont}'; font-size:${gSubSize}px; margin-left:10px;">${g.subtitle}</span>` : ''}
            </div>

            <div class="group-content-box" id="group-content-${gIdx}" style="background-color:${gRgba}; ${gBlur}; height:${contentHeight}; position:relative; ${overflowStyle}; border-radius:15px;">
                <div class="${freeMode ? 'free-container' : 'grid-container'}" style="${freeMode ? '' : gridStyle}">
        `;

        (g.items || []).forEach((item, iIdx) => {
            const iNameFont = cssFont(getStyle(item, 'name_font', 'item_name_font'));
            const iDescFont = cssFont(getStyle(item, 'desc_font', 'item_desc_font'));
            const iNameColor = getStyle(item, 'name_color', 'item_name_color');
            const iDescColor = getStyle(item, 'desc_color', 'item_desc_color');
            const iNameSize = getStyle(item, 'name_size', 'item_name_size') || m.item_name_size || 20;
            const iDescSize = getStyle(item, 'desc_size', 'item_desc_size') || m.item_desc_size || 14;

            const iBgColor = getStyle(item, 'bg_color', 'item_bg_color') || "#FFFFFF";
            const iBgAlpha = item.bg_alpha !== undefined ? item.bg_alpha : (m.item_bg_alpha !== undefined ? m.item_bg_alpha : 20);
            const iRgba = hexToRgba(iBgColor, iBgAlpha / 255);
            const iBlur = m.item_blur_radius > 0 ? `backdrop-filter: blur(${m.item_blur_radius}px);` : '';

            if (freeMode) {
                const isSel = selectedItem.gIdx === gIdx && selectedItem.iIdx === iIdx;
                const tx = parseInt(item.x)||0; const ty = parseInt(item.y)||0; const tw = parseInt(item.w)||100; const th = parseInt(item.h)||100;

                html += `
                <div class="free-item ${isSel ? 'selected' : ''}"
                     id="item-${gIdx}-${iIdx}"
                     style="left:${tx}px; top:${ty}px; width:${tw}px; height:${th}px; background-color:${iRgba}; ${iBlur};"
                     onmousedown="initItemDrag(event, ${gIdx}, ${iIdx}, 'move')">
                     <div style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none;">
                        <div style="color:${iNameColor}; font-family:'${iNameFont}'; font-size:${iNameSize}px;">${item.name}</div>
                        <div style="color:${iDescColor}; font-family:'${iDescFont}'; font-size:${iDescSize}px;">${item.desc}</div>
                     </div>
                     ${isSel ? `<div class="resize-handle" onmousedown="initItemDrag(event, ${gIdx}, ${iIdx}, 'resize')"></div>` : ''}
                </div>`;
            } else {
                html += `
                <div class="grid-item" style="background-color:${iRgba}; ${iBlur};" onclick="openContextEditor('item', ${gIdx}, ${iIdx})">
                    <div style="color:${iNameColor}; font-family:'${iNameFont}'; font-size:${iNameSize}px">${item.name}</div>
                    <div style="color:${iDescColor}; font-family:'${iDescFont}'; font-size:${iDescSize}px">${item.desc}</div>
                </div>`;
            }
        });

        if (!freeMode) {
            html += `<div class="grid-item" style="justify-content:center; opacity:0.5; border:1px dashed #666" onclick="addItem(${gIdx})"><h4 style="color:#fff">+</h4></div>`;
        }
        html += `</div></div></div>`;
    });
    cvs.innerHTML = html;
    renderWidgets(cvs, m);
}

function renderWidgets(container, m) {
    (m.custom_widgets || []).forEach((wid, idx) => {
        const el = document.createElement("div"); el.className = "draggable-widget";
        if (selectedWidgetIdx === idx) el.classList.add("selected");
        el.style.left = (parseInt(wid.x)||0) + "px";
        el.style.top = (parseInt(wid.y)||0) + "px";
        if (wid.type === 'image') {
            const imgUrl = wid.content ? `/raw_assets/widgets/${wid.content}` : '';
            el.innerHTML = imgUrl ? `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover;pointer-events:none">` : `无图`;
            el.style.width = (parseInt(wid.width)||100) + "px"; el.style.height = (parseInt(wid.height)||100) + "px";
        } else {
            el.innerText = wid.text || "Text";
            el.style.fontSize = (parseInt(wid.size)||40) + "px"; el.style.color = wid.color || "#FFF";
        }
        el.onmousedown = (e) => initWidgetDrag(e, idx, 'move');
        const handle = document.createElement("div"); handle.className = "resize-handle";
        handle.onmousedown = (e) => initWidgetDrag(e, idx, 'resize');
        el.appendChild(handle);
        container.appendChild(el);
    });
}
function hexToRgba(hex, alpha) { const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16); return `rgba(${r},${g},${b},${alpha})`; }

// --- 交互: 属性编辑器与选中 ---

// 打开上下文编辑器 (由点击触发)
function openContextEditor(type, gIdx, iIdx) {
    if (dragData.isDragging) return;

    if (type === 'item') {
        selectedItem = { gIdx, iIdx };
        renderCanvas(getCurrentMenu());
    } else {
        selectedItem = { gIdx: -1, iIdx: -1 };
        renderCanvas(getCurrentMenu());
    }

    selectedWidgetIdx = -1;
    document.getElementById("widgetEditor").style.display = "none";

    const m = getCurrentMenu();
    let targetObj, title, desc;

    if (type === 'title') {
        targetObj = m;
        title = "编辑主标题";
        desc = "设置菜单的主标题、副标题及全局样式";
    } else if (type === 'group') {
        targetObj = m.groups[gIdx];
        title = `编辑分组`;
        desc = "此处修改样式仅影响当前分组";
    } else if (type === 'item') {
        targetObj = m.groups[gIdx].items[iIdx];
        title = `编辑功能项`;
        desc = "此处修改样式仅影响当前选中项";
    }

    document.getElementById("globalPanel").style.display = "none";
    document.getElementById("propPanel").style.display = "block";
    document.getElementById("propTitle").innerText = title;
    document.getElementById("propDesc").innerText = desc;

    const content = document.getElementById("propContent");
    content.innerHTML = generatePropForm(type, targetObj, gIdx, iIdx);
}

// 退出选中，返回全局
function clearSelection() {
    selectedItem = { gIdx: -1, iIdx: -1 };
    selectedWidgetIdx = -1;
    document.querySelectorAll('.free-item, .draggable-widget').forEach(el => el.classList.remove('selected'));
    document.getElementById("widgetEditor").style.display = "none";

    document.getElementById("globalPanel").style.display = "block";
    document.getElementById("propPanel").style.display = "none";
    renderCanvas(getCurrentMenu());
}

// 动态生成属性表单
function generatePropForm(type, obj, gIdx, iIdx) {
    const input = (label, key, val, itype='text', extra='') => `
        <div class="form-row">
            <label>${label}</label>
            <input type="${itype}" value="${val || ''}" class="form-control"
                oninput="updateProp('${type}', ${gIdx}, ${iIdx}, '${key}', this.value)" ${extra}>
        </div>`;

    const color = (label, key, globalKey) => {
        const val = obj[key] || "";
        const globalVal = (type==='title') ? (val || "#FFFFFF") : (getCurrentMenu()[globalKey] || "#FFFFFF");
        const showInherit = (type !== 'title');

        return `
        <div class="form-row">
            <label>${label} ${showInherit ? `<span style="font-size:10px;color:#aaa">${val ? '(私有)' : '(继承全局)'}</span>` : ''}</label>
            <div class="color-picker-row">
                <input type="color" value="${val || globalVal}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, '${key}', this.value)">
                <input type="text" class="color-value" value="${val}" placeholder="${showInherit?'继承':'#FFFFFF'}" onchange="updateProp('${type}', ${gIdx}, ${iIdx}, '${key}', this.value)">
                ${(showInherit && val) ? `<span class="icon-btn" onclick="updateProp('${type}', ${gIdx}, ${iIdx}, '${key}', '')" title="重置">↺</span>` : ''}
            </div>
        </div>`;
    };

    const fonts = (label, key, globalKey) => {
        const val = obj[key] || "";
        const globalVal = (type==='title') ? val : getCurrentMenu()[globalKey];
        const opts = appState.assets.fonts.map(f => `<option value="${f}" ${f===val?'selected':''}>${f}</option>`).join('');
        return `
        <div class="form-row">
            <label>${label}</label>
            <select onchange="updateProp('${type}', ${gIdx}, ${iIdx}, '${key}', this.value)">
                <option value="">${type==='title' ? '-- 默认 --' : `-- 继承 (${globalVal||'默认'}) --`}</option>
                ${opts}
            </select>
        </div>`;
    };

    let html = "";

    if (type === 'title') {
        html += input("主标题内容", "title", obj.title);
        html += input("副标题内容", "sub_title", obj.sub_title);

        html += `<div class="form-row"><label>对齐方式</label>
        <select onchange="updateProp('${type}', 0, 0, 'title_align', this.value)">
            <option value="center" ${obj.title_align==='center'?'selected':''}>居中</option>
            <option value="left" ${obj.title_align==='left'?'selected':''}>居左</option>
            <option value="right" ${obj.title_align==='right'?'selected':''}>居右</option>
        </select></div>`;

        html += `<hr style="border-color:#444; margin: 20px 0;">`;
        html += `<div class="section-title">样式设置</div>`;

        html += color("主标题颜色", "title_color", "title_color");
        html += input("主标题大小 (px)", "title_size", obj.title_size, "number");
        html += fonts("主标题字体", "title_font", "title_font");

        html += color("副标题颜色", "subtitle_color", "subtitle_color");
    }
    else if (type === 'group') {
        html += input("分组标题", "title", obj.title);
        html += input("副标题", "subtitle", obj.subtitle);

        // === 修复：新增分组独立列数设置 ===
        html += input("每行列数 (Grid模式)", "layout_columns", obj.layout_columns, "number", "placeholder='默认跟随全局'");

        html += `<div class="form-row" style="background:#333;padding:10px;border-radius:4px;margin-top:10px;display:flex;align-items:center;justify-content:space-between">
            <label style="margin:0">✨ 自由排版模式</label>
            <input type="checkbox" ${obj.free_mode?'checked':''} onclick="toggleGroupFreeMode(${gIdx}, this.checked)" style="width:20px;height:20px;">
        </div>`;
        html += `<button class="btn btn-danger btn-block" style="margin-top:10px" onclick="deleteGroup(${gIdx})">删除此分组</button>`;

        html += `<hr style="border-color:#444; margin: 20px 0;">`;
        html += `<div class="section-title">样式覆盖 (独立设置)</div>`;

        html += color("标题颜色", "title_color", "group_title_color");
        html += input("标题大小 (px)", "title_size", obj.title_size, "number", "placeholder='默认'");
        html += fonts("标题字体", "title_font", "group_title_font");

        html += color("副标题颜色", "sub_color", "group_sub_color");
        html += input("副标题大小 (px)", "sub_size", obj.sub_size, "number", "placeholder='默认'");

        html += color("背景颜色", "bg_color", "group_bg_color");
        html += `<div class="form-row"><label>背景透明度 (0-255)</label><input type="range" max="255" value="${obj.bg_alpha!==undefined?obj.bg_alpha:''}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, 'bg_alpha', this.value)"></div>`;

    }
    else {
        html += input("功能名称", "name", obj.name);
        html += input("功能描述", "desc", obj.desc);
        const icons = appState.assets.icons.map(i => `<option value="${i}" ${i===obj.icon?'selected':''}>${i}</option>`).join('');
        html += `<div class="form-row"><label>图标</label><select onchange="updateProp('${type}', ${gIdx}, ${iIdx}, 'icon', this.value)"><option value="">无</option>${icons}</select></div>`;

        html += `<button class="btn btn-danger btn-block" style="margin-top:10px" onclick="deleteCurrentItemProp(${gIdx}, ${iIdx})">删除此功能项</button>`;

        html += `<hr style="border-color:#444; margin: 20px 0;">`;
        html += `<div class="section-title">样式覆盖 (独立设置)</div>`;

        html += color("名称颜色", "name_color", "item_name_color");
        html += input("名称大小 (px)", "name_size", obj.name_size, "number", "placeholder='默认'");
        html += fonts("名称字体", "name_font", "item_name_font");

        html += color("描述颜色", "desc_color", "item_desc_color");
        html += input("描述大小 (px)", "desc_size", obj.desc_size, "number", "placeholder='默认'");
        html += fonts("描述字体", "desc_font", "item_desc_font");

        html += color("背景颜色", "bg_color", "item_bg_color");
        html += `<div class="form-row"><label>背景透明度 (0-255)</label><input type="range" max="255" value="${obj.bg_alpha!==undefined?obj.bg_alpha:''}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, 'bg_alpha', this.value)"></div>`;
    }

    return html;
}

function updateProp(type, gIdx, iIdx, key, val) {
    const m = getCurrentMenu();
    let obj;
    if (type === 'title') {
        obj = m;
    } else if (type === 'group') {
        obj = m.groups[gIdx];
    } else {
        obj = m.groups[gIdx].items[iIdx];
    }

    if (val === "") {
        delete obj[key];
    } else {
        // 关键逻辑：如果是数字类型的属性，转换一下
        if (key.includes('size') || key.includes('alpha') || key.includes('layout_columns')) val = parseInt(val);
        obj[key] = val;
    }
    renderCanvas(m);
}

function deleteCurrentItemProp(gIdx, iIdx) {
    if (confirm("确定删除此项？")) {
        getCurrentMenu().groups[gIdx].items.splice(iIdx, 1);
        clearSelection();
    }
}

// --- 拖拽处理 ---
function initItemDrag(e, gIdx, iIdx, mode) {
    e.stopPropagation(); e.preventDefault();
    if (selectedItem.gIdx !== gIdx || selectedItem.iIdx !== iIdx) {
        openContextEditor('item', gIdx, iIdx);
    }
    const item = getCurrentMenu().groups[gIdx].items[iIdx];
    dragData = {
        active: true, isDragging: false, type: 'item', mode: mode,
        gIdx, iIdx, startX: e.clientX, startY: e.clientY,
        initialVals: { x: parseInt(item.x)||0, y: parseInt(item.y)||0, w: parseInt(item.w)||100, h: parseInt(item.h)||100 },
        elId: `item-${gIdx}-${iIdx}`
    };
}

function initWidgetDrag(e, idx, mode) {
    e.stopPropagation(); e.preventDefault();
    if (selectedWidgetIdx !== idx) {
        clearSelection();
        selectedWidgetIdx = idx;
        const els = document.querySelectorAll('.draggable-widget');
        if (els[idx]) els[idx].classList.add('selected');
        document.getElementById("globalPanel").style.display = "block";
        updateWidgetEditor(getCurrentMenu());
    }
    const w = getCurrentMenu().custom_widgets[idx];
    dragData = {
        active: true, isDragging: false, type: 'widget', mode: mode, targetIdx: idx,
        startX: e.clientX, startY: e.clientY,
        initialVals: { x: parseInt(w.x)||0, y: parseInt(w.y)||0, width: parseInt(w.width)||100, height: parseInt(w.height)||100 }
    };
}

function handleGlobalMouseMove(e) {
    if (!dragData.active) return;
    e.preventDefault();
    const scale = viewState.scale || 1;
    const dx = (e.clientX - dragData.startX) / scale;
    const dy = (e.clientY - dragData.startY) / scale;

    if (!dragData.isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) dragData.isDragging = true;
    if (!dragData.isDragging) return;

    if (dragData.type === 'item') {
        const el = document.getElementById(dragData.elId);
        if (el) {
            if (dragData.mode === 'move') { el.style.left = (dragData.initialVals.x + dx) + 'px'; el.style.top = (dragData.initialVals.y + dy) + 'px'; }
            else { el.style.width = Math.max(20, dragData.initialVals.w + dx) + 'px'; el.style.height = Math.max(20, dragData.initialVals.h + dy) + 'px'; }
        }
    } else if (dragData.type === 'widget') {
        const els = document.querySelectorAll(".draggable-widget");
        const el = els[dragData.targetIdx];
        if (el) {
            if (dragData.mode === 'move') { el.style.left = (dragData.initialVals.x + dx) + 'px'; el.style.top = (dragData.initialVals.y + dy) + 'px'; }
            else { el.style.width = Math.max(20, (dragData.initialVals.width||100) + dx) + 'px'; el.style.height = Math.max(20, (dragData.initialVals.height||100) + dy) + 'px'; }
        }
    }
}

function handleGlobalMouseUp(e) {
    if (!dragData.active) return;
    if (dragData.isDragging) {
        const m = getCurrentMenu();
        const scale = viewState.scale || 1;
        const dx = (e.clientX - dragData.startX) / scale;
        const dy = (e.clientY - dragData.startY) / scale;

        if (dragData.type === 'item') {
            const item = m.groups[dragData.gIdx].items[dragData.iIdx];
            if (dragData.mode === 'move') { item.x = Math.round(dragData.initialVals.x + dx); item.y = Math.round(dragData.initialVals.y + dy); }
            else { item.w = Math.max(20, Math.round(dragData.initialVals.w + dx)); item.h = Math.max(20, Math.round(dragData.initialVals.h + dy)); }
            renderCanvas(m);
        } else if (dragData.type === 'widget') {
            const w = m.custom_widgets[dragData.targetIdx];
            if (dragData.mode === 'move') { w.x = Math.round(dragData.initialVals.x + dx); w.y = Math.round(dragData.initialVals.y + dy); }
            else { w.width = Math.max(20, Math.round((dragData.initialVals.width||100) + dx)); w.height = Math.max(20, Math.round((dragData.initialVals.height||100) + dy)); }
            updateWidgetEditor(m);
        }
    } else {
        if (dragData.type === 'item' && dragData.mode === 'move') {
            openContextEditor('item', dragData.gIdx, dragData.iIdx);
        }
    }
    dragData.active = false;
    dragData.isDragging = false;
}

function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const m = getCurrentMenu();
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedWidgetIdx !== -1) deleteWidget();
        else if (selectedItem.gIdx !== -1) deleteCurrentItemProp(selectedItem.gIdx, selectedItem.iIdx);
    }
    if ((e.ctrlKey || e.metaKey)) {
        if (e.key === 'c') {
            if (selectedWidgetIdx !== -1) appState.clipboard = { type: 'widget', data: {...m.custom_widgets[selectedWidgetIdx]} };
            else if (selectedItem.gIdx !== -1) appState.clipboard = { type: 'item', data: {...m.groups[selectedItem.gIdx].items[selectedItem.iIdx]} };
        }
        if (e.key === 'v') {
            if (!appState.clipboard) return;
            const d = {...appState.clipboard.data};
            if (appState.clipboard.type === 'widget') {
                d.x = (parseInt(d.x)||0)+20; d.y = (parseInt(d.y)||0)+20; m.custom_widgets.push(d); selectedWidgetIdx = m.custom_widgets.length-1;
            } else if (appState.clipboard.type === 'item') {
                let tG = selectedItem.gIdx !== -1 ? selectedItem.gIdx : 0;
                if (m.groups[tG].free_mode) { d.x = (parseInt(d.x)||0)+20; d.y = (parseInt(d.y)||0)+20; }
                m.groups[tG].items.push(d);
            }
            renderCanvas(m);
        }
    }
}
function toggleGroupFreeMode(gIdx, isFree) {
    const m = getCurrentMenu(); const g = m.groups[gIdx];
    if (isFree && !g.free_mode) {
        g.items.forEach((item, iIdx) => {
            const el = document.getElementById(`item-${gIdx}-${iIdx}`);
            if (el) { item.x = el.offsetLeft; item.y = el.offsetTop; item.w = el.offsetWidth; item.h = el.offsetHeight; }
            else { item.x = 20 + (iIdx%3)*115; item.y = 20 + Math.floor(iIdx/3)*115; item.w = 100; item.h = 100; }
        });
    }
    g.free_mode = isFree; renderAll(); openContextEditor('group', gIdx, -1);
}
function renderSidebarGroupList(m) {
    const list = document.getElementById("groupList"); list.innerHTML = "";
    (m.groups || []).forEach((g, idx) => {
        const div = document.createElement("div"); div.className = "group-item";
        div.innerHTML = `<div style="flex:1;overflow:hidden;"><div style="font-weight:500;">${g.title}${g.free_mode?' <span style="font-size:9px;background:#0e639c;padding:1px 3px;border-radius:2px;">自由</span>':''}</div></div><div class="group-actions"><span class="icon-btn" onclick="addItem(${idx})">+</span><span class="icon-btn" onclick="moveGroup(${idx}, -1)">↑</span><span class="icon-btn" onclick="moveGroup(${idx}, 1)">↓</span></div>`;
        div.firstElementChild.onclick = () => openContextEditor('group', idx, -1);
        list.appendChild(div);
    });
}
function addItem(gIdx) {
    const g = getCurrentMenu().groups[gIdx]; let nextY = 20;
    if (g.free_mode) { let max = 0; g.items.forEach(i => {const b=(parseInt(i.y)||0)+(parseInt(i.h)||100);if(b>max)max=b;}); if(max>0)nextY=max+15; }
    g.items.push({ name: "新功能", desc: "...", icon: "", x: 20, y: nextY, w: 200, h: 80 }); renderCanvas(getCurrentMenu());
}
function addGroup() { getCurrentMenu().groups.push({ title: "新分组", subtitle: "", items: [], free_mode: false }); renderAll(); }
function deleteGroup(idx) { if (confirm("删除此分组？")) { getCurrentMenu().groups.splice(idx, 1); clearSelection(); } }
function moveGroup(idx, dir) { const g = getCurrentMenu().groups; if (idx+dir<0 || idx+dir>=g.length) return; [g[idx], g[idx+dir]] = [g[idx+dir], g[idx]]; renderAll(); }
async function uploadFile(type, inp) {
    const f = inp.files[0]; if (!f) return; const d = new FormData(); d.append("type", type); d.append("file", f);
    if ((await api("/upload", "POST", d)).status === 'ok') { alert("上传成功"); if(type==='font') initFonts(); await loadAssets(); renderAll(); inp.value = ""; }
}
function addWidget(type) {
    const m = getCurrentMenu();
    if(type==='image') m.custom_widgets.push({ type:'image', content:'', x:50, y:50, width:100, height:100 });
    else m.custom_widgets.push({ type:'text', text:"新文本", x:50, y:50, size:40, color:"#FFFFFF" });
    selectedWidgetIdx = m.custom_widgets.length-1; renderAll();
}
function updateWidget(key, val) { if (selectedWidgetIdx===-1) return; const m = getCurrentMenu(); const w = m.custom_widgets[selectedWidgetIdx]; if(['size','width','height'].includes(key)) w[key]=parseInt(val); else w[key]=val; renderCanvas(m); }
function updateWidgetEditor(m) {
    const ed = document.getElementById("widgetEditor"); if (selectedWidgetIdx===-1) { ed.style.display="none"; return; } ed.style.display="block";
    const w = m.custom_widgets[selectedWidgetIdx];
    if (w.type === 'image') { document.getElementById("wEdit-text").style.display="none"; document.getElementById("wEdit-image").style.display="block"; document.getElementById("widW").value=w.width; document.getElementById("widH").value=w.height; renderSelect("widImgSelect", appState.assets.widget_imgs, w.content, "选择图片"); }
    else { document.getElementById("wEdit-image").style.display="none"; document.getElementById("wEdit-text").style.display="block"; document.getElementById("widText").value=w.text; document.getElementById("widSize").value=w.size; document.getElementById("widColor").value=w.color; }
}
function deleteWidget() { if(selectedWidgetIdx===-1) return; if(confirm("删除组件?")) { getCurrentMenu().custom_widgets.splice(selectedWidgetIdx, 1); selectedWidgetIdx=-1; renderAll(); } }
function updateMenuMeta(key, val) { getCurrentMenu()[key] = val; renderAll(); }
function updateBg(val) { updateMenuMeta('background', val); }
function updateColor(key, val, src) { if (src === 'text' && !val.startsWith('#')) val = '#' + val; updateMenuMeta(key, val); }
function initFonts() { (appState.assets.fonts || []).forEach(n => { const id="f-"+n; if(!document.getElementById(id)) { const s=document.createElement("style"); s.id=id; s.textContent=`@font-face { font-family: '${cssFont(n)}'; src: url('/fonts/${n}'); }`; document.head.appendChild(s); } }); }
function cssFont(n) { return n ? n.replace(/[^a-zA-Z0-9_]/g, '_') : 'sans-serif'; }