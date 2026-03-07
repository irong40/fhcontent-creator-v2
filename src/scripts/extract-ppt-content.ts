/**
 * Extract text content from converted .pptx files and update lecture_chapters.
 * Run with: npx tsx src/scripts/extract-ppt-content.ts <pptx-directory>
 *
 * Example: npx tsx src/scripts/extract-ppt-content.ts "E:/UMGC/CMIT291/XK0-006-PPTs/pptx"
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 * Requires: python3 with python-pptx installed (used via child_process)
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { Database } from '../types/database';

interface SlideContent {
    slide_number: number;
    texts: string[];
}

function extractPptxContent(filePath: string): SlideContent[] {
    const pythonScript = `
import sys, json, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from pptx import Presentation

prs = Presentation(r'${filePath.replace(/'/g, "\\'")}')
slides = []
for i, slide in enumerate(prs.slides):
    texts = []
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                t = para.text.strip()
                if t and len(t) > 2:
                    texts.append(t)
    if texts:
        slides.append({"slide_number": i + 1, "texts": texts})

print(json.dumps(slides, ensure_ascii=True))
`;

    const result = execSync(`python -c "${pythonScript.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
    });

    return JSON.parse(result.trim());
}

async function main() {
    const pptxDir = process.argv[2];
    if (!pptxDir) {
        console.error('Usage: npx tsx src/scripts/extract-ppt-content.ts <pptx-directory>');
        process.exit(1);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

    // Get all lecture chapters
    const { data: chapters, error } = await supabase
        .from('lecture_chapters')
        .select('id, chapter_number, title')
        .order('chapter_number');

    if (error || !chapters) {
        console.error('Error fetching chapters:', error?.message);
        process.exit(1);
    }

    let updated = 0;
    for (const chapter of chapters) {
        const fileName = `Chapter${String(chapter.chapter_number).padStart(2, '0')}.pptx`;
        const filePath = path.join(pptxDir, fileName);

        if (!fs.existsSync(filePath)) {
            console.log(`SKIP Chapter ${chapter.chapter_number}: ${fileName} not found`);
            continue;
        }

        try {
            const slideContent = extractPptxContent(filePath);

            const { error: updateError } = await supabase
                .from('lecture_chapters')
                .update({ slide_content: slideContent as never })
                .eq('id', chapter.id);

            if (updateError) {
                console.error(`FAIL Chapter ${chapter.chapter_number}: ${updateError.message}`);
            } else {
                updated++;
                console.log(`OK Chapter ${chapter.chapter_number}: ${chapter.title} (${slideContent.length} slides)`);
            }
        } catch (e) {
            console.error(`FAIL Chapter ${chapter.chapter_number}: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }

    console.log(`\nUpdated ${updated}/${chapters.length} chapters with slide content.`);
}

main();
