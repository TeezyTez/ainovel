// Layout is a view projection. Coordinates never become world geography.
export function mapLayout(places,links,currentId){
  const byId=new Map(places.map(p=>[p.id,p]));
  const edges=links.filter(e=>e.from!==e.to&&byId.has(e.from)&&byId.has(e.to));
  const adjacent=new Map(places.map(p=>[p.id,new Set()]));
  for(const e of edges){adjacent.get(e.from).add(e.to);adjacent.get(e.to).add(e.from);}
  const root=byId.has(currentId)?currentId:[...places].sort((a,b)=>adjacent.get(b.id).size-adjacent.get(a.id).size)[0]?.id;
  const visited=new Set(),rows=[],detached=[];
  let frontier=root?[root]:[];
  while(frontier.length){
    const row=frontier.filter(id=>!visited.has(id));if(!row.length)break;
    row.forEach(id=>visited.add(id));
    for(let i=0;i<row.length;i+=3)rows.push(row.slice(i,i+3));
    const order=(from,to)=>{const label=edges.find(e=>e.from===from&&e.to===to)?.label||'';return /^左侧/.test(label)?-1:/^右侧/.test(label)?1:0;};
    frontier=[...new Set(row.flatMap(id=>[...adjacent.get(id)].sort((a,b)=>order(id,a)-order(id,b))))].filter(id=>!visited.has(id));
  }
  for(const p of places)if(!visited.has(p.id))detached.push(p.id);
  for(let i=0;i<detached.length;i+=3)rows.push(detached.slice(i,i+3));
  const width=640,height=Math.max(180,rows.length*140);
  const positions=new Map();
  rows.forEach((row,r)=>row.forEach((id,c)=>positions.set(id,{x:width*(c+1)/(row.length+1),y:65+r*140})));
  return {width,height,positions,edges,detached};
}

export function currentMapPlace(places,location,version){
  const exact=places.filter(p=>p.name===location);
  if(exact.length===1)return exact[0].id;
  if(exact.length>1)return null;
  const marked=places.filter(p=>['当前位置','当前所在'].includes(p.status)&&p.sourceVersion===version&&p.name.length>=2&&location?.includes(p.name));
  return marked.length===1?marked[0].id:null;
}
