import asyncio
import socket
import json
import multiprocessing
import traceback
import threading
import time
from pathlib import Path

# AstrBot API
from astrbot.api.star import Context, Star, register
from astrbot.api import event
from astrbot.api.event import filter
from astrbot.api import logger

# --- 顶层导入 Storage ---
try:
    from . import storage
except ImportError:
    storage = None


def _get_local_ip_sync():
    """Gets local IP with a timeout to prevent long blocking"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2.0)
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
    version="1.6.0"
)
class CustomMenuPlugin(Star):
    def __init__(self, context: Context, config: dict):
        super().__init__(context)
        self.cfg = config
        self.web_process = None
        self.log_queue = None
        self._log_consumer_task = None
        self.admins_id = context.get_config().get("admins_id", [])

        self.has_deps = False
        self.dep_error = "插件正在初始化..."

        # 启动初始化
        self._init_task = asyncio.create_task(self._async_init())

    async def _async_init(self):
        logger.info("[CustomMenuPlugin] 开始加载资源...")
        try:
            if storage is None:
                raise ImportError("storage 模块加载失败")

            try:
                import PIL
            except ImportError:
                raise ImportError("缺少 Pillow 库，请 pip install Pillow")

            storage.plugin_storage.init_paths()
            await asyncio.to_thread(storage.plugin_storage.migrate_data)

            from .renderer.menu import render_one_menu

            self.has_deps = True
            self.dep_error = None
            logger.info("✅ [CustomMenuPlugin] 初始化成功")

        except Exception as e:
            err_msg = traceback.format_exc()
            self.has_deps = False
            self.dep_error = f"{e.__class__.__name__}: {str(e)}"
            logger.error(f"❌ [CustomMenuPlugin] 加载失败:\n{err_msg}")

    async def on_load(self):
        if self._init_task and not self._init_task.done():
            await self._init_task

    async def on_unload(self):
        if self.web_process and self.web_process.is_alive():
            self.web_process.terminate()
            logger.info("后台 Web 服务已关闭")

    def is_admin(self, event: event.AstrMessageEvent) -> bool:
        if not self.admins_id: return True
        sender_id = str(event.get_sender_id())
        return sender_id in [str(uid) for uid in self.admins_id]

    def _consume_logs(self):
        """消费子进程日志"""
        while self.web_process and self.web_process.is_alive():
            try:
                if self.log_queue:
                    # 使用较短的 timeout 以便能响应停止信号
                    level, msg = self.log_queue.get(timeout=0.5)
                    if level == "ERROR":
                        logger.error(f"[Web] {msg}")
                    elif level == "WARNING":
                        logger.warning(f"[Web] {msg}")
                    else:
                        logger.info(f"[Web] {msg}")
            except:  # Queue empty or other errors
                continue

    async def _generate_menu_chain(self, event_obj):
        if self._init_task and not self._init_task.done():
            try:
                await asyncio.wait_for(self._init_task, timeout=5.0)
            except asyncio.TimeoutError:
                yield event_obj.plain_result("⚠️ 插件初始化超时")
                return

        if not self.has_deps:
            yield event_obj.plain_result(f"❌ 插件加载失败: {self.dep_error}")
            return

        try:
            from .renderer.menu import render_one_menu

            logger.info("正在渲染菜单...")

            root_config = await asyncio.to_thread(storage.plugin_storage.load_config)
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
                temp_path = (storage.plugin_storage.data_dir / temp_filename).absolute()

                await asyncio.to_thread(img.save, temp_path)

                logger.info(f"渲染完成，发送图片: {temp_path}")
                yield event_obj.image_result(str(temp_path))

        except Exception as e:
            logger.error(f"生成菜单流程异常: {e}")
            yield event_obj.plain_result(f"❌ 系统内部错误: {e}")

    @filter.command("菜单")
    async def menu_cmd(self, event: event.AstrMessageEvent):
        async for result in self._generate_menu_chain(event):
            yield result

    @filter.llm_tool(name="show_graphical_menu")
    async def show_menu_tool(self, event: event.AstrMessageEvent):
        logger.info(f"🧠 LLM 触发了菜单工具 (User: {event.get_sender_name()})")
        async for result in self._generate_menu_chain(event):
            yield result
        yield event.plain_result("已发送功能菜单图片。")

    @filter.command("开启后台")
    async def start_web_cmd(self, event: event.AstrMessageEvent):
        if not self.is_admin(event):
            yield event.plain_result("❌ 权限不足")
            return

        if self._init_task and not self._init_task.done():
            await asyncio.wait([self._init_task], timeout=2.0)

        if not self.has_deps:
            yield event.plain_result(f"❌ 插件加载失败: {self.dep_error}")
            return

        if self.web_process and self.web_process.is_alive():
            yield event.plain_result("⚠️ 后台已在运行")
            return

        yield event.plain_result("🚀 正在启动后台...")

        ctx = multiprocessing.get_context('spawn')
        status_queue = ctx.Queue()
        self.log_queue = ctx.Queue()

        try:
            # 安全的配置拷贝：使用 JSON 序列化确保无复杂对象
            try:
                clean_config = json.loads(json.dumps(self.cfg))
            except:
                clean_config = dict(self.cfg)

            if not storage.plugin_storage.data_dir:
                storage.plugin_storage.init_paths()

            data_dir_str = str(storage.plugin_storage.data_dir.absolute())

            from .web_server import run_server

            self.web_process = ctx.Process(
                target=run_server,
                args=(clean_config, status_queue, self.log_queue, data_dir_str),
                daemon=True
            )
            self.web_process.start()

            self._log_consumer_task = threading.Thread(target=self._consume_logs, daemon=True)
            self._log_consumer_task.start()

            # 使用轮询替代 run_in_executor 避免兼容性问题
            msg = "TIMEOUT"
            for _ in range(20):  # 10 seconds total
                try:
                    if not status_queue.empty():
                        msg = status_queue.get_nowait()
                        break
                except:
                    pass
                if not self.web_process.is_alive():
                    msg = "PROCESS_DIED"
                    break
                await asyncio.sleep(0.5)

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
            logger.error(f"启动异常: {traceback.format_exc()}")
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
        self.log_queue = None
        yield event.plain_result("✅ 后台已关闭")