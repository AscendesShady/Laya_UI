import { MODELS } from './server.mjs';

// Release this session's checkpoints without stopping the shared Ollama service.
export async function unloadSessionModels(models,{fetchOllama=fetch,log=console.log,timeout=5000}={}) {
  const names=[...new Set(models)].filter(name=>MODELS.includes(name));
  return Promise.all(names.map(async model=>{
    try {
      const response=await fetchOllama('http://127.0.0.1:11434/api/generate',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model,keep_alive:0,stream:false}),signal:AbortSignal.timeout(timeout),
      });
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      await response.arrayBuffer();
      log(`Unloaded ${model} from Ollama.`);return {model,unloaded:true};
    }catch(error){
      log(`Could not unload ${model}: ${error.message}`);return {model,unloaded:false};
    }
  }));
}
