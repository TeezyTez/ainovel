// Exact UI requests are handled locally before model intent routing.
export function localCommand(input){
  const value=String(input).trim().replace(/[。！!]+$/,'');
  if(/^(?:请)?(?:把)?(?:字|字号|字体)(?:调|变)?大(?:一点|些)?$/.test(value))return {setting:'fontSize',delta:2};
  if(/^(?:请)?(?:把)?(?:字|字号|字体)(?:调|变)?小(?:一点|些)?$/.test(value))return {setting:'fontSize',delta:-2};
  if(/^(?:打开|切换到|换成)?(?:深色|夜间)模式$/.test(value))return {setting:'theme',value:'dark'};
  if(/^(?:打开|切换到|换成)?(?:浅色|日间)模式$/.test(value))return {setting:'theme',value:'light'};
  const actions={'查看人物':'situation','看看人物':'situation','查看物品':'situation','查看情况':'situation','看看情况':'situation','打开历史':'history','查看经历':'history','查看笔记':'notes','打开阅读设置':'reader-settings','怎么操作':'help'};
  return actions[value]?{action:actions[value]}:null;
}
