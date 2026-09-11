import { config } from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { createAdminClient } from '../src/lib/supabase/server';
import { getOrEnqueueLocalInference, LocalInferencePendingError } from '../src/lib/local-inference-queue';
import { buildContentPrompt } from '../src/lib/prompts';
import { contentResponseSchema } from '../src/lib/schemas';
import { localContentResponseSchema } from '../src/lib/content-inference';
import type { TopicWithPersona } from '../src/types/database';
config({path:'.env.local',quiet:true});
async function main() {
    const {data,error}=await createAdminClient().from('topics').select('*,personas(*)').eq('id','578e3906-3bd3-4c43-bf46-ee27492d9a30').single();
    if(error||!data)throw new Error('Representative source unavailable');
    const topic=data as unknown as TopicWithPersona;
    const {system,user}=buildContentPrompt(topic.personas,topic);
    try {
        const result=await getOrEnqueueLocalInference({requestKey:'deployment-six-piece-smoke-2026-09-11-v2',system,user,maxTokens:6144,schema:z.toJSONSchema(localContentResponseSchema)});
        const validated=contentResponseSchema.parse(JSON.parse(result.text));
        if(new Set(validated.pieces.map(p=>p.pieceType)).size!==6)throw new Error('Duplicate piece types');
        const report={checkedAt:new Date().toISOString(),boundary:'Representative published source copied read-only into an isolated queue job. Generated draft is unapproved; no topic/content/media/publish writes.',sourceTopicId:topic.id,promptBytes:Buffer.byteLength(system)+Buffer.byteLength(user),inputTokens:result.inputTokens,outputTokens:result.outputTokens,pieces:validated.pieces};
        await writeFile('docs/local-inference-content-smoke-2026-09-11.json',JSON.stringify(report,null,2));
        console.log(JSON.stringify({...report,pieces:validated.pieces.map(p=>({type:p.pieceType,scriptWords:p.script.split(/\s+/).length}))},null,2));
    }catch(error){if(error instanceof LocalInferencePendingError){console.log(JSON.stringify({status:'queued',jobId:error.jobId}));return;}throw error;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
