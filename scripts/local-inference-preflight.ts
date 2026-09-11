import { config } from 'dotenv';
import { createAdminClient } from '../src/lib/supabase/server';
import { buildContentPrompt } from '../src/lib/prompts';
import type { TopicWithPersona } from '../src/types/database';
config({path:'.env.local',quiet:true});
async function main() {
    const db=createAdminClient();
    const {data,error}=await db.from('topics').select('*,personas(*)').order('created_at',{ascending:false}).limit(30);
    if(error)throw new Error(`Preflight database error ${error.code}`);
    const rows=(data??[]).map(row=>{
        const topic=row as unknown as TopicWithPersona;
        const {system,user}=buildContentPrompt(topic.personas,topic);
        const bytes=Buffer.byteLength(system)+Buffer.byteLength(user);
        const maxTokens=topic.personas.content_format==='quote_video'?4096:6144;
        return {topicId:topic.id,format:topic.personas.content_format,status:topic.status,requiresReview:topic.requires_review,promptBytes:bytes,reservedTokens:maxTokens,withinBaseBudget:bytes+maxTokens+512<=16384};
    });
    console.log(JSON.stringify(rows,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
