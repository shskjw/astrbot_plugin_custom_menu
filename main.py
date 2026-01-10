import asyncio
import socket
import json
import multiprocessing
import traceback
import re
import os  # 新增引用
import collections
from pathlib import Path
import threading
from typing import Dict, List, Optional

from astrbot.api.star import Context, Star, register
from astrbot.api import event
from astrbot.api.event import filter
from astrbot.api import logger
from astrbot.api.message_components import File, Plain  # 新增引用：用于发送文件和纯文本

# --- 自动填充功能需要的引用 ---
from astrbot.core.star.star_handler import star_handlers_registry, StarHandlerMetadata
from astrbot.core.star.filter.command import CommandFilter
from astrbot.core.star.filter.command_group import CommandGroupFilter

# ---------------------------

try:
    from . import storage
except ImportError:
    storage = None


def _get_local_ip_sync():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2.0)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"


async def get_local_ip(): return await asyncio.to_thread(_get_local_ip_sync)


@register("astrbot_plugin_custom_menu", author="shskjw", desc="Web可视化菜单编辑器", version="1.7.6")
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
        self.trigger_keywords = ["菜单", "功能", "帮助", "指令", "列表", "说明书", "help", "menu"]
        self.regex_pattern = re.compile(
            r"(?i)(^\s*[/\.]?(菜单|功能|帮助|指令|列表|说明书|help|menu)\s*$)|"
            r"(^\s*(这个|你|bot)?\s*(怎么|如何|咋)\s*(用|使用|操作)\s*[?？]*$)|"
            r"(^\s*(你|bot)?\s*(能|会|可以|都?会)\s*(干|做|写|帮|处理|些|有)\s*(什么|啥|哪些)\s*(呢|呀|功能|作用)?\s*[?？]*$)|"
            r"(^\s*(你|bot)?\s*(有|包含|是)\s*(什么|啥|哪些)\s*(功能|作用|能力|本事)\s*[?？]*$)|"
            r"(^\s*(你|bot)?\s*(的)?\s*(功能|作用|能力)\s*(都?有|是|包含)\s*(什么|啥|哪些)\s*[?？]*$)"
        )
        self._init_task = asyncio.create_task(self._async_init())

    async def _async_init(self):
        logger.info("[CustomMenuPlugin] 开始加载资源...")
        try:
            if storage is None: raise ImportError("storage 模块加载失败")
            try:
                import PIL, imageio, numpy
            except ImportError:
                raise ImportError("缺少依赖，请安装: pip install Pillow imageio imageio-ffmpeg numpy")
            storage.plugin_storage.init_paths()
            await asyncio.to_thread(storage.plugin_storage.migrate_data)
            self.has_deps = True
            logger.info("✅ [CustomMenuPlugin] 初始化成功")
        except Exception as e:
            self.has_deps = False
            self.dep_error = f"{e.__class__.__name__}: {str(e)}"
            logger.error(f"❌ [CustomMenuPlugin] 加载失败: {self.dep_error}")

    async def on_unload(self):
        if self.web_process and self.web_process.is_alive(): self.web_process.terminate()

    def is_admin(self, event: event.AstrMessageEvent) -> bool:
        if not self.admins_id: return True
        return str(event.get_sender_id()) in [str(uid) for uid in self.admins_id]

    def _consume_logs(self):
        while self.web_process and self.web_process.is_alive():
            try:
                if self.log_queue:
                    level, msg = self.log_queue.get(timeout=0.5)
                    if level == "ERROR":
                        logger.error(f"[Web] {msg}")
                    elif level == "WARNING":
                        logger.warning(f"[Web] {msg}")
                    else:
                        logger.info(f"[Web] {msg}")
            except:
                continue

    # --- 获取 AstrBot 指令数据 (自动填充功能) ---
    def get_astrbot_commands(self) -> Dict[str, List[Dict[str, str]]]:
        """获取所有插件及其命令列表, 返回结构化数据"""
        plugin_commands = collections.defaultdict(list)
        try:
            all_stars_metadata = self.context.get_all_stars()
            all_stars_metadata = [star for star in all_stars_metadata if star.activated]
        except Exception as e:
            logger.error(f"获取插件列表失败: {e}")
            return {}

        if not all_stars_metadata: return {}

        for star in all_stars_metadata:
            plugin_name = getattr(star, "name", "未知插件")
            if plugin_name == "astrbot_plugin_custom_menu": continue

            plugin_instance = getattr(star, "star_cls", None)
            module_path = getattr(star, "module_path", None)

            if not plugin_name or not module_path: continue

            for handler in star_handlers_registry:
                if not isinstance(handler, StarHandlerMetadata): continue
                if handler.handler_module_path != module_path: continue

                command_name: Optional[str] = None
                description: Optional[str] = handler.desc

                for filter_ in handler.event_filters:
                    if isinstance(filter_, CommandFilter):
                        command_name = filter_.command_name
                        break
                    elif isinstance(filter_, CommandGroupFilter):
                        command_name = filter_.group_name
                        break

                if command_name:
                    item = {"cmd": command_name, "desc": description or ""}
                    if item not in plugin_commands[plugin_name]:
                        plugin_commands[plugin_name].append(item)

        return dict(plugin_commands)

    def _yield_smart_result(self, event_obj, path_str: str):
        """
        如果文件 <= 15MB，发送图片。
        如果文件 > 15MB，发送文件。
        """
        try:
            size_bytes = os.path.getsize(path_str)
            size_mb = size_bytes / (1024 * 1024)
            path_obj = Path(path_str)

            if size_mb > 15:
                logger.info(f"文件体积 ({size_mb:.2f}MB) 超过15MB，转为文件发送")
                return event_obj.chain_result([
                    File(file=str(path_obj), name=path_obj.name),
                    Plain(f" ⚠️ 菜单文件较大({size_mb:.1f}MB)，已转为文件形式发送。")
                ])
            else:
                return event_obj.image_result(str(path_obj))
        except Exception as e:
            logger.error(f"检查文件大小时出错: {e}")
            return event_obj.image_result(path_str)

    async def _generate_menu_chain(self, event_obj):
        if self._init_task and not self._init_task.done():
            try:
                await asyncio.wait_for(self._init_task, timeout=5.0)
            except:
                yield event_obj.plain_result("⚠️ 插件初始化超时");
                return
        if not self.has_deps: yield event_obj.plain_result(f"❌ 插件加载失败: {self.dep_error}"); return

        try:
            from .renderer.menu import render_static, render_animated
            root_config = await asyncio.to_thread(storage.plugin_storage.load_config)
            menus = root_config.get("menus", [])
            active_menus = [m for m in menus if m.get("enabled", True)]

            if not active_menus: yield event_obj.plain_result("⚠️ 当前没有启用的菜单，请在后台开启。"); return

            for menu_data in active_menus:
                menu_id = menu_data.get("id")
                is_video_mode = (menu_data.get("bg_type") == "video")

                output_format_key = "png"
                if is_video_mode:
                    output_format_key = menu_data.get("video_export_format", "apng")

                cache_path = storage.plugin_storage.get_menu_output_cache_path(menu_id, is_video_mode,
                                                                               output_format_key)

                # --- 1. 缓存命中情况 ---
                if cache_path.exists():
                    logger.info(f"✅ 从缓存发送: {menu_data.get('name')}")
                    # 使用智能发送逻辑
                    yield self._yield_smart_result(event_obj, str(cache_path))
                    continue

                logger.info(f"渲染菜单: {menu_data.get('name')} (模式: {'动画' if is_video_mode else '静态'})")

                try:
                    if is_video_mode:
                        result_path = await asyncio.to_thread(render_animated, menu_data, cache_path)
                        if result_path and result_path.exists():
                            # --- 2. 动态渲染完成情况 ---
                            yield self._yield_smart_result(event_obj, str(result_path))
                        else:
                            yield event_obj.plain_result(f"❌ 动态菜单 {menu_data.get('name')} 渲染失败，请检查视频源。")
                    else:
                        img = await asyncio.to_thread(render_static, menu_data)
                        await asyncio.to_thread(img.save, cache_path)
                        # --- 3. 静态渲染完成情况 ---
                        yield self._yield_smart_result(event_obj, str(cache_path))

                except Exception as e:
                    logger.error(f"渲染失败: {traceback.format_exc()}")
                    yield event_obj.plain_result(f"❌ 渲染错误: {e}")
                    continue

        except Exception as e:
            logger.error(f"生成菜单流程异常: {e}")
            yield event_obj.plain_result(f"❌ 系统内部错误: {e}")

    @filter.event_message_type(filter.EventMessageType.ALL)
    async def menu_smart_check(self, event: event.AstrMessageEvent):
        msg = event.message_str
        if not msg or not any(k in msg for k in self.trigger_keywords): return
        if self.regex_pattern.search(msg):
            if hasattr(event, "stop_event_propagation"): event.stop_event_propagation()
            async for res in self._generate_menu_chain(event): yield res

    @filter.command("开启后台")
    async def start_web_cmd(self, event: event.AstrMessageEvent):
        if not self.is_admin(event): return
        if self.web_process and self.web_process.is_alive(): yield event.plain_result("⚠️ 后台已运行"); return

        ctx = multiprocessing.get_context('spawn')
        status_q, self.log_queue = ctx.Queue(), ctx.Queue()

        yield event.plain_result("🚀 正在启动后台...")

        # 获取指令数据 (自动填充)
        command_data = self.get_astrbot_commands()

        try:
            from .web_server import run_server
            if not storage.plugin_storage.data_dir: storage.plugin_storage.init_paths()
            self.web_process = ctx.Process(target=run_server, args=(dict(self.cfg), status_q, self.log_queue,
                                                                    str(storage.plugin_storage.data_dir), command_data),
                                           daemon=True)
            self.web_process.start()
            self._log_consumer_task = threading.Thread(target=self._consume_logs, daemon=True)
            self._log_consumer_task.start()
            msg = "TIMEOUT"
            for _ in range(20):
                if not status_q.empty(): msg = status_q.get(); break
                if not self.web_process.is_alive(): msg = "DIED"; break
                await asyncio.sleep(0.5)
            if msg == "SUCCESS":
                ip = await get_local_ip() if self.cfg.get("web_host") != "127.0.0.1" else "127.0.0.1"
                yield event.plain_result(
                    f"🚀 正在启动后台... ✅ 启动成功!\n地址: http://{ip}:{self.cfg.get('web_port', 9876)}/\n密钥: {self.cfg.get('web_token')}")
            else:
                yield event.plain_result(f"❌ 启动失败: {msg}")
        except Exception as e:
            yield event.plain_result(f"❌ 异常: {e}")

    @filter.command("关闭后台")
    async def stop_web_cmd(self, event: event.AstrMessageEvent):
        if not self.is_admin(event): return
        if self.web_process: self.web_process.terminate(); self.web_process = None
        yield event.plain_result("✅ 后台已关闭")