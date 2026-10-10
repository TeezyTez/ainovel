// Explicit live smoke test: uses the logged-in account's model allowance.
import { modelConfig, modelStatus, generate, validateRequest } from '../src/server-model.mjs';
import { PRESET_WORLDS } from '../src/worlds.js';
import { createSession, currentState } from '../src/core.js';
process.loadEnvFile('.env');
const config=modelConfig(process.env),world=PRESET_WORLDS[0];
console.log('Provider:',await modelStatus(config));
const session=createSession(world,{name:'旅人',identity:world.identity,goal:world.goal},'real');
const body=validateRequest({requestId:crypto.randomUUID(),world,state:currentState(session),player:session.player,preferences:{perspective:'第二人称',length:'简短',pace:'从容',style:'细腻克制'},memory:[],recent:[],input:'我暂时不查那封电报，先站在屋檐下，问林知微雨什么时候会停。'});
const start=Date.now();
const result=await generate(body,config,new AbortController().signal);
console.log(JSON.stringify({elapsedMs:Date.now()-start,prose:result.prose,events:result.events,suggestions:result.suggestions,baseVersion:result.baseVersion},null,2));
