import os
import sys
import asyncio
import traceback
from pathlib import Path
from multiprocessing import Queue

PLUGIN_DIR = Path(__file__).parent
if str(PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(PLUGIN_DIR))


def run_server(config_dict, status_queue):
    """
    Web 服务子进程入口。
    使用 Quart + Hypercorn 运行。
    """
    try:
        # 强制刷新输出流，确保日志可见
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)

        from quart import Quart, request, render_template, redirect, url_for, session, jsonify, send_from_directory
        from hypercorn.config import Config
        from hypercorn.asyncio import serve

        # 延迟导入业务逻辑
        try:
            from storage import load_menu, save_menu, get_assets_list, ASSETS_DIR, FONTS_DIR
            from renderer.menu import render_menu
        except ImportError:
            from .storage import load_menu, save_menu, get_assets_list, ASSETS_DIR, FONTS_DIR
            from .renderer.menu import render_menu

        app = Quart(__name__,
                    template_folder=str(PLUGIN_DIR / "templates"),
                    static_folder=str(PLUGIN_DIR / "static"))
        app.secret_key = os.urandom(24)

        # --- 路由 ---
        @app.before_request
        async def check_auth():
            if request.endpoint in ["login", "static", "serve_raw_assets", "serve_fonts", "health", "ping"]: return
            if not session.get("is_admin"): return redirect(url_for("login"))

        @app.route("/ping")
        async def ping():
            return "pong"

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
                preview_path = PLUGIN_DIR / "data" / "preview.png"
                render_menu(preview_path)
            except Exception as e:
                return jsonify({"status": "error", "msg": str(e)}), 500
            return jsonify({"status": "ok"})

        @app.route("/api/assets", methods=["GET"])
        async def get_assets():
            return jsonify(get_assets_list())

        @app.route("/api/fonts", methods=["GET"])
        async def get_fonts():
            fonts = [f.name for f in FONTS_DIR.glob("*") if f.suffix.lower() in ['.ttf', '.otf', '.ttc']]
            return jsonify(fonts)

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
            elif u_type == "font":
                target = FONTS_DIR / filename
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

        @app.route("/fonts/<path:path>")
        async def serve_fonts(path):
            if ".." in path: return "Forbidden", 403
            return await send_from_directory(FONTS_DIR, path)

        # --- Hypercorn 启动 ---
        async def start_async():
            port = int(config_dict.get("web_port", 9876))
            host = config_dict.get("web_host", "0.0.0.0")

            cfg = Config()
            cfg.bind = [f"{host}:{port}"]
            cfg.graceful_timeout = 2
            cfg.accesslog = None
            cfg.errorlog = None

            print(f"✅ [Web进程] 启动监听: {host}:{port}")
            status_queue.put("SUCCESS")
            await serve(app, cfg)

        asyncio.run(start_async())

    except Exception as e:
        err_msg = traceback.format_exc()
        print(f"❌ [崩溃] {err_msg}", file=sys.stderr)
        status_queue.put(f"ERROR: {str(e)}")