import asyncio
import socket
import json
import multiprocessing
import traceback
from pathlib import Path

# AstrBot API
from astrbot.api.star import Context, Star, register
from astrbot.api import event
from astrbot.api.event import filter
from astrbot.api import logger
from astrbot.api.star import StarTools

# 尝试导入依赖 (延迟到 on_load 或 try块中处理，这里先声明)
HAS_DEPS = False


def _get_local_ip_sync():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"


async def get_local_ip():
    return await asyncio.to_thread(_get_local_ip_sync)


@register(
    "astrbot_plugin_custom_menu",
    author="shskjw",
    desc="Web可视化菜单编辑器(支持LLM智能回复)",
    version="1.5.3"
)
class CustomMenuPlugin(Star):
    def __init__(self, context: Context, config: dict):
        super().__init__(context, config)
        self.cfg = config
        self.web_process = None
        self.admins_id = context.get_config().get("admins_id", [])

    async def on_load(self):
        # --- FIX: Initialize storage paths explicitly ---
        global HAS_DEPS
        try:
            from . import storage
            storage.setup_paths()  # Must call this before accessing DATA_DIR

            from .renderer.menu import render_one_menu
            HAS_DEPS = True
            logger.info("✅ 菜单插件加载完毕 (LLM Tool: show_graphical_menu 已注册)")
        except ImportError as e:
            logger.error(f"❌ 依赖缺失: {e}")
            HAS_DEPS = False

    async def on_unload(self):
        if self.web_process and self.web_process.is_alive():
            self.web_process.terminate()
            logger.info("后台 Web 服务已关闭")

    def is_admin(self, event: event.AstrMessageEvent) -> bool:
        if not self.admins_id: return True
        sender_id = str(event.get_sender_id())
        return sender_id in [str(uid) for uid in self.admins_id]

    async def _generate_menu_chain(self, event_obj):
        if not HAS_DEPS:
            yield event_obj.plain_result("❌ 插件文件不完整，无法渲染。")
            return

        try:
            from .storage import load_config, DATA_DIR
            from .renderer.menu import render_one_menu

            logger.info("正在渲染菜单...")
            root_config = load_config()
            menus = root_config.get("menus", [])
            active_menus = [m for m in menus if m.get("enabled", True)]

            if not active_menus:
                yield event_obj.plain_result("⚠️ 当前没有启用的菜单，请在后台开启。")
                return

            for menu_data in active_menus:
                logger.info(f"正在渲染菜单: {menu_data.get('name')}")

                try:
                    img = await asyncio.to_thread(render_one_menu, menu_data)
                except Exception as e:
                    logger.error(f"渲染失败: {traceback.format_exc()}")
                    yield event_obj.plain_result(f"❌ 渲染错误 [{menu_data.get('name')}]: {e}")
                    continue

                temp_filename = f"temp_render_{menu_data.get('id')}.png"
                temp_path = (DATA_DIR / temp_filename).absolute()
                img.save(temp_path)

                logger.info(f"渲染完成，发送图片: {temp_path}")
                yield event_obj.image_result(str(temp_path))

        except Exception as e:
            logger.error(f"生成菜单流程异常: {e}")
            yield event_obj.plain_result(f"❌ 系统内部错误: {e}")

    @filter.command("菜单")
    async def menu_cmd(self, event: event.AstrMessageEvent):
        """发送功能菜单图片"""
        async for result in self._generate_menu_chain(event):
            yield result

    @filter.llm_tool(name="show_graphical_menu")
    async def show_menu_tool(self, event: event.AstrMessageEvent):
        """
        当用户询问你是谁、有什么功能、查看菜单、查看帮助、指令列表时，调用此工具。
        """
        logger.info(f"🧠 LLM 触发了菜单工具 (User: {event.get_sender_name()})")
        async for result in self._generate_menu_chain(event):
            yield result
        yield event.plain_result("已发送功能菜单图片。")

    @filter.command("开启后台")
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

            # Pass absolute path string to subprocess
            from .storage import DATA_DIR
            data_dir_str = str(DATA_DIR.absolute())

            # Import run_server here to avoid circular imports if any
            from .web_server import run_server

            self.web_process = ctx.Process(
                target=run_server,
                args=(clean_config, status_queue, data_dir_str),
                daemon=True
            )
            self.web_process.start()

            try:
                msg = await asyncio.to_thread(status_queue.get, True, 10)
            except:
                msg = "TIMEOUT"

            if msg == "SUCCESS":
                host_conf = self.cfg.get("web_host", "0.0.0.0")
                port = self.cfg.get("web_port", 9876)
                token = self.cfg.get("web_token", "astrbot123")
                show_ip = "127.0.0.1" if host_conf == "127.0.0.1" else await get_local_ip()
                yield event.plain_result(f"✅ 启动成功！\n地址: http://{show_ip}:{port}/\n密钥: {token}")
            else:
                if self.web_process.is_alive(): self.web_process.terminate()
                yield event.plain_result(f"❌ 启动失败: {msg}")

        except Exception as e:
            logger.error(f"启动异常: {e}")
            yield event.plain_result(f"❌ 启动异常: {e}")

    @filter.command("关闭后台")
    async def stop_web_cmd(self, event: event.AstrMessageEvent):
        if not self.is_admin(event): return
        if not self.web_process or not self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台未运行")
            return
        self.web_process.terminate()
        self.web_process.join()
        self.web_process = None
        yield event.plain_result("✅ 后台已关闭")