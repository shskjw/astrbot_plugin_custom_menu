import asyncio
from astrbot.api.star import Context, Star, register
# 关键修改：直接引用 event 模块，而不是 filter 对象，防止重名冲突
from astrbot.api import event

# 尝试引用本地模块，如果报错则打印日志
try:
    from .web import start_web
    from .preview import get_latest_preview
except ImportError as e:
    print(f"❌ 插件引用错误: {e}")
    # 防止 IDE 报错，定义空函数
    start_web = None
    get_latest_preview = lambda: None


@register(
    "astrbot_plugin_custom_menu",
    author="shskjw",
    desc="Web可视化菜单",
    version="1.0.1"
)
class CustomMenuPlugin(Star):
    def __init__(self, context: Context, config: dict):
        super().__init__(context, config)
        self.cfg = config

    async def on_load(self):
        # 再次检查依赖是否正常
        if not start_web:
            self.context.logger.error("❌ 缺少依赖或文件缺失，Web服务无法启动！请检查 aiohttp 是否安装。")
            return

        self.context.logger.info("正在启动菜单 Web 编辑器...")
        asyncio.create_task(start_web(self.cfg, self.context.logger))

    # 使用 event.filter 而不是直接用 filter
    @event.filter.command("菜单")
    async def menu(self, e: event.AstrMessageEvent):
        if not get_latest_preview:
            yield e.plain_result("插件未正确加载。")
            return

        img_path = get_latest_preview()
        if not img_path:
            yield e.plain_result("❌ 菜单预览尚未生成，请检查 Web 后台。")
        else:
            yield e.image_result(str(img_path))

    @event.filter.command("菜单登录")
    async def login_info(self, e: event.AstrMessageEvent):
        host = e.context.platform_info.public_ip or "127.0.0.1"
        port = self.cfg.get("web_port", 9876)
        token = self.cfg.get("web_token", "astrbot123")

        yield e.plain_result(
            f"🖥️ Miao-Menu 编辑器\n"
            f"地址: http://{host}:{port}/\n"
            f"Token: {token}"
        )