'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PersonaOption {
    id: string;
    name: string;
    brand: string;
}

interface PersonaSwitcherProps {
    personas: PersonaOption[];
    selectedId: string | null;
    onSelect: (personaId: string | null) => void;
}

export function PersonaSwitcher({ personas, selectedId, onSelect }: PersonaSwitcherProps) {
    return (
        <Tabs
            value={selectedId ?? 'all'}
            onValueChange={(value) => onSelect(value === 'all' ? null : value)}
        >
            <TabsList>
                <TabsTrigger value="all">All Personas</TabsTrigger>
                {personas.map((p) => (
                    <TabsTrigger key={p.id} value={p.id}>
                        {p.name}
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
}
