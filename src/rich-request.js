// Presentation intents are deliberately explicit; narrative speech is not a UI command.
export function richInteractionRequest(input){
  if(typeof input!=='string'||input.length>2000)return null;
  const text=input.trim(),s=text.replace(/[。！？!?]+$/,'').replace(/^请/,'');
  if(!s||/[\n“”「」『』"'；;]/.test(s)||/(?:然后|之后|并且|接着|再去|会怎样|会怎么样|不要|别画)/.test(s))return null;
  const format=/(?:表格|比较表|对照表|人物关系|关系图|流程图|示意图|SVG|图像|插画|柱状图|数据图|时间线|卡片)/i;
  const request=s.replace(/^(?:帮我|给我|我想(?:要)?)/,'');
  const presentation=/^(?:画|绘制|生成|展示|显示|整理成|做成|看看|看一下)/.test(request)
    ||/^把.+(?:画成|绘制成|整理成|做成|转换成|列成|显示成)/.test(request)
    ||/^(?:用|以).{0,20}(?:比较|对比|整理|显示|展示|列出|梳理|描绘|画出|呈现)/.test(request);
  if(['智能交互','智能整理当前处境','关系图','流程图','比较表','时间线','SVG示意图'].includes(s)||(presentation&&format.test(s)))return {intent:text};
  return null;
}

export function appendInteractionDraft(current,prompt){
  if(typeof prompt!=='string'||prompt.length>1000)throw new Error('这条提示过长，请在输入框中自行补充。');
  const addition=prompt.trim();
  return !addition?current:current?current+'\n'+addition:addition;
}
