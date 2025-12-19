import asyncio
import logging
import socket
import json
import multiprocessing  # 引入多进程
from pathlib import Path
from astrbot.api.star import Context, Star, register
from astrbot.api import event

try:
    from .web_server import run_server
    from .renderer.menu import render_menu

    HAS_DEPS = True
except ImportError as e:
    print(f"❌ [MemeMenu] 依赖缺失: {e}")
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
    desc="Web可视化菜单",
    version="1.0.0"
)
class CustomMenuPlugin(Star):
    def __init__(self, context: Context, config: dict):
        super().__init__(context, config)
        self.cfg = config
        self.web_process = None
        self.logger = logging.getLogger("astrbot_plugin_custom_menu")

    async def on_load(self):
        if not HAS_DEPS:
            self.logger.error("❌ 缺少 quart 或 hypercorn")
        else:
            self.logger.info("✅ 插件加载完毕")

    async def on_unload(self):
        if self.web_process and self.web_process.is_alive():
            self.web_process.terminate()

    @event.filter.command("菜单")
    async def menu(self, event: event.AstrMessageEvent):
        base = Path(__file__).parent
        img_path = base / "data" / "preview.png"

        if img_path.exists():
            yield event.image_result(str(img_path))
            return

        if HAS_DEPS:
            try:
                await asyncio.to_thread(render_menu, img_path)
                yield event.image_result(str(img_path))
            except Exception as e:
                yield event.plain_result(f"❌ 渲染失败: {e}")
        else:
            yield event.plain_result("❌ 缺少依赖")

    @event.filter.command("开启后台")
    async def start_web_cmd(self, event: event.AstrMessageEvent):
        if not HAS_DEPS:
            yield event.plain_result("❌ 缺少依赖")
            return

        if self.web_process and self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台已在运行")
            return

        yield event.plain_result("🚀 正在启动后台...")

        # 1. 使用 'spawn' 上下文启动进程
        # 这是解决 Linux 下 curl 卡死/死锁问题的关键！
        ctx = multiprocessing.get_context('spawn')
        status_queue = ctx.Queue()

        # 2. 清洗配置
        try:
            clean_config = json.loads(json.dumps(self.cfg))
        except:
            clean_config = dict(self.cfg)

        try:
            # 3. 启动
            self.web_process = ctx.Process(
                target=run_server,
                args=(clean_config, status_queue),
                daemon=True
            )
            self.web_process.start()

            # 4. 等待反馈
            try:
                msg = await asyncio.to_thread(status_queue.get, True, 5)
            except:
                if not self.web_process.is_alive():
                    yield event.plain_result("❌ 启动失败：子进程立即崩溃，请检查 web_crash.log")
                else:
                    # 如果超时但进程还在，可能是初始化慢，但也算启动了
                    msg = "SUCCESS"

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
            self.logger.error(f"主进程异常: {e}")
            yield event.plain_result(f"❌ 主进程异常: {e}")

    @event.filter.command("关闭后台")
    async def stop_web_cmd(self, event: event.AstrMessageEvent):
        if not self.web_process or not self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台未运行")
            return

        self.web_process.terminate()
        self.web_process.join()
        self.web_process = None
        yield event.plain_result("✅ 后台已关闭")

    @event.filter.command("菜单登录")
    async def login_info(self, event: event.AstrMessageEvent):
        if not self.web_process or not self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台未启动")
            return

        host_conf = self.cfg.get("web_host", "0.0.0.0")
        port = self.cfg.get("web_port", 9876)
        token = self.cfg.get("web_token", "astrbot123")
        show_ip = "127.0.0.1" if host_conf == "127.0.0.1" else get_local_ip()

        yield event.plain_result(f"地址: http://{show_ip}:{port}/\n密钥: {token}")