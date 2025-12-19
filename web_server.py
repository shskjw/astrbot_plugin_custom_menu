import os
import sys
import asyncio
import traceback
from pathlib import Path
from multiprocessing import Queue

# 确保当前目录在 sys.path 中，防止 spawn 模式下找不到模块
PLUGIN_DIR = Path(__file__).parent
if str(PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(PLUGIN_DIR))


def run_server(config_dict, status_queue):
    """
    独立进程入口
    """
    try:
        # 1. 基础环境设置
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)

        # 2. 延迟导入依赖 (在纯净环境中导入)
        from quart import Quart, request, render_template, redirect, url_for, session, jsonify, send_from_directory
        from hypercorn.config import Config
        from hypercorn.asyncio import serve

        # 3. 导入业务逻辑 (使用绝对导入或相对导入的兼容写法)
        try:
            from storage import load_menu, save_menu, get_assets_list, ASSETS_DIR
            from renderer.menu import render_menu
        except ImportError:
            # 如果是包结构运行
            from .storage import load_menu, save_menu, get_assets_list, ASSETS_DIR
            from .renderer.menu import render_menu

        # 4. 定义 App
        # 必须显式指定 template/static 文件夹绝对路径
        app = Quart(__name__,
                    template_folder=str(PLUGIN_DIR / "templates"),
                    static_folder=str(PLUGIN_DIR / "static"))
        app.secret_key = os.urandom(24)

        # --- 路由定义 ---
        @app.before_request
        async def check_auth():
            if request.endpoint in ["login", "static", "serve_raw_assets", "health", "ping"]: return
            if not session.get("is_admin"): return redirect(url_for("login"))

        @app.route("/ping")
        async def ping():
            return "pong"  # 存活检测接口

        @app.route("/login", methods=["GET", "POST"])
        async def login():
            error = None
            if request.method == "POST":
                form = await request.form
                if form.get("token") == config_dict.get("web_token"):
                    session["is_admin"] = True
                    return redirect(url_for("index"))
                error = "密钥错误"
            return await render_template("login.html", error=error)

        @app.route("/")
        async def index():
            return await render_template("index.html")

        @app.route("/api/menu", methods=["GET"])
        async def get_menu():
            return jsonify(load_menu())

        @app.route("/api/menu", methods=["POST"])
        async def save_menu_api():
            data = await request.get_json()
            save_menu(data)
            try:
                # 这里的路径必须用绝对路径
                preview_path = PLUGIN_DIR / "data" / "preview.png"
                render_menu(preview_path)
            except Exception as e:
                return jsonify({"status": "error", "msg": str(e)}), 500
            return jsonify({"status": "ok"})

        @app.route("/api/assets", methods=["GET"])
        async def get_assets():
            return jsonify(get_assets_list())

        @app.route("/api/upload", methods=["POST"])
        async def upload_asset():
            files = await request.files
            form = await request.form
            u_type = form.get("type")
            u_file = files.get("file")
            if not u_file: return jsonify({"error": "No file"}), 400

            filename = u_file.filename
            if u_type == "background":
                target = ASSETS_DIR / "backgrounds" / filename
            elif u_type == "icon":
                target = ASSETS_DIR / "icons" / filename
            else:
                return jsonify({"error": "Type err"}), 400

            await u_file.save(target)
            return jsonify({"status": "ok", "filename": filename})

        @app.route("/api/preview")
        async def preview():
            p_file = PLUGIN_DIR / "data" / "preview.png"
            if p_file.exists():
                r = await send_from_directory(p_file.parent, p_file.name)
                r.headers["Cache-Control"] = "no-store"
                return r
            return "No preview", 404

        @app.route("/raw_assets/<path:path>")
        async def serve_raw_assets(path):
            if ".." in path: return "Forbidden", 403
            return await send_from_directory(ASSETS_DIR, path)

        # --- 启动 ---
        async def start_async():
            port = int(config_dict.get("web_port", 9876))
            host = config_dict.get("web_host", "0.0.0.0")

            cfg = Config()
            cfg.bind = [f"{host}:{port}"]
            cfg.graceful_timeout = 2
            # 关键：不绑定 Logger，防止 pickle 错误
            cfg.accesslog = None
            cfg.errorlog = None

            print(f"✅ [子进程] Hypercorn 启动监听: {host}:{port}")
            status_queue.put("SUCCESS")  # 通知父进程

            await serve(app, cfg)

        asyncio.run(start_async())

    except Exception as e:
        err_msg = traceback.format_exc()
        print(f"❌ [子进程崩溃] {err_msg}", file=sys.stderr)
        try:
            with open(PLUGIN_DIR / "web_crash.log", "w") as f:
                f.write(err_msg)
        except:
            pass
        status_queue.put(f"ERROR: {str(e)}")