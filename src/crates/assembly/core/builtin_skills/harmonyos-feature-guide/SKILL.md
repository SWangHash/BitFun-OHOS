---
name: harmonyos-feature-guide
description: "MUST load when the user wants to add a HarmonyOS innovative feature to their app (e.g. 扫码, 画中画, 隔空传送, 服务卡片, 碰一碰), mentions a HarmonyOS Kit (e.g. Scan Kit, Share Kit, Form Kit), mentions a feature-related keyword (e.g. 转场, 动效, 投屏, 分屏, 拖拽, 振感), or asks about 2C feature categories (全场景协同, 原生智能, 极致流畅, 简单易用, 高端精致, 纯净安全). Do NOT load for basic ArkUI component usage (Column/Row/Stack layout), ArkTS syntax errors, or project setup."
---

# HarmonyOS 创新特性开发指南

本 Skill 提供鸿蒙 70+ 创新特性的开发指南和 API 参考。下方已列出所有特性的官方开发资源链接，**优先获取这些链接的内容去开发**，如需补充实现细节可搜索网络。

## 模糊匹配提示

用户描述功能时可能使用非标准名称，以下提示帮助匹配到正确的特性：

| 用户可能的说法 | 应匹配的特性编号 |
|---------------|----------------|
| 转场/过渡/出现消失动画/共享元素/转场组件 | #47 一镜到底 |
| 扫码/二维码/条码 | #8, #35, #50 |
| 分享/跨设备传文件 | #3, #19 |
| 卡片/桌面小部件/widget | #12, #13, #42 |
| 投屏/投播/镜像 | #67 |
| 分屏/多窗口/小窗 | #68, #69 |
| 画中画/小窗播放 | #5, #69 |
| 拖拽/长按拖动 | #61 |
| 振感/马达/震动 | #21 |
| 活体检测/安全相机 | #22 |
| 防羊毛/设备风险 | #23 |
| 无密码登录/passkey | #6 |
| AI识图/图片抠图/文字提取 | #34 |
| 文档扫描/去弯曲/扫描成PDF | #57 |
| 证件识别/OCR/卡证 | #58 |
| 朗读/听书/TTS | #59 |
| AI字幕/实时字幕/翻译字幕 | #60 |
| 自动填充/表单填充 | #56 |
| 导航/定位/隧道 | #7, #41 |
| 直播/开播/低时延视频 | #2, #28 |
| 并发/并行/多线程 | #38, #48 |
| 高斯溅射/3D渲染 | #1 |
| 智能体/AI Agent | #4 |
| 3D重建/点云/体积测量 | #9 |
| NPU算子/自定义算子 | #10 |
| 截图分享/图片加链接/回旋镖 | #11 |
| RAG/向量搜索/语义检索 | #14 |
| 上传加速/网络加速 | #15 |
| 金融盾/TUI | #16 |
| 防窥/防偷窥 | #17 |
| 握持感知 | #18 |
| 复制粘贴同步/剪贴板跨设备 | #20 |
| NPU/AI算力 | #24 |
| 文档权限/数据保护/DLP | #25 |
| 自动支付/扫码支付 | #26 |
| 文件下载/下载按钮 | #29 |
| 设备证明/设备证书 | #30 |
| 国密/密钥管理 | #31 |
| Keychain/敏感数据存储 | #32 |
| 设备匿名标识 | #33 |
| 游戏低时延音频/音频时延 | #36 |
| 三方相机/拍照效果 | #37 |
| 短视频流畅 | #39 |
| HDR Vivid/Audio Vivid | #40 |
| DeepLink/AppLinking/统一链接 | #43 |
| 儿童模式 | #44 |
| 来电/一键接听/VOIP | #45 |
| 帧率自适应/可变帧率 | #46 |
| 日程/日历 | #49 |
| 一步直达/状态栏 | #51 |
| QuickLook/文件预览 | #52 |
| 触控笔/手写 | #53 |
| 网络质量/弱网优化 | #54 |
| 智慧分发/意图 | #55 |
| 图片增强/超分辨率/超分 | #62 |
| 动态照片/Live Photo | #64 |
| 跨设备相机 | #65 |
| 跨设备接续/应用续接 | #66 |
| 胶囊通知/实况窗 | #70 |

## 2C分类

- **简单易用**: 服务卡片、锁屏卡片、扫码能力、百米扫码、扫码直达、统一拖拽、鸿蒙振感、VOIP一键接听、日历、手写、实况窗、PC一步直达、统一文件下载、统一文件预览、智慧多窗-画中画、智慧多窗-应用内分屏
- **原生智能**: 应用智能体、意图框架、智能填充、AR空间计算、AR高精几何重建、AI算力开放、左右手感知、智能图文提取、文档扫描、卡证识别、朗读、AI字幕、长隧道车道级定位、智感支付、回旋镖、ArkData向量数据库
- **极致流畅**: 网络上行加速、弱网感知、TaskPool任务池、LTPO可变帧率、低时延编解码、小视频流畅、FFRT并行、音频低时延通路、Ascend C自定义算子
- **全场景协同**: 隔空传送、碰一碰、跨设备剪贴板、应用接续、服务互通、手机车机导航流转、无线投屏
- **高端精致**: 3DGS渲染、大图预览画中画、互动卡片、云镜-红枫直播、拍照一致性、鸿蒙vivid、视频超分辨率、MovingPhoto、流畅动效-一镜到底
- **纯净安全**: 通行密钥、数字盾、机主认证、安全检测、DLP数据保护、设备真实性证明、通用密钥管理Keystore、Asset敏感资产存储、匿名设备查询、未成年人模式

## 特性表

1. **3DGS渲染** - 渲染结果更清晰，材质表现力更强 | Spatial Recon Kit | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/spatial-recon-api | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/spatial-recon-api
2. **云镜-红枫直播** - 直播采集红枫原色、多摄切换、HDR Vivid | Camera Kit | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/camera-framerate-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-camera#setzoomratio11
3. **隔空传送(一抓一放)** - 跨设备基于隔空手势交互分享 | Share Kit | 全场景协同 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/share-introduction | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/share-arkts
4. **应用智能体** - 开发智能体集成到鸿蒙应用提升智能化体验 | AgentKit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/service/quick-start-0000002270426102 | API参考: https://developer.huawei.com/consumer/cn/doc/service/quick-start-0000002270426102
5. **大图预览画中画** - 全景照片画中画浏览，沉浸式看大图 | Image Kit | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/image-kit | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/image-kit
6. **通行密钥(Passkey)** - 无密码登录，用屏幕解锁方式作凭据 | Online Authentication Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/onlineauthentication-passkey | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/onlineauthentication-passkey-api
7. **长隧道车道级定位** - 长隧道精准速度提醒、高精位置输出 | Location Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/location-guidelines | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/location-guidelines
8. **百米扫码** - 50cm二维码百米距离扫码直达 | Scan Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/scan-kit-guide-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/scan-scanbarcode-api + https://developer.huawei.com/consumer/cn/doc/harmonyos-references/scan-customscan-api
9. **AR高精几何重建** - 环境高精度稠密点云，体积测量、三维重建 | AR Engine | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arengine-ability | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/arengine-capi-arengine
10. **Ascend C自定义算子** - NPU自定义算子，极致性能功耗优化 | CANN Kit | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/cannkit-ascendc-operator-development | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/cann-api
11. **回旋镖** - 图片中添加AppLink，截图可快速跳转源应用 | Multimodal Awareness Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/metadatabinding-guidelines | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-awareness-metadatabinding
12. **锁屏卡片** - 锁屏呈现关键信息，无需解锁一键直达 | Form Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-ui-lockscreen-form-development | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-app-form-forminfo
13. **互动卡片** - 3D互动卡片，桌面可互动新体验 | Form Kit | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-ui-liveform-overview | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-app-form-liveformextensionability
14. **ArkData向量数据库** - 向量数据库，数据检索及语义化AI能力 | ArkData | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/data-augmentation-rag-demo | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/dataaugmentation-rag-api
15. **网络上行加速** - 多路径网络并发，实现上行加速 | Network Kit | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/networkboost-introduction | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/networkboost-arkts
16. **数字盾服务** - 金融盾TUI PIN和交易确认能力 | Device Security Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/devicesecurity-trustedauth-service | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/devicesecurity-trusted-auth-api
17. **机主本人认证** - 识别是否机主，对非机主隐藏隐私 | Device Security Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/devicesecurity-dlpantipeep | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/devicesecurity-dlpantipeep-api
18. **左右手感知** - 识别握持手和操作手情况 | Multimodal Awareness Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/motion-guidelines | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-awareness-motion
19. **碰一碰** - 双方手机顶部碰一碰快速完成分享 | Share Kit | 全场景协同 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V13/harmony-share-overview-V13 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V13/share-harmony-share-V13
20. **跨设备剪贴板** - 一台设备复制，另一台粘贴 | Basic Services Kit | 全场景协同 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/distributed-pasteboard-guide-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/js-apis-pasteboard-V5
21. **鸿蒙振感** - 振动与交互融合，细腻精致一体化振动体验 | Sensor Service Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/vibrator-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/sensor-service-arkts-V5
22. **安全摄像头&安全地理位置** - 活体检测防篡改、地理位置防欺诈 | Device Security Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/devicesecurity-taas-dev-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/devicesecurity-taas-api-V5
23. **安全检测服务** - 交易或敏感操作的设备风险查询风控 | Device Security Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/devicesecurity-safetydetect-develop-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/devicesecurity-safetydetect-api-V5
24. **AI算力开放** - NPU提升AI计算性能，异构计算降低功耗 | CANN Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/hiai-foundation-kit-guide-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/hiai-foundation-api-V5
25. **DLP数据分享保护** - 文档策略权限控制，只有授权用户可查看 | Data Protection Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/data-protection-kit-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/js-apis-dlppermission-V5
26. **智感支付** - 检测扫码枪自动跳转支付码界面 | -- | 原生智能 | 三方只需提供支付页deeplink即可
27. **AR空间计算** - AR运动跟踪，理解现实空间打造虚实融合体验 | AR Engine | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/ar-engine-kit-guide-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/ar-engine-api-V5
28. **低时延编解码** - 窗口流畅切换、快速启动、低时延硬件编解码 | AVCodec Kit | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/avcodec-kit-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/avcodec-c-V5
29. **统一文件下载** - 文件统一保存到下载目录，系统自动授权 | Core File Kit | 简单易用 | 开发指南: https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ohos-arkui-advanced-DownloadFileButton.md | API参考: https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-core-file-kit/js-apis-file-picker.md#save-3
30. **设备真实性证明** - 硬件TEE设备证书，证明设备真实性 | Device Certificate Kit + Universal Keystore Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/device-attestation | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/universal-keystore-api
31. **通用密钥管理Keystore** - 密钥安全操作，国密算法，密钥不出安全区 | Universal Keystore Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/huks-key-generation-arkts | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/universal-keystore-kit-api
32. **Asset敏感资产存储** - TEE级短敏感数据加密存储，对标iOS Keychain | Asset Store Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/asset-store-kit-guide | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/asset-store-kit-api
33. **匿名设备查询(Device Verify)** - 匿名Token标记设备，防薅羊毛、标记新机 | Device Security Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/devicesecurity-deviceverify-develop-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/devicesecurity-deviceverify-api-V5
34. **智能图文提取** - 一行代码使能AI识图、抠图、文字识别 | ArkUI | 原生智能 | 开发指南: 一行代码使能enableAnalyzer=true | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/ts-basic-components-image-V5#enableanalyzer11
35. **扫码直达** - 系统入口扫码直达应用服务页面 | Scan Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/scan-directservice-V5
36. **音频低时延通路** - 统一音频接口，最低20ms输出时延 | Audio Kit | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/using-ohaudio-for-playback-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/_o_h_audio-V5
37. **拍照一致性** - 三方拍照效果等同系统相机，500ms出图 | Camera Kit | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/camera-guide-arkts-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/js-apis-camera-V5
38. **FFRT并行加速库** - 数据依赖构建异步并发任务，提升并行度 | Function Flow Runtime | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ffrt-kit | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/function-flow-runtime-api-V5
39. **小视频流畅优化** - 解码器复用和surface，短视频滑动流畅 | AVCodec Kit | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/video-decoding-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/_video_decoder-V5
40. **鸿蒙vivid标准能力开放** - HDR Vivid视频+图片+Audio Vivid标准 | Image Kit + Media Kit + Audio Kit | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/hdr-vivid-video-player-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/_video_decoder-V5
41. **手机车机导航流转** - 导航信息手机和座舱间碰一碰/摇一摇流转 | Car Kit | 全场景协同 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/car-kit-guide | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/car-navigationinfomgr
42. **服务卡片** - 桌面组合卡片，美化桌面、一步直达APP | Form Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/form-kit-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/form-kit-V5
43. **统一链接跳转** - 样式丰富、规则内免弹窗、安全好 | App Linking Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/app-linking-startup-V5
44. **未成年人模式** - 系统级未成年保护，纯净安全体验 | Account Kit | 纯净安全 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/account-minorsprotection-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/account-api-minorsprotection-V5
45. **VOIP一键接听** - 一键接听VOIP消息 | Call Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/push-voip-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/push-arkts-V5
46. **LTPO可变帧率** - 不同场景不同刷新率，保证流畅增加续航 | ArkGraphics 2D | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkgraphics-displaySync | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-graphics-displaysync
47. **一镜到底** - 共享元素转场过渡，提升视觉流畅感 | ArkUI | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/arkts-use-animation-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/ts-universal-attributes-menu
48. **TaskPool任务池** - 更简单易用的并发API | ArkTS | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/concurrency-overview-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/js-apis-taskpool-V5
49. **日历开放能力** - 日程写入日历、一键服务、日程picker | Calendar Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/calendarmanager-guidelines | API参考: https://gitee.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-calendar-kit/js-apis-calendarManager.md
50. **扫码能力开放** - 统一扫码服务，扫得快、准、远 | Scan Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/scan-introduction-V5
51. **PC一步直达** - 应用高频操作轻量化便捷入口 | StatusBar Extension Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/statusbar-extension-introduction-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/statusbar-extension-arkts-V5
52. **统一文件预览** - 不跳转弹窗直接预览各类文档 | PreView Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/preview-filepreview-V5
53. **手写体验** - 笔刷效果、笔迹编辑、报点预测、一笔成形 | Pen Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/pen-kit-guide-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/pen-api-V5
54. **弱网感知** - 蜂窝网络质量感知，弱网场景音视频优化 | Network Kit | 极致流畅 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/network-boost-kit-guide-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/networkboost-netquality-V5
55. **意图框架** - 聚合系统流量入口，AI精准分发服务 | Intents Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/intents-kit-guide | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/intents-api-V5
56. **智能填充** - 个人信息一次填入处处适用，自动填充 | Account Kit + ArkUI | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/scenario-fusion-intelligent-filling-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/ts-basic-components-textinput-V5#contenttype12
57. **文档扫描** - 纸质文档快速扫描为PDF，边缘识别去弯曲 | Vision Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/vision-documentscanner-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/vision-document-scanner-V5
58. **卡证识别** - 身份证银行卡结构化识别，OCR增强 | Vision Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/vision-cardrecognition-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/vision-card-recognition-V5
59. **朗读** - 几行代码上线听新闻/听小说，断网可用 | Speech Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/speech-textreader-guide-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/speech-textreader-api-V5
60. **AI字幕** - 视频播放实时字幕+双语翻译字幕 | Speech Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/speech-aicaption-guide-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/speech-aicaptioncomponent-V5
61. **统一拖拽** - 辅助拖拽一键摘录，跨应用跨设备中转数据 | ArkUI | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/ts-universal-events-drag-drop | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/ts-universal-attributes-drag-drop
62. **视频&图片超分辨率** - 提高图像或视频帧分辨率 | Media Kit | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/image-processing-arkts
63. **智能图片picker** - PhotoPicker智能推荐，快速找到需要的照片 | MediaLibrary Kit | 原生智能 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/smart-photopicker-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/js-apis-photoaccesshelper-V5
64. **MovingPhoto** - 鸿蒙动态照片格式，动态效果展示图片 | MediaLibrary Kit | 高端精致 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/camera-moving-photo-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/ohos-multimedia-movingphotoview-V5
65. **服务互通** - 借助周边设备的拍照、图库、扫描、高清视频能力 | ServiceCollaboration Kit | 全场景协同 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/servicecollaborationkit-introduction-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/servicecollaboration-arkts-V5
66. **应用接续** - 在其他设备上无缝衔接当前任务 | Ability Kit | 全场景协同 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/app-continuation-overview-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/ability-api-V5
67. **无线投屏&投播** - 统一投播组件，视频自动切换资源投播 | AVSession Kit | 全场景协同 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/avsession-overview | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/ohos-multimedia-avcastpicker
68. **智慧多窗-应用内分屏** - 应用内分屏，任务并行（折叠机/PAD） | ArkUI | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/multi-window-intro-V5 | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-app-ability-abilityconstant#windowmode12
69. **智慧多窗-画中画** - 视频播放/通话/会议/直播画中画能力 | ArkUI | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/window-pipwindow | API参考: https://gitee.com/openharmony/interface_sdk-js/blob/master/api/@ohos.PiPWindow.d.ts
70. **实况窗** - 聚焦进行中的任务，锁屏/通知中心/状态栏展示 | LiveView Kit | 简单易用 | 开发指南: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/liveview-introduction | API参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/live-view-api-V5