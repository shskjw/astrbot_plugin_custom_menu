let data = { groups: [] };
let assets = { backgrounds: [], icons: [] };

// 状态
let editingType = null;
let editingIdx = { g: -1, i: -1 };

// 初始化
init();

async function init() {
    // 并行加载
    try {
        await Promise.all([loadAssets(), loadMenu()]);
        renderCanvas();
    } catch (e) {
        console.error("初始化失败", e);
        // 如果 API 返回 401/403，浏览器会自动跳转到 /login，因为后端做了 redirect
        if(e.status === 401) window.location.href = "/login";
    }
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
    if (!res.ok) throw res; // 抛出错误让上层处理
    return res.json();
}

async function loadAssets() {
    assets = await api("/assets");
    renderAssetSelects();
}

async function loadMenu() {
    data = await api("/menu");
}

function renderCanvas() {
    const cvs = document.getElementById("canvas");
    const bgUrl = data.background ? `/api/assets?t=${Date.now()}` : ''; // 实际上图片是 /static 的，这里逻辑要修正，直接读文件路径

    // 修正：直接指向静态资源路径
    // 但是我们的图片在 data/assets，Quart 需要配置 static 路由
    // 我们在 Quart 里没有把 data 设为 static，所以这里用 CSS background-image 最好指向 /api/preview 类似的逻辑
    // 为了简单，我们让 web_server.py 里的 index.html 引用 css 没问题
    // 图片路径问题：
    // 我们需要在 web_server.py 里增加一个路由来服务 assets 图片，或者把 data 目录加到 static_url_path

    if(data.background) {
         // 这里我们暂时假设背景图上传后，通过 /api/preview 看到的是生成后的图
         // 但为了实时编辑体验，我们需要能访问原始素材
         // 没关系，我们把背景设为 none，用 CSS 样式模拟，或者直接显示
         // 简单起见，我们用 CSS 变量
         cvs.style.backgroundImage = `url('/api/assets')`; // 这里的逻辑太复杂，我们改成在 web_server.py 里加一个路由
    }

    // 由于 web_server.py 没有暴露 data 目录，我们改一下 web_server.py 增加一个路由
    // 不过没关系，我们可以用 base64 或者简单一点：
    // *重要*：在上面的 web_server.py 里，我已经没有暴露 data 目录了。
    // 为了编辑器能看到图，我们需要修改 editor.js，让它知道图片其实加载不到，除非我们加路由。

    // 我们修改一下 renderCanvas 的逻辑，只渲染文字结构
    // 背景图我们在 web_server.py 里加一个特殊的路由：
    // @app.route('/assets/<path:path>') ...

    let html = `
        <div class="header-area">
            <div class="main-title" onclick="editGlobal()">${data.title || '标题'}</div>
            <div class="sub-title" onclick="editGlobal()">${data.sub_title || ''}</div>
        </div>
    `;

    // 渲染分组
    (data.groups || []).forEach((group, gIdx) => {
        html += `<div class="group-section">
            <div class="group-title" onclick="editGroup(${gIdx})">${group.title}</div>
            <div class="group-box">`;

        (group.items || []).forEach((item, iIdx) => {
            // 图标处理：这里需要一个能访问图标的 URL
            // 我们约定：所有的 assets 都在 /api/raw_assets/<type>/<filename>
            // (这个路由我在最后会补上)
            let iconSrc = item.icon ? `/raw_assets/icons/${item.icon}` : '';

            html += `<div class="item-card" onclick="editItem(${gIdx}, ${iIdx})">
                <img class="item-icon" src="${iconSrc}" onerror="this.style.opacity=0">
                <div class="item-info">
                    <div class="item-name">${item.name}</div>
                    <div class="item-desc">${item.desc}</div>
                </div>
            </div>`;
        });

        html += `<div class="add-item-btn" onclick="addNewItem(${gIdx})">+</div>`;
        html += `</div></div>`;
    });

    html += `<div class="add-group-btn" onclick="addNewGroup()">+ 新增分组</div>`;
    cvs.innerHTML = html;

    if(data.background) {
        cvs.style.backgroundImage = `url('/raw_assets/backgrounds/${data.background}')`;
    } else {
        cvs.style.backgroundImage = 'none';
    }

    document.getElementById("bgSelect").value = data.background || "";
}

// 资源渲染
function renderAssetSelects() {
    let bgSel = document.getElementById("bgSelect");
    let iconSel = document.getElementById("inp-icon");

    bgSel.innerHTML = '<option value="">无背景</option>';
    assets.backgrounds.forEach(b => bgSel.innerHTML += `<option value="${b}">${b}</option>`);

    iconSel.innerHTML = '<option value="">无图标</option>';
    assets.icons.forEach(i => iconSel.innerHTML += `<option value="${i}">${i}</option>`);
}

// 交互函数
function editGlobal() {
    editingType = 'global';
    document.getElementById("inp-name").value = data.title;
    document.getElementById("inp-desc").value = data.sub_title;
    openModal("全局设置", true, false, false);
}

function editGroup(gIdx) {
    editingType = 'group';
    editingIdx.g = gIdx;
    document.getElementById("inp-name").value = data.groups[gIdx].title;
    openModal("分组设置", false, false, true);
}

function editItem(gIdx, iIdx) {
    editingType = 'item';
    editingIdx.g = gIdx; editingIdx.i = iIdx;
    let item = data.groups[gIdx].items[iIdx];
    document.getElementById("inp-name").value = item.name;
    document.getElementById("inp-desc").value = item.desc;
    document.getElementById("inp-icon").value = item.icon;
    openModal("功能项设置", true, true, true);
}

function openModal(title, showDesc, showIcon, showDel) {
    document.getElementById("modalTitle").innerText = title;
    document.getElementById("editModal").style.display = "flex";
    document.getElementById("field-desc").style.display = showDesc?"block":"none";
    document.getElementById("field-icon").style.display = showIcon?"block":"none";
    document.getElementById("btn-delete").style.display = showDel?"block":"none";
}

function closeModal() {
    document.getElementById("editModal").style.display = "none";
}

function saveModal() {
    let name = document.getElementById("inp-name").value;
    let desc = document.getElementById("inp-desc").value;
    let icon = document.getElementById("inp-icon").value;

    if(editingType === 'global') { data.title = name; data.sub_title = desc; }
    else if(editingType === 'group') { data.groups[editingIdx.g].title = name; }
    else if(editingType === 'item') {
        let item = data.groups[editingIdx.g].items[editingIdx.i];
        item.name = name; item.desc = desc; item.icon = icon;
    }
    closeModal(); renderCanvas();
}

function addNewGroup() {
    data.groups = data.groups || [];
    data.groups.push({ title: "新分组", items: [] });
    renderCanvas();
}

function addNewItem(gIdx) {
    data.groups[gIdx].items.push({ name: "功能", desc: "描述", icon: "" });
    renderCanvas();
    editItem(gIdx, data.groups[gIdx].items.length-1);
}

function deleteCurrent() {
    if(!confirm("确认删除？")) return;
    if(editingType === 'group') data.groups.splice(editingIdx.g, 1);
    else if(editingType === 'item') data.groups[editingIdx.g].items.splice(editingIdx.i, 1);
    closeModal(); renderCanvas();
}

function updateBg(val) {
    data.background = val;
    renderCanvas();
}

async function uploadFile(type, input) {
    let f = input.files[0];
    if(!f) return;
    let form = new FormData();
    form.append("type", type);
    form.append("file", f);

    let res = await api("/upload", "POST", form);
    if(res.status === 'ok') {
        alert("上传成功");
        assets = await api("/assets");
        renderAssetSelects();
        if(type === 'background') updateBg(res.filename);
        input.value = "";
    }
}

async function saveAll() {
    let res = await api("/menu", "POST", data);
    if(res.status === 'ok') {
        // 强制刷新图片缓存
        document.getElementById("canvas").style.opacity = 0.5;
        setTimeout(() => document.getElementById("canvas").style.opacity = 1, 500);
        alert("保存成功！Bot 发送【菜单】即可查看");
    }
}