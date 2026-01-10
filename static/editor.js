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
async function saveAll() { await api("/config", "POST", appState.fullConfig); alert("✅ 已保存"); }

async function exportImage() {
    await api("/config", "POST", appState.fullConfig);
    const menu = getCurrentMenu();
    if (menu.bg_type === 'video') alert("⏳ 正在生成动图，视频处理较慢，请耐心等待...");

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
    } else alert("导出失败");
}

function getStyle(obj, key, fallbackGlobalKey) {
    const m = getCurrentMenu();
    if (obj && obj[key] !== undefined && obj[key] !== "") return obj[key];
    return m[fallbackGlobalKey];
}

// =============================================================
//  核心新功能：批量上传、导入、导出
// =============================================================

/**
 * 批量上传文件
 * 支持多选，循环上传，最后统一刷新
 */
async function uploadFile(type, inp) {
    const files = inp.files;
    if (!files || files.length === 0) return;

    let successCount = 0;
    let failCount = 0;

    // 显示加载状态（可选）
    const originalText = inp.previousElementSibling ? inp.previousElementSibling.innerText : '';
    if(inp.previousElementSibling) inp.previousElementSibling.innerText = "⏳...";

    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const d = new FormData();
        d.append("type", type);
        d.append("file", f);

        try {
            const res = await api("/upload", "POST", d);
            successCount++;

            // 如果是单个文件上传，且是背景/视频，直接应用到当前菜单
            if (files.length === 1) {
                const m = getCurrentMenu();
                if (type === 'video' && res.filename) m.bg_video = res.filename;
                else if (type === 'background' && res.filename) m.background = res.filename;
                else if (type === 'icon' && selectedItem.gIdx !== -1) {
                     // 图标特殊处理：如果是单个上传，直接赋值给当前选中项
                     updateProp('item', selectedItem.gIdx, selectedItem.iIdx, 'icon', res.filename);
                }
            }
        } catch (e) {
            console.error(`File ${f.name} upload failed:`, e);
            failCount++;
        }
    }

    // 恢复按钮文本
    if(inp.previousElementSibling) inp.previousElementSibling.innerText = originalText;

    // 刷新资源列表
    await loadAssets();
    if (type === 'font') initFonts();
    renderAll();

    // 如果在编辑组件或属性面板，刷新下拉框
    if (selectedWidgetIdx !== -1) updateWidgetEditor(getCurrentMenu());
    if (selectedItem.gIdx !== -1) openContextEditor('item', selectedItem.gIdx, selectedItem.iIdx);

    alert(`上传完成\n✅ 成功: ${successCount}\n❌ 失败: ${failCount}`);
    inp.value = ""; // 清空 input 防止重复触发
}

/**
 * 导出模板包 (Zip)
 * 包含当前菜单配置 + 所有引用的素材
 */
async function exportTemplatePack() {
    await api("/config", "POST", appState.fullConfig); // 先保存
    const menu = getCurrentMenu();

    if(!confirm(`即将导出菜单模板 "${menu.name}" 及其使用的图片、字体等素材。\n是否继续？`)) return;

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
            alert("导出失败: " + err);
        }
    } catch (e) {
        alert("导出请求错误: " + e);
    }
}

/**
 * 导入模板包 (Zip)
 */
async function importTemplatePack(inp) {
    const file = inp.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
        // 显示 loading
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
            alert(`✅ 导入成功！\n已导入菜单: ${data.menu_name}`);
            // 重新加载配置和资源
            await loadAssets();
            initFonts(); // 刷新字体
            await loadConfig();
            // 切换到新导入的菜单 (假设后端将其放在了最后)
            if (appState.fullConfig.menus.length > 0) {
                switchMenu(appState.fullConfig.menus[appState.fullConfig.menus.length - 1].id);
            }
        } else {
            const err = await res.text();
            alert("❌ 导入失败: " + err);
        }
    } catch (e) {
        alert("导入错误: " + e);
    } finally {
        inp.value = "";
        const btn = inp.previousElementSibling;
        btn.innerText = "📦"; // 恢复按钮图标（或者你原来的图标）
        btn.disabled = false;
    }
}

// =============================================================
//  菜单基础操作
// =============================================================

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
        title: "标题",
        sub_title: "Subtitle", // 默认副标题
        groups: [],
        custom_widgets: [],
        // --- 核心样式默认值 (关键修复) ---
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
        // --- 布局默认值 ---
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
    // 兼容性/空值防御
    if (!m.video_scale) m.video_scale = 1.0;
    if (!m.bg_fit_mode) m.bg_fit_mode = "cover";
    if (!m.title_size) m.title_size = 60; // 防御旧数据缺失

    updateFormInputs(m);
    renderSidebarGroupList(m);
    renderCanvas(m);
    updateWidgetEditor(m);
}

// =============================================================
//  表单与参数更新
// =============================================================

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
    // 基础设置
    setValue("columnInput", m.layout_columns || 3);
    setValue("cvsW", m.canvas_width || 1000);
    setValue("cvsH", m.canvas_height || 2000);
    if (document.getElementById("canvasMode")) document.getElementById("canvasMode").value = m.use_canvas_size ? "true" : "false";

    setValue("expScaleInput", m.export_scale || 1.0);
    setValue("cvsColorP", m.canvas_color || "#1e1e1e");
    setValue("cvsColorT", m.canvas_color || "#1e1e1e");

    // 背景设置
    setValue("bgType", m.bg_type || "image");
    setValue("bgFit", m.bg_fit_mode || "cover");
    setValue("bgAlignX", m.bg_align_x || "center");
    setValue("bgAlignY", m.bg_align_y || "center");

    // 缩放值
    const bgScale = m.video_scale !== undefined ? m.video_scale : 1.0;
    setValue("bgScaleRange", bgScale);
    setValue("bgScaleInput", bgScale);
    const scaleValSpan = document.getElementById("bgScaleVal");
    if(scaleValSpan) scaleValSpan.innerText = bgScale;

    setValue("bgCustomW", m.bg_custom_width || 1000);
    setValue("bgCustomH", m.bg_custom_height || 1000);
    toggleBgCustomInputs();

    // 图片与视频资源
    renderSelect("bgSelect", appState.assets.backgrounds, m.background, "无背景");
    renderSelect("vidSelect", appState.assets.videos, m.bg_video, "无视频");

    setValue("vStart", m.video_start || 0);
    setValue("vEnd", m.video_end || "");
    setValue("vFps", m.video_fps || 12);
    setValue("vFormat", m.video_export_format || "webp");

    toggleBgPanel();

    // 样式颜色
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
    renderSelect("fIName", appState.assets.fonts, m.item_name_font);
    renderSelect("fIDesc", appState.assets.fonts, m.item_desc_font);

    document.getElementById("shadowEn").checked = !!m.shadow_enabled;
    setValue("shadowColP", m.shadow_color || "#000000");
    setValue("shadowColT", m.shadow_color || "#000000");
    setValue("shadowX", m.shadow_offset_x !== undefined ? m.shadow_offset_x : 2);
    setValue("shadowY", m.shadow_offset_y !== undefined ? m.shadow_offset_y : 2);
    setValue("shadowR", m.shadow_radius !== undefined ? m.shadow_radius : 2);

    // 批量设置颜色输入框
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
    if (['layout_columns', 'canvas_width', 'canvas_height', 'group_blur_radius', 'item_blur_radius', 'group_bg_alpha', 'item_bg_alpha', 'shadow_offset_x', 'shadow_offset_y', 'shadow_radius', 'bg_custom_width', 'bg_custom_height', 'video_fps'].includes(key)) {
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
    // 强制触发更新
    if (type === 'align_x') {
        m.bg_align_x = val;
        m.video_align_x = val;
    } else if (type === 'align_y') {
        m.bg_align_y = val;
        m.video_align = val; // video_align 是旧 key，保留兼容
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

// =============================================================
//  渲染画布 (HTML DOM Preview) - [Flexbox 修复版]
// =============================================================

function renderCanvas(m) {
    const cvsWrapper = document.getElementById("canvas-wrapper");
    const cvs = document.getElementById("canvas");
    const bgPreviewLayer = document.getElementById("bg-preview-layer");
    const vidPreview = document.getElementById("canvas-video-preview");
    const imgPreview = document.getElementById("canvas-img-preview");

    // 1. 计算画布尺寸
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

    // 2. 渲染背景 (使用 Flexbox 布局修复对齐问题)
    const bgType = m.bg_type || 'image';
    const bgFit = m.bg_fit_mode || 'cover';
    const alignX = m.bg_align_x || 'center';
    const alignY = m.bg_align_y || 'center';
    const bgScale = parseFloat(m.video_scale !== undefined ? m.video_scale : 1.0);
    const userBgColor = m.canvas_color || '#1e1e1e';

    // 缩放处理
    const transformCSS = `scale(${bgScale})`;

    // 清空内联背景图 (旧逻辑)
    cvs.style.backgroundImage = 'none';

    // 状态判定
    const hasVideo = bgType === 'video' && m.bg_video;
    const hasImage = bgType === 'image' && m.background;

    // 配置 Preview Layer 容器 (Flexbox 用于绝对对齐)
    // 重置所有影响布局的样式
    bgPreviewLayer.style.display = (hasVideo || hasImage) ? 'flex' : 'none';
    bgPreviewLayer.style.flexDirection = 'column'; // 垂直排列，方便主轴/交叉轴映射
    bgPreviewLayer.style.overflow = 'hidden';
    bgPreviewLayer.style.backgroundColor = userBgColor;

    // 映射对齐到 Flex 属性
    // justify-content 控制垂直 (因为 flexDirection: column)
    // align-items 控制水平
    const flexMapY = { 'top': 'flex-start', 'center': 'center', 'bottom': 'flex-end' };
    const flexMapX = { 'left': 'flex-start', 'center': 'center', 'right': 'flex-end' };

    bgPreviewLayer.style.justifyContent = flexMapY[alignY] || 'center';
    bgPreviewLayer.style.alignItems = flexMapX[alignX] || 'center';

    // 前景透明化
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

        // 应用缩放
        vidPreview.style.transform = transformCSS;
        // 关键：Flex布局下，transformOrigin 设为 center 保证缩放后仍居中对齐
        vidPreview.style.transformOrigin = 'center center';

        // 视频尺寸与 Object-Fit 策略
        if (bgFit === 'cover' || bgFit === 'contain') {
            // 标准模式：占满容器，内部对齐依靠 object-position
            vidPreview.style.width = '100%';
            vidPreview.style.height = '100%';
            vidPreview.style.objectFit = bgFit;
            vidPreview.style.objectPosition = `${alignX} ${alignY}`;
            // 在此模式下 Flex 父容器的对齐其实不起作用，起作用的是 object-position
        } else {
            // 自定义/单向填满模式：依靠 Flex 父容器对齐，本身重置 object-fit
            vidPreview.style.objectFit = 'fill'; // 强制拉伸填满设定的宽高

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
        // 图片预览逻辑同理
        vidPreview.style.display = 'none';
        imgPreview.style.display = 'block';

        // 由于 imgPreview 是 100% 100% 的 div，Flex 对其无影响，使用 background-position
        const imgUrl = `url('/raw_assets/backgrounds/${m.background}')`;
        imgPreview.style.backgroundImage = imgUrl;
        imgPreview.style.backgroundRepeat = 'no-repeat';

        // CSS background-position 完美支持各种对齐，不需要 Flex hack
        imgPreview.style.backgroundPosition = `${alignX} ${alignY}`;
        imgPreview.style.transform = transformCSS;
        imgPreview.style.transformOrigin = `${alignX} ${alignY}`; // 缩放基点跟随对齐
        imgPreview.style.width = '100%';
        imgPreview.style.height = '100%';

        if (bgFit === 'cover') imgPreview.style.backgroundSize = 'cover';
        else if (bgFit === 'contain') imgPreview.style.backgroundSize = 'contain';
        else if (bgFit === 'cover_w') imgPreview.style.backgroundSize = '100% auto';
        else if (bgFit === 'cover_h') imgPreview.style.backgroundSize = 'auto 100%';
        else if (bgFit === 'custom') imgPreview.style.backgroundSize = `${m.bg_custom_width}px ${m.bg_custom_height}px`;
    }

    // 3. 渲染 DOM 内容
    let shadowCss = 'none';
    if (m.shadow_enabled) {
        shadowCss = `${m.shadow_offset_x}px ${m.shadow_offset_y}px ${m.shadow_radius}px ${m.shadow_color}`;
    }

    const gfTitle = cssFont(m.title_font);
    const titleAlign = m.title_align || 'center';

    // 使用默认值防止 undefined
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
        const gBlur = m.group_blur_radius > 0 ? `backdrop-filter: blur(${m.group_blur_radius}px);` : '';
        const freeMode = g.free_mode === true;

        // 计算高度
        let contentHeight = "auto";
        if (freeMode) {
            let maxBottom = 0;
            (g.items || []).forEach(item => { const b = (parseInt(item.y) || 0) + (parseInt(item.h) || 100); if (b > maxBottom) maxBottom = b; });
            contentHeight = Math.max(Number(g.min_height) || 100, maxBottom + 20) + "px";
        }

        const gridStyle = freeMode ? '' : `display:grid; gap:15px; padding:20px; grid-template-columns: repeat(${g.layout_columns || m.layout_columns || 3}, 1fr);`;

        const gTitleSz = getStyle(g, 'title_size', 'group_title_size') || 30;
        const gTitleFont = cssFont(getStyle(g, 'title_font', 'group_title_font'));

        html += `
        <div class="group-wrapper">
            <div class="group-header-wrap" onclick="openContextEditor('group', ${gIdx}, -1)" style="padding:0 0 10px 10px; cursor:pointer; text-shadow:${shadowCss};">
                <span style="color:${getStyle(g, 'title_color', 'group_title_color')}; font-family:'${gTitleFont}'; font-size:${gTitleSz}px">${g.title}</span>
            </div>
            <div class="group-content-box" style="background-color:${gRgba}; ${gBlur}; height:${contentHeight}; position:relative; ${freeMode ? 'overflow:visible' : gridStyle} border-radius:15px;">`;

        (g.items || []).forEach((item, iIdx) => {
            const iRgba = hexToRgba(getStyle(item, 'bg_color', 'item_bg_color'), (item.bg_alpha !== undefined ? item.bg_alpha : m.item_bg_alpha) / 255);
            const icon = item.icon ? `<img src="/raw_assets/icons/${item.icon}" class="item-icon" style="${item.icon_size ? `height:${item.icon_size}px` : ''}">` : '';

            const iNameSz = getStyle(item, 'name_size', 'item_name_size') || 26;
            const iDescSz = getStyle(item, 'desc_size', 'item_desc_size') || 16;
            const iNameFont = cssFont(getStyle(item, 'name_font', 'item_name_font'));
            const iDescFont = cssFont(getStyle(item, 'desc_font', 'item_desc_font'));

            const txt = `
                <div class="item-text-content" style="text-shadow:${shadowCss};">
                    <div style="color:${getStyle(item, 'name_color', 'item_name_color')};font-family:'${iNameFont}';font-size:${iNameSz}px;">${item.name}</div>
                    <div style="color:${getStyle(item, 'desc_color', 'item_desc_color')};font-family:'${iDescFont}';font-size:${iDescSz}px;margin-top:5px;white-space:pre-wrap;">${item.desc || ''}</div>
                </div>`;

            if (freeMode) {
                const isSel = selectedItem.gIdx === gIdx && selectedItem.iIdx === iIdx;
                html += `<div class="free-item ${isSel ? 'selected' : ''}" id="item-${gIdx}-${iIdx}" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;background-color:${iRgba};" onmousedown="initItemDrag(event,${gIdx},${iIdx},'move')">${icon}${txt}${isSel ? `<div class="resize-handle" onmousedown="initItemDrag(event,${gIdx},${iIdx},'resize')"></div>` : ''}</div>`;
            } else {
                html += `<div class="grid-item" style="background-color:${iRgba};height:90px;" onclick="openContextEditor('item', ${gIdx}, ${iIdx})">${icon}${txt}</div>`;
            }
        });

        if (!freeMode) {
            html += `<div class="grid-item add-item-btn" onclick="addItem(${gIdx})"><span>+</span></div>`;
        }
        html += `</div></div>`;
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

// =============================================================
//  交互：拖拽与事件
// =============================================================

function toggleGroupFreeMode(gIdx, isFree) {
    const m = getCurrentMenu();
    m.groups[gIdx].free_mode = isFree;
    renderAll();
    openContextEditor('group', gIdx, -1);
}

function renderSidebarGroupList(m) {
    const list = document.getElementById("groupList");
    list.innerHTML = "";
    (m.groups || []).forEach((g, idx) => {
        const div = document.createElement("div");
        div.className = "group-item";
        div.innerHTML = `<div style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;"><div style="font-weight:500;">${g.title}${g.free_mode ? ' <span style="font-size:9px;background:#0e639c;padding:1px 3px;border-radius:2px;">自由</span>' : ''}</div></div><div class="group-actions"><span class="icon-btn" onclick="addItem(${idx})">+</span><span class="icon-btn" onclick="moveGroup(${idx}, -1)">↑</span><span class="icon-btn" onclick="moveGroup(${idx}, 1)">↓</span></div>`;
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

async function uploadFile(type, inp) {
    const f = inp.files[0];
    if (!f) return;
    const d = new FormData();
    d.append("type", type);
    d.append("file", f);
    try {
        const res = await api("/upload", "POST", d);
        alert("上传成功");
        await loadAssets();
        if (type === 'font') initFonts();

        const m = getCurrentMenu();
        if (type === 'video' && res.filename) {
            m.bg_video = res.filename;
        } else if (type === 'background' && res.filename) {
            m.background = res.filename;
        }

        renderAll();

        if (type === 'icon' && selectedItem.gIdx !== -1) {
            openContextEditor('item', selectedItem.gIdx, selectedItem.iIdx);
        }
        if (type === 'widget_img' && selectedWidgetIdx !== -1) {
            updateWidgetEditor(getCurrentMenu());
        }

    } catch (e) { alert("上传失败!"); } finally { inp.value = ""; }
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
        renderSelect("widImgSelect", appState.assets.widget_imgs, w.content, "选择图片");
    } else {
        document.getElementById("wEdit-image").style.display = "none";
        document.getElementById("wEdit-text").style.display = "block";
        setValue("widText", w.text);
        setValue("widSize", w.size || 40); // 修复默认值
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

function updateMenuMeta(key, val) {
    const m = getCurrentMenu();
    if(['layout_columns', 'canvas_width', 'canvas_height', 'group_blur_radius', 'item_blur_radius', 'group_bg_alpha', 'item_bg_alpha', 'shadow_offset_x', 'shadow_offset_y', 'shadow_radius', 'bg_custom_width', 'bg_custom_height', 'video_fps'].includes(key)) {
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

function updateBg(val) {
    updateMenuMeta('background', val);
}

function updateColor(key, val, src) { if (src === 'text' && !val.startsWith('#')) val = '#' + val; updateMenuMeta(key, val); }
function initFonts() { (appState.assets.fonts || []).forEach(n => { const id="f-"+n; if(!document.getElementById(id)) { const s=document.createElement("style"); s.id=id; s.textContent=`@font-face { font-family: '${cssFont(n)}'; src: url('/fonts/${n}'); }`; document.head.appendChild(s); } }); }
function cssFont(n) { return n ? n.replace(/[^a-zA-Z0-9_]/g, '_') : 'sans-serif'; }

const get_style = getStyle;

// --- 新增：自动填充逻辑 ---
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

    // 排序插件名
    const sortedPlugins = Object.keys(data).sort();

    sortedPlugins.forEach(pluginName => {
        const cmds = data[pluginName];
        if (!cmds || cmds.length === 0) return;

        const groupDiv = document.createElement('div');
        groupDiv.style.marginBottom = '10px';

        // 插件标题 + 全选框
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

        // 指令列表
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
        if (chk.value) { // 排除插件标题的全选框 (没有 value)
            try {
                selectedData.push(JSON.parse(chk.value));
            } catch(e){}
        }
    });

    if (selectedData.length === 0) {
        alert("请先选择要导入的指令！");
        return;
    }

    // 按插件分组整理数据
    const grouped = {};
    selectedData.forEach(item => {
        if (!grouped[item.p]) grouped[item.p] = [];
        grouped[item.p].push(item.c);
    });

    const m = getCurrentMenu();
    let addedCount = 0;

    // 为每个插件创建一个新分组
    for (const [pluginName, cmds] of Object.entries(grouped)) {
        const newGroup = {
            title: pluginName,
            subtitle: "Plugin Commands",
            items: [],
            free_mode: false // 自动填充默认使用 Grid 模式
        };

        cmds.forEach(c => {
            newGroup.items.push({
                name: c.cmd,
                desc: c.desc || "...",
                icon: "",
                x: 0, y: 0, w: 200, h: 80 // Grid 模式下 xy 无效，但给个默认值
            });
            addedCount++;
        });

        m.groups.push(newGroup);
    }

    document.getElementById('autoFillModal').style.display='none';
    renderAll();
    alert(`✅ 已成功导入 ${addedCount} 个指令到新分组！`);
}

// -------------------------------------------------------------
//  上下文属性编辑表单 (Prop Panel)
// -------------------------------------------------------------

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
                <!-- multiple -->
                <input type="file" id="itemIconUp" hidden accept="image/*" multiple onchange="uploadFile('icon', this)">
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
        if (['title_size', 'sub_size', 'name_size', 'desc_size', 'bg_alpha', 'layout_columns', 'width', 'height', 'x', 'y', 'w', 'h', 'group_blur_radius', 'item_blur_radius', 'canvas_width', 'canvas_height', 'icon_size', 'bg_custom_width', 'bg_custom_height'].includes(key)) {
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

// =============================================================
//  全局鼠标事件 (Global Dragging)
// =============================================================

function initItemDrag(e, gIdx, iIdx, mode) {
    if (e.button !== 0) return;
    const m = getCurrentMenu();
    const grp = m.groups[gIdx];
    if (!grp.free_mode) return;
    e.stopPropagation();

    // 选中
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
        } else return;
    }

    // 防止选中文字
    e.preventDefault();

    if (!rafLock) {
        rafLock = true;
        requestAnimationFrame(() => {
            const dx = (e.clientX - dragData.startX) / dragData.zoom;
            const dy = (e.clientY - dragData.startY) / dragData.zoom;

            const m = getCurrentMenu();
            let obj;
            if (dragData.type === 'item') obj = m.groups[dragData.gIdx].items[dragData.iIdx];
            else obj = m.custom_widgets[dragData.targetIdx];

            if (dragData.mode === 'move') {
                // 简单的吸附逻辑：10px
                let nx = dragData.initialVals.x + dx;
                let ny = dragData.initialVals.y + dy;
                if (Math.abs(nx) < 10) nx = 0;
                if (Math.abs(ny) < 10) ny = 0;

                obj.x = Math.round(nx);
                obj.y = Math.round(ny);

                dragData.cachedEl.style.left = obj.x + "px";
                dragData.cachedEl.style.top = obj.y + "px";
            } else {
                // resize
                let nw = dragData.initialVals.w + dx;
                let nh = dragData.initialVals.h + dy;
                if (nw < 20) nw = 20;
                if (nh < 20) nh = 20;

                if (dragData.type === 'item') {
                    obj.w = Math.round(nw);
                    obj.h = Math.round(nh);
                    dragData.cachedEl.style.width = obj.w + "px";
                    dragData.cachedEl.style.height = obj.h + "px";
                } else {
                    obj.width = Math.round(nw);
                    obj.height = Math.round(nh);
                    dragData.cachedEl.style.width = obj.width + "px";
                    dragData.cachedEl.style.height = obj.height + "px";
                }
            }
            rafLock = false;
        });
    }
}

function handleGlobalMouseUp(e) {
    if (dragData.active) {
        dragData.active = false;
        dragData.isDragging = false;
        dragData.cachedEl = null;
        // 拖拽结束，触发一次完全重绘以保存状态/更新关联UI
        renderCanvas(getCurrentMenu());
        if (dragData.type === 'widget') updateWidgetEditor(getCurrentMenu());
        else if (dragData.type === 'item') openContextEditor('item', dragData.gIdx, dragData.iIdx);
    }
}

function handleKeyDown(e) {
    // 删除快捷键
    if (e.key === 'Delete' || e.key === 'Backspace') {
        // 如果正在输入框中，不处理
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        if (selectedWidgetIdx !== -1) deleteWidget();
        else if (selectedItem.gIdx !== -1) deleteCurrentItemProp(selectedItem.gIdx, selectedItem.iIdx);
    }
    // 方向键微调 (仅当选中元素时)
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