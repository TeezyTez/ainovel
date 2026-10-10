// Only explicit interface commands bypass ordinary action/question routing.
export function readerInputCommand(input){
  const value=String(input).trim().replace(/[。！!]+$/,'').replace(/^请/,'');
  const commands={继续:'continue',继续读:'continue',接着读:'continue',往下读:'continue',重试:'retry',重新发送:'retry',恢复进度:'recover',恢复已确认结果:'recover',核对进度:'recover',故事选项:'tools',更多选项:'tools',查看存档:'saves',查看分支:'saves',保存:'save',保存进度:'save',开启后日谈:'epilogue'};
  if(commands[value])return {action:commands[value]};
  const named=value.match(/^保存为[：:\s]*(.{1,100})$/u);
  if(named)return {action:'save',name:named[1]};
  // Do not turn dialogue or speculative questions into permission to advance time.
  if(/[？?“”「」『』"\n]/.test(value)||/(?:可以吗|会怎样|会怎么样|怎么办|吗)$/.test(value))return null;
  const wait=value.match(/^(等到|等待|让时间推进到|把时间推进到)([^，,。；;！!]+)(?:[，,。；;！!].*)?$/u);
  if(!wait)return null;
  const target=wait[2].trim();
  if(!target)return null;
  const finite=/^(?:半|[\d一二两三四五六七八九十百]+)(?:个)?(?:分钟|小时|刻钟|天|日|周)$|^(?:今天|明天|后天|今晚|明早|午休|中午|下午|上午|傍晚|天亮|日落)(?:[\d一二三四五六七八九十点分半上午下午晚上早晨夜里\s]*)$/u.test(target);
  return {action:'time',control:{kind:wait[1].includes('推进')?'advance':'wait',goal:String(input).trim(),until:'出现输入中指定的接手条件，或首次需要我作出重要决定',limit:finite?target:'到当前场景自然结束，或首次需要我作决定时',forbidden:'遵守本次输入的全部限制；不得替我承担新的承诺、交易或不可逆代价',reserved:'新的承诺、交易、关系表态或不可逆决定'}};
}
