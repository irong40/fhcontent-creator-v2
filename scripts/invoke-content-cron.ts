import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
async function main() {
    const env=parse(await readFile('.vercel/.env.activation-verification'));
    if(env.CONTENT_INFERENCE_PROVIDER!=='ollama')throw new Error('Production provider is not Ollama');
    if(!env.CRON_SECRET)throw new Error('Production cron credential missing');
    const response=await fetch('https://fhcontent-creator-v2.vercel.app/api/cron/content-generator',{
        headers:{Authorization:`Bearer ${env.CRON_SECRET}`},signal:AbortSignal.timeout(60000),redirect:'error',
    });
    console.log(JSON.stringify({status:response.status,result:await response.json()},null,2));
    if(!response.ok)process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
