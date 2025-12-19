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
    from .renderer.menu import render_menu

    HAS_DEPS = True
except ImportError as e:
    print(f"❌ [CustomMenu] 依赖缺失: {e}")
    HAS_DEPS = False


def get_local_ip():
    """获取本机内网IP"""
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
    author="BotAdmin",
    desc="可视化菜单编辑器(Pro版)",
    version="6.2.0"
)
class CustomMenuPlugin(Star):
    def __init__(self, context: Context, config: dict):
        super().__init__(context, config)
        self.cfg = config
        self.web_process = None
        self.logger = logging.getLogger("astrbot_plugin_custom_menu")
        # 权限控制
        self.admins_id = context.get_config().get("admins_id", [])

    async def on_load(self):
        if not HAS_DEPS:
            self.logger.error("❌ 缺少 quart 或 hypercorn，请运行: pip install quart hypercorn")
        else:
            self.logger.info("✅ 菜单插件加载完毕")

    async def on_unload(self):
        if self.web_process and self.web_process.is_alive():
            self.web_process.terminate()

    def is_admin(self, event: event.AstrMessageEvent) -> bool:
        """检查管理员权限"""
        if not self.admins_id: return True  # 未配置管理员则允许所有人
        sender_id = str(event.get_sender_id())
        return sender_id in [str(uid) for uid in self.admins_id]

    @event.filter.command("菜单")
    async def menu(self, event: event.AstrMessageEvent):
        """发送菜单图片 (无需 Web 在线)"""
        base = Path(__file__).parent
        img_path = base / "data" / "preview.png"

        # 1. 优先读取缓存图
        if img_path.exists():
            yield event.image_result(str(img_path))
            return

        # 2. 无缓存则现场渲染
        if HAS_DEPS:
            try:
                await asyncio.to_thread(render_menu, img_path)
                yield event.image_result(str(img_path))
            except Exception as e:
                yield event.plain_result(f"❌ 渲染失败: {e}")
        else:
            yield event.plain_result("❌ 缺少依赖且无缓存图片")

    @event.filter.command("开启后台")
    async def start_web_cmd(self, event: event.AstrMessageEvent):
        """开启 Web 编辑器 (仅管理员)"""
        if not self.is_admin(event):
            yield event.plain_result("❌ 权限不足")
            return

        if not HAS_DEPS:
            yield event.plain_result("❌ 缺少依赖")
            return

        if self.web_process and self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台已在运行")
            return

        yield event.plain_result("🚀 正在启动后台 (独立进程)...")

        # 使用 spawn 模式防止死锁
        ctx = multiprocessing.get_context('spawn')
        status_queue = ctx.Queue()

        try:
            # 清洗配置，防止 pickle 错误
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

            # 等待子进程反馈
            try:
                msg = await asyncio.to_thread(status_queue.get, True, 5)
            except:
                msg = "SUCCESS" if self.web_process.is_alive() else "TIMEOUT"

            if msg == "SUCCESS":
                host_conf = self.cfg.get("web_host", "0.0.0.0")
                port = self.cfg.get("web_port", 9876)
                token = self.cfg.get("web_token", "astrbot123")
                show_ip = "127.0.0.1" if host_conf == "127.0.0.1" else get_local_ip()

                yield event.plain_result(
                    f"✅ 启动成功！(PID={self.web_process.pid})\n"
                    f"地址: http://{show_ip}:{port}/\n"
                    f"密钥: {token}"
                )
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

    @event.filter.command("菜单登录")
    async def login_info(self, event: event.AstrMessageEvent):
        if not self.is_admin(event): return

        if not self.web_process or not self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台未启动")
            return

        host_conf = self.cfg.get("web_host", "0.0.0.0")
        port = self.cfg.get("web_port", 9876)
        token = self.cfg.get("web_token", "astrbot123")
        show_ip = "127.0.0.1" if host_conf == "127.0.0.1" else get_local_ip()

        yield event.plain_result(f"地址: http://{show_ip}:{port}/\n密钥: {token}")