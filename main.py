import asyncio
import logging
import socket
import json
import multiprocessing
from pathlib import Path
from astrbot.api.star import Context, Star, register
from astrbot.api import event

try:
    from .web_server import run_server
    from .storage import load_config
    from .renderer.menu import render_one_menu

    HAS_DEPS = True
except ImportError as e:
    print(f"❌ [CustomMenu] 依赖缺失: {e}")
    HAS_DEPS = False


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"


@register(
    "astrbot_plugin_custom_menu",
    author="shskjw",
    desc="web可视化菜单编辑器(多菜单版)",
    version="2.0.0"
)
class CustomMenuPlugin(Star):
    def __init__(self, context: Context, config: dict):
        super().__init__(context, config)
        self.cfg = config
        self.web_process = None
        self.logger = logging.getLogger("astrbot_plugin_custom_menu")
        self.admins_id = context.get_config().get("admins_id", [])

    async def on_load(self):
        if not HAS_DEPS:
            self.logger.error("❌ 缺少依赖")
        else:
            self.logger.info("✅ 菜单插件加载完毕")

    async def on_unload(self):
        if self.web_process and self.web_process.is_alive():
            self.web_process.terminate()

    def is_admin(self, event: event.AstrMessageEvent) -> bool:
        if not self.admins_id: return True
        sender_id = str(event.get_sender_id())
        return sender_id in [str(uid) for uid in self.admins_id]

    @event.filter.command("菜单")
    async def menu(self, event: event.AstrMessageEvent):
        if not HAS_DEPS:
            yield event.plain_result("❌ 插件依赖缺失")
            return

        # 加载最新配置
        root_config = load_config()
        menus = root_config.get("menus", [])

        # 筛选启用的菜单
        active_menus = [m for m in menus if m.get("enabled", True)]

        if not active_menus:
            yield event.plain_result("⚠️ 当前没有启用的菜单")
            return

        chain = []
        for menu_data in active_menus:
            try:
                # 渲染图片
                img = await asyncio.to_thread(render_one_menu, menu_data)

                # 保存临时文件发送 (或者直接转 base64，这里用临时文件稳妥)
                temp_path = Path(__file__).parent / "data" / f"temp_{menu_data.get('id')}.png"
                img.save(temp_path)
                chain.append(event.image_result(str(temp_path)))
            except Exception as e:
                self.logger.error(f"渲染菜单 {menu_data.get('name')} 失败: {e}")
                chain.append(event.plain_result(f"❌ 渲染错误: {e}"))

        # 一次性发送所有图片
        yield chain

    @event.filter.command("开启后台")
    async def start_web_cmd(self, event: event.AstrMessageEvent):
        if not self.is_admin(event):
            yield event.plain_result("❌ 权限不足")
            return
        if not HAS_DEPS:
            yield event.plain_result("❌ 缺少依赖")
            return
        if self.web_process and self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台已在运行")
            return

        yield event.plain_result("🚀 正在启动后台...")

        ctx = multiprocessing.get_context('spawn')
        status_queue = ctx.Queue()

        try:
            try:
                clean_config = json.loads(json.dumps(self.cfg))
            except:
                clean_config = dict(self.cfg)

            self.web_process = ctx.Process(
                target=run_server,
                args=(clean_config, status_queue),
                daemon=True
            )
            self.web_process.start()

            try:
                msg = await asyncio.to_thread(status_queue.get, True, 5)
            except:
                msg = "SUCCESS" if self.web_process.is_alive() else "TIMEOUT"

            if msg == "SUCCESS":
                host_conf = self.cfg.get("web_host", "0.0.0.0")
                port = self.cfg.get("web_port", 9876)
                token = self.cfg.get("web_token", "astrbot123")
                show_ip = "127.0.0.1" if host_conf == "127.0.0.1" else get_local_ip()
                yield event.plain_result(f"✅ 启动成功！\n地址: http://{show_ip}:{port}/\n密钥: {token}")
            else:
                yield event.plain_result(f"❌ 启动报错: {msg}")

        except Exception as e:
            self.logger.error(f"启动异常: {e}")
            yield event.plain_result(f"❌ 启动异常: {e}")

    @event.filter.command("关闭后台")
    async def stop_web_cmd(self, event: event.AstrMessageEvent):
        if not self.is_admin(event): return
        if not self.web_process or not self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台未运行")
            return
        self.web_process.terminate()
        self.web_process.join()
        self.web_process = None
        yield event.plain_result("✅ 后台已关闭")