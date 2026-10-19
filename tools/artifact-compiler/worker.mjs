// One bounded compile request; no story storage, HTTP server, or candidate execution.
import {compileReactArtifact} from './src/server-artifact-build.mjs';
import {stop} from 'esbuild';

const timeout=setTimeout(()=>{process.stderr.write('artifact_compile_timeout\n');process.exit(70);},30000);
timeout.unref();
try {
  let size=0;const chunks=[];
  for await(const chunk of process.stdin){
    size+=chunk.length;
    if(size>256*1024)throw new Error('input_limit');
    chunks.push(chunk);
  }
  const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!request||Array.isArray(request)||Object.keys(request).length!==1||!Object.hasOwn(request,'node'))throw new Error('request_shape');
  const bundle=await compileReactArtifact(request.node);
  const output=JSON.stringify({bundle});
  if(Buffer.byteLength(output)>2*1024*1024)throw new Error('output_limit');
  process.stdout.write(output+'\n');
}catch(error){
  // Diagnostics identify only the candidate location, never host paths or source.
  const location=String(error?.message??'').match(/artifact\.tsx:(\d+):(\d+)/);
  process.stderr.write('artifact_compile_rejected'+(location?' at '+location[1]+':'+location[2]:'')+'\n');
  process.exitCode=65;
}finally{clearTimeout(timeout);stop();}
