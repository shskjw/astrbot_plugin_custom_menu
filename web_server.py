import os
import sys
import asyncio
import traceback
from pathlib import Path
from multiprocessing import Queue
import uuid

PLUGIN_DIR = Path(__file__).parent
if str(PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(PLUGIN_DIR))


def run_server(config_dict, status_queue):
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)

        from quart import Quart, request, render_template, redirect, url_for, session, jsonify, send_from_directory, \
            send_file
        from hypercorn.config import Config
        from hypercorn.asyncio import serve
        from io import BytesIO

        try:
            from storage import load_config, save_config, get_assets_list, ASSETS_DIR, FONTS_DIR
            from renderer.menu import render_one_menu
        except ImportError:
            from .storage import load_config, save_config, get_assets_list, ASSETS_DIR, FONTS_DIR
            from .renderer.menu import render_one_menu

        app = Quart(__name__,
                    template_folder=str(PLUGIN_DIR / "templates"),
                    static_folder=str(PLUGIN_DIR / "static"))
        app.secret_key = os.urandom(24)

        # --- 路由 ---
        @app.before_request
        async def check_auth():
            if request.endpoint in ["login", "static", "serve_raw_assets", "serve_fonts", "health", "ping"]: return
            if not session.get("is_admin"): return redirect(url_for("login"))

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

        @app.route("/api/config", methods=["GET"])
        async def get_all_config():
            return jsonify(load_config())

        @app.route("/api/config", methods=["POST"])
        async def save_all_config():
            data = await request.get_json()
            save_config(data)
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

            filename = f"{uuid.uuid4().hex[:8]}_{u_file.filename}"  # 防止重名
            if u_type == "background":
                target = ASSETS_DIR / "backgrounds" / filename
            elif u_type == "icon":
                target = ASSETS_DIR / "icons" / filename
            elif u_type == "widget_img":
                target = ASSETS_DIR / "widgets" / filename
            elif u_type == "font":
                target = FONTS_DIR / filename
            else:
                return jsonify({"error": "Type err"}), 400

            await u_file.save(target)
            return jsonify({"status": "ok", "filename": filename})

        @app.route("/api/export_image", methods=["POST"])
        async def export_image():
            # 接收单个菜单的JSON配置，直接渲染并返回图片流
            menu_data = await request.get_json()
            try:
                # 在线程池中渲染
                img = await asyncio.to_thread(render_one_menu, menu_data)
                byte_io = BytesIO()
                img.save(byte_io, 'PNG')
                byte_io.seek(0)
                return await send_file(byte_io, mimetype='image/png', as_attachment=True,
                                       attachment_filename=f"{menu_data.get('name', 'menu')}.png")
            except Exception as e:
                return jsonify({"error": str(e)}), 500

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

            print(f"✅ [Web进程] 启动监听: {host}:{port}")
            status_queue.put("SUCCESS")
            await serve(app, cfg)

        asyncio.run(start_async())

    except Exception as e:
        err_msg = traceback.format_exc()
        print(f"❌ [崩溃] {err_msg}", file=sys.stderr)
        status_queue.put(f"ERROR: {str(e)}")