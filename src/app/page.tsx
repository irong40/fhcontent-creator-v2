import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function DashboardPage() {
    const supabase = await createClient();

    const { count: personaCount } = await supabase
        .from('personas')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const { count: topicCount } = await supabase
        .from('topics')
        .select('*', { count: 'exact', head: true })
        .in('status', ['draft', 'topics_approved', 'content_generating', 'content_ready']);

    const { count: readyCount } = await supabase
        .from('content_pieces')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ready');

    return (
        <div className="container max-w-screen-2xl py-8">
            <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Link href="/personas">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">Active Personas</CardTitle>
                            <CardDescription>Creator profiles</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-4xl font-bold text-amber-500">{personaCount ?? 0}</p>
                        </CardContent>
                    </Card>
                </Link>
                <Link href="/plan">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">Topics in Progress</CardTitle>
                            <CardDescription>Draft through content ready</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-4xl font-bold">{topicCount ?? 0}</p>
                        </CardContent>
                    </Card>
                </Link>
                <Link href="/plan">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">Content Pieces Ready</CardTitle>
                            <CardDescription>Awaiting review</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-4xl font-bold text-green-500">{readyCount ?? 0}</p>
                        </CardContent>
                    </Card>
                </Link>
                <Link href="/api/health">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">API Status</CardTitle>
                            <CardDescription>7 service connections</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">Click to check connectivity</p>
                        </CardContent>
                    </Card>
                </Link>
            </div>
        </div>
    );
}
