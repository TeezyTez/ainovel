export const names={port:'港口',square:'广场',forest:'松林',tower:'灯塔',hall:'大厅',room:'档案室'};
export const prose='广场位于港口正北300米。松林位于广场正东400米。灯塔位于广场正西200米。港口与广场之间的石路可以双向通行。广场通向灯塔的栈桥已经封锁。';
export const entity=id=>({id,kind:'place',name:names[id],detail:'',status:'',value:null,max:null,unit:'',quote:prose});
export const site=(id,terrain='landmark',parentId=null,quote=prose)=>({id,terrain,parentId,quote});
export const relation=(id,from,to,bearing,distanceMeters=null,extra={})=>({id,from,to,kind:'relative',bearing,distanceMeters,passage:'unknown',bidirectional:false,label:'',quote:prose,...extra});
export const atlas=()=>({sites:[site('port'),site('square'),site('forest','forest'),site('tower','building')],relations:[relation('north','port','square','N',300),relation('east','square','forest','E',400),relation('west','square','tower','W',200),relation('road','port','square',null,null,{kind:'route',passage:'open',bidirectional:true,label:'石路'}),relation('bridge','square','tower',null,null,{kind:'route',passage:'blocked',label:'栈桥'})]});
