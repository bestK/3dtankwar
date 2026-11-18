# 装甲战线 1985 (Armor Frontline 1985) · 3D 坦克大战

> 极高品质的 3D 坦克大战现代重构，基于 **Three.js + TypeScript + Vite**，原生支持 **EMQX 现代 MQTT WebSocket 协议**跨端全网联机对战，专为 **GitHub Pages** 静态托管优化。

![战役演示](./dist/screenshot_hero.png)

---

## 🌟 核心特性与技术亮点

### 1. 顶尖的审美与 3D 艺术表现力
* **微缩沙盘微距摄影美学（Macro Diorama & Tilt-Shift）**：
  * 精心调校的移轴散景虚化（Tilt-Shift DOF）、动态冲击波色散、胶片暗角与颗粒质感。
  * 赛博黑曜石与古铜黄铜（Obsidian & Ordnance Brass）战术界面，所有 HUD 采用斜切装甲倒角（Chamfered Armour Plate）。
* **全过程程序化物理材质（PBR Materials）**：
  * 100% 纯代码生成的窑烧红砖法线/粗糙度贴图、锻造轧制装甲钢铆钉贴图、玄武岩战术地砖与磨损冰原表面，零外部静态贴图依赖，极速秒开。
  * 多层立体水系流动 Shader（带实时阳光焦散与菲涅尔镜面反射）。
* **物理悬挂动力学与弹道系统**：
  * 坦克拥有独立的履带驱动、路轮旋转、车体加减速俯仰/颠簸摇晃弹簧物理。
  * 独立 360° 炮塔旋转与反冲后坐力、炮口红热热量传导、车尾真实粒子排气与地面履带压痕。
* **令人震撼的爆破与粒子特效（VFX）**：
  * 砖墙被炮弹击中时化作多块独立三维物理碎块翻滚弹跳，飞溅白炽火花与火光转浓烟的双段体积烟雾。
  * 蓄力电磁穿甲炮、炮塔殉爆掀飞翻滚（Flying Popped Turret）、能量偏折护盾六边形扫描。

### 2. 现代 MQTT 全网联机对战（基于 EMQX Broker）
* **免自建后端，直接连接公开分布式 MQTT Broker**：
  * 默认直连 `wss://broker.emqx.io:8084/mqtt`（TLS/WSS 加密），同时支持 `ws://broker.emqx.io:8083/mqtt`。
  * 智能探测页面协议，若部署在 HTTPS/GitHub Pages 下自动升级为 WSS 加密连接。
* **丰富联机模式**：
  * **联机死斗 (PvP)**：支持 2~4 人多向竞技死斗，首个达成 8 击杀者夺冠；房间内仅有一人时自动配备 AI 陪练，真人接入瞬间无缝交接！
  * **联机守卫 (Co-op)**：与好友组队协同守卫经典鹰徽基地，抵御蜂拥而至的机械化装甲波次。
* **房间机制与一键邀请**：
  * 支持自定义房间号（如 `#1985`、`#8842`），点击「复制邀请」即可生成带参数链接（如 `?room=8842&mode=pvp`），好友打开即自动进房同台激战。
  * 内置活跃房间大厅广播与动态延迟 Ping 测量。

### 3. 多种游戏模式
1. **单人战役**：精选 5 大经典战区（01 经典防线、02 运河铁壁、03 极寒冰堡、04 密林伏击、05 双子要塞）。
2. **联机死斗 / 联机守卫**：全网多人对决。
3. **沙盘工坊**：自由雕刻红砖、钢铁、水道、密林与冰原，支持即时保存并一键实弹演练。
4. **子弹时间（Slow-Mo）**：轻按 `Tab` 键即可体验 0.24x 极速降维的慢镜头微观弹道对碰与破片慢动作。

---

## 🎮 操作指南

| 按键 / 操作 | 功能描述 |
| :--- | :--- |
| **WASD** | 驾驶坦克移动（智能基于当前摄像机视线方向，360°旋转后依然符合直觉） |
| **← → / Q E** | 键盘旋转炮塔瞄准（与鼠标瞄准自动切换） |
| **空格 / 鼠标左键** | 开炮；长按蓄力充能，蓄满释放高爆穿甲轨道炮（击穿多层障碍与钢铁） |
| **鼠标右键拖拽** | 360° 无死角自由旋转三维战术沙盘 |
| **滚轮** | 缩放微距镜头（支持超近特写与宏观全局沙盘） |
| **中键拖拽 / Alt+拖拽** | 平移战区聚焦中心 |
| **Tab 键** | 开启 / 关闭慢动作子弹时间 |
| **C 键** | 快速循环切换：微缩沙盘视角 / 追尾跟随视角 / 自由环视视角 |

右上角「设置」可调整键盘炮塔转速（1.0–6.0），设置会自动保存在本地。

---

## 🚀 本地开发与构建

### 安装依赖
```bash
npm install
```

### 本地启动热重载开发服务器
```bash
npm run dev
```
打开浏览器访问 `http://localhost:5173` 即可畅玩。

### 编译生产静态包
```bash
npm run build
```
编译产物位于 `dist/` 目录，完全静态化，无需任何 Node.js 运行时即可在任意 Web 容器或 CDN 上运行。

---

## 🌐 部署到 GitHub Pages

项目中已配置自动化 GitHub Actions 工作流文件 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)。

1. 将代码推送到 GitHub 仓库的 `main` 分支：
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit 3d tank war"
   git remote add origin https://github.com/<your-username>/3dtankwar.git
   git branch -M main
   git push -u origin main
   ```
2. 进入 GitHub 仓库设置：
   * 依次点击 **Settings** -> **Pages**。
   * 在 **Build and deployment** 下的 **Source** 选择 **GitHub Actions**。
3. 推送完成后，GitHub Actions 会自动构建并部署，几秒钟后即可在 `https://<your-username>.github.io/3dtankwar/` 在线游玩！
