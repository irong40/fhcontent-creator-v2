import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { z } from 'zod';

export async function POST(_request: NextRequest, { params }: { params: Promise<{id:string}> }) {
    const auth = await createClient();
    const {data:{user},error:authError} = await auth.auth.getUser();
    if (authError || !user) return NextResponse.json({success:false,error:'Human sign-in required'}, {status:401});
    const parsed=z.string().uuid().safeParse((await params).id);
    if(!parsed.success) return NextResponse.json({success:false,error:'Invalid topic ID'}, {status:400});
    const id=parsed.data;
    const db=createAdminClient();
    const {data:topic,error}=await db.from('topics').select('id,status,requires_review').eq('id',id).single();
    if(error || !topic) return NextResponse.json({success:false,error:'Topic not found'}, {status:404});
    if(topic.status!=='content_ready' || topic.requires_review!==true) return NextResponse.json({success:false,error:'Topic must be content_ready and awaiting text review'}, {status:409});
    const {data:pieces,error:pieceError}=await db.from('content_pieces').select('id,script').eq('topic_id',id);
    if(pieceError) return NextResponse.json({success:false,error:'Could not verify content pieces'}, {status:500});
    if(!pieces?.length || pieces.some(piece=>!piece.script?.trim())) return NextResponse.json({success:false,error:'Every content piece must have text before review'}, {status:400});
    const {data:updated,error:updateError}=await db.from('topics').update({requires_review:false,reviewed_by:user.id,reviewed_at:new Date().toISOString()})
        .eq('id',id).eq('status','content_ready').eq('requires_review',true).select('id').maybeSingle();
    if(updateError) return NextResponse.json({success:false,error:'Text review could not be saved'}, {status:500});
    if(!updated) return NextResponse.json({success:false,error:'Topic changed during review; reload and review again'}, {status:409});
    return NextResponse.json({success:true,status:'content_ready',requires_review:false});
}
