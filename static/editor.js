const appState = {
    fullConfig: { menus: [] },
    currentMenuId: null,
    assets: { backgrounds: [], icons: [], widget_imgs: [], fonts: [] },
    clipboard: null
};

// 拖拽核心状态
let dragData = {
    active: false,
    isDragging: false,
    mode: 'move', // 'move' or 'resize'
    type: null,   // 'item' or 'widget'

    // 数据索引
    gIdx: -1, iIdx: -1, targetIdx: -1,

    // 坐标计算
    startX: 0, startY: 0,
    initialVals: {}, // {x, y, w, h, size}

    // 缓存 DOM 元素
    cachedEl: null
};

// 渲染锁
let rafLock = false;

let viewState = { scale: 1 };
let selectedWidgetIdx = -1;
let selectedItem = { gIdx: -1, iIdx: -1 };

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([loadAssets(), loadConfig()]);
        initFonts();
        if (appState.fullConfig.menus && appState.fullConfig.menus.length > 0) {
            switchMenu(appState.fullConfig.menus[0].id);
        } else {
            createNewMenu();
        }

        window.addEventListener('mouseup', handleGlobalMouseUp);
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('keydown', handleKeyDown);

        const cvsWrapper = document.getElementById('canvas-wrapper');
        cvsWrapper.addEventListener('mousedown', (e) => {
            if (e.target.id === 'canvas-wrapper' || e.target.id === 'canvas' || e.target.classList.contains('group-wrapper')) {
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
    const newMenu = {
        id: "m_" + Date.now(), name: "新菜单", enabled: true, title: "标题", groups: [], custom_widgets: [],
        layout_columns: 3, group_bg_color: "#000000", group_bg_alpha: 50, item_bg_color: "#FFFFFF", item_bg_alpha: 20,
        use_canvas_size: false, canvas_width: 1000, canvas_height: 2000,
        shadow_enabled: false, shadow_color: "#000000", shadow_offset_x: 2, shadow_offset_y: 2, shadow_radius: 2,
        export_scale: 1.0
    };
    if (!appState.fullConfig.menus) appState.fullConfig.menus = [];
    appState.fullConfig.menus.push(newMenu);
    switchMenu(newMenu.id);
}

function duplicateMenu() {
    const current = getCurrentMenu();
    if (!current) return;
    const newMenu = JSON.parse(JSON.stringify(current));
    newMenu.id = "m_" + Date.now();
    newMenu.name = newMenu.name + " (副本)";
    appState.fullConfig.menus.push(newMenu);
    switchMenu(newMenu.id);
    alert(`✅ 已复制模板：${newMenu.name}`);
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
    setValue("columnInput", m.layout_columns || 3);
    setValue("alignSelect", m.title_align || "center");
    setValue("cvsW", m.canvas_width || 1000);
    setValue("cvsH", m.canvas_height || 2000);
    const canvasModeSel = document.getElementById("canvasMode");
    if (canvasModeSel) canvasModeSel.value = m.use_canvas_size ? "true" : "false";

    setValue("expScaleInput", m.export_scale || 1.0);

    setValue("cvsColorP", m.canvas_color || "#1e1e1e"); setValue("cvsColorT", m.canvas_color || "#1e1e1e");
    renderSelect("bgSelect", appState.assets.backgrounds, m.background, "无背景");
    setValue("bgFit", m.bg_fit_mode || "cover_w");

    setValue("boxColor", m.group_bg_color || "#000000"); setValue("boxBlur", m.group_blur_radius || 0); setValue("boxAlpha", m.group_bg_alpha !== undefined ? m.group_bg_alpha : 50); document.getElementById("alphaVal").innerText = m.group_bg_alpha !== undefined ? m.group_bg_alpha : 50;
    setValue("iboxColor", m.item_bg_color || "#FFFFFF"); setValue("iboxBlur", m.item_blur_radius || 0); setValue("iboxAlpha", m.item_bg_alpha !== undefined ? m.item_bg_alpha : 20); document.getElementById("ialphaVal").innerText = m.item_bg_alpha !== undefined ? m.item_bg_alpha : 20;

    renderSelect("fTitle", appState.assets.fonts, m.title_font); renderSelect("fGTitle", appState.assets.fonts, m.group_title_font); renderSelect("fGSub", appState.assets.fonts, m.group_sub_font); renderSelect("fIName", appState.assets.fonts, m.item_name_font); renderSelect("fIDesc", appState.assets.fonts, m.item_desc_font);

    document.getElementById("shadowEn").checked = !!m.shadow_enabled;
    setValue("shadowColP", m.shadow_color || "#000000"); setValue("shadowColT", m.shadow_color || "#000000");
    setValue("shadowX", m.shadow_offset_x !== undefined ? m.shadow_offset_x : 2);
    setValue("shadowY", m.shadow_offset_y !== undefined ? m.shadow_offset_y : 2);
    setValue("shadowR", m.shadow_radius !== undefined ? m.shadow_radius : 2);

    const map = {'title_color': ['cTitleP', 'cTitleT'], 'subtitle_color': ['cSubP', 'cSubT'], 'group_title_color': ['cGTitleP', 'cGTitleT'], 'group_sub_color': ['cGSubP', 'cGSubT'], 'item_name_color': ['cItemNameP', 'cItemNameT'], 'item_desc_color': ['cItemDescP', 'cItemDescT']};
    for (const [k, ids] of Object.entries(map)) { const val = m[k] || "#FFFFFF"; ids.forEach(id => { if (document.getElementById(id)) document.getElementById(id).value = val; }); }
}
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function renderSelect(id, opts, sel, def) { const el = document.getElementById(id); if (!el) return; el.innerHTML = (def ? `<option value="">${def}</option>` : '') + (opts || []).map(o => `<option value="${o}" ${o===sel?'selected':''}>${o}</option>`).join(''); }

function renderCanvas(m) {
    const cvsWrapper = document.getElementById("canvas-wrapper");
    const cvs = document.getElementById("canvas");
    cvs.style.pointerEvents = "auto";

    const useFixedSize = String(m.use_canvas_size) === 'true';
    const targetW = parseInt(m.canvas_width) || 1000;
    const targetH = parseInt(m.canvas_height) || 2000;

    const editorWidth = cvsWrapper.parentElement.clientWidth - 120;
    let scale = 1;
    if (editorWidth < targetW) {
        scale = editorWidth / targetW;
    }
    viewState.scale = scale;

    cvsWrapper.style.width = targetW + "px";
    cvs.style.width = targetW + "px";

    cvs.style.transform = `scale(${scale})`;
    cvs.style.transformOrigin = "top left";
    cvs.style.minHeight = "800px";

    if (m.background && !useFixedSize) {
        const tmpImg = new Image();
        tmpImg.src = `/raw_assets/backgrounds/${m.background}`;
        tmpImg.onload = () => {
             const ratio = tmpImg.height / tmpImg.width;
             const bgFitHeight = targetW * ratio;
             if (cvs.offsetHeight < bgFitHeight) {
                 cvs.style.minHeight = bgFitHeight + "px";
                 if (!useFixedSize) {
                     cvsWrapper.style.height = (cvs.offsetHeight * scale) + "px";
                 }
             }
        };
    }

    if (useFixedSize) {
        cvs.style.height = targetH + "px";
        cvs.style.minHeight = targetH + "px";
        cvsWrapper.style.width = (targetW * scale) + "px";
        cvsWrapper.style.height = (targetH * scale) + "px";
    } else {
        cvs.style.height = "auto";
        cvsWrapper.style.width = (targetW * scale) + "px";
        cvsWrapper.style.height = "auto";
    }

    cvs.style.backgroundColor = m.canvas_color || "#1e1e1e";
    cvs.style.backgroundImage = m.background ? `url('/raw_assets/backgrounds/${m.background}')` : "none";
    if (m.background) {
        cvs.style.backgroundRepeat = "no-repeat";
        cvs.style.backgroundSize = m.bg_fit_mode === "custom" ? `${m.bg_custom_width}px ${m.bg_custom_height}px` : "100% auto";
        cvs.style.backgroundPosition = "top center";
    }

    let shadowCss = 'none';
    if (m.shadow_enabled) {
        const sx = m.shadow_offset_x || 2;
        const sy = m.shadow_offset_y || 2;
        const sr = m.shadow_radius || 2;
        const sc = m.shadow_color || '#000000';
        shadowCss = `${sx}px ${sy}px ${sr}px ${sc}`;
    }

    const gfTitle = cssFont(m.title_font);
    const titleAlign = m.title_align || 'center';

    let html = `
        <div class="header-area title-clickable" style="text-align:${titleAlign}; text-shadow:${shadowCss};"
             onclick="openContextEditor('title')" title="点击修改标题">
            <div style="color:${m.title_color || '#FFFFFF'}; font-family:'${gfTitle}'; font-size:${m.title_size || 60}px">${m.title || ''}</div>
            <div style="color:${m.subtitle_color || '#DDDDDD'}; font-family:'${gfTitle}'; font-size:${(m.title_size || 60) * 0.5}px">${m.sub_title || ''}</div>
        </div>
    `;

    (m.groups || []).forEach((g, gIdx) => {
        const gTitleFont = cssFont(getStyle(g, 'title_font', 'group_title_font'));
        const gSubFont = cssFont(getStyle(g, 'sub_font', 'group_sub_font'));
        const gTitleColor = getStyle(g, 'title_color', 'group_title_color');
        const gSubColor = getStyle(g, 'sub_color', 'group_sub_color');
        const gTitleSize = getStyle(g, 'title_size', 'group_title_size') || 30;
        const gSubSize = get_style(g, 'sub_size', 'group_sub_size') || 18;
        const gBgColor = getStyle(g, 'bg_color', 'group_bg_color') || "#000000";
        const gBgAlpha = g.bg_alpha !== undefined ? g.bg_alpha : (m.group_bg_alpha !== undefined ? m.group_bg_alpha : 50);
        const gRgba = hexToRgba(gBgColor, gBgAlpha / 255);
        const gBlur = m.group_blur_radius > 0 ? `backdrop-filter: blur(${m.group_blur_radius}px);` : '';
        const freeMode = g.free_mode === true;
        let contentHeight = "auto";
        if (freeMode) {
            let maxBottom = 0;
            (g.items || []).forEach(item => { const b = (parseInt(item.y)||0) + (parseInt(item.h)||100); if (b > maxBottom) maxBottom = b; });
            contentHeight = Math.max(Number(g.min_height) || 100, maxBottom + 20) + "px";
        }
        const overflowStyle = freeMode ? 'overflow:visible' : 'overflow:hidden';
        const cols = g.layout_columns || m.layout_columns || 3;
        const gridStyle = `grid-template-columns: repeat(${cols}, 1fr);`;

        html += `
        <div class="group-wrapper" style="margin-bottom:30px;">
            <div class="group-header-wrap" onclick="openContextEditor('group', ${gIdx}, -1)" style="padding:0 0 10px 10px; cursor:pointer; text-shadow:${shadowCss}; display:flex; align-items:center;">
                <span style="color:${gTitleColor}; font-family:'${gTitleFont}'; font-size:${gTitleSize}px">${g.title}</span>
                ${g.subtitle ? `<span style="color:${gSubColor}; font-family:'${gSubFont}'; font-size:${gSubSize}px; margin-left:10px;">${g.subtitle}</span>` : ''}
            </div>
            <div class="group-content-box" id="group-content-${gIdx}" style="background-color:${gRgba}; ${gBlur}; height:${contentHeight}; position:relative; ${overflowStyle}; border-radius:15px;">
                <div class="${freeMode ? 'free-container' : 'grid-container'}" style="${freeMode ? '' : gridStyle}">`;

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

            let iconHtml = '';
            if (item.icon) {
                const iconHeight = getStyle(item, 'icon_size', null);
                const iconStyle = iconHeight ? `style="height: ${iconHeight}px; width: auto; max-width: none;"` : '';
                iconHtml = `<img src="/raw_assets/icons/${item.icon}" class="item-icon" ${iconStyle}>`;
            }

            const descText = (item.desc || '').replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const textContentHtml = `
                <div class="item-text-content" style="text-shadow:${shadowCss};">
                    <div style="color:${iNameColor}; font-family:'${iNameFont}'; font-size:${iNameSize}px;">${item.name || ''}</div>
                    <div style="color:${iDescColor}; font-family:'${iDescFont}'; font-size:${iDescSize}px; margin-top: 5px; white-space: pre-wrap; word-break: break-all;">${descText}</div>
                </div>`;

            if (freeMode) {
                const isSel = selectedItem.gIdx === gIdx && selectedItem.iIdx === iIdx;
                const tx = parseInt(item.x)||0; const ty = parseInt(item.y)||0; const tw = parseInt(item.w)||200; const th = parseInt(item.h)||80;
                // 添加 resize-handle 的事件处理，注意 event.stopPropagation
                html += `
                <div class="free-item ${isSel ? 'selected' : ''}"
                     id="item-${gIdx}-${iIdx}"
                     style="left:${tx}px; top:${ty}px; width:${tw}px; height:${th}px; background-color:${iRgba}; ${iBlur};"
                     onmousedown="initItemDrag(event, ${gIdx}, ${iIdx}, 'move')">
                     ${iconHtml} ${textContentHtml}
                     ${isSel ? `<div class="resize-handle" onmousedown="initItemDrag(event, ${gIdx}, ${iIdx}, 'resize')"></div>` : ''}
                </div>`;
            } else {
                html += `
                <div class="grid-item" style="background-color:${iRgba}; ${iBlur}; height:90px;" onclick="openContextEditor('item', ${gIdx}, ${iIdx})">
                    ${iconHtml} ${textContentHtml}
                </div>`;
            }
        });

        if (!freeMode) {
            html += `<div class="grid-item add-item-btn" onclick="addItem(${gIdx})"><span>+</span></div>`;
        }
        html += `</div></div></div>`;
    });
    cvs.innerHTML = html;
    renderWidgets(cvs, m, shadowCss);

    if (!useFixedSize) {
        requestAnimationFrame(() => {
             cvsWrapper.style.height = (cvs.offsetHeight * scale) + "px";
        });
    }
}

function renderWidgets(container, m, shadowCss) {
    (m.custom_widgets || []).forEach((wid, idx) => {
        const el = document.createElement("div");
        el.className = "draggable-widget";
        el.id = `widget-${idx}`;
        if (selectedWidgetIdx === idx) el.classList.add("selected");

        el.style.left = (parseInt(wid.x)||0) + "px";
        el.style.top = (parseInt(wid.y)||0) + "px";

        if (wid.type === 'image') {
            const imgUrl = wid.content ? `/raw_assets/widgets/${wid.content}` : '';
            el.innerHTML = imgUrl ? `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover;pointer-events:none">` : `无图`;
            el.style.width = (parseInt(wid.width)||100) + "px";
            el.style.height = (parseInt(wid.height)||100) + "px";
        } else {
            // [字体修复]: 强制给字体加引号，防止数字开头的字体失效
            el.innerText = wid.text || "Text";
            el.style.fontSize = (parseInt(wid.size)||40) + "px";
            el.style.color = wid.color || "#FFF";
            if (wid.font) {
                el.style.fontFamily = `"${cssFont(wid.font)}"`;
            }
            el.style.textShadow = shadowCss;
        }

        el.onmousedown = (e) => initWidgetDrag(e, idx, 'move');

        const handle = document.createElement("div");
        handle.className = "resize-handle";
        handle.onmousedown = (e) => initWidgetDrag(e, idx, 'resize');
        el.appendChild(handle);

        container.appendChild(el);
    });
}
function hexToRgba(hex, alpha) { if(!hex) return `rgba(0,0,0,${alpha})`; const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16); return `rgba(${r},${g},${b},${alpha})`; }

// --- 统一的选中逻辑 ---
function selectWidget(idx) {
    if (selectedWidgetIdx !== idx) {
        selectedItem = { gIdx: -1, iIdx: -1 };
        selectedWidgetIdx = idx;

        document.getElementById("propPanel").style.display = "none";
        document.getElementById("globalPanel").style.display = "block";

        renderCanvas(getCurrentMenu());
        updateWidgetEditor(getCurrentMenu());
    }
}

function openContextEditor(type, gIdx, iIdx) {
    if (dragData.active && dragData.isDragging) return;

    selectedWidgetIdx = -1;
    if (type === 'item') {
        selectedItem = { gIdx, iIdx };
    } else {
        selectedItem = { gIdx: -1, iIdx: -1 };
    }

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
    document.getElementById("propContent").innerHTML = generatePropForm(type, targetObj, gIdx, iIdx);
    renderCanvas(getCurrentMenu());
}

function clearSelection() {
    selectedItem = { gIdx: -1, iIdx: -1 };
    selectedWidgetIdx = -1;
    document.getElementById("widgetEditor").style.display = "none";
    document.getElementById("globalPanel").style.display = "block";
    document.getElementById("propPanel").style.display = "none";
    renderCanvas(getCurrentMenu());
}

function generatePropForm(type, obj, gIdx, iIdx) {
    const input = (label, key, val, itype='text', extra='') => `
        <div class="form-row">
            <label>${label}</label>
            <input type="${itype}" value="${val || ''}" class="form-control"
                oninput="updateProp('${type}', ${gIdx}, ${iIdx}, '${key}', this.value)" ${extra}>
        </div>`;
    const textarea = (label, key, val) => `
        <div class="form-row">
            <label>${label}</label>
            <textarea class="form-control" style="height: 80px; resize: vertical;"
                oninput="updateProp('${type}', ${gIdx}, ${iIdx}, '${key}', this.value)">${val || ''}</textarea>
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
        const globalVal = (type==='title') ? val : (getCurrentMenu()[globalKey] || "");
        const opts = (appState.assets.fonts || []).map(f => `<option value="${f}" ${f===val?'selected':''}>${f}</option>`).join('');
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
    } else if (type === 'group') {
        html += input("分组标题", "title", obj.title);
        html += input("副标题", "subtitle", obj.subtitle);
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
    } else {
        html += input("功能名称", "name", obj.name);
        html += textarea("功能描述", "desc", obj.desc);

        const icons = (appState.assets.icons || []).map(i => `<option value="${i}" ${i===obj.icon?'selected':''}>${i}</option>`).join('');
        html += `
        <div class="form-row">
            <label>图标</label>
            <div style="display:flex; gap:5px;">
                <select style="flex:1" onchange="updateProp('${type}', ${gIdx}, ${iIdx}, 'icon', this.value)">
                    <option value="">无</option>
                    ${icons}
                </select>
                <button class="btn btn-secondary" onclick="document.getElementById('itemIconUp').click()" title="上传新图标">⬆</button>
                <input type="file" id="itemIconUp" hidden accept="image/*" onchange="uploadFile('icon', this)">
            </div>
        </div>`;

        if (obj.icon) {
            html += input("图标高度 (px)", "icon_size", obj.icon_size, "number", "placeholder='默认自适应'");
        }

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
    if (type === 'title') { obj = m; }
    else if (type === 'group') { obj = m.groups[gIdx]; }
    else { obj = m.groups[gIdx].items[iIdx]; }

    if (val === "") {
        delete obj[key];
    } else {
        if (['title_size', 'sub_size', 'name_size', 'desc_size', 'bg_alpha', 'layout_columns', 'width', 'height', 'x', 'y', 'w', 'h', 'group_blur_radius', 'item_blur_radius', 'canvas_width', 'canvas_height', 'icon_size'].includes(key)) {
            val = parseInt(val);
        }
        obj[key] = val;
    }

    if (key === 'icon') {
        openContextEditor(type, gIdx, iIdx);
    } else {
        renderCanvas(m);
    }
}

function deleteCurrentItemProp(gIdx, iIdx) {
    if (confirm("确定删除此项？")) {
        getCurrentMenu().groups[gIdx].items.splice(iIdx, 1);
        clearSelection();
    }
}

// -------------------------------------------------------------
//  核心拖拽逻辑 (点击即拖 + 高性能 + 文本字号优化)
// -------------------------------------------------------------

function initItemDrag(e, gIdx, iIdx, mode) {
    e.stopPropagation(); e.preventDefault();
    if (selectedItem.gIdx !== gIdx || selectedItem.iIdx !== iIdx) {
        openContextEditor('item', gIdx, iIdx);
    }
    const item = getCurrentMenu().groups[gIdx].items[iIdx];
    const elId = `item-${gIdx}-${iIdx}`;

    dragData = {
        active: true,
        isDragging: true,
        type: 'item',
        mode: mode,
        gIdx, iIdx,
        startX: e.clientX,
        startY: e.clientY,
        initialVals: { x: parseInt(item.x)||0, y: parseInt(item.y)||0, w: parseInt(item.w)||200, h: parseInt(item.h)||80 },
        cachedEl: document.getElementById(elId)
    };
}

function initWidgetDrag(e, idx, mode) {
    e.stopPropagation(); e.preventDefault();

    selectWidget(idx); // 确保选中

    const w = getCurrentMenu().custom_widgets[idx];
    const elId = `widget-${idx}`;

    // 缓存数据，如果是文本则缓存字号
    dragData = {
        active: true,
        isDragging: true,
        type: 'widget',
        mode: mode,
        targetIdx: idx,
        startX: e.clientX,
        startY: e.clientY,
        initialVals: {
            x: parseInt(w.x)||0,
            y: parseInt(w.y)||0,
            width: parseInt(w.width)||100,
            height: parseInt(w.height)||100,
            size: parseInt(w.size)||40 // 缓存初始字号
        },
        cachedEl: document.getElementById(elId)
    };
}

function handleGlobalMouseMove(e) {
    if (!dragData.active) return;
    e.preventDefault();

    if (rafLock) return;

    rafLock = true;
    requestAnimationFrame(() => {
        const scale = viewState.scale || 1;
        const dx = (e.clientX - dragData.startX) / scale;
        const dy = (e.clientY - dragData.startY) / scale;
        const targetEl = dragData.cachedEl;

        if (targetEl) {
            if (dragData.mode === 'move') {
                targetEl.style.left = (dragData.initialVals.x + dx) + 'px';
                targetEl.style.top = (dragData.initialVals.y + dy) + 'px';
            } else {
                // resize 模式
                const m = getCurrentMenu();
                const widget = m.custom_widgets[dragData.targetIdx];

                // [字号拖拽修复]: 支持向右或向下拖动来放大
                if (dragData.type === 'widget' && widget.type === 'text') {
                    // 取 dx 和 dy 的最大值，操作更顺滑
                    let delta = Math.max(dx, dy);
                    let newSize = Math.max(10, dragData.initialVals.size + delta);
                    targetEl.style.fontSize = newSize + "px";

                    const sizeInp = document.getElementById("widSize");
                    if(sizeInp) sizeInp.value = Math.round(newSize);
                } else {
                    const propW = dragData.type === 'widget' ? 'width' : 'w';
                    const propH = dragData.type === 'widget' ? 'height' : 'h';
                    const wVal = dragData.initialVals[propW] || 100;
                    const hVal = dragData.initialVals[propH] || 100;

                    targetEl.style.width = Math.max(20, wVal + dx) + 'px';
                    targetEl.style.height = Math.max(20, hVal + dy) + 'px';
                }
            }
        }
        rafLock = false;
    });
}

function handleGlobalMouseUp(e) {
    if (!dragData.active) return;

    // 松开鼠标时同步数据
    const m = getCurrentMenu();
    const scale = viewState.scale || 1;
    const dx = (e.clientX - dragData.startX) / scale;
    const dy = (e.clientY - dragData.startY) / scale;

    if (dragData.type === 'item') {
        const item = m.groups[dragData.gIdx].items[dragData.iIdx];
        if (dragData.mode === 'move') {
            item.x = Math.round(dragData.initialVals.x + dx);
            item.y = Math.round(dragData.initialVals.y + dy);
        } else {
            item.w = Math.max(20, Math.round(dragData.initialVals.w + dx));
            item.h = Math.max(20, Math.round(dragData.initialVals.h + dy));
        }
    } else if (dragData.type === 'widget') {
        const w = m.custom_widgets[dragData.targetIdx];
        if (dragData.mode === 'move') {
            w.x = Math.round(dragData.initialVals.x + dx);
            w.y = Math.round(dragData.initialVals.y + dy);
        } else {
            // 保存 Resize 结果
            if (w.type === 'text') {
                let delta = Math.max(dx, dy);
                w.size = Math.max(10, Math.round(dragData.initialVals.size + delta));
            } else {
                w.width = Math.max(20, Math.round((dragData.initialVals.width||100) + dx));
                w.height = Math.max(20, Math.round((dragData.initialVals.height||100) + dy));
            }
        }
        updateWidgetEditor(m);
    }

    dragData.active = false;
    dragData.isDragging = false;
    dragData.cachedEl = null;
    rafLock = false;
}

// -------------------------------------------------------------

function handleKeyDown(e) {
    if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.key === 'Backspace') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const m = getCurrentMenu();
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedWidgetIdx !== -1) deleteWidget();
        else if (selectedItem.gIdx !== -1) deleteCurrentItemProp(selectedItem.gIdx, selectedItem.iIdx);
    }
    if ((e.ctrlKey || e.metaKey)) {
        if (e.key === 'c') {
            if (selectedWidgetIdx !== -1) appState.clipboard = { type: 'widget', data: JSON.parse(JSON.stringify(m.custom_widgets[selectedWidgetIdx])) };
            else if (selectedItem.gIdx !== -1) appState.clipboard = { type: 'item', data: JSON.parse(JSON.stringify(m.groups[selectedItem.gIdx].items[selectedItem.iIdx])) };
        }
        if (e.key === 'v') {
            if (!appState.clipboard) return;
            const d = JSON.parse(JSON.stringify(appState.clipboard.data));
            if (appState.clipboard.type === 'widget') {
                d.x = (parseInt(d.x)||0)+20; d.y = (parseInt(d.y)||0)+20; m.custom_widgets.push(d); selectedWidgetIdx = m.custom_widgets.length-1;
            } else if (appState.clipboard.type === 'item') {
                let tG = selectedItem.gIdx !== -1 ? selectedItem.gIdx : 0;
                if(m.groups.length === 0) return;
                if (m.groups[tG].free_mode) { d.x = (parseInt(d.x)||0)+20; d.y = (parseInt(d.y)||0)+20; }
                m.groups[tG].items.push(d);
            }
            renderAll();
        }
    }
}

function toggleGroupFreeMode(gIdx, isFree) {
    const m = getCurrentMenu(); const g = m.groups[gIdx];
    g.free_mode = isFree;
    renderAll();
    openContextEditor('group', gIdx, -1);
}

function renderSidebarGroupList(m) {
    const list = document.getElementById("groupList");
    list.innerHTML = "";
    (m.groups || []).forEach((g, idx) => {
        const div = document.createElement("div"); div.className = "group-item";
        div.innerHTML = `<div style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;"><div style="font-weight:500;">${g.title}${g.free_mode?' <span style="font-size:9px;background:#0e639c;padding:1px 3px;border-radius:2px;">自由</span>':''}</div></div><div class="group-actions"><span class="icon-btn" onclick="addItem(${idx})">+</span><span class="icon-btn" onclick="moveGroup(${idx}, -1)">↑</span><span class="icon-btn" onclick="moveGroup(${idx}, 1)">↓</span></div>`;
        div.firstElementChild.onclick = () => openContextEditor('group', idx, -1);
        list.appendChild(div);
    });
}

function addItem(gIdx) {
    const g = getCurrentMenu().groups[gIdx];
    let nextY = 20;
    if (g.free_mode) { let max = 0; g.items.forEach(i => {const b=(parseInt(i.y)||0)+(parseInt(i.h)||100);if(b>max)max=b;}); if(max>0)nextY=max+15; }
    g.items.push({ name: "新功能", desc: "...", icon: "", x: 20, y: nextY, w: 200, h: 80 });
    renderAll();
}

function addGroup() { getCurrentMenu().groups.push({ title: "新分组", subtitle: "", items: [], free_mode: false }); renderAll(); }
function deleteGroup(idx) { if (confirm("删除此分组？")) { getCurrentMenu().groups.splice(idx, 1); clearSelection(); } }
function moveGroup(idx, dir) { const g = getCurrentMenu().groups; if (idx+dir<0 || idx+dir>=g.length) return; [g[idx], g[idx+dir]] = [g[idx+dir], g[idx]]; renderAll(); }

async function uploadFile(type, inp) {
    const f = inp.files[0]; if (!f) return;
    const d = new FormData(); d.append("type", type); d.append("file", f);
    try {
        await api("/upload", "POST", d);
        alert("上传成功");
        await loadAssets();
        if(type==='font') initFonts();

        renderAll();

        if (type === 'icon' && selectedItem.gIdx !== -1) {
            openContextEditor('item', selectedItem.gIdx, selectedItem.iIdx);
        }
        if (type === 'widget_img' && selectedWidgetIdx !== -1) {
            updateWidgetEditor(getCurrentMenu());
        }

    } catch(e) { alert("上传失败!"); } finally { inp.value = ""; }
}

function addWidget(type) {
    const m = getCurrentMenu();
    if (!m.custom_widgets) m.custom_widgets = [];
    if(type==='image') m.custom_widgets.push({ type:'image', content:'', x:50, y:50, width:100, height:100 });
    else m.custom_widgets.push({ type:'text', text:"新文本", x:50, y:50, size:40, color:"#FFFFFF" });
    selectedWidgetIdx = m.custom_widgets.length-1;
    renderAll();
    updateWidgetEditor(m);
}

function updateWidget(key, val) {
    if (selectedWidgetIdx === -1) return;
    const m = getCurrentMenu();
    const w = m.custom_widgets[selectedWidgetIdx];
    if(['size','width','height'].includes(key)) w[key]=parseInt(val); else w[key]=val;
    renderCanvas(m);
}

function updateWidgetEditor(m) {
    const ed = document.getElementById("widgetEditor");
    if (selectedWidgetIdx === -1) { ed.style.display="none"; return; }
    ed.style.display="block";
    const w = m.custom_widgets[selectedWidgetIdx];
    if (w.type === 'image') {
        document.getElementById("wEdit-text").style.display="none";
        document.getElementById("wEdit-image").style.display="block";
        setValue("widW", w.width);
        setValue("widH", w.height);
        renderSelect("widImgSelect", appState.assets.widget_imgs, w.content, "选择图片");
    } else {
        document.getElementById("wEdit-image").style.display="none";
        document.getElementById("wEdit-text").style.display="block";
        setValue("widText", w.text);
        setValue("widSize", w.size);
        setValue("widColor", w.color);
        renderSelect("widFontSelect", appState.assets.fonts, w.font || "", "默认字体");
    }
}

function deleteWidget() {
    if(selectedWidgetIdx===-1) return;
    if(confirm("删除组件?")) {
        getCurrentMenu().custom_widgets.splice(selectedWidgetIdx, 1);
        selectedWidgetIdx=-1;
        renderAll();
    }
}

function updateMenuMeta(key, val) {
    const m = getCurrentMenu();
    if(['layout_columns', 'canvas_width', 'canvas_height', 'group_blur_radius', 'item_blur_radius', 'group_bg_alpha', 'item_bg_alpha', 'shadow_offset_x', 'shadow_offset_y', 'shadow_radius'].includes(key)) {
        m[key] = parseInt(val);
    } else if (key === 'use_canvas_size' || key === 'shadow_enabled') {
        m[key] = val === 'true' || val === true; // 修正bool转换
    } else if (key === 'export_scale') {
        m[key] = parseFloat(val);
    } else {
        m[key] = val;
    }
    renderAll();
}

function updateBg(val) {
    updateMenuMeta('background', val);
}

function updateColor(key, val, src) { if (src === 'text' && !val.startsWith('#')) val = '#' + val; updateMenuMeta(key, val); }
function initFonts() { (appState.assets.fonts || []).forEach(n => { const id="f-"+n; if(!document.getElementById(id)) { const s=document.createElement("style"); s.id=id; s.textContent=`@font-face { font-family: '${cssFont(n)}'; src: url('/fonts/${n}'); }`; document.head.appendChild(s); } }); }
function cssFont(n) { return n ? n.replace(/[^a-zA-Z0-9_]/g, '_') : 'sans-serif'; }

const get_style = getStyle;