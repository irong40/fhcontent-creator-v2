/**
 * Update the St. John's lecture content piece with the v3 PHA-focused script.
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const PIECE_ID = 'c6229931-2bee-4dfc-87fd-6e049dd50b59';

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const scriptPath = path.join('C:', 'Users', 'redle.SOULAAN', 'Documents', 'stjohns-lecture-v4-PHA.md');
    const raw = fs.readFileSync(scriptPath, 'utf-8');

    // Extract the Script section (between "## Script" and "## Source Citations")
    const startIdx = raw.indexOf('## Script');
    const endIdx = raw.indexOf('## Source Citations');
    if (startIdx === -1 || endIdx === -1) {
        console.error('Could not extract script section');
        process.exit(1);
    }

    // Skip past "## Script\n\n" to first content line, and stop before "---\n" before Source Citations
    let script = raw.substring(startIdx + '## Script'.length, endIdx).trim();
    // Trim trailing "---"
    script = script.replace(/\s*---\s*$/, '').trim();
    const wordCount = script.split(/\s+/).length;

    const { error } = await supabase
        .from('content_pieces')
        .update({
            script,
            caption_long: "A Past Master of MWPHGLVA reflects on the Feast of St. John the Baptist — why June 24 is central to the Prince Hall tradition, from Brother Prince Hall's 1797 Charge to the founding of the Grand Lodge of Virginia in 1865. #PrinceHall #Freemasonry #StJohnsDay #MWPHGLVA",
            caption_short: "Why June 24 matters to Prince Hall Masons. #PrinceHall #StJohnsDay",
        })
        .eq('id', PIECE_ID);

    if (error) {
        console.error('Update error:', error.message);
        process.exit(1);
    }

    console.log(`Script v3 saved: ${wordCount} words`);
    console.log(`Est. duration at 1.05x: ~${(wordCount / 150 / 1.05).toFixed(1)} min`);
}

main();
