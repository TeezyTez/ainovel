import {Script} from 'node:vm';

// Compile only: generated code never runs on the server.
export function validateArtifactScripts(definition){
  let count=0;
  function visit(node,repeated=false){
    if(node.type==='interactive'||node.type==='react'){
      if(repeated)throw new Error('repeat 布局内不能放置可运行交互图；请在单个 interactive 内自行绘制和管理多项内容。');
      if(++count>1)throw new Error('每份界面最多包含一个可运行交互图。');
      if(node.type==='interactive')try{new Script(node.script,{filename:'interactive-view.js'});}catch{throw new Error('交互图脚本语法无效，请修复后返回完整定义。');}
    }
    for(const child of node.children??[])visit(child,repeated||node.type==='repeat');
  }
  for(const node of definition.view??[])visit(node);
}
