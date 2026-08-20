# dsh-video

DeepSeek Harness 的工作区本地视频插件。启用后，Agent 可调用 `read_video`，把 `/workspace` 中的 MP4/WebM 文件显示为对话内的原生 HTML5 视频播放器，并提供同源下载链接。

## 安全边界

- 只允许 `/workspace` 内的文件；相对路径按 `/workspace` 解析。
- 规范化路径并拒绝目录穿越及符号链接逃逸。
- 拒绝远程 URL、`file:` URL、目录和控制字符。
- 仅支持 `.mp4` 与 `.webm`，且扩展名必须与真实容器文件头一致。
- 单文件上限 200 MiB。
- 视频按 SHA-256 保存到 `~/.dsh/videos`，目录权限 `0700`，对象权限 `0600`。
- HTTP 仅支持 GET、HEAD 和单段 Range；路由不提供目录列表。
- 浏览器只从经过校验的哈希构造同源 URL，不接受元数据提供的任意 URL，也不插入 HTML。

## 使用

在工作区放入视频，例如：

```text
/workspace/videos/demo.mp4
```

然后让 Agent 读取或展示该视频。工具名是 `read_video`，参数为：

```json
{ "file_path": "/workspace/videos/demo.mp4" }
```

成功后，对应工具卡片会显示视频播放器和“下载视频”链接。

## 配置

通常无需配置。测试或隔离运行可使用：

- `DSH_VIDEO_WORKSPACE_ROOT`：允许的工作区根，默认 `/workspace`。
- `DSH_VIDEO_STORE_DIR`：内容存储目录，默认 `~/.dsh/videos`。

## 启停与恢复

插件通过自身 `cordis.patch.yml` 的 loader entry 控制，经过单元、安全与本地 profile 验证后默认启用。若需要紧急隔离，可临时给 entry 加上 `disabled: true`，从而保留包和历史结果但停止加载。

禁用插件不会删除 `~/.dsh/videos` 中的对象。历史工具结果会安全降级为文本；需要清理存储时应先确认没有会话仍引用对应哈希，再对精确对象做备份和删除。

## 验证

```bash
npm test
node --check lib/index.js
node --check lib/client.js
```

