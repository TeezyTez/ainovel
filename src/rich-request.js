// Presentation intents are deliberately explicit; narrative speech is not a UI command.
export function richInteractionRequest(input,{hasArtifact=false}={}){
  if(typeof input!=='string'||input.length>2000)return null;
  const text=input.trim(),s=text.replace(/[。！？!?]+$/,'').replace(/^请/,'');
  if(!s||/[\n“”「」『』"'；;]/.test(s)||/(?:然后|之后|并且|接着|(?:再|并|就)(?:去|问|找|走|调查|前往|出发|告诉|交给)|如果|假如|要是|是否|是不是|会不会|会怎样|会怎么样|会发生什么|会有什么|[吗么]$)/.test(s))return null;
  const format=/(?:表格|比较表|对照表|人物关系|关系图|流程图|路线图|示意图|SVG|图像|插画|柱状图|数据图|时间线|卡片|面板|试算|滑块|(?:可交互|可操作).*(?:工具|界面))/i;
  const request=s.replace(/^(?:帮我|给我|我想(?:要)?)/,'');
  // Bare filtering/sorting needs an existing artifact; visual edits also name its surface.
  const surface=/^(?:把|给)?(?:这个|这张|这幅|当前的|刚才的)(关系图|路线图|流程图|图|界面|面板|表格|卡片)(.*)$/.exec(request);
  const change=surface?surface[2]:request;
  const refinement=/^只显示[^，,。！？!?：:]{1,80}$/.test(change)
    ||/^(?:不要|别)显示[^，,。！？!?：:]{0,80}(?:项|信息|线索|记录|数值|字段|列|行)$/.test(change)
    ||/^按(?:时间|名称|类别|人物|来源)(?:升序|降序)?排序$/.test(change)
    ||(surface&&(/^(?:里|中)?的(?:文字|字体|字)(?:放大|缩小)(?:一点)?$/.test(change)
      ||/^看不清[，,]\s*(?:文字|字体|字)(?:大|放大)(?:一点)?$/.test(change)
      ||(surface[1]==='表格'&&/^(?:加|增加|添加)一列[^，,。！？!?：:]{1,20}$/.test(change))));
  if(hasArtifact&&refinement)return {intent:text};
  // Negating a display filter is useful; other negated commands must stay with the story.
  if(/(?:不要|别(?:画|把|给|做|改|加|放|生成|绘))/.test(s))return null;
  const presentation=/^(?:画|绘制|生成|展示|显示|整理成|做成|做个|做一(?:个|张)|看看|看一下)/.test(request)
    ||/^把.+(?:画成|绘制成|整理成|做成|转换成|列成|显示成)/.test(request)
    ||/^(?:用|以).{0,20}(?:比较|对比|整理|显示|展示|列出|梳理|描绘|画出|呈现)/.test(request);
  const followup=/^(?:把)?(?:这个|这张|这幅|当前的|刚才的)(关系图|路线图|流程图|图|界面|面板|表格|卡片)?(?:改成|变成|转换成|放大|缩小|加上|加入|增加|添加|调整|修改)([^，,。！？!?：:]*)$/.exec(request);
  if(hasArtifact&&followup&&(followup[1]||format.test(followup[2])||/^(?:按人|按类别|按时间|分组|排序|筛选|横向|纵向)/.test(followup[2])))return {intent:text};
  if(/^(?:比较|对比)(?:一下)?(?:(?:这几条|这些|两条|两种|几条|几种)[^，,。！？!?：:]*(?:路线|道路|方案|路)|[^，,。！？!?：:]{1,20}(?:路线|路)(?:和|与)[^，,。！？!?：:]{1,20}(?:路线|路))$/.test(request))return {intent:text};
  if(['智能交互','智能整理当前处境','关系图','流程图','比较表','时间线','SVG示意图'].includes(s)||(presentation&&format.test(s)))return {intent:text};
  return null;
}

export function appendInteractionDraft(current,prompt){
  if(typeof prompt!=='string'||prompt.length>1000)throw new Error('这条提示过长，请在输入框中自行补充。');
  const addition=prompt.trim();
  return !addition?current:current?current+'\n'+addition:addition;
}
