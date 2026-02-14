import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Persona } from '@/types/database';

interface PersonaCardProps {
    persona: Persona;
}

export function PersonaCard({ persona }: PersonaCardProps) {
    const platformCount = Object.keys(persona.platform_accounts || {}).length;

    return (
        <Link href={`/personas/${persona.id}/edit`}>
            <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{persona.name}</CardTitle>
                        <Badge variant={persona.is_active ? 'default' : 'secondary'}>
                            {persona.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{persona.brand}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                    {persona.tagline && (
                        <p className="text-sm italic text-muted-foreground">{persona.tagline}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                        {persona.expertise_areas.slice(0, 3).map((area) => (
                            <Badge key={area} variant="outline" className="text-xs">
                                {area}
                            </Badge>
                        ))}
                        {persona.expertise_areas.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                                +{persona.expertise_areas.length - 3}
                            </Badge>
                        )}
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground pt-2">
                        <span>{platformCount} platform{platformCount !== 1 ? 's' : ''}</span>
                        <span>{persona.voice_pool.length} voices</span>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
