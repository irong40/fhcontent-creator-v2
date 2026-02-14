import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { PersonaCard } from '@/components/persona-card';

export default async function PersonasPage() {
    const supabase = await createClient();

    const { data: personas, error } = await supabase
        .from('personas')
        .select('*')
        .order('created_at', { ascending: false });

    return (
        <div className="container max-w-screen-2xl py-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold">Personas</h1>
                <Link href="/personas/new">
                    <Button>New Persona</Button>
                </Link>
            </div>

            {error && (
                <p className="text-destructive mb-4">Error loading personas: {error.message}</p>
            )}

            {personas && personas.length === 0 && (
                <p className="text-muted-foreground">No personas yet. Create one to get started.</p>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {personas?.map((persona) => (
                    <PersonaCard key={persona.id} persona={persona} />
                ))}
            </div>
        </div>
    );
}
