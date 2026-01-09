import os, sys, asyncio, traceback, uuid
from pathlib import Path
from multiprocessing import Queue
from types import ModuleType
from io import BytesIO

PLUGIN_DIR = Path(__file__).parent
if str(PLUGIN_DIR) not in sys.path: sys.path.insert(0, str(PLUGIN_DIR))


class QueueLogger:
    def __init__(self, queue): self.queue = queue

    def info(self, msg, *args): self.queue.put(("INFO", str(msg)))

    def error(self, msg, *args): self.queue.put(("ERROR", str(msg)))

    def warning(self, msg, *args): self.queue.put(("WARNING", str(msg)))

    def debug(self, msg, *args): pass


def mock_astrbot_modules(queue):
    if "astrbot.api" not in sys.modules:
        m_api = ModuleType("astrbot.api")
        m_api.logger = QueueLogger(queue)
        sys.modules["astrbot.api"] = m_api
    if "astrbot.api.star" not in sys.modules:
        m_star = ModuleType("astrbot.api.star")

        class MockStarTools:
            @staticmethod
            def get_data_dir(name): return Path(".")

        m_star.StarTools = MockStarTools
        sys.modules["astrbot.api.star"] = m_star


# --- 修改函数签名，增加 command_data 参数 ---
def run_server(config_dict, status_queue, log_queue, data_dir=None, command_data=None):
    mock_astrbot_modules(log_queue)
    try:
        from quart import Quart, request, render_template, redirect, url_for, session, jsonify, send_from_directory, \
            send_file
        from hypercorn.config import Config
        from hypercorn.asyncio import serve

        try:
            import storage
            if data_dir: storage.plugin_storage.init_paths(data_dir)
            from storage import plugin_storage
            from renderer.menu import render_static, render_animated
        except ImportError:
            from . import storage
            if data_dir: storage.plugin_storage.init_paths(data_dir)
            from .storage import plugin_storage
            from .renderer.menu import render_static, render_animated

        app = Quart(__name__, template_folder=str(PLUGIN_DIR / "templates"), static_folder=str(PLUGIN_DIR / "static"))
        app.secret_key = os.urandom(24)

        @app.before_request
        async def check_auth():
            if request.endpoint in ["login", "static", "serve_bg", "serve_icon", "serve_widget", "serve_fonts",
                                    "serve_video", "serve_outputs"]: return
            if not session.get("is_admin"): return redirect(url_for("login"))

        @app.route("/login", methods=["GET", "POST"])
        async def login():
            if request.method == "POST":
                if (await request.form).get("token") == config_dict.get("web_token"):
                    session["is_admin"] = True
                    return redirect(url_for("index"))
            return await render_template("login.html")

        @app.route("/")
        async def index():
            return await render_template("index.html")

        # --- 新增 API：获取指令数据 ---
        @app.route("/api/commands", methods=["GET"])
        async def get_commands_data():
            # command_data 是在进程启动时传入的字典
            return jsonify(command_data or {})

        @app.route("/api/config", methods=["GET"])
        async def get_cfg():
            return jsonify(plugin_storage.load_config())

        @app.route("/api/config", methods=["POST"])
        async def save_cfg():
            data = await request.get_json()
            plugin_storage.save_config(data)

            if data and "menus" in data:
                plugin_storage.cleanup_unused_caches(data["menus"])
                for m in data["menus"]:
                    if m.get("enabled", True):
                        plugin_storage.clear_menu_cache(m.get("id"))
            return jsonify({"status": "ok"})

        @app.route("/api/assets", methods=["GET"])
        async def get_assets():
            return jsonify(plugin_storage.get_assets_list())

        @app.route("/api/upload", methods=["POST"])
        async def upload():
            files, form = await request.files, await request.form
            u_file = files.get("file")
            if not u_file: return jsonify({"error": "No file"}), 400
            target_map = {"background": plugin_storage.bg_dir, "video": plugin_storage.video_dir,
                          "icon": plugin_storage.icon_dir, "widget_img": plugin_storage.img_dir,
                          "font": plugin_storage.fonts_dir}
            target_dir = target_map.get(form.get("type"))
            if target_dir:
                fname = f"{uuid.uuid4().hex[:8]}_{u_file.filename}"
                await u_file.save(target_dir / fname)
                for m in plugin_storage.load_config().get("menus", []): plugin_storage.clear_menu_cache(m.get("id"))
                return jsonify({"status": "ok", "filename": fname})
            return jsonify({"error": "Unknown type"}), 400

        @app.route("/api/export_image", methods=["POST"])
        async def export():
            m = await request.get_json()
            m_id = m.get("id")
            is_video = (m.get("bg_type") == "video")

            # [修改] 静态使用 png
            fmt = "png"
            if is_video:
                fmt = m.get("video_export_format", "apng")

            cache_path = plugin_storage.get_menu_output_cache_path(m_id, is_video, fmt)

            if cache_path.exists(): return await send_file(str(cache_path), as_attachment=True,
                                                           attachment_filename=cache_path.name)

            try:
                if is_video:
                    out_path = await asyncio.to_thread(render_animated, m, cache_path)
                    if out_path:
                        return await send_file(str(out_path), as_attachment=True, attachment_filename=out_path.name)
                    else:
                        return jsonify({"error": "Animated render failed"}), 500
                else:
                    img = await asyncio.to_thread(render_static, m)
                    byte_io = BytesIO()
                    # Export as PNG
                    await asyncio.to_thread(img.save, byte_io, 'PNG')
                    byte_io.seek(0)
                    cache_path.write_bytes(byte_io.getvalue())
                    return await send_file(byte_io, mimetype='image/png', as_attachment=True,
                                           attachment_filename=f"{m.get('name')}.png")
            except Exception as e:
                log_queue.put(("ERROR", f"Render Failed: {traceback.format_exc()}"))
                return jsonify({"error": str(e)}), 500

        @app.route("/raw_assets/backgrounds/<path:path>")
        async def serve_bg(path):
            return await send_from_directory(plugin_storage.bg_dir, path)

        @app.route("/raw_assets/icons/<path:path>")
        async def serve_icon(path):
            return await send_from_directory(plugin_storage.icon_dir, path)

        @app.route("/raw_assets/widgets/<path:path>")
        async def serve_widget(path):
            return await send_from_directory(plugin_storage.img_dir, path)

        @app.route("/fonts/<path:path>")
        async def serve_fonts(path):
            return await send_from_directory(plugin_storage.fonts_dir, path)

        @app.route("/raw_assets/videos/<path:path>")
        async def serve_video(path):
            return await send_from_directory(plugin_storage.video_dir, path)

        @app.route("/outputs/<path:path>")
        async def serve_outputs(path):
            return await send_from_directory(plugin_storage.outputs_dir, path)

        async def start_async():
            cfg = Config()
            cfg.bind = [f"{config_dict.get('web_host', '0.0.0.0')}:{int(config_dict.get('web_port', 9876))}"]
            status_queue.put("SUCCESS")
            await serve(app, cfg)

        asyncio.run(start_async())
    except Exception as e:
        log_queue.put(("ERROR", f"Web Crash: {traceback.format_exc()}"))
        status_queue.put(f"ERROR: {str(e)}")