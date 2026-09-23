#!/usr/bin/env bash
# 跑全部检查。用法： bash test/run.sh
# NODE 可覆盖： NODE=/path/to/node bash test/run.sh
#
# 这七步**全部只需要 Node**（无头夹具自己搭 DOM 桩），所以任何机器都能跑。
# 有三件事这里查不到，必须**另开浏览器**跑（它们需要本机 Chrome，而且要先起服务器
# `E:/anaconda/python.exe serve.py 8791`）：
#   · 单文件版能不能真的启动并装配出完整世界
#       node "…/web3d-headless-integration-test/scripts/cdp-probe.mjs" \
#            "file:///…/alien-walk-standalone.html?autostart=1&still=1" _shots/sa.png
#       （为什么不用 --screenshot：它不等 module 的 top-level await，拍到的永远是开场卡的半截）
#   · 真浏览器里的**原生 HTML5 拖放**（弹夹 ⇄ 背包 ⇄ 屠宰块）
#       node _probe_dnd.mjs
#       走 CDP 的 Input.setInterceptDrags + dispatchDragEvent，是浏览器**自己**起拖、
#       自己命中 drop 落点；七步里的拖放断言只走合成事件 + 假元素链，证明不了这些。
#   · **HUD 的摆放**（弹夹在顶部中间、体力条在底部中间、两两不重叠、&hud=0 藏得住弹夹）
#       node _probe_hud.mjs
#       摆放类 UI 的正确性不在代码里，在渲染出来的矩形上；而且窄窗口的重叠
#       **只在某个宽度区间出现**，开发机的窗口宽度永远看不到。
#       它还会验证「窄屏 @media 真的生效了」—— 同优先级的 @media 写在基础规则前面
#       会变成静默死代码，而"不重叠"那几条断言**照样会绿**。
#
# 另外这几个是**排查用**的诊断（不进七步，按需手动跑；都只要 Node）：
#   · _probe_animal_spacing.mjs   40 只生物的最近邻间距 / 重叠侵入量 / 位移分布
#   · _probe_animal_stuck.mjs     复现"某只卡在场地角落不动"的时序并定位它
#   · _probe_corpse_spot.mjs      算尸体的取景机位（给 _shots/shoot.sh 用）
#   · _probe_sheet.mjs            新 GLB 的材质/贴图体检页
NODE="${NODE:-C:/Users/26335/.workbuddy/binaries/node/versions/22.12.0/node.exe}"
cd "$(dirname "$0")/.." || exit 1

##############################################################################
# 0. 语法闸门（几毫秒，但省下几分钟）
# ----------------------------------------------------------------------------
# 为什么单开这一步：integration / input / scene-cost 这些文件的 driver 是
# **一个大模板字符串**，只要注释里多写一个反引号，整条字符串就被截断，
# 报出来的是一个莫名其妙的 SyntaxError（"Unexpected token '>'" —— 指向注释里的
# 某个字），人第一眼会以为是正文写错了。这个坑在 2026-09-22 一天里踩了五次。
# node --check 会在动手之前、几毫秒内把同一类错误直接指出来，
# 不用先跑完整套（几秒）再看到它。
##############################################################################
echo "########## 0/7 语法闸门（node --check）##########"
# 先清掉上一次留下的临时模块。
# 为什么：夹具把 driver 拼进 .tmp-harness-N.mjs 再 import，正常会自己删；
# 但 Windows 上 ESM 还挂着时 unlink 会失败（拦不住，只能报一声），于是残留下来。
# 残留本身无害，但有两个实际后果：① 会被下面这轮 node --check 一起扫（浪费且误导）；
# ② **会随打包发出去**（2026-09-23 真发生过）。
rm -f test/.tmp-harness-*.mjs
for f in test/*.mjs build-standalone.mjs _probe_*.mjs; do
  [ -e "$f" ] || continue
  if ! "$NODE" --check "$f" 2>/tmp/_chk.err; then
    echo "  语法错误：$f"
    sed -n '1,6p' /tmp/_chk.err
    FAILED=1
  fi
done
if [ -n "$FAILED" ]; then echo "  语法没过，后面的检查没意义 —— 先修上面这几处。"; else echo "  全部 .mjs 通过解析"; fi

##############################################################################
# 0b. driver 模板字符串里的裸反引号（同一步的成本，但诊断信息准确得多）
# ----------------------------------------------------------------------------
# `node --check` 也能抓到这个错，但它报的是"后面某处的 SyntaxError/ReferenceError"
# —— 指向注释里的一个词，甚至（截断后接上一堆合法表达式时）变成
# `ReferenceError: fill is not defined` 这种完全不相干的症状。
# 这个坑在本项目已经踩了八次，所以单开一条**指到行号**的检查。
##############################################################################
if ! "$NODE" test/check-driver-backticks.mjs; then FAILED=1; fi

echo
echo "########## 1/7 集成测试（场景 / AI / 交互逻辑）##########"
"$NODE" test/integration.mjs || FAILED=1

echo
echo "########## 2/7 输入与 UI 接线测试 ##########"
"$NODE" test/input.mjs || FAILED=1

echo
echo "########## 3/7 启动参数（?autostart=1&… 这条真实入口）##########"
"$NODE" test/boot-params.mjs || FAILED=1

echo
echo "########## 4/7 场景开销体检 ##########"
"$NODE" test/scene-cost.mjs || FAILED=1

echo
echo "########## 5/7 单文件版重建（含内联完整性断言）##########"
"$NODE" build-standalone.mjs || FAILED=1

echo
echo "########## 6/7 取景坐标（供 _shots/shoot.sh 用）##########"
"$NODE" test/animal-aim.mjs || FAILED=1

echo
if [ -n "$FAILED" ]; then echo ">>> 有检查失败 <<<"; exit 1; fi
echo ">>> 全部通过 <<<"
