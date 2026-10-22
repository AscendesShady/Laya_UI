import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unloadSessionModels} from '../ollama-session.mjs';
import {MODELS} from '../server.mjs';

test('shutdown unloads only the distinct allowed models used by the session',async()=>{
  const calls=[];
  const result=await unloadSessionModels([MODELS[0],MODELS[0],'another-app:model'],{log:()=>{},fetchOllama:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({done:true});}});
  assert.deepEqual(calls,[{url:'http://127.0.0.1:11434/api/generate',body:{model:MODELS[0],keep_alive:0,stream:false}}]);
  assert.deepEqual(result,[{model:MODELS[0],unloaded:true}]);
});
test('offline Ollama or unload failure does not prevent application exit',async()=>{
  const results=await unloadSessionModels(MODELS,{log:()=>{},fetchOllama:async()=>{throw new Error('offline');}});
  assert.equal(results.length,2);assert.ok(results.every(result=>!result.unloaded));
});
