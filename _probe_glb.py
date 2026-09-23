# -*- coding: utf-8 -*-
"""看一眼一批 GLB 到底装了什么：几何量、贴图、动画、扩展、真实尺寸、透明方式。
   只读 GLB 二进制，不依赖任何 3D 库 —— GLB 就是
   [12 字节头][JSON chunk][BIN chunk]，把 JSON chunk 解出来即可。

   用法: python _probe_glb.py <目录>      # 递归扫该目录下所有 .glb

   2026-09-22 扩写：① 递归（Tripo 库是 01_Characters/ 这样的两层结构）；
   ② 打印 alphaMode / doubleSided / metallic / KHR_materials_transmission ——
   判"这模型能不能直接进实时游戏"靠的就是这几个字段（BLEND+transmission 会触发
   额外全屏 pass）；③ 打印节点缩放，因为 JellyTranslucent 是故意 2x 的。"""
import json
import os
import struct
import sys

root = sys.argv[1] if len(sys.argv) > 1 else 'models_inspect/models'

rows = []
for dirpath, _dirnames, filenames in os.walk(root):
    for fn in sorted(filenames):
        if not fn.endswith('.glb'):
            continue
        p = os.path.join(dirpath, fn)
        rel = os.path.relpath(p, root).replace('\\', '/')
        with open(p, 'rb') as f:
            data = f.read()
        magic, ver, total = struct.unpack('<4sII', data[:12])
        assert magic == b'glTF', (fn, magic)
        off, j = 12, None
        while off < len(data):
            clen, ctype = struct.unpack('<I4s', data[off:off + 8])
            chunk = data[off + 8: off + 8 + clen]
            if ctype == b'JSON':
                j = json.loads(chunk.decode('utf-8'))
                break
            off += 8 + clen
        assert j is not None, fn

        meshes = j.get('meshes', [])
        prims = [pr for m in meshes for pr in m.get('primitives', [])]
        tris = 0
        for pr in prims:
            if pr.get('mode', 4) != 4:
                continue
            if 'indices' in pr:
                tris += j['accessors'][pr['indices']]['count'] // 3
            else:
                tris += j['accessors'][pr['attributes']['POSITION']]['count'] // 3

        # 顶点属性里有哪些通道
        attrs = set()
        for pr in prims:
            attrs |= set(pr.get('attributes', {}).keys())

        # POSITION 的 min/max → 真实世界尺寸（模型自带单位）
        lo = [1e9] * 3
        hi = [-1e9] * 3
        for pr in prims:
            acc = j['accessors'][pr['attributes']['POSITION']]
            if 'min' in acc and 'max' in acc:
                for k in range(3):
                    lo[k] = min(lo[k], acc['min'][k])
                    hi[k] = max(hi[k], acc['max'][k])
        size = [round(hi[k] - lo[k], 3) for k in range(3)]
        base_y = round(lo[1], 3)          # 最低点：判断"原点在脚底还是几何中心"

        # 节点变换：Tripo 一般恒等，但 JellyTranslucent 靠缩放做 2x，必须看
        node_scales = []
        for n in j.get('nodes', []):
            s = n.get('scale')
            if s and any(abs(v - 1) > 1e-6 for v in s):
                node_scales.append([round(v, 3) for v in s])

        imgs = j.get('images', [])
        img_kind = []
        for im in imgs:
            if 'bufferView' in im:
                bv = j['bufferViews'][im['bufferView']]
                raw = data[bv['byteOffset'] + off + 8: bv['byteOffset'] + off + 8 + 4]
                img_kind.append('内嵌 ' + ('PNG' if raw[:2] == b'\x89P' else 'JPG' if raw[:2] == b'\xff\xd8' else raw.hex()))

        mats = j.get('materials', [])
        mat_info = []
        mat_ext = []
        for m in mats:
            pbr = m.get('pbrMetallicRoughness', {})
            mat_info.append('%s(alpha=%s, side=%s, metal=%s, rough=%s, factor=%s, tex=%s)' % (
                m.get('name', '?'),
                m.get('alphaMode', 'OPAQUE'),
                '双面' if m.get('doubleSided') else '单面',
                pbr.get('metallicFactor', 1), pbr.get('roughnessFactor', 1),
                [round(v, 2) for v in pbr.get('baseColorFactor', [1, 1, 1, 1])],
                '有' if 'baseColorTexture' in pbr else '无'))
            for k, v in (m.get('extensions') or {}).items():
                mat_ext.append('%s %s' % (k, json.dumps(v, ensure_ascii=False)))

        rows.append(dict(
            fn=rel, kb=round(os.path.getsize(p) / 1024),
            gen=j.get('asset', {}).get('generator', '?'),
            nodes=len(j.get('nodes', [])), meshes=len(meshes), prims=len(prims),
            tris=tris, attrs=sorted(attrs),
            size=size, base_y=base_y,
            node_scales=node_scales,
            imgs=len(imgs), img_kind=img_kind,
            anims=len(j.get('animations', [])),
            skins=len(j.get('skins', [])),
            ext_used=j.get('extensionsUsed', []),
            ext_req=j.get('extensionsRequired', []),
            mats=mat_info, mat_ext=mat_ext,
        ))

for r in rows:
    print('=== %s  (%d KB)' % (r['fn'], r['kb']))
    print('    生成器      : %s' % r['gen'])
    print('    节点/网格/图元: %d / %d / %d     三角形 %d' % (r['nodes'], r['meshes'], r['prims'], r['tris']))
    print('    顶点属性    : %s' % (', '.join(r['attrs']) or '-'))
    print('    包围盒尺寸  : %s   最低点 y=%s' % (r['size'], r['base_y']))
    print('    节点缩放    : %s' % (r['node_scales'] or '恒等（1,1,1）'))
    print('    贴图        : %d 张  %s' % (r['imgs'], '; '.join(r['img_kind']) or '-'))
    print('    动画/骨骼   : %d / %d' % (r['anims'], r['skins']))
    print('    扩展 used   : %s' % (r['ext_used'] or '-'))
    print('    扩展 req    : %s   ← 非空则必须带对应解码器' % (r['ext_req'] or '-'))
    print('    材质        : %s' % '; '.join(r['mats']))
    if r['mat_ext']:
        print('    材质扩展    : %s' % ' | '.join(r['mat_ext']))
    print()

print('---- 汇总 ----')
print('%d 个模型，三角形合计 = %d' % (len(rows), sum(r['tris'] for r in rows)))
print('体积尺寸范围: 宽 %s ~ %s' % (
    min(r['size'][0] for r in rows), max(r['size'][0] for r in rows)))
print('高度范围: %s ~ %s' % (
    min(r['size'][1] for r in rows), max(r['size'][1] for r in rows)))
print('alphaMode 并集 = %s' % (sorted({m.split('alpha=')[1].split(',')[0]
                                     for r in rows for m in r['mats']}) or '-'))
print('所有扩展 required 并集 = %s' % (sorted({e for r in rows for e in r['ext_req']}) or '空（无需额外解码器）'))
