# -*- coding: utf-8 -*-
"""突变检验：把 index.html 里每条"守卫"逐个拆掉，确认对应的断言真的会红。

为什么必须做这件事（而不是"测试都绿了所以没问题"）：
一条断言在**代码正确**时通过，不能说明它在**代码错误**时失败。
上面这一轮加/改了不少断言 —— 尤其"变灰""只认背包""随机数配重"这几条，
它们守的是**静默失效**（改坏了不报错，只是行为不对）。
所以每条都要现场拆一次守卫，看断言是否 FAIL，而且 FAIL 的正是那一条。

做法：改 index.html → 跑指定的测试 → 看输出里那条断言是不是 FAIL → 还原。
原文件先整份备份，跑完在 finally 里还原（中途崩了也不会留下半改的文件）。

用法： E:/anaconda/python.exe _mutate.py
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'index.html')
BAK = os.path.join(HERE, '_backup', 'index.html.mutbak')
NODE = r'C:/Users/26335/.workbuddy/binaries/node/versions/22.12.0/node.exe'

# name / old / new / 测试文件 / 期望在 FAIL 行里出现的关键词
MUTATIONS = [
    dict(
        name='拆掉「只认背包」守卫 —— 弹夹里的也能屠宰',
        old="  if (src !== 'bag') return false;",
        new="  /* MUTATED: 守卫被拆掉 */",
        test='test/integration.mjs',
        expect='只认背包',
    ),
    dict(
        name='去掉 corpses.push —— 尸体收不进去',
        old="  corpses.push(a);",
        new="  /* MUTATED: 不进 corpses */",
        test='test/integration.mjs',
        expect='corpses 收下了这一只',
    ),
    dict(
        name='材质不给副本（就地改）—— 同一物种会一起染灰',
        old="  const m = src.clone();",
        new="  const m = src;   /* MUTATED: 就地改 */",
        test='test/integration.mjs',
        expect='每个材质都换成了',
    ),
    dict(
        name='跳过贴图灰度化（只压颜色）',
        old="  if (m.map) m.map = grayTexture(m.map);",
        new="  if (false) m.map = grayTexture(m.map);   /* MUTATED */",
        test='test/integration.mjs',
        expect='贴图也换成了新的',
    ),
    dict(
        name='8b 少消费一次 rndWorld（配重被"清理"一格）',
        old="    spin: rndWorld() * 6.28,",
        new="    spin: 0,   /* MUTATED: 少消费一次随机数 */",
        test='test/integration.mjs',
        expect='随机流未漂移',
    ),
    dict(
        name='屠宰块去掉 data-zone="slay"',
        old='<div class="slab" data-zone="slay" id="slayBlock">',
        new='<div class="slab" data-zone="slayX" id="slayBlock">',
        test='test/integration.mjs',
        expect='屠宰块带着 data-zone',
    ),
    dict(
        name='高亮加回页面容器（.hot 永远看不见的老写法）',
        old="  markHot(zoneElFromEvent(e));",
        new="  markHot(bagPageEls[bag.page]);   /* MUTATED: 老写法 */",
        test='test/input.mjs',
        expect='dragover 时高亮加在',
    ),
    dict(
        name='繁衍页里擅自塞一个按钮（用户明令不许）',
        old='`<div class="sect">繁衍<span class="hint">骨架占位 · 规则待定</span></div>` +',
        new='`<div class="sect">繁衍<span class="hint">骨架占位 · 规则待定</span></div>` +\n    `<button class="btn">开始繁衍</button>` +',
        test='test/integration.mjs',
        expect='繁衍页里没有任何按钮',
    ),
]


def run_test(rel):
    p = subprocess.run([NODE, rel], cwd=HERE, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return p.stdout + p.stderr


def main():
    with io.open(SRC, encoding='utf-8', newline='') as f:
        original = f.read()
    os.makedirs(os.path.dirname(BAK), exist_ok=True)
    with io.open(BAK, 'w', encoding='utf-8', newline='') as f:
        f.write(original)
    print('原文件已备份到 ' + os.path.relpath(BAK, HERE) + '（%d 字节）' % len(original))

    bad = 0
    try:
        for i, m in enumerate(MUTATIONS, 1):
            n = original.count(m['old'])
            if n != 1:
                print('[%d] !! 跳过（突变点出现 %d 次，需要恰好 1 次）：%s' % (i, n, m['name']))
                bad += 1
                continue

            with io.open(SRC, 'w', encoding='utf-8', newline='') as f:
                f.write(original.replace(m['old'], m['new']))
            out = run_test(m['test'])
            with io.open(SRC, 'w', encoding='utf-8', newline='') as f:
                f.write(original)

            fails = [ln for ln in out.splitlines()
                     if ln.startswith('FAIL ') or ln.startswith('FAIL\t')]
            hit = [ln for ln in fails if m['expect'] in ln]
            # 「抛异常」要跟"正常的断言失败"分开：断言失败时 footer 会主动
            # throw 一句 "N assertion(s) failed"，那也会打印"运行失败："。
            # 真·崩溃的特征是**没有**那句总结（说明 driver 半路被打断了）。
            crashed = ('运行失败：' in out) and ('项失败' not in out)
            # 「跑起来了」的三种证据：有总结、有 FAIL、或者至少打印了"运行失败"。
            # 注意别把"中途抛异常"误判成"没跑" —— 那种情况 FAIL 行照样有意义
            # （第一次写这个脚本时就误判过一次，把一条真被抓住的突变记成了漏网）。
            ran = ('项断言' in out) or ('项失败' in out) or crashed
            if not ran:
                verdict = '?? 测试根本没跑起来（多半是语法就错了）'
                bad += 1
            elif hit:
                verdict = 'PASS 突变被抓住：' + hit[0].strip()[:88] + ('   [driver 半路被打断]' if crashed else '')
            else:
                verdict = '!! 突变**没**被抓住（该测试仍然全绿或红在了别处）'
                bad += 1
            print('\n[%d/%d] %s' % (i, len(MUTATIONS), m['name']))
            print('       跑 ' + m['test'] + ' → FAIL 共 ' + str(len(fails)) + ' 条')
            print('       ' + verdict)
    finally:
        with io.open(SRC, 'w', encoding='utf-8', newline='') as f:
            f.write(original)
        with io.open(SRC, encoding='utf-8', newline='') as f:
            assert f.read() == original
        print('\nindex.html 已还原（逐字节校验通过）')

    print('\n===== 突变检验：%d/%d 被抓住 =====' % (len(MUTATIONS) - bad, len(MUTATIONS)))
    return 1 if bad else 0


sys.exit(main())
