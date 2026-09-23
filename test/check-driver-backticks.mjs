/**
 * 专项检查：测试文件里那些**大模板字符串**（driver）内部有没有裸反引号。
 *
 * 为什么单开这一步 —— 这个坑在本项目里已经踩了**八次**：
 *   · `test/*.mjs` 的 driver 整段是一个模板字符串（`const DRIVER = \`...\`;`），
 *     而注释里只要多写一个反引号，字符串就**提前结束**；
 *   · 报出来的是一个毫不相干的 `SyntaxError: Unexpected identifier 'xxx'`，
 *     指向注释里的某个词，第一眼会以为是正文写错了；
 *   · 更坏的情况是它**不报错**：那一段被截断之后接上了一堆合法表达式，
 *     于是变成了 `ReferenceError: fill is not defined` 之类，把方向彻底带偏
 *     （本轮就先后撞到 `Unexpected identifier 'rndWorld'` 和 `fill is not defined` 两种症状，
 *      根因都是同一个）。
 *
 * `node --check` 当然能抓到它（第 0 步的语法闸门），但**诊断信息是错的**。
 * 这一步把同一件事换个说法讲出来：哪一行、属于哪个模板、那个反引号长什么样。
 *
 * 用法： node test/check-driver-backticks.mjs      （退出码 1 = 有问题）
 * 由 test/run.sh 的第 0 步调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/* 扫两处：test/ 下的测试，以及项目根目录的 _probe_*.mjs —— 
   后者用的是**同一个模式**（`const DRIVER = \`…\`;`），踩的也是同一个坑
   （第一次跑这一步就抓到了 _probe_corpse_spot.mjs 里我刚写进去的三处）。 */
const files = [
  ...fs.readdirSync(HERE).filter(n => n.endsWith('.mjs')).map(n => path.join(HERE, n)),
  ...fs.readdirSync(ROOT).filter(n => /^_probe_.*\.mjs$/.test(n)).map(n => path.join(ROOT, n)),
].sort();
const SELF = url.fileURLToPath(import.meta.url);

/* 模板起点的判据：`const XXX = \`` 且反引号后到行尾没有别的东西。
   为什么这么写：这些 driver 都是**独占一行**开头的（见各文件的写法），
   这个判据不会误命中 `const s = \`x${y}\`` 这类正常用法。 */
const START = /^\s*(?:const|let|var)\s+[\w$]+\s*=\s*`\s*$/;

let problems = 0, scanned = 0;
for (const abs of files) {
  if (abs === SELF) continue;
  const f = path.relative(ROOT, abs);
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!START.test(lines[i])) continue;
    /* 结束行：独占一行的 `;（本项目一律这么收尾）。找不到就跳过 —— 
       那属于"别的写法"，不该由这一步下结论。 */
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '`;') { end = j; break; }
    }
    if (end < 0) continue;
    scanned++;
    for (let j = i + 1; j < end; j++) {
      /* ⚠️ **必须先去掉转义**：`\`` 是合法的（模板里想写一个反引号就得转义），
         harness.mjs 里就有三处这样的注释。第一版没做这一步，
         结果把三个合法转义报成了问题 —— 假 FAIL 比漏报更坏，
         它会让人开始怀疑这条检查、最后把它关掉。 */
      const noEsc = lines[j].replace(/\\`/g, '');
      if (noEsc.includes('`')) {
        problems++;
        console.log('  反引号：' + f + ':' + (j + 1) + '（位于 ' + (i + 1) + ' 行开始的模板字符串内）');
        console.log('    ' + lines[j].trim().slice(0, 110));
      }

      /* ---- 第二类：**会被外层模板先求值的转义序列** ----
         反引号只是最显眼的那个；同一个根因还有更阴的一类：
         driver 是模板字符串 ⇒ 里面的 `\n` / `\d` / `\u0000` 会被**先求值**，
         然后才变成代码。于是同一个根因给出三种完全不同的症状：
           · 字符串里的 \n        → 生成的文件里被真换行截断 ⇒ **SyntaxError**
           · 正则里的 \d          → 变成 /…"d"/，永远匹配不到 ⇒ **断言静默失效**（最坏）
           · 字符串里的 \u0000    → 生成的文件里多一个裸 NUL ⇒ **Invalid or unexpected token**
         这三种今天各撞了一次。正确写法是**双反斜杠**：'\\n' / \\d / '\\u0000'。
         ⚠️ **注释行跳过**：注释里写 `\n` 被求值成换行也不影响语法，
            而那正是解释这个坑时最自然的写法（本文件自己就在写）。
         ⚠️ 判据要用**原始行**、不能用 noEsc —— 已经正确的 `\\n` 去掉一个反斜杠之后
            看起来就和错误的 `\n` 一样了。 */
      const trimmed = lines[j].trim();
      const isComment = /^(\*|\/\/|\/\*)/.test(trimmed);
      if (!isComment) {
        const m = lines[j].match(/(?<!\\)\\([ntrbfv0uUxXdDsSwWpP])/);
        if (m) {
          problems++;
          console.log('  会被求值的转义：' + f + ':' + (j + 1) +
                      '（位于 ' + (i + 1) + ' 行开始的模板字符串内）—— 反斜杠 ' + m[1]);
          console.log('    ' + trimmed.slice(0, 110));
          console.log('    ⇒ 改成双反斜杠（\\\\' + m[1] + '），否则它会被外层模板先求值掉。');
        }
      }
    }
  }
}

if (problems) {
  console.log('');
  console.log('  上面这些反引号会把 driver 的模板字符串**提前截断**。');
  console.log('  症状通常不是"这里错了"，而是后面某处莫名其妙的');
  console.log('  SyntaxError / ReferenceError。删掉反引号（用自己的引号或直接不引）即可。');
  process.exit(1);
}
console.log('  已扫描 ' + scanned + ' 个模板字符串：' +
            '没有裸反引号、也没有会被外层模板先求值的转义序列');
