# 把这个场景搬到 WebGPU，能快多少

先交代现在的处境。这个环跑在 WebGL2 上，1440×900 的窗口、DPR 1.75，画布实际
2520×1575。帧率锁 30，主线程每帧 1.39 ms，剩余约 30 ms 全是余量。整机看，
GPU 吃掉了帧预算的一半左右。

数据全部来自 `data/baseline.json`，测量方法是 `scripts/bench-frame.mjs`：打开页面、
等画布就绪、用 CDP 的 `Performance.getMetrics` 取十秒差值，再用 `MutationObserver`
数实际帧。数字是在这台 M5 上跑出来的，换机器会变。

## 瓶颈到底在哪一层

先排除几个常见的嫌疑人。

**绘制调用不是。** 整个场景只有三个 draw：节点（一个 InstancedMesh，644 个实例）、
连杆（一个，966 个）、光点（一个 Points）。三个 draw call 在哪个 API 里都不值一提。

**节点数量也不是。** 把蠕动挪进顶点着色器之后，每帧的 CPU 工作只剩 uniform 赋值
和三次 draw 的提交，实测 1.39 ms。就算全砍掉，30 fps 也还是 30 fps。

**剩下的是像素。** 每帧要跑的东西按顺序是：场景渲染到 RGBA16F（2520×1575）、
景深的两次 pass 加一遍 mipmap 生成、bloom 的五级降采样加五级升采样、
最后一次合成到屏幕。十二个左右全屏 pass，每个都在读写同样大的浮点附件。

单张 RGBA16F 是 2520 × 1575 × 8 字节 ≈ 31.8 MB。十二个 pass 一轮下来，
光附件读写就是几百 MB 的显存流量。这才是那一半帧预算的去处。

## WebGPU 在这条链上能改三件事

**一，省掉 tile 写回。** 苹果的 GPU 是 tile-based 的，渲染时颜色先留在片上，
pass 结束才写回内存。WebGL2 没给应用任何控制权，每个中间附件都得老老实实存一次
再读一次。WebGPU 的 render pass 可以标 `storeOp: "discard"`：中间那几级 bloom
只被下一个 pass 读、永远不会被采样，写回内存纯属浪费。十二个 pass 里能标 discard
的至少八到九个。

按 31.8 MB 一个附件算，九个附件就是 286 MB 的读写省下来。M5 的统一内存带宽
在 150–200 GB/s 这个量级，折合 1.5–2 ms。听着不多，但这一帧总共只有 33 ms，
而且省的正好是最贵的那部分。

**二，bloom 的降采样可以用 compute 写。** 现在的做法是每个降采样级别画一个全屏
三角形，顶点着色器什么也没干，纯粹为了触发像素着色。compute pass 里一个
workgroup 读 4×4 写 1 个像素，省掉光栅化这一层和全屏三角形的设置开销。
省下的绝对值不大，但链条清楚，好实现。

**三，能量到真正的 GPU 时间。** 这条跟快慢无关，但可能是最有价值的。
WebGL2 的 `EXT_disjoint_timer_query` 在 Safari 上靠不住，Chrome 上被各种策略
削弱，所以到今天为止我们手上没有一个可信的 GPU 帧时间——只能从"总帧时间减去
主线程时间"倒推。WebGPU 的 `timestamp-query` 是核心特性，能直接给出每个 pass
的耗时。有了这个数字，上面所有估算都能被证伪或证实。

## 所以能快多少

老实说：**10–20%**，在 30 fps 锁定的前提下肉眼看不出来。

理由是把上面两条加起来。带宽省 1.5–2 ms，compute 换掉光栅化再省一点，剩下的
像素着色、金属 IBL 采样、景深模糊的采样次数一件都没变——这些跟 API 无关。
要真的翻倍，得动 DPR 和 pass 数量，那是另一个课题，而且现在就能做。

反过来说，如果解除 30 fps 上限，WebGL2 这边已经能跑到 60 fps（主线程 1.8 ms）。
也就是说这个场景今天在两个 API 下都不缺帧。迁移的价值不在帧率，在于：

- 更少的 GPU 时间意味着更低的功耗，笔记本上更安静、电池更久；
- 拿到可信的 GPU 计时，以后的优化有据可依；
- 为将来真正吃 GPU 的功能（比如把整个晶格做成 compute 生成的几何）铺路。

## 代价

**着色器要重写。** 现在 `src/scene/material.ts` 是一套 `onBeforeCompile` 补丁：
在 three 的着色器源码里替换 `begin_vertex`、`project_vertex`、`emissivemap_fragment`
这些 include 块。节点材质（TSL）没有这套钩子，得换成 `positionNode`、`colorNode`、
`emissiveNode` 一层层拼。涉及大约 200 行，包括金属磨损、微划痕、蠕动的曲线采样、
连杆的旋转。这不是机械翻译，有几处得重新想。

**后处理要重调。** 景深和 bloom 在 three 的 WebGPU 后端里都有对应节点，
但参数不通用，得重新对一遍。这是最容易出现"看起来差不多但就是不对"的地方。

**包体涨。** three 的 WebGPU 构建带上 TSL 编译器，大约多 150 kB gzip。
对首屏有影响，可以用动态 import 隔离掉——本来场景就是异步挂载的。

**浏览器覆盖。** 桌面 Chrome、Edge 已经稳定。Safari 和 iOS 的支持情况**待验证**，
这是这条课题里唯一还没有答案的事实。降级链现成的：`data-renderer` 已经有
`webgpu → webgl2 → static` 的位置，探不到 WebGPU 就走现在这条路。

## 下一步

不迁。先做一个 spike，一天，分两段：

1. `?renderer=webgpu` 参数开着走 `WebGPURenderer`，几何和金属材质用默认节点材质，
   蠕动用 `texture()` 采样同一张 LUT，**关掉景深和 bloom**。量裸场景的 GPU 时间。
2. 打开 post chain，逐个 pass 加 timestamp query，跟 WebGL2 那边的倒推值对照。

判据写在前面：60 fps 下主线程 ≤ 1.0 ms，且 GPU 帧时间下降 ≥ 10%，才继续。
两项都不满足就停在这里，把结论留在台账里，别再花第二个星期。

现在还没做的部分就是这两段，做完回来改 `status`。
