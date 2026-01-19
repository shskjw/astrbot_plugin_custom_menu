const appState = {
    fullConfig: { menus: [] },
    currentMenuId: null,
    assets: { backgrounds: [], icons: [], widget_imgs: [], fonts: [], videos: [] },
    clipboard: null,
    commandsData: null
};

// 拖拽核心状态
let dragData = {
    active: false,
    isDragging: false,
    mode: 'move', // 'move' or 'resize'
    type: null,   // 'item' or 'widget'
    gIdx: -1, iIdx: -1, targetIdx: -1,
    startX: 0, startY: 0,
    initialVals: {},
    cachedEl: null
};

// 渲染锁
let rafLock = false;
let viewState = { scale: 1 };
let selectedWidgetIdx = -1;
let selectedItem = { gIdx: -1, iIdx: -1 };

// =============================================================
//  初始化与 API
// =============================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([loadAssets(), loadConfig()]);
        initFonts();
        if (appState.fullConfig.menus && appState.fullConfig.menus.length > 0) {
            switchMenu(appState.fullConfig.menus[0].id);
        } else {
            createNewMenu();
        }

        // 全局事件监听
        window.addEventListener('mouseup', handleGlobalMouseUp);
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('keydown', handleKeyDown);

        // 点击画布空白处取消选中
        const cvsWrapper = document.getElementById('canvas-wrapper');
        cvsWrapper.addEventListener('mousedown', (e) => {
            const ids = ['canvas-wrapper', 'canvas', 'bg-preview-layer', 'canvas-img-preview', 'canvas-video-preview'];
            if (ids.includes(e.target.id) || e.target.classList.contains('group-wrapper')) {
                clearSelection();
            }
        });
    } catch (e) {
        console.error("Init failed:", e);
    }
});

function getCurrentMenu() {
    return appState.fullConfig.menus.find(m => m.id === appState.currentMenuId) || appState.fullConfig.menus[0];
}

async function api(url, method = "GET", body = null) {
    const opts = {
        method,
        headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}
    };
    if (body) opts.body = body instanceof FormData ? body : JSON.stringify(body);
    const res = await fetch("/api" + url, opts);
    if (!res.ok) throw res;
    return res.headers.get("content-type")?.includes("json") ? res.json() : res;
}

async function loadConfig() { appState.fullConfig = await api("/config"); }
async function loadAssets() { appState.assets = await api("/assets"); }

// --- 修复提示逻辑：保存功能 ---
async function saveAll() {
    // 获取按钮以改变状态
    const btn = document.querySelector('button[onclick="saveAll()"]');
    const oldText = btn ? btn.innerText : "💾 保存";
    if(btn) { btn.innerText = "⏳ 保存中..."; btn.disabled = true; }

    try {
        await api("/config", "POST", appState.fullConfig);
        alert("✅ 配置已保存成功！");
    } catch(e) {
        alert("❌ 保存失败: " + e);
    } finally {
        if(btn) { btn.innerText = oldText; btn.disabled = false; }
    }
}

// --- 修复提示逻辑：导出图片 ---
async function exportImage() {
    try {
        await api("/config", "POST", appState.fullConfig);
        const menu = getCurrentMenu();

        // 视频导出提示
        if (menu.bg_type === 'video') {
            alert("⏳ 正在生成动态视频菜单...\n这可能需要几十秒时间，请耐心等待浏览器下载提示。");
        }

        const res = await fetch("/api/export_image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(menu)
        });

        if (res.ok) {
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = window.URL.createObjectURL(blob);
            const isAnim = menu.bg_type === 'video' && menu.bg_video;
            let ext = 'png';
            if (isAnim) {
                const fmt = menu.video_export_format || 'apng';
                ext = (fmt === 'apng') ? 'png' : fmt;
            }
            a.download = `${menu.name}.${ext}`;
            a.click();
        } else {
            const errText = await res.text();
            alert("❌ 导出失败: " + errText);
        }
    } catch(e) {
        alert("❌ 导出请求异常: " + e);
    }
}

function getStyle(obj, key, fallbackGlobalKey) {
    const m = getCurrentMenu();
    if (obj && obj[key] !== undefined && obj[key] !== "") return obj[key];
    return m[fallbackGlobalKey];
}

// --- 修复提示逻辑：上传文件 ---
async function uploadFile(type, inp) {
    const files = Array.from(inp.files || []);
    if (files.length === 0) return;

    let successCount = 0;
    let failCount = 0;
    const failedFiles = [];

    // 找到显示状态的按钮
    const btn = inp.previousElementSibling;
    const originalText = btn ? btn.innerText : '';
    
    // 使用 Promise.all 并行上传所有文件以提高效率
    const uploadPromises = files.map(async (f, idx) => {
        if (btn) btn.innerText = `⏳ ${idx + 1}/${files.length}`;
        
        const d = new FormData();
        d.append("type", type);
        d.append("file", f);

        try {
            const res = await fetch("/api/upload", {
                method: "POST",
                body: d
            });
            
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            
            const json = await res.json();
            
            if (json.error) {
                throw new Error(json.error);
            }
            
            // 单文件时自动设置到当前项
            if (files.length === 1 && json.filename) {
                const m = getCurrentMenu();
                if (type === 'video') m.bg_video = json.filename;
                else if (type === 'background') m.background = json.filename;
                else if (type === 'icon' && selectedItem.gIdx !== -1) {
                    updateProp('item', selectedItem.gIdx, selectedItem.iIdx, 'icon', json.filename);
                } else if (type === 'widget_img' && selectedWidgetIdx !== -1) {
                    updateWidget('content', json.filename);
                }
            }
            
            return { success: true, filename: f.name };
        } catch (e) {
            console.error(`File ${f.name} upload failed:`, e);
            return { success: false, filename: f.name, error: e.message };
        }
    });

    // 等待所有上传完成
    const results = await Promise.all(uploadPromises);
    
    results.forEach(r => {
        if (r.success) {
            successCount++;
        } else {
            failCount++;
            failedFiles.push(r.filename);
        }
    });

    if (btn) btn.innerText = originalText;

    // 刷新资源列表
    await loadAssets();
    if (type === 'font') initFonts();
    renderAll();

    // 刷新编辑器面板
    if (selectedWidgetIdx !== -1) updateWidgetEditor(getCurrentMenu());
    if (selectedItem.gIdx !== -1) openContextEditor('item', selectedItem.gIdx, selectedItem.iIdx);

    // 提示结果
    let msg = `上传完成\n✅ 成功: ${successCount} 个`;
    if (failCount > 0) {
        msg += `\n❌ 失败: ${failCount} 个\n失败文件: ${failedFiles.join(', ')}`;
    }
    alert(msg);
    
    inp.value = "";
}

// --- 修复提示逻辑：导出模版包 ---
async function exportTemplatePack() {
    await api("/config", "POST", appState.fullConfig);
    const menu = getCurrentMenu();

    if(!confirm(`即将导出菜单模板 "${menu.name}" 及其使用的图片、字体等素材。\n这会生成一个 .zip 文件。\n\n是否继续？`)) return;

    try {
        const res = await fetch("/api/export_pack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(menu)
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${menu.name}_pack.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } else {
            const err = await res.text();
            alert("❌ 导出失败: " + err);
        }
    } catch (e) {
        alert("❌ 导出请求错误: " + e);
    }
}

// --- 修复提示逻辑：导入模版包 ---
async function importTemplatePack(inp) {
    const file = inp.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
        const btn = inp.previousElementSibling;
        const oldText = btn.innerText;
        btn.innerText = "⏳";
        btn.disabled = true;

        const res = await fetch("/api/import_pack", {
            method: "POST",
            body: formData
        });

        if (res.ok) {
            const data = await res.json();
            alert(`✅ 导入成功！\n\n已导入菜单: ${data.menu_name}\n素材已自动解压。`);
            await loadAssets();
            initFonts();
            await loadConfig();
            if (appState.fullConfig.menus.length > 0) {
                switchMenu(appState.fullConfig.menus[appState.fullConfig.menus.length - 1].id);
            }
        } else {
            const err = await res.text();
            alert("❌ 导入失败: " + err);
        }
    } catch (e) {
        alert("❌ 导入错误: " + e);
    } finally {
        inp.value = "";
        const btn = inp.previousElementSibling;
        btn.innerText = "📦";
        btn.disabled = false;
    }
}

function switchMenu(id) {
    appState.currentMenuId = id;
    clearSelection();
    renderMenuSelect();
    renderAll();
}

function createNewMenu() {
    const newMenu = {
        id: "m_" + Date.now(),
        name: "新菜单",
        enabled: true,
        trigger_keywords: "",
        title: "标题",
        sub_title: "Subtitle",
        groups: [],
        custom_widgets: [],
        title_size: 60,
        group_title_size: 30,
        group_sub_size: 18,
        item_name_size: 26,
        item_desc_size: 16,
        title_color: "#FFFFFF",
        subtitle_color: "#DDDDDD",
        group_title_color: "#FFFFFF",
        group_sub_color: "#AAAAAA",
        item_name_color: "#FFFFFF",
        item_desc_color: "#AAAAAA",
        layout_columns: 3,
        group_bg_color: "#000000",
        group_bg_alpha: 50,
        item_bg_color: "#FFFFFF",
        item_bg_alpha: 20,
        use_canvas_size: false,
        canvas_width: 1000,
        canvas_height: 2000,
        export_scale: 1.0,
        bg_type: "image",
        bg_fit_mode: "cover",
        bg_align_x: "center",
        bg_align_y: "center",
        video_scale: 1.0,
        video_fps: 12,
        video_export_format: "webp"
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

function deleteMenu() {
    if (appState.fullConfig.menus.length <= 1) return alert("至少保留一个菜单模板。");
    if (confirm("确定删除当前菜单模板？此操作不可逆。")) {
        const menuToDeleteId = appState.currentMenuId;
        appState.fullConfig.menus = appState.fullConfig.menus.filter(m => m.id !== menuToDeleteId);
        api("/config", "POST", appState.fullConfig).then(() => {
            switchMenu(appState.fullConfig.menus[0].id);
            alert("✅ 菜单已删除。");
        });
    }
}

function toggleEnable() {
    const m = getCurrentMenu();
    m.enabled = !m.enabled;
    renderMenuSelect();
}

function renderMenuSelect() {
    document.getElementById("menuSelect").innerHTML = appState.fullConfig.menus.map(m =>
        `<option value="${m.id}" ${m.id === appState.currentMenuId ? 'selected' : ''}>${m.enabled ? '' : '[停] '}${m.name}</option>`
    ).join('');
    document.getElementById("menuNameInput").value = getCurrentMenu().name;
    const btn = document.getElementById("enableBtn");
    btn.innerText = getCurrentMenu().enabled ? "已启用" : "已停用";
    btn.style.color = getCurrentMenu().enabled ? "#4caf50" : "#f56c6c";
}

function renderAll() {
    const m = getCurrentMenu();
    if (!m.video_scale) m.video_scale = 1.0;
    if (!m.bg_fit_mode) m.bg_fit_mode = "cover";
    if (!m.title_size) m.title_size = 60;

    updateFormInputs(m);
    renderSidebarGroupList(m);
    renderCanvas(m);
    updateWidgetEditor(m);
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function renderSelect(id, opts, sel, def) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = (def ? `<option value="">${def}</option>` : '') + (opts || []).map(o =>
        `<option value="${o}" ${o === sel ? 'selected' : ''}>${o}</option>`
    ).join('');
}

function updateFormInputs(m) {
    setValue("menuNameInput", m.name);
    setValue("triggerKeywordsInput", m.trigger_keywords || "");

    setValue("columnInput", m.layout_columns || 3);
    setValue("cvsW", m.canvas_width || 1000);
    setValue("cvsH", m.canvas_height || 2000);
    if (document.getElementById("canvasMode")) document.getElementById("canvasMode").value = m.use_canvas_size ? "true" : "false";

    setValue("expScaleInput", m.export_scale || 1.0);
    setValue("cvsColorP", m.canvas_color || "#1e1e1e");
    setValue("cvsColorT", m.canvas_color || "#1e1e1e");

    setValue("bgType", m.bg_type || "image");
    setValue("bgFit", m.bg_fit_mode || "cover");
    setValue("bgAlignX", m.bg_align_x || "center");
    setValue("bgAlignY", m.bg_align_y || "center");

    const bgScale = m.video_scale !== undefined ? m.video_scale : 1.0;
    setValue("bgScaleRange", bgScale);
    setValue("bgScaleInput", bgScale);
    const scaleValSpan = document.getElementById("bgScaleVal");
    if(scaleValSpan) scaleValSpan.innerText = bgScale;

    setValue("bgCustomW", m.bg_custom_width || "");
    setValue("bgCustomH", m.bg_custom_height || "");
    setValue("groupCustomW", m.group_custom_width || "");
    setValue("groupCustomH", m.group_custom_height || "");
    setValue("itemCustomW", m.item_custom_width || "");
    setValue("itemCustomH", m.item_custom_height || "");
    toggleBgCustomInputs();

    // 使用带预览的背景图片选择器
    renderImageSelect("bgSelectPreview", "background", m.background, (v) => { updateBg(v); });
    renderSelect("vidSelect", appState.assets.videos, m.bg_video, "无视频");
    renderRandomBgList();  // 渲染随机背景列表

    setValue("vStart", m.video_start || 0);
    setValue("vEnd", m.video_end || "");
    setValue("vFps", m.video_fps || 12);
    setValue("vFormat", m.video_export_format || "webp");

    toggleBgPanel();

    setValue("boxColor", m.group_bg_color || "#000000");
    setValue("boxBlur", m.group_blur_radius || 0);
    setValue("boxAlpha", m.group_bg_alpha !== undefined ? m.group_bg_alpha : 50);
    if(document.getElementById("alphaVal")) document.getElementById("alphaVal").innerText = m.group_bg_alpha !== undefined ? m.group_bg_alpha : 50;

    setValue("iboxColor", m.item_bg_color || "#FFFFFF");
    setValue("iboxBlur", m.item_blur_radius || 0);
    setValue("iboxAlpha", m.item_bg_alpha !== undefined ? m.item_bg_alpha : 20);
    if(document.getElementById("ialphaVal")) document.getElementById("ialphaVal").innerText = m.item_bg_alpha !== undefined ? m.item_bg_alpha : 20;

    renderSelect("fTitle", appState.assets.fonts, m.title_font);
    renderSelect("fGTitle", appState.assets.fonts, m.group_title_font);
    renderSelect("fGSub", appState.assets.fonts, m.group_sub_font);
    setValue("fGSubAlign", m.group_sub_align || "bottom");
    renderSelect("fIName", appState.assets.fonts, m.item_name_font);
    renderSelect("fIDesc", appState.assets.fonts, m.item_desc_font);

    document.getElementById("shadowEn").checked = !!m.shadow_enabled;
    setValue("shadowColP", m.shadow_color || "#000000");
    setValue("shadowColT", m.shadow_color || "#000000");
    setValue("shadowX", m.shadow_offset_x !== undefined ? m.shadow_offset_x : 2);
    setValue("shadowY", m.shadow_offset_y !== undefined ? m.shadow_offset_y : 2);
    setValue("shadowR", m.shadow_radius !== undefined ? m.shadow_radius : 2);

    const colorMap = {
        'title_color': ['cTitleP', 'cTitleT'],
        'subtitle_color': ['cSubP', 'cSubT'],
        'group_title_color': ['cGTitleP', 'cGTitleT'],
        'group_sub_color': ['cGSubP', 'cGSubT'],
        'item_name_color': ['cItemNameP', 'cItemNameT'],
        'item_desc_color': ['cItemDescP', 'cItemDescT']
    };
    for (const [k, ids] of Object.entries(colorMap)) {
        const val = m[k] || "#FFFFFF";
        ids.forEach(id => {
            if (document.getElementById(id)) document.getElementById(id).value = val;
        });
    }
}

function updateMenuMeta(key, val) {
    const m = getCurrentMenu();
    if (['layout_columns', 'canvas_width', 'canvas_height', 'group_blur_radius', 'item_blur_radius', 'group_bg_alpha', 'item_bg_alpha', 'shadow_offset_x', 'shadow_offset_y', 'shadow_radius', 'bg_custom_width', 'bg_custom_height', 'group_custom_width', 'group_custom_height', 'item_custom_width', 'item_custom_height', 'video_fps'].includes(key)) {
        m[key] = parseInt(val);
    } else if (key === 'use_canvas_size' || key === 'shadow_enabled') {
        m[key] = val === 'true' || val === true;
    } else if (['export_scale', 'video_start', 'video_end', 'video_scale'].includes(key)) {
        m[key] = parseFloat(val);
    } else {
        m[key] = val;
    }
    renderAll();
}

function updateUnifiedBgParams(type, val) {
    const m = getCurrentMenu();
    if (type === 'align_x') {
        m.bg_align_x = val;
        m.video_align_x = val;
    } else if (type === 'align_y') {
        m.bg_align_y = val;
        m.video_align = val;
        m.video_align_y = val;
    } else if (type === 'scale') {
        const floatVal = parseFloat(val);
        m.video_scale = floatVal;
        setValue("bgScaleRange", floatVal);
        setValue("bgScaleInput", floatVal);
        const span = document.getElementById("bgScaleVal");
        if(span) span.innerText = floatVal;
    }
    renderCanvas(m);
}

function updateBg(val) { updateMenuMeta('background', val); }
function updateColor(key, val, src) { if (src === 'text' && !val.startsWith('#')) val = '#' + val; updateMenuMeta(key, val); }

function toggleBgCustomInputs() {
    const fitMode = document.getElementById('bgFit').value;
    const customInputs = document.getElementById('bg-custom-size-inputs');
    if (customInputs) {
        customInputs.style.display = (fitMode === 'custom') ? 'block' : 'none';
    }
}

function toggleBgPanel() {
    const type = document.getElementById("bgType").value;
    const imgPanel = document.getElementById("panel-bg-image");
    const vidPanel = document.getElementById("panel-bg-video");
    if (type === 'video') {
        imgPanel.style.display = "none";
        vidPanel.style.display = "block";
    } else {
        imgPanel.style.display = "block";
        vidPanel.style.display = "none";
    }
    renderCanvas(getCurrentMenu());
}

function renderCanvas(m) {
    const cvsWrapper = document.getElementById("canvas-wrapper");
    const cvs = document.getElementById("canvas");
    const bgPreviewLayer = document.getElementById("bg-preview-layer");
    const vidPreview = document.getElementById("canvas-video-preview");
    const imgPreview = document.getElementById("canvas-img-preview");

    const useFixedSize = String(m.use_canvas_size) === 'true';
    const targetW = parseInt(m.canvas_width) || 1000;
    const targetH = parseInt(m.canvas_height) || 2000;

    const editorWidth = cvsWrapper.parentElement.clientWidth - 120;
    let scale = 1;
    if (editorWidth < targetW) scale = editorWidth / targetW;
    viewState.scale = scale;

    cvsWrapper.style.width = targetW + "px";
    cvs.style.width = targetW + "px";
    cvs.style.transform = `scale(${scale})`;
    cvs.style.transformOrigin = "top left";
    cvs.style.minHeight = "800px";

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

    const bgType = m.bg_type || 'image';
    const bgFit = m.bg_fit_mode || 'cover';
    const alignX = m.bg_align_x || 'center';
    const alignY = m.bg_align_y || 'center';
    const bgScale = parseFloat(m.video_scale !== undefined ? m.video_scale : 1.0);
    const userBgColor = m.canvas_color || '#1e1e1e';

    const transformCSS = `scale(${bgScale})`;
    cvs.style.backgroundImage = 'none';

    const hasVideo = bgType === 'video' && m.bg_video;
    const hasImage = bgType === 'image' && m.background;

    bgPreviewLayer.style.display = (hasVideo || hasImage) ? 'flex' : 'none';
    bgPreviewLayer.style.flexDirection = 'column';
    bgPreviewLayer.style.overflow = 'hidden';
    bgPreviewLayer.style.backgroundColor = userBgColor;

    const flexMapY = { 'top': 'flex-start', 'center': 'center', 'bottom': 'flex-end' };
    const flexMapX = { 'left': 'flex-start', 'center': 'center', 'right': 'flex-end' };

    bgPreviewLayer.style.justifyContent = flexMapY[alignY] || 'center';
    bgPreviewLayer.style.alignItems = flexMapX[alignX] || 'center';

    if (hasVideo || hasImage) {
        cvs.style.backgroundColor = 'transparent';
    } else {
        cvs.style.backgroundColor = userBgColor;
    }

    if (hasVideo) {
        vidPreview.style.display = 'block';
        imgPreview.style.display = 'none';

        const targetSrc = `/raw_assets/videos/${m.bg_video}`;
        if (!vidPreview.src.endsWith(encodeURI(m.bg_video))) {
            vidPreview.src = targetSrc;
        }

        vidPreview.style.transform = transformCSS;
        vidPreview.style.transformOrigin = 'center center';

        if (bgFit === 'cover' || bgFit === 'contain') {
            vidPreview.style.width = '100%';
            vidPreview.style.height = '100%';
            vidPreview.style.objectFit = bgFit;
            vidPreview.style.objectPosition = `${alignX} ${alignY}`;
        } else {
            vidPreview.style.objectFit = 'fill';

            if (bgFit === 'cover_w') {
                vidPreview.style.width = '100%';
                vidPreview.style.height = 'auto';
            } else if (bgFit === 'cover_h') {
                vidPreview.style.width = 'auto';
                vidPreview.style.height = '100%';
            } else if (bgFit === 'custom') {
                vidPreview.style.width = (m.bg_custom_width || 1000) + 'px';
                vidPreview.style.height = (m.bg_custom_height || 1000) + 'px';
            }
        }

    } else if (hasImage) {
        vidPreview.style.display = 'none';
        imgPreview.style.display = 'block';

        const imgUrl = `url('/raw_assets/backgrounds/${m.background}')`;
        imgPreview.style.backgroundImage = imgUrl;
        imgPreview.style.backgroundRepeat = 'no-repeat';

        imgPreview.style.backgroundPosition = `${alignX} ${alignY}`;
        imgPreview.style.transform = transformCSS;
        imgPreview.style.transformOrigin = `${alignX} ${alignY}`;
        imgPreview.style.width = '100%';
        imgPreview.style.height = '100%';

        if (bgFit === 'cover') imgPreview.style.backgroundSize = 'cover';
        else if (bgFit === 'contain') imgPreview.style.backgroundSize = 'contain';
        else if (bgFit === 'cover_w') imgPreview.style.backgroundSize = '100% auto';
        else if (bgFit === 'cover_h') imgPreview.style.backgroundSize = 'auto 100%';
        else if (bgFit === 'custom') imgPreview.style.backgroundSize = `${m.bg_custom_width}px ${m.bg_custom_height}px`;
    }

    let shadowCss = 'none';
    if (m.shadow_enabled) {
        shadowCss = `${m.shadow_offset_x}px ${m.shadow_offset_y}px ${m.shadow_radius}px ${m.shadow_color}`;
    }

    const gfTitle = cssFont(m.title_font);
    const titleAlign = m.title_align || 'center';
    const titleSz = m.title_size || 60;
    const subSz = titleSz * 0.5;

    let html = `
        <div class="header-area title-clickable" style="text-align:${titleAlign}; text-shadow:${shadowCss};"
             onclick="openContextEditor('title')">
            <div style="color:${m.title_color}; font-family:'${gfTitle}'; font-size:${titleSz}px">${m.title}</div>
            <div style="color:${m.subtitle_color}; font-family:'${gfTitle}'; font-size:${subSz}px">${m.sub_title}</div>
        </div>
    `;

    (m.groups || []).forEach((g, gIdx) => {
        const gRgba = hexToRgba(getStyle(g, 'bg_color', 'group_bg_color'), (g.bg_alpha !== undefined ? g.bg_alpha : m.group_bg_alpha) / 255);
        
        // 分组自定义模糊或使用全局模糊
        const gGroupBlur = g.blur_radius !== undefined ? g.blur_radius : m.group_blur_radius;
        const gBlur = gGroupBlur > 0 ? `backdrop-filter: blur(${gGroupBlur}px);` : '';
        const freeMode = g.free_mode === true;
        const isTextGroup = g.group_type === 'text';

        let contentHeight = "auto";
        let groupWidth = "auto";
        let groupHeight = "auto";
        
        // 处理分组自定义大小
        if (g.custom_width !== undefined) groupWidth = g.custom_width + "px";
        if (g.custom_height !== undefined) groupHeight = g.custom_height + "px";
        
        if (freeMode && !isTextGroup) {
            let maxBottom = 0;
            (g.items || []).forEach(item => { const b = (parseInt(item.y) || 0) + (parseInt(item.h) || 100); if (b > maxBottom) maxBottom = b; });
            contentHeight = Math.max(Number(g.min_height) || 100, maxBottom + 20) + "px";
        }

        const gridStyle = (freeMode && !isTextGroup) ? '' : `display:grid; gap:15px; padding:20px; grid-template-columns: repeat(${g.layout_columns || m.layout_columns || 3}, 1fr);`;

        const gTitleSz = getStyle(g, 'title_size', 'group_title_size') || 30;
        const gTitleFont = cssFont(getStyle(g, 'title_font', 'group_title_font'));
        const gSubSz = getStyle(g, 'sub_size', 'group_sub_size') || 18;
        const gSubFont = cssFont(getStyle(g, 'sub_font', 'group_sub_font'));
        const gSubColor = getStyle(g, 'sub_color', 'group_sub_color');

        const subAlign = getStyle(g, 'sub_align', 'group_sub_align') || 'bottom';
        let alignItems = 'flex-end';
        if (subAlign === 'center') alignItems = 'center';
        if (subAlign === 'top') alignItems = 'flex-start';

        html += `
        <div class="group-wrapper">
            <div class="group-header-wrap" onclick="openContextEditor('group', ${gIdx}, -1)"
                 style="padding:0 0 10px 10px; cursor:pointer; text-shadow:${shadowCss}; display:flex; gap:15px; align-items:${alignItems};">
                <span style="color:${getStyle(g, 'title_color', 'group_title_color')}; font-family:'${gTitleFont}'; font-size:${gTitleSz}px; line-height:1; ${getTextStyleCSS(g, 'group_title')}">${g.title}</span>
                ${g.subtitle ? `<span style="color:${gSubColor}; font-family:'${gSubFont}'; font-size:${gSubSz}px; line-height:1; ${getTextStyleCSS(g, 'group_sub')}">${g.subtitle}</span>` : ''}
            </div>`;
        
        // 纯文本分组
        if (isTextGroup) {
            const textContent = g.text_content || g.subtitle || '';
            html += `<div class="group-content-box" style="background-color:${gRgba}; ${gBlur}; width:${groupWidth}; min-height:${groupHeight !== 'auto' ? groupHeight : 'auto'}; padding:20px; position:relative; border-radius:15px; word-wrap:break-word; white-space:pre-wrap; overflow-wrap:break-word;">
                <div style="color:${getStyle(g, 'sub_color', 'group_sub_color')}; font-family:'${gSubFont}'; font-size:${gSubSz}px; line-height:1.6; text-shadow:${shadowCss};">${textContent}</div>
            </div>`;
        } else {
            // 功能项分组
            html += `<div class="group-content-box" style="background-color:${gRgba}; ${gBlur}; height:${contentHeight}; width:${groupWidth}; min-height:${groupHeight !== 'auto' ? groupHeight : 'auto'}; position:relative; ${freeMode ? 'overflow:visible' : gridStyle} border-radius:15px;">`;

            (g.items || []).forEach((item, iIdx) => {
                // 功能项自定义模糊或使用全局模糊
                const iItemBlur = item.blur_radius !== undefined ? item.blur_radius : m.item_blur_radius;
                const iBlur = iItemBlur > 0 ? `backdrop-filter: blur(${iItemBlur}px);` : '';
                
                const iRgba = hexToRgba(getStyle(item, 'bg_color', 'item_bg_color'), (item.bg_alpha !== undefined ? item.bg_alpha : m.item_bg_alpha) / 255);
                const icon = item.icon ? `<img src="/raw_assets/icons/${item.icon}" class="item-icon" style="${item.icon_size ? `height:${item.icon_size}px` : ''}">` : '';

                const iNameSz = getStyle(item, 'name_size', 'item_name_size') || 26;
                const iDescSz = getStyle(item, 'desc_size', 'item_desc_size') || 16;
                const iNameFont = cssFont(getStyle(item, 'name_font', 'item_name_font'));
                const iDescFont = cssFont(getStyle(item, 'desc_font', 'item_desc_font'));
                
                // 处理功能项自定义大小
                let itemStyles = "";
                if (item.custom_width !== undefined || item.custom_height !== undefined) {
                    const itemW = item.custom_width || 'auto';
                    const itemH = item.custom_height || 'auto';
                    itemStyles = `width:${itemW}px;height:${itemH}px;`;
                } else {
                    itemStyles = `height:90px;`;
                }

                const txt = `
                    <div class="item-text-content" style="text-shadow:${shadowCss};">
                        <div style="color:${getStyle(item, 'name_color', 'item_name_color')};font-family:'${iNameFont}';font-size:${iNameSz}px;${getTextStyleCSS(item, 'item_name')}">${item.name}</div>
                        <div style="color:${getStyle(item, 'desc_color', 'item_desc_color')};font-family:'${iDescFont}';font-size:${iDescSz}px;margin-top:5px;white-space:pre-wrap;${getTextStyleCSS(item, 'item_desc')}">${item.desc || ''}</div>
                    </div>`;

                if (freeMode) {
                    const isSel = selectedItem.gIdx === gIdx && selectedItem.iIdx === iIdx;
                    html += `<div class="free-item ${isSel ? 'selected' : ''}" id="item-${gIdx}-${iIdx}" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;background-color:${iRgba}; ${iBlur}" onmousedown="initItemDrag(event,${gIdx},${iIdx},'move')">${icon}${txt}${isSel ? `<div class="resize-handle" onmousedown="initItemDrag(event,${gIdx},${iIdx},'resize')"></div>` : ''}</div>`;
                } else {
                    html += `<div class="grid-item" style="background-color:${iRgba}; ${iBlur} ${itemStyles}" onclick="openContextEditor('item', ${gIdx}, ${iIdx})">${icon}${txt}</div>`;
                }
            });

            if (!freeMode) {
                html += `<div class="grid-item add-item-btn" onclick="addItem(${gIdx})"><span>+</span></div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;
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

function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function getTextStyleCSS(obj, stylePrefix) {
    let css = '';
    if (obj[stylePrefix + '_bold']) css += 'font-weight:bold;';
    if (obj[stylePrefix + '_italic']) css += 'font-style:italic;';
    if (obj[stylePrefix + '_underline']) css += 'text-decoration:underline;';
    return css;
}

function toggleGroupFreeMode(gIdx, isFree) {
    const m = getCurrentMenu();
    m.groups[gIdx].free_mode = isFree;
    renderAll();
    openContextEditor('group', gIdx, -1);
}

function updateShadowFieldsVisibility(shadowId, isEnabled) {
    const elem = document.getElementById(shadowId);
    if (elem) {
        elem.style.display = isEnabled ? 'block' : 'none';
    }
}

function renderSidebarGroupList(m) {
    const list = document.getElementById("groupList");
    list.innerHTML = "";
    (m.groups || []).forEach((g, idx) => {
        const div = document.createElement("div");
        div.className = "group-item";
        const isTextGroup = g.group_type === 'text';
        const badges = [
            isTextGroup ? ' <span style="font-size:9px;background:#8b5cf6;padding:1px 3px;border-radius:2px;">纯文本</span>' : '',
            g.free_mode ? ' <span style="font-size:9px;background:#0e639c;padding:1px 3px;border-radius:2px;">自由</span>' : ''
        ].join('');
        div.innerHTML = `<div style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;"><div style="font-weight:500;">${g.title}${badges}</div></div><div class="group-actions"><span class="icon-btn" onclick="addItem(${idx})">+</span><span class="icon-btn" onclick="moveGroup(${idx}, -1)">↑</span><span class="icon-btn" onclick="moveGroup(${idx}, 1)">↓</span></div>`;
        div.firstElementChild.onclick = () => openContextEditor('group', idx, -1);
        list.appendChild(div);
    });
}

function addItem(gIdx) {
    const g = getCurrentMenu().groups[gIdx];
    let nextY = 20;
    if (g.free_mode) {
        let max = 0;
        g.items.forEach(i => {
            const b = (parseInt(i.y) || 0) + (parseInt(i.h) || 100);
            if (b > max) max = b;
        });
        if (max > 0) nextY = max + 15;
    }
    g.items.push({ name: "新功能", desc: "...", icon: "", x: 20, y: nextY, w: 200, h: 80 });
    renderAll();
}

function moveItem(gIdx, iIdx, dir) {
    const g = getCurrentMenu().groups[gIdx];
    if (iIdx + dir < 0 || iIdx + dir >= g.items.length) return;
    [g.items[iIdx], g.items[iIdx + dir]] = [g.items[iIdx + dir], g.items[iIdx]];
    renderAll();
    // 更新选中状态和打开编辑面板
    selectedItem = { gIdx, iIdx: iIdx + dir };
    openContextEditor('item', gIdx, iIdx + dir);
}

function addGroup() {
    getCurrentMenu().groups.push({ title: "新分组", subtitle: "", items: [], free_mode: false });
    renderAll();
}

function deleteGroup(idx) {
    if (confirm("确定删除此分组？")) {
        getCurrentMenu().groups.splice(idx, 1);
        clearSelection();
    }
}

function moveGroup(idx, dir) {
    const g = getCurrentMenu().groups;
    if (idx + dir < 0 || idx + dir >= g.length) return;
    [g[idx], g[idx + dir]] = [g[idx + dir], g[idx]];
    renderAll();
}

function addWidget(type) {
    const m = getCurrentMenu();
    if (!m.custom_widgets) m.custom_widgets = [];
    if (type === 'image') m.custom_widgets.push({ type: 'image', content: '', x: 50, y: 50, width: 100, height: 100 });
    else m.custom_widgets.push({ type: 'text', text: "新文本", x: 50, y: 50, size: 40, color: "#FFFFFF" });
    selectedWidgetIdx = m.custom_widgets.length - 1;
    renderAll();
    updateWidgetEditor(m);
}

function updateWidget(key, val) {
    if (selectedWidgetIdx === -1) return;
    const m = getCurrentMenu();
    const w = m.custom_widgets[selectedWidgetIdx];
    if (['size', 'width', 'height'].includes(key)) w[key] = parseInt(val);
    else w[key] = val;
    renderCanvas(m);
}

function updateWidgetEditor(m) {
    const ed = document.getElementById("widgetEditor");
    if (selectedWidgetIdx === -1) { ed.style.display = "none"; return; }
    ed.style.display = "block";
    const w = m.custom_widgets[selectedWidgetIdx];
    if (w.type === 'image') {
        document.getElementById("wEdit-text").style.display = "none";
        document.getElementById("wEdit-image").style.display = "block";
        setValue("widW", w.width);
        setValue("widH", w.height);
        // 使用带预览的组件图片选择器
        renderImageSelect("widImgSelectPreview", "widget", w.content, (v) => { updateWidget('content', v); });
    } else {
        document.getElementById("wEdit-image").style.display = "none";
        document.getElementById("wEdit-text").style.display = "block";
        setValue("widText", w.text);
        setValue("widSize", w.size || 40);
        setValue("widColor", w.color || "#FFFFFF");
        renderSelect("widFontSelect", appState.assets.fonts, w.font || "", "默认字体");
    }
}

function deleteWidget() {
    if (selectedWidgetIdx === -1) return;
    if (confirm("删除组件?")) {
        getCurrentMenu().custom_widgets.splice(selectedWidgetIdx, 1);
        selectedWidgetIdx = -1;
        renderAll();
    }
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
        if (['title_size', 'sub_size', 'name_size', 'desc_size', 'text_size', 'bg_alpha', 'layout_columns', 'width', 'height', 'x', 'y', 'w', 'h', 'group_blur_radius', 'item_blur_radius', 'canvas_width', 'canvas_height', 'icon_size', 'bg_custom_width', 'bg_custom_height', 'blur_radius', 'custom_width', 'custom_height', 'group_title_shadow_offset_x', 'group_title_shadow_offset_y', 'group_title_shadow_radius', 'item_name_shadow_offset_x', 'item_name_shadow_offset_y', 'item_name_shadow_radius', 'item_desc_shadow_offset_x', 'item_desc_shadow_offset_y', 'item_desc_shadow_radius', 'text_bg_alpha', 'text_bg_blur'].includes(key)) {
            val = parseInt(val);
        }
        if (key.endsWith('_enabled') || key.endsWith('_bold') || key.endsWith('_italic') || key.endsWith('_underline')) {
            val = val === true || val === 'true';
        }
        obj[key] = val;
    }

    if (key === 'icon') {
        openContextEditor(type, gIdx, iIdx);
    } else if (key === 'group_type') {
        // 当改变分组类型时，刷新编辑面板以显示/隐藏相关字段
        renderCanvas(m);
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

function initFonts() { (appState.assets.fonts || []).forEach(n => { const id="f-"+n; if(!document.getElementById(id)) { const s=document.createElement("style"); s.id=id; s.textContent=`@font-face { font-family: '${cssFont(n)}'; src: url('/fonts/${n}'); }`; document.head.appendChild(s); } }); }
function cssFont(n) { return n ? n.replace(/[^a-zA-Z0-9_]/g, '_') : 'sans-serif'; }

async function openAutoFillModal() {
    const modal = document.getElementById('autoFillModal');
    const listEl = document.getElementById('pluginList');
    modal.style.display = 'flex';
    listEl.innerHTML = '<div style="text-align:center; color:#888;">正在加载指令...</div>';

    try {
        if (!appState.commandsData) {
            appState.commandsData = await api("/commands");
        }
        renderAutoFillList(appState.commandsData);
    } catch (e) {
        listEl.innerHTML = `<div style="text-align:center; color:#f56c6c;">加载失败: ${e}</div>`;
    }
}

function renderAutoFillList(data) {
    const listEl = document.getElementById('pluginList');
    listEl.innerHTML = '';

    if (Object.keys(data).length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#888;">没有找到可用的插件指令数据。</div>';
        return;
    }

    const sortedPlugins = Object.keys(data).sort();

    sortedPlugins.forEach(pluginName => {
        const cmds = data[pluginName];
        if (!cmds || cmds.length === 0) return;

        const groupDiv = document.createElement('div');
        groupDiv.style.marginBottom = '10px';

        const header = document.createElement('div');
        header.style.background = '#333';
        header.style.padding = '5px 10px';
        header.style.borderRadius = '4px';
        header.style.marginBottom = '5px';
        header.style.display = 'flex';
        header.style.alignItems = 'center';

        const pCheck = document.createElement('input');
        pCheck.type = 'checkbox';
        pCheck.id = `chk-plugin-${pluginName}`;
        pCheck.style.width = '16px'; pCheck.style.height = '16px'; pCheck.style.marginRight = '8px';
        pCheck.onclick = (e) => {
            const children = document.querySelectorAll(`.chk-item-${pluginName.replace(/[^a-zA-Z0-9]/g, '_')}`);
            children.forEach(c => c.checked = e.target.checked);
        };

        const label = document.createElement('label');
        label.innerText = pluginName;
        label.htmlFor = `chk-plugin-${pluginName}`;
        label.style.fontWeight = 'bold';
        label.style.cursor = 'pointer';

        header.appendChild(pCheck);
        header.appendChild(label);
        groupDiv.appendChild(header);

        const cmdsDiv = document.createElement('div');
        cmdsDiv.style.paddingLeft = '20px';
        cmdsDiv.style.display = 'grid';
        cmdsDiv.style.gridTemplateColumns = '1fr 1fr';
        cmdsDiv.style.gap = '5px';

        const safePName = pluginName.replace(/[^a-zA-Z0-9]/g, '_');

        cmds.forEach((cmdObj, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.style.display = 'flex';
            itemDiv.style.alignItems = 'center';

            const iCheck = document.createElement('input');
            iCheck.type = 'checkbox';
            iCheck.className = `chk-item-${safePName}`;
            iCheck.value = JSON.stringify({p: pluginName, c: cmdObj});
            iCheck.style.width = '14px'; iCheck.style.height = '14px'; iCheck.style.marginRight = '5px';

            const iLabel = document.createElement('span');
            iLabel.innerText = cmdObj.cmd;
            iLabel.title = cmdObj.desc || '';
            iLabel.style.fontSize = '12px';
            iLabel.style.color = '#ccc';

            itemDiv.appendChild(iCheck);
            itemDiv.appendChild(iLabel);
            cmdsDiv.appendChild(itemDiv);
        });

        groupDiv.appendChild(cmdsDiv);
        listEl.appendChild(groupDiv);
    });
}

function confirmAutoFill() {
    const listEl = document.getElementById('pluginList');
    const checks = listEl.querySelectorAll('input[type="checkbox"]:checked');
    const selectedData = [];

    checks.forEach(chk => {
        if (chk.value) {
            try {
                selectedData.push(JSON.parse(chk.value));
            } catch(e){}
        }
    });

    if (selectedData.length === 0) {
        alert("请先选择要导入的指令！");
        return;
    }

    const grouped = {};
    selectedData.forEach(item => {
        if (!grouped[item.p]) grouped[item.p] = [];
        grouped[item.p].push(item.c);
    });

    const m = getCurrentMenu();
    let addedCount = 0;

    for (const [pluginName, cmds] of Object.entries(grouped)) {
        const newGroup = {
            title: pluginName,
            subtitle: "Plugin Commands",
            items: [],
            free_mode: false
        };

        cmds.forEach(c => {
            newGroup.items.push({
                name: c.cmd,
                desc: c.desc || "...",
                icon: "",
                x: 0, y: 0, w: 200, h: 80
            });
            addedCount++;
        });

        m.groups.push(newGroup);
    }

    document.getElementById('autoFillModal').style.display='none';
    renderAll();
    alert(`✅ 已成功导入 ${addedCount} 个指令到新分组！`);
}

function clearSelection() {
    selectedItem = { gIdx: -1, iIdx: -1 };
    selectedWidgetIdx = -1;
    document.getElementById("widgetEditor").style.display = "none";
    document.getElementById("globalPanel").style.display = "block";
    document.getElementById("propPanel").style.display = "none";
    renderCanvas(getCurrentMenu());
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

function generatePropForm(type, obj, gIdx, iIdx) {
    const input = (label, key, val, itype='text', extra='') => `
        <div class="form-row">
            <label>${label}</label>
            <input type="${itype}" value="${val !== undefined && val !== null ? val : ''}" class="form-control"
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
    const textStyles = (labelPrefix, keyPrefix) => {
        const boldVal = obj[keyPrefix + '_bold'] ? 'checked' : '';
        const italicVal = obj[keyPrefix + '_italic'] ? 'checked' : '';
        const underlineVal = obj[keyPrefix + '_underline'] ? 'checked' : '';
        return `
        <div class="form-row">
            <label>${labelPrefix} 文本样式</label>
            <div style="display:flex;gap:10px;align-items:center;">
                <label style="display:flex;align-items:center;gap:5px;margin:0;cursor:pointer;">
                    <input type="checkbox" ${boldVal} onchange="updateProp('${type}', ${gIdx}, ${iIdx}, '${keyPrefix}_bold', this.checked)">
                    <strong>加粗</strong>
                </label>
                <label style="display:flex;align-items:center;gap:5px;margin:0;cursor:pointer;">
                    <input type="checkbox" ${italicVal} onchange="updateProp('${type}', ${gIdx}, ${iIdx}, '${keyPrefix}_italic', this.checked)">
                    <em>斜体</em>
                </label>
                <label style="display:flex;align-items:center;gap:5px;margin:0;cursor:pointer;">
                    <input type="checkbox" ${underlineVal} onchange="updateProp('${type}', ${gIdx}, ${iIdx}, '${keyPrefix}_underline', this.checked)">
                    <u>下划线</u>
                </label>
            </div>
        </div>`;
    };
    const shadowSettings = (labelPrefix, keyPrefix) => {
        const enabledVal = obj[keyPrefix + '_shadow_enabled'] ? 'checked' : '';
        const colorVal = obj[keyPrefix + '_shadow_color'] || '#000000';
        const offsetXVal = obj[keyPrefix + '_shadow_offset_x'] !== undefined ? obj[keyPrefix + '_shadow_offset_x'] : '';
        const offsetYVal = obj[keyPrefix + '_shadow_offset_y'] !== undefined ? obj[keyPrefix + '_shadow_offset_y'] : '';
        const radiusVal = obj[keyPrefix + '_shadow_radius'] !== undefined ? obj[keyPrefix + '_shadow_radius'] : '';
        const globalMenu = getCurrentMenu();
        const shadowId = `shadow-${type}-${gIdx}-${iIdx}-${keyPrefix}`;
        return `
        <div style="background:#333;padding:10px;border-radius:4px;margin:10px 0;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                <label style="display:flex;align-items:center;gap:5px;margin:0;cursor:pointer;flex:1">
                    <input type="checkbox" ${enabledVal} onchange="updateProp('${type}', ${gIdx}, ${iIdx}, '${keyPrefix}_shadow_enabled', this.checked); updateShadowFieldsVisibility('${shadowId}', this.checked)">
                    <strong>${labelPrefix}阴影</strong>
                    <span style="font-size:10px;color:#aaa">${obj[keyPrefix + '_shadow_enabled'] ? '(自定义)' : '(继承全局)'}</span>
                </label>
            </div>
            <div id="${shadowId}" style="display:${obj[keyPrefix + '_shadow_enabled'] ? 'block' : 'none'};">
                <div class="form-row" style="margin:5px 0;">
                    <label style="font-size:12px;">颜色</label>
                    <input type="color" value="${colorVal}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, '${keyPrefix}_shadow_color', this.value)" style="height:30px;cursor:pointer;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:5px 0;">
                    <div class="form-row" style="margin:0;">
                        <label style="font-size:12px;">偏移X</label>
                        <input type="number" value="${offsetXVal}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, '${keyPrefix}_shadow_offset_x', this.value)" placeholder="2">
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label style="font-size:12px;">偏移Y</label>
                        <input type="number" value="${offsetYVal}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, '${keyPrefix}_shadow_offset_y', this.value)" placeholder="2">
                    </div>
                </div>
                <div class="form-row" style="margin:5px 0;">
                    <label style="font-size:12px;">模糊半径</label>
                    <input type="range" min="0" max="20" value="${radiusVal}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, '${keyPrefix}_shadow_radius', this.value)">
                </div>
            </div>
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
        html += textStyles("主标题", "title");
        html += color("副标题颜色", "subtitle_color", "subtitle_color");
        html += textStyles("副标题", "subtitle");
    } else if (type === 'group') {
        html += input("分组标题", "title", obj.title);
        html += input("副标题", "subtitle", obj.subtitle);

        const currentAlign = obj.sub_align || "";
        const globalAlign = getCurrentMenu().group_sub_align || "bottom";
        html += `
        <div class="form-row">
            <label>副标题对齐方式 <span style="font-size:10px;color:#aaa">(${obj.sub_align ? '私有' : '全局:'+globalAlign})</span></label>
            <select onchange="updateProp('${type}', ${gIdx}, ${iIdx}, 'sub_align', this.value)">
                <option value="">-- 继承 --</option>
                <option value="bottom" ${currentAlign==='bottom'?'selected':''}>底对齐 (Bottom)</option>
                <option value="center" ${currentAlign==='center'?'selected':''}>居中 (Center)</option>
                <option value="top" ${currentAlign==='top'?'selected':''}>顶对齐 (Top)</option>
            </select>
        </div>`;

        html += input("每行列数 (Grid模式)", "layout_columns", obj.layout_columns, "number", "placeholder='默认跟随全局'");
        
        // 分组类型选择
        const isTextGroup = obj.group_type === 'text';
        html += `<div class="form-row">
            <label>分组类型</label>
            <select onchange="updateProp('${type}', ${gIdx}, ${iIdx}, 'group_type', this.value)">
                <option value="normal" ${(!obj.group_type || obj.group_type === 'normal')?'selected':''}>功能项分组</option>
                <option value="text" ${obj.group_type === 'text'?'selected':''}>纯文本分组</option>
            </select>
        </div>`;
        
        // 纯文本分组的文本内容编辑
        if (isTextGroup) {
            html += textarea("文本内容", "text_content", obj.text_content || obj.subtitle || "");
            html += `<hr style="border-color:#444; margin: 20px 0;">`;
            html += `<div class="section-title">纯文本样式</div>`;
            html += color("文本颜色", "text_color", "group_sub_color");
            html += input("文本大小 (px)", "text_size", obj.text_size, "number", "placeholder='默认30'");
            html += fonts("文本字体", "text_font", "group_sub_font");
            html += textStyles("文本", "text");
            
            html += `<hr style="border-color:#444; margin: 20px 0;">`;
            html += `<div class="section-title">背景毛玻璃效果</div>`;
            html += color("背景颜色", "text_bg_color", "group_sub_bg_color");
            html += input("背景透明度", "text_bg_alpha", obj.text_bg_alpha, "range", "min='0' max='255' placeholder='0-255'");
            html += input("模糊半径", "text_bg_blur", obj.text_bg_blur, "number", "min='0' placeholder='0-15'");
        }
        
        html += `<div class="form-row" style="background:#333;padding:10px;border-radius:4px;margin-top:10px;display:flex;align-items:center;justify-content:space-between">
            <label style="margin:0">✨ 自由排版模式</label>
            <input type="checkbox" ${obj.free_mode?'checked':''} onclick="toggleGroupFreeMode(${gIdx}, this.checked)" style="width:20px;height:20px;" ${isTextGroup?'disabled':''}>
        </div>`;
        html += `<button class="btn btn-danger btn-block" style="margin-top:10px" onclick="deleteGroup(${gIdx})">删除此分组</button>`;
        html += `<hr style="border-color:#444; margin: 20px 0;">`;
        html += `<div class="section-title">样式覆盖 (独立设置)</div>`;
        html += color("标题颜色", "title_color", "group_title_color");
        html += input("标题大小 (px)", "title_size", obj.title_size, "number", "placeholder='默认'");
        html += fonts("标题字体", "title_font", "group_title_font");
        html += textStyles("标题", "group_title");
        html += color("副标题颜色", "sub_color", "group_sub_color");
        html += input("副标题大小 (px)", "sub_size", obj.sub_size, "number", "placeholder='默认'");
        html += textStyles("副标题", "group_sub");
        html += shadowSettings("标题", "group_title");
        
        // 毛玻璃设置
        html += `<hr style="border-color:#444; margin: 20px 0;">`;
        html += `<div class="section-title">毛玻璃效果</div>`;
        html += color("背景颜色", "bg_color", "group_bg_color");
        html += `<div class="form-row"><label>背景透明度 (0-255)</label><input type="range" max="255" value="${obj.bg_alpha!==undefined?obj.bg_alpha:''}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, 'bg_alpha', this.value)"></div>`;
        html += input("毛玻璃模糊半径 (px)", "blur_radius", obj.blur_radius, "number", "placeholder='默认继承全局'");
        html += input("自定义宽度 (px)", "custom_width", obj.custom_width, "number", "placeholder='默认自适应'");
        html += input("自定义高度 (px)", "custom_height", obj.custom_height, "number", "placeholder='默认自适应'");
    } else {
        html += input("功能名称", "name", obj.name);
        html += textarea("功能描述", "desc", obj.desc);

        // 图标选择器 - 使用全局函数调用
        const iconPreview = obj.icon ? 
            `<img src="/raw_assets/icons/${obj.icon}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid #555;">` :
            `<div style="width:32px;height:32px;background:#333;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px;border:1px solid #555;">无</div>`;
        html += `
        <div class="form-row">
            <label>图标</label>
            <div style="display:flex; gap:5px; align-items:center;">
                <div style="flex:1;display:flex;align-items:center;gap:8px;cursor:pointer;padding:5px;background:#2a2a2a;border-radius:4px;border:1px solid #444;" onclick="openIconPicker(${gIdx}, ${iIdx}, '${obj.icon || ''}')">
                    ${iconPreview}
                    <span style="flex:1;font-size:12px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${obj.icon || '点击选择...'}</span>
                    <span style="color:#888;font-size:14px;">▼</span>
                </div>
                <button class="btn btn-secondary" onclick="document.getElementById('itemIconUp').click()" title="上传新图标">⬆</button>
                <input type="file" id="itemIconUp" hidden accept="image/*" multiple onchange="uploadFile('icon', this)">
            </div>
        </div>`;

        if (obj.icon) {
            html += input("图标高度 (px)", "icon_size", obj.icon_size, "number", "placeholder='默认自适应'");
        }

        // 在非自由模式下显示顺序调整按钮
        const m = getCurrentMenu();
        const grp = m.groups[gIdx];
        if (!grp.free_mode) {
            const canMoveUp = iIdx > 0;
            const canMoveDown = iIdx < grp.items.length - 1;
            html += `<div class="form-row" style="display:flex;gap:5px;">
                <button class="btn btn-secondary" ${!canMoveUp ? 'disabled' : ''} onclick="moveItem(${gIdx}, ${iIdx}, -1)">⬆ 前进一位</button>
                <button class="btn btn-secondary" ${!canMoveDown ? 'disabled' : ''} onclick="moveItem(${gIdx}, ${iIdx}, 1)">⬇ 后退一位</button>
            </div>`;
        }

        html += `<button class="btn btn-danger btn-block" style="margin-top:10px" onclick="deleteCurrentItemProp(${gIdx}, ${iIdx})">删除此功能项</button>`;
        html += `<hr style="border-color:#444; margin: 20px 0;">`;
        html += `<div class="section-title">样式覆盖 (独立设置)</div>`;
        html += color("名称颜色", "name_color", "item_name_color");
        html += input("名称大小 (px)", "name_size", obj.name_size, "number", "placeholder='默认'");
        html += fonts("名称字体", "name_font", "item_name_font");
        html += textStyles("名称", "item_name");
        html += color("描述颜色", "desc_color", "item_desc_color");
        html += input("描述大小 (px)", "desc_size", obj.desc_size, "number", "placeholder='默认'");
        html += fonts("描述字体", "desc_font", "item_desc_font");
        html += textStyles("描述", "item_desc");
        html += shadowSettings("名称", "item_name");
        html += shadowSettings("描述", "item_desc");
        
        // 毛玻璃效果
        html += `<hr style="border-color:#444; margin: 20px 0;">`;
        html += `<div class="section-title">毛玻璃效果</div>`;
        html += color("背景颜色", "bg_color", "item_bg_color");
        html += `<div class="form-row"><label>背景透明度 (0-255)</label><input type="range" max="255" value="${obj.bg_alpha!==undefined?obj.bg_alpha:''}" oninput="updateProp('${type}', ${gIdx}, ${iIdx}, 'bg_alpha', this.value)"></div>`;
        html += input("毛玻璃模糊半径 (px)", "blur_radius", obj.blur_radius, "number", "placeholder='默认继承全局'");
        html += input("自定义宽度 (px)", "custom_width", obj.custom_width, "number", "placeholder='默认自适应'");
        html += input("自定义高度 (px)", "custom_height", obj.custom_height, "number", "placeholder='默认自适应'");
    }
    return html;
}

function initItemDrag(e, gIdx, iIdx, mode) {
    if (e.button !== 0) return;
    const m = getCurrentMenu();
    const grp = m.groups[gIdx];
    if (!grp.free_mode) return;
    e.stopPropagation();

    openContextEditor('item', gIdx, iIdx);

    const item = grp.items[iIdx];
    const el = document.getElementById(`item-${gIdx}-${iIdx}`);
    if (!el) return;

    const zoom = viewState.scale;

    dragData = {
        active: true,
        isDragging: false,
        mode: mode,
        type: 'item',
        gIdx: gIdx,
        iIdx: iIdx,
        startX: e.clientX,
        startY: e.clientY,
        initialVals: { x: item.x, y: item.y, w: item.w, h: item.h },
        cachedEl: el,
        zoom: zoom
    };
}

function initWidgetDrag(e, wIdx, mode) {
    if (e.button !== 0) return;
    e.stopPropagation();

    selectWidget(wIdx);

    const m = getCurrentMenu();
    const w = m.custom_widgets[wIdx];
    const el = document.getElementById(`widget-${wIdx}`);
    if (!el) return;

    const zoom = viewState.scale;

    dragData = {
        active: true,
        isDragging: false,
        mode: mode,
        type: 'widget',
        targetIdx: wIdx,
        startX: e.clientX,
        startY: e.clientY,
        initialVals: { x: w.x, y: w.y, w: w.width||100, h: w.height||100 },
        cachedEl: el,
        zoom: zoom
    };
}

function handleGlobalMouseMove(e) {
    if (!dragData.active) return;
    if (!dragData.isDragging) {
        if (Math.abs(e.clientX - dragData.startX) > 3 || Math.abs(e.clientY - dragData.startY) > 3) {
            dragData.isDragging = true;
            // 拖动开始时添加拖动样式
            if (dragData.cachedEl) {
                dragData.cachedEl.style.willChange = 'transform';
                dragData.cachedEl.style.zIndex = '9999';
            }
        } else return;
    }

    e.preventDefault();

    // 使用 RAF 节流，但核心逻辑使用 CSS transform 实现流畅拖动
    if (!rafLock) {
        rafLock = true;
        requestAnimationFrame(() => {
            if (!dragData.cachedEl) { rafLock = false; return; }
            
            const dx = (e.clientX - dragData.startX) / dragData.zoom;
            const dy = (e.clientY - dragData.startY) / dragData.zoom;

            if (dragData.mode === 'move') {
                // 使用 CSS transform 进行流畅移动，不更新数据
                dragData.cachedEl.style.transform = `translate(${dx}px, ${dy}px)`;
                // 缓存当前偏移量
                dragData.currentDx = dx;
                dragData.currentDy = dy;
            } else {
                // resize 模式：计算新尺寸
                let nw = dragData.initialVals.w + dx;
                let nh = dragData.initialVals.h + dy;
                if (nw < 20) nw = 20;
                if (nh < 20) nh = 20;
                
                dragData.cachedEl.style.width = Math.round(nw) + "px";
                dragData.cachedEl.style.height = Math.round(nh) + "px";
                // 缓存当前尺寸
                dragData.currentW = nw;
                dragData.currentH = nh;
            }
            rafLock = false;
        });
    }
}

function handleGlobalMouseUp(e) {
    if (dragData.active && dragData.isDragging) {
        const m = getCurrentMenu();
        let obj;
        
        if (dragData.type === 'item') {
            obj = m.groups[dragData.gIdx].items[dragData.iIdx];
        } else {
            obj = m.custom_widgets[dragData.targetIdx];
        }

        if (dragData.mode === 'move' && dragData.currentDx !== undefined) {
            // 计算最终位置
            let nx = dragData.initialVals.x + dragData.currentDx;
            let ny = dragData.initialVals.y + dragData.currentDy;
            
            // 吸附到0
            if (Math.abs(nx) < 10) nx = 0;
            if (Math.abs(ny) < 10) ny = 0;
            
            obj.x = Math.round(nx);
            obj.y = Math.round(ny);
        } else if (dragData.mode === 'resize') {
            if (dragData.type === 'item') {
                obj.w = Math.round(dragData.currentW || dragData.initialVals.w);
                obj.h = Math.round(dragData.currentH || dragData.initialVals.h);
            } else {
                obj.width = Math.round(dragData.currentW || dragData.initialVals.w);
                obj.height = Math.round(dragData.currentH || dragData.initialVals.h);
            }
        }

        // 清除拖动样式
        if (dragData.cachedEl) {
            dragData.cachedEl.style.transform = '';
            dragData.cachedEl.style.willChange = '';
            dragData.cachedEl.style.zIndex = '';
        }

        // 重绘画布更新最终位置
        renderCanvas(m);
        
        if (dragData.type === 'widget') updateWidgetEditor(m);
        else if (dragData.type === 'item') openContextEditor('item', dragData.gIdx, dragData.iIdx);
    }
    
    // 重置拖动状态
    dragData.active = false;
    dragData.isDragging = false;
    dragData.cachedEl = null;
    dragData.currentDx = undefined;
    dragData.currentDy = undefined;
    dragData.currentW = undefined;
    dragData.currentH = undefined;
}

function handleKeyDown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        if (selectedWidgetIdx !== -1) deleteWidget();
        else if (selectedItem.gIdx !== -1) deleteCurrentItemProp(selectedItem.gIdx, selectedItem.iIdx);
    }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        e.preventDefault();

        const m = getCurrentMenu();
        let obj, updateFn;

        if (selectedWidgetIdx !== -1) {
            obj = m.custom_widgets[selectedWidgetIdx];
            updateFn = () => updateWidgetEditor(m);
        } else if (selectedItem.gIdx !== -1 && m.groups[selectedItem.gIdx].free_mode) {
            obj = m.groups[selectedItem.gIdx].items[selectedItem.iIdx];
            updateFn = () => openContextEditor('item', selectedItem.gIdx, selectedItem.iIdx);
        } else return;

        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') obj.x = (parseInt(obj.x)||0) - step;
        if (e.key === 'ArrowRight') obj.x = (parseInt(obj.x)||0) + step;
        if (e.key === 'ArrowUp') obj.y = (parseInt(obj.y)||0) - step;
        if (e.key === 'ArrowDown') obj.y = (parseInt(obj.y)||0) + step;

        renderCanvas(m);
        updateFn();
    }
}

// =============================================================
//  通用图片选择器（完全模仿随机背景逻辑）
// =============================================================

let imagePickerCallback = null;
let imagePickerCurrentValue = '';
let imagePickerImages = [];  // 缓存当前图片列表
let imagePickerBasePath = '';  // 缓存当前路径
let imagePickerType = '';  // 缓存当前资源类型 (background, icon, widget, font, video)

function openImagePicker(type, currentValue, callback) {
    imagePickerCallback = callback;
    imagePickerCurrentValue = currentValue;
    imagePickerType = type;  // 保存资源类型
    
    let images = [];
    let basePath = '';
    let title = '选择图片';
    
    if (type === 'background') {
        images = appState.assets.backgrounds || [];
        basePath = '/raw_assets/backgrounds/';
        title = '选择背景图片';
    } else if (type === 'icon') {
        images = appState.assets.icons || [];
        basePath = '/raw_assets/icons/';
        title = '选择图标';
    } else if (type === 'widget') {
        images = appState.assets.widget_imgs || [];
        basePath = '/raw_assets/widgets/';
        title = '选择组件图片';
    }
    
    // 缓存用于搜索
    imagePickerImages = images;
    imagePickerBasePath = basePath;
    
    const modal = document.getElementById('imagePickerModal');
    const container = document.getElementById('imagePickerGrid');
    const titleEl = document.getElementById('imagePickerTitle');
    const searchInput = document.getElementById('imagePickerSearch');
    
    titleEl.innerText = title;
    if (searchInput) searchInput.value = '';  // 清空搜索框
    
    // 渲染图片列表
    renderImagePickerGrid(images, basePath, currentValue);
    
    modal.style.display = 'flex';
}

function renderImagePickerGrid(images, basePath, currentValue) {
    const container = document.getElementById('imagePickerGrid');
    container.innerHTML = '';
    
    if (images.length === 0 && imagePickerImages.length === 0) {
        container.innerHTML = '<div style="color:#888; text-align:center; grid-column:1/-1; padding:40px;">暂无图片，请先上传</div>';
        return;
    }
    
    // 添加"无"选项（只在未搜索或搜索为空时显示）
    const noneItem = document.createElement('div');
    noneItem.className = 'image-picker-item' + (!currentValue ? ' selected' : '');
    noneItem.innerHTML = `
        <div style="width:80px;height:80px;display:flex;align-items:center;justify-content:center;background:#333;border-radius:4px;color:#666;font-size:24px;">✕</div>
        <span>无</span>
    `;
    noneItem.onclick = function() { doSelectImage(''); };
    container.appendChild(noneItem);
    
    if (images.length === 0) {
        const noResult = document.createElement('div');
        noResult.style.cssText = 'color:#888; text-align:center; grid-column:1/-1; padding:20px;';
        noResult.innerText = '没有匹配的图片';
        container.appendChild(noResult);
        return;
    }
    
    // 添加所有图片选项
    images.forEach(function(img) {
        const isSelected = img === currentValue;
        const item = document.createElement('div');
        item.className = 'image-picker-item' + (isSelected ? ' selected' : '');
        item.style.position = 'relative';
        
        const imgHtml = `
            <img src="${basePath}${img}" style="width:80px;height:80px;object-fit:cover;border-radius:4px;">
            <span style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;" title="${img}">${img}</span>
        `;
        
        // 添加操作按钮
        const actionButtons = `
            <div style="position:absolute;top:0;right:0;background:rgba(0,0,0,0.7);border-radius:0 4px;padding:2px;display:flex;gap:2px;opacity:0;transition:opacity 0.3s;" class="asset-actions">
                <button class="btn btn-xs" style="padding:2px 4px;font-size:10px;color:#fff;" onclick="downloadAsset('${imagePickerType}', '${img.replace(/'/g, "\\'")}'); return false;" title="下载">📥</button>
                <button class="btn btn-xs btn-danger" style="padding:2px 4px;font-size:10px;color:#fff;" onclick="deleteAssetAndRefresh('${imagePickerType}', '${img.replace(/'/g, "\\'")}'); return false;" title="删除">🗑</button>
            </div>
        `;
        
        item.innerHTML = imgHtml + actionButtons;
        item.style.cursor = 'pointer';
        
        // 添加鼠标事件
        item.onmouseenter = function() {
            this.querySelector('.asset-actions').style.opacity = '1';
        };
        item.onmouseleave = function() {
            this.querySelector('.asset-actions').style.opacity = '0';
        };
        
        // 点击选择
        item.querySelector('img').parentElement.onclick = function(e) {
            if (!e.target.closest('.asset-actions')) {
                doSelectImage(img);
            }
        };
        
        container.appendChild(item);
    });
}

function filterImagePicker(keyword) {
    const kw = keyword.trim().toLowerCase();
    if (!kw) {
        // 空搜索，显示全部
        renderImagePickerGrid(imagePickerImages, imagePickerBasePath, imagePickerCurrentValue);
        return;
    }
    // 过滤匹配的图片
    const filtered = imagePickerImages.filter(function(img) {
        return img.toLowerCase().indexOf(kw) !== -1;
    });
    renderImagePickerGrid(filtered, imagePickerBasePath, imagePickerCurrentValue);
}

function doSelectImage(value) {
    if (imagePickerCallback) {
        imagePickerCallback(value);
    }
    document.getElementById('imagePickerModal').style.display = 'none';
    imagePickerCallback = null;
}

function closeImagePicker() {
    document.getElementById('imagePickerModal').style.display = 'none';
    imagePickerCallback = null;
}

async function downloadAsset(type, filename) {
    try {
        const response = await api("/download_asset", "POST", { type, filename });
        // 下载文件
        const url = window.URL.createObjectURL(response);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (e) {
        alert("❌ 下载失败: " + e);
    }
}

async function deleteAssetAndRefresh(type, filename) {
    if (!confirm(`确定要删除文件 "${filename}" 吗？此操作不可逆。`)) return;
    
    try {
        await api("/delete_asset", "POST", { type, filename });
        alert("✅ 文件已删除");
        await loadAssets();
        initFonts();
        renderAll();
        // 重新打开图片选择器
        if (imagePickerType) {
            openImagePicker(imagePickerType, imagePickerCurrentValue, imagePickerCallback);
        }
    } catch (e) {
        alert("❌ 删除失败: " + e);
    }
}

// 专用选择器函数（用于 HTML onclick 调用）
function openIconPicker(gIdx, iIdx, currentIcon) {
    openImagePicker('icon', currentIcon, function(v) {
        updateProp('item', gIdx, iIdx, 'icon', v);
        openContextEditor('item', gIdx, iIdx);
    });
}

function openBgPicker(currentBg) {
    openImagePicker('background', currentBg, function(v) {
        updateBg(v);
    });
}

function openWidgetImgPicker(currentImg) {
    openImagePicker('widget', currentImg, function(v) {
        updateWidget('content', v);
    });
}

// =============================================================
//  带预览的选择器渲染（用于侧边栏）
// =============================================================

function renderImageSelect(containerId, type, currentValue, onChangeCallback) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let basePath = '';
    if (type === 'background') basePath = '/raw_assets/backgrounds/';
    else if (type === 'icon') basePath = '/raw_assets/icons/';
    else if (type === 'widget') basePath = '/raw_assets/widgets/';
    
    container.innerHTML = '';
    
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:5px;background:#2a2a2a;border-radius:4px;border:1px solid #444;';
    
    // 预览图
    if (currentValue) {
        const img = document.createElement('img');
        img.src = basePath + currentValue;
        img.style.cssText = 'width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid #555;';
        wrapper.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'width:32px;height:32px;background:#333;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px;border:1px solid #555;';
        placeholder.innerText = '无';
        wrapper.appendChild(placeholder);
    }
    
    // 文本
    const text = document.createElement('span');
    text.style.cssText = 'flex:1;font-size:12px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    text.innerText = currentValue || '点击选择...';
    wrapper.appendChild(text);
    
    // 箭头
    const arrow = document.createElement('span');
    arrow.style.cssText = 'color:#888;font-size:14px;';
    arrow.innerText = '▼';
    wrapper.appendChild(arrow);
    
    // 点击打开选择器
    wrapper.onclick = function() {
        openImagePicker(type, currentValue || '', function(selectedValue) {
            onChangeCallback(selectedValue);
        });
    };
    
    container.appendChild(wrapper);
}

// =============================================================
//  随机背景功能
// =============================================================

function openRandomBgModal() {
    const m = getCurrentMenu();
    const bgList = appState.assets.backgrounds || [];
    const selectedBgs = m.backgrounds || [];
    
    const container = document.getElementById('randomBgCheckList');
    container.innerHTML = '';
    
    if (bgList.length === 0) {
        container.innerHTML = '<div style="color:#888; text-align:center; grid-column:1/-1;">暂无背景图片，请先上传</div>';
        document.getElementById('randomBgModal').style.display = 'flex';
        return;
    }
    
    bgList.forEach(bg => {
        const isChecked = selectedBgs.includes(bg);
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; align-items:center; gap:8px; padding:5px; background:#333; border-radius:4px;';
        item.innerHTML = `
            <input type="checkbox" class="random-bg-check" value="${bg}" ${isChecked ? 'checked' : ''} style="width:16px;height:16px;">
            <img src="/raw_assets/backgrounds/${bg}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">
            <span style="font-size:11px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${bg}">${bg}</span>
        `;
        container.appendChild(item);
    });
    
    document.getElementById('randomBgModal').style.display = 'flex';
}

function confirmRandomBgSelection() {
    const m = getCurrentMenu();
    const checks = document.querySelectorAll('.random-bg-check:checked');
    const selected = Array.from(checks).map(c => c.value);
    
    m.backgrounds = selected;
    
    // 更新显示
    renderRandomBgList();
    document.getElementById('randomBgModal').style.display = 'none';
}

function renderRandomBgList() {
    const m = getCurrentMenu();
    const container = document.getElementById('randomBgList');
    if (!container) return;
    
    const bgList = m.backgrounds || [];
    
    if (bgList.length === 0) {
        container.innerHTML = '<div style="color:#666; font-size:11px; text-align:center;">未配置随机背景</div>';
        return;
    }
    
    container.innerHTML = bgList.map(bg => `
        <div style="display:inline-flex; align-items:center; gap:4px; margin:2px; padding:3px 6px; background:#333; border-radius:4px; font-size:10px;">
            <img src="/raw_assets/backgrounds/${bg}" style="width:20px;height:20px;object-fit:cover;border-radius:2px;">
            <span style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${bg}">${bg}</span>
            <span style="cursor:pointer;color:#f56c6c;" onclick="removeRandomBg('${bg}')">&times;</span>
        </div>
    `).join('');
}

function removeRandomBg(bgName) {
    const m = getCurrentMenu();
    m.backgrounds = (m.backgrounds || []).filter(b => b !== bgName);
    renderRandomBgList();
}