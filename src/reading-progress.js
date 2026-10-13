// Defer DOM measurement and metadata copying until scrolling settles. Context
// carries the original branch so route changes cannot save into another story.
export function createReadingProgress({capture,delay=180,setTimer=setTimeout,clearTimer=clearTimeout}){
  let timer=null,pending=null;
  function flush(){
    if(timer!==null)clearTimer(timer);timer=null;
    const context=pending;pending=null;
    if(context)capture(context);
  }
  return {
    schedule(context){
      if(pending&&pending.branch!==context.branch)flush();
      pending=context;if(timer!==null)clearTimer(timer);
      timer=setTimer(flush,delay);
    },
    flush,
  };
}
