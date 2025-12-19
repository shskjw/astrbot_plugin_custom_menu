let data = { groups: [] };
let assets = { backgrounds: [], icons: [], fonts: [] };
const PRESET_COLORS = ["#FFFFFF", "#000000", "#FF5757", "#FFB357", "#FFFF57", "#57FF57", "#57FFFF", "#579BFF", "#BD57FF", "#FF57C8", "#CCCCCC", "#333333"];
let editingType = null;
let editingIdx = { g: -1, i: -1 };

init();
async function init() {
    initSwatches();
    try {
        await Promise.all([loadAssets(), loadFonts(), loadMenu()]);

        // 渲染前先加载当前选中的字体
        if(data.title_font) injectFontCSS(data.title_font);
        if(data.text_font) injectFontCSS(data.text_font);

        renderCanvas();
        updateColorInputs();
        updateFontSelects();
    } catch (e) {
        if(e.status === 401) window.location.href = "/login";
        console.error(e);
    }
}

function initSwatches() {
    const create = (id, type) => {
        const c = document.getElementById(id);
        PRESET_COLORS.forEach(col => {
            let d = document.createElement("div");
            d.className = "swatch";
            d.style.backgroundColor = col;
            d.onclick = () => updateColor(type, col);
            c.appendChild(d);
        });
    };
    create("titleSwatches", "title");
    create("textSwatches", "text");
}

async function api(url, method="GET", body=null) {
    let opts = { method };
    if (body) {
        if (body instanceof FormData) opts.body = body;
        else {
            opts.headers = { "Content-Type": "application/json" };
            opts.body = JSON.stringify(body);
        }
    }
    let res = await fetch("/api" + url, opts);
    if (!res.ok) throw res;
    return res.json();
}

async function loadAssets() {
    assets = await api("/assets");
    renderAssetSelects();
}

// 新增：加载字体列表
async function loadFonts() {
    assets.fonts = await api("/fonts");
}

async function loadMenu() {
    data = await api("/menu");
    if (!data.title_color) data.title_color = "#FFFFFF";
    if (!data.text_color) data.text_color = "#FFFFFF";
    // 默认字体
    if (!data.title_font) data.title_font = "title.ttf";
    if (!data.text_font) data.text_font = "text.ttf";
}

// 核心：动态注入字体 CSS
function injectFontCSS(fontFilename) {
    if (!fontFilename) return;
    // 检查是否已经注入过，防止重复
    if (document.getElementById(`font-${fontFilename}`)) return;

    const style = document.createElement('style');
    style.id = `font-${fontFilename}`;
    // font-family 直接用文件名 (去掉非法字符)
    const familyName = fontFilename.replace(/\./g, '_');

    style.textContent = `
        @font-face {
            font-family: '${familyName}';
            src: url('/fonts/${fontFilename}');
        }
    `;
    document.head.appendChild(style);
}

// 更新下拉框
function updateFontSelects() {
    const fill = (id, val) => {
        const sel = document.getElementById(id);
        sel.innerHTML = '';
        assets.fonts.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.innerText = f;
            sel.appendChild(opt);
        });
        sel.value = val;
    };
    fill("titleFontSelect", data.title_font);
    fill("textFontSelect", data.text_font);
}

function updateFont(type, fontFilename) {
    injectFontCSS(fontFilename);
    const familyName = fontFilename.replace(/\./g, '_');

    if (type === 'title') {
        data.title_font = fontFilename;
        document.querySelectorAll('.main-title, .item-name').forEach(el => {
            el.style.fontFamily = `'${familyName}', sans-serif`;
        });
    } else if (type === 'text') {
        data.text_font = fontFilename;
        document.querySelectorAll('.sub-title, .group-title, .item-desc').forEach(el => {
            el.style.fontFamily = `'${familyName}', sans-serif`;
        });
    }
}

function updateColor(type, color) {
    if (type === 'title') {
        data.title_color = color;
        document.querySelectorAll('.main-title').forEach(el => el.style.color = color);
    } else if (type === 'text') {
        data.text_color = color;
        document.querySelectorAll('.item-name, .group-title').forEach(el => el.style.color = color);
    }
    updateColorInputs();
}

function updateColorInputs() {
    document.getElementById("titleColorPick").value = data.title_color;
    document.getElementById("titleColorText").value = data.title_color;
    document.getElementById("textColorPick").value = data.text_color;
    document.getElementById("textColorText").value = data.text_color;
}

function renderCanvas() {
    const cvs = document.getElementById("canvas");
    if(data.background) cvs.style.backgroundImage = `url('/raw_assets/backgrounds/${data.background}')`;
    else cvs.style.backgroundImage = 'none';

    // 获取当前字体对应的 CSS Family Name
    const titleFamily = data.title_font ? data.title_font.replace(/\./g, '_') : 'sans-serif';
    const textFamily = data.text_font ? data.text_font.replace(/\./g, '_') : 'sans-serif';

    let html = `
        <div class="header-area">
            <div class="main-title" onclick="editGlobal()" style="color:${data.title_color}; font-family: '${titleFamily}'">${data.title || '标题'}</div>
            <div class="sub-title" onclick="editGlobal()" style="font-family: '${textFamily}'">${data.sub_title || ''}</div>
        </div>
    `;

    (data.groups || []).forEach((group, gIdx) => {
        html += `<div class="group-section">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="group-title" onclick="editGroup(${gIdx})" style="color:${data.text_color}; font-family: '${textFamily}'">${group.title}</div>
                <div style="font-size:12px; cursor:pointer; color:#f56c6c;" onclick="deleteGroup(${gIdx})">删除</div>
            </div>
            <div class="group-box">`;
        (group.items || []).forEach((item, iIdx) => {
            let iconSrc = item.icon ? `/raw_assets/icons/${item.icon}` : '';
            html += `<div class="item-card" onclick="editItem(${gIdx}, ${iIdx})">
                <img class="item-icon" src="${iconSrc}" onerror="this.style.opacity=0">
                <div class="item-info">
                    <div class="item-name" style="color:${data.text_color}; font-family: '${titleFamily}'">${item.name}</div>
                    <div class="item-desc" style="font-family: '${textFamily}'">${item.desc}</div>
                </div>
            </div>`;
        });
        html += `<div class="add-item-btn" onclick="addNewItem(${gIdx})">+</div></div></div>`;
    });
    html += `<div class="add-group-btn" onclick="addNewGroup()">+ 新增分组</div>`;
    cvs.innerHTML = html;
    document.getElementById("bgSelect").value = data.background || "";
}

function renderAssetSelects() {
    let bgSel = document.getElementById("bgSelect");
    let iconSel = document.getElementById("inp-icon");
    bgSel.innerHTML = '<option value="">无背景</option>';
    assets.backgrounds.forEach(b => bgSel.innerHTML += `<option value="${b}">${b}</option>`);
    iconSel.innerHTML = '<option value="">无图标</option>';
    assets.icons.forEach(i => iconSel.innerHTML += `<option value="${i}">${i}</option>`);
}

function editGlobal() { editingType = 'global'; document.getElementById("inp-name").value = data.title; document.getElementById("inp-desc").value = data.sub_title; openModal("全局设置", true, false, false); }
function editGroup(g) { editingType = 'group'; editingIdx.g = g; document.getElementById("inp-name").value = data.groups[g].title; openModal("分组", false, false, false); }
function editItem(g, i) { editingType = 'item'; editingIdx.g = g; editingIdx.i = i; let item = data.groups[g].items[i]; document.getElementById("inp-name").value = item.name; document.getElementById("inp-desc").value = item.desc; document.getElementById("inp-icon").value = item.icon; openModal("功能项", true, true, true); }
function openModal(t, sd, si, sdel) { document.getElementById("modalTitle").innerText = t; document.getElementById("editModal").style.display = "flex"; document.getElementById("field-desc").style.display = sd?"block":"none"; document.getElementById("field-icon").style.display = si?"block":"none"; document.getElementById("btn-delete").style.display = sdel?"block":"none"; }
function closeModal() { document.getElementById("editModal").style.display = "none"; }
function saveModal() {
    let name = document.getElementById("inp-name").value;
    let desc = document.getElementById("inp-desc").value;
    let icon = document.getElementById("inp-icon").value;
    if(editingType === 'global') { data.title = name; data.sub_title = desc; }
    else if(editingType === 'group') { data.groups[editingIdx.g].title = name; }
    else if(editingType === 'item') { let it = data.groups[editingIdx.g].items[editingIdx.i]; it.name = name; it.desc = desc; it.icon = icon; }
    closeModal(); renderCanvas();
}
function addNewGroup() { data.groups = data.groups || []; data.groups.push({ title: "新分组", items: [] }); renderCanvas(); }
function addNewItem(g) { data.groups[g].items.push({ name: "功能", desc: "描述", icon: "" }); renderCanvas(); editItem(g, data.groups[g].items.length-1); }
function deleteCurrent() { if(!confirm("确认删除？")) return; data.groups[editingIdx.g].items.splice(editingIdx.i, 1); closeModal(); renderCanvas(); }
function deleteGroup(g) { if(!confirm("删除分组？")) return; data.groups.splice(g, 1); renderCanvas(); }
function updateBg(v) { data.background = v; renderCanvas(); }

async function uploadFile(type, input) {
    let f = input.files[0]; if(!f) return;
    let form = new FormData(); form.append("type", type); form.append("file", f);
    let res = await api("/upload", "POST", form);
    if(res.status === 'ok') {
        alert("上传成功");
        if(type === 'font') {
            await loadFonts();
            updateFontSelects();
        } else {
            assets = await api("/assets");
            renderAssetSelects();
            if(type==='background') updateBg(res.filename);
        }
        input.value = "";
    }
}

async function saveAll() {
    let res = await api("/menu", "POST", data);
    if(res.status === 'ok') { document.getElementById("canvas").style.opacity = 0.5; setTimeout(() => document.getElementById("canvas").style.opacity = 1, 500); alert("保存成功"); }
}