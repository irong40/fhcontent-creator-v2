/**
 * Seed CMIT 291 lecture chapters from extracted PPT content.
 * Run with: npx tsx src/scripts/seed-lecture-chapters.ts
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

// Chapter-to-week mapping based on CMIT 291 syllabus
const CHAPTER_WEEK_MAP: Record<number, { week: number; fieldConnections: string[] }> = {
    1:  { week: 1, fieldConnections: ['Setting up dev environments for clients', 'Choosing distros for production servers vs workstations'] },
    2:  { week: 1, fieldConnections: ['Running web/database/DNS services in production', 'Service uptime and SLA management'] },
    3:  { week: 2, fieldConnections: ['Navigating production servers via SSH', 'Log file analysis during incident response'] },
    4:  { week: 2, fieldConnections: ['Parsing logs during outages', 'Extracting data from config files for audits'] },
    5:  { week: 3, fieldConnections: ['Troubleshooting servers that won\'t boot', 'GRUB recovery in data centers'] },
    6:  { week: 3, fieldConnections: ['Managing systemd services on production servers', 'Writing custom service units for applications'] },
    7:  { week: 3, fieldConnections: ['Network configuration on cloud VMs', 'Diagnosing connectivity issues in production'] },
    8:  { week: 4, fieldConnections: ['Remote desktop for Linux workstations', 'Choosing desktop environments for end users'] },
    9:  { week: 4, fieldConnections: ['Configuring servers for international teams', 'Timezone management in distributed systems'] },
    10: { week: 4, fieldConnections: ['User provisioning for new employees', 'Access control and principle of least privilege'] },
    11: { week: 5, fieldConnections: ['Disk management on production servers', 'LVM for flexible storage in data centers', 'RAID configuration for redundancy'] },
    12: { week: 5, fieldConnections: ['Backup strategies for disaster recovery', 'Automating backups with cron'] },
    13: { week: 5, fieldConnections: ['Installing software on air-gapped systems', 'Package management in enterprise environments'] },
    14: { week: 5, fieldConnections: ['Loading drivers for hardware in the field', 'Kernel updates and change management'] },
    15: { week: 6, fieldConnections: ['File permissions for web server directories', 'Securing shared project directories'] },
    16: { week: 6, fieldConnections: ['PAM configuration for SSH hardening', 'Multi-factor auth on Linux servers'] },
    17: { week: 6, fieldConnections: ['Centralized logging with rsyslog/journald', 'Log aggregation for compliance audits'] },
    18: { week: 6, fieldConnections: ['Firewall rules for production servers', 'iptables vs firewalld in enterprise environments'] },
    19: { week: 6, fieldConnections: ['Security hardening checklists', 'Vulnerability scanning and remediation'] },
    20: { week: 8, fieldConnections: ['Troubleshooting network outages', 'Using tcpdump and wireshark in production'] },
    21: { week: 8, fieldConnections: ['Process monitoring for performance issues', 'Identifying resource-hungry processes'] },
    22: { week: 8, fieldConnections: ['Resolving user access tickets', 'Password reset procedures in enterprise'] },
    23: { week: 8, fieldConnections: ['Hardware troubleshooting on Linux servers', 'Working with udev rules'] },
    24: { week: 8, fieldConnections: ['Diagnosing application crashes', 'Storage troubleshooting in production'] },
    25: { week: 7, fieldConnections: ['Automating server setup with bash scripts', 'Writing deployment scripts'] },
    26: { week: 7, fieldConnections: ['Python for sysadmin automation', 'Writing monitoring scripts'] },
    27: { week: 7, fieldConnections: ['Scheduling automated backups and reports', 'Cron job management in production'] },
    28: { week: 7, fieldConnections: ['Version control for infrastructure-as-code', 'Git workflows for ops teams'] },
    29: { week: 8, fieldConnections: ['Cloud server provisioning', 'AWS/Azure/GCP Linux instances'] },
    30: { week: 8, fieldConnections: ['Managing VMs with libvirt/KVM', 'Container orchestration basics'] },
    31: { week: 8, fieldConnections: ['Ansible/Puppet for configuration management', 'Infrastructure automation at scale'] },
};

// PPT content will be extracted and inserted via this script
// For now, seed with chapter titles (content extracted separately)
const CHAPTERS: { number: number; title: string; keyConceptsSummary: string[] }[] = [
    { number: 1, title: 'Preparing Your Environment', keyConceptsSummary: ['Linux distributions', 'CPU architectures (x86, ARM, RISC-V)', 'Installation methods', 'Virtual machines'] },
    { number: 2, title: 'Introduction to Services', keyConceptsSummary: ['Linux servers', 'Web services', 'Database services', 'DNS', 'DHCP'] },
    { number: 3, title: 'Managing Files, Directories, and Text', keyConceptsSummary: ['File hierarchy', 'ls, cp, mv, rm', 'cat, less, head, tail', 'touch, mkdir'] },
    { number: 4, title: 'Searching and Analyzing Text', keyConceptsSummary: ['grep', 'sed', 'awk', 'cut', 'sort', 'wc', 'Regular expressions'] },
    { number: 5, title: 'Explaining the Boot Process', keyConceptsSummary: ['BIOS/UEFI', 'GRUB bootloader', 'Kernel initialization', 'init/systemd'] },
    { number: 6, title: 'Maintaining System Startup and Services', keyConceptsSummary: ['systemd', 'systemctl', 'Service units', 'Targets/runlevels'] },
    { number: 7, title: 'Configuring Network Connections', keyConceptsSummary: ['IP addressing', 'NetworkManager', 'nmcli', 'DNS resolution', '/etc/hosts'] },
    { number: 8, title: 'Comparing GUIs', keyConceptsSummary: ['GNOME', 'KDE', 'X Window System', 'Wayland', 'Remote desktop'] },
    { number: 9, title: 'Adjusting Localization Options', keyConceptsSummary: ['Locale', 'Timezone', 'Character encoding', 'timedatectl'] },
    { number: 10, title: 'Administering Users and Groups', keyConceptsSummary: ['useradd', 'usermod', 'groupadd', '/etc/passwd', '/etc/shadow', 'sudo'] },
    { number: 11, title: 'Handling Storage', keyConceptsSummary: ['Partitions', 'Filesystems', 'LVM', 'RAID', 'mount', 'fstab'] },
    { number: 12, title: 'Protecting Files', keyConceptsSummary: ['tar', 'gzip', 'bzip2', 'Backup types', 'rsync', 'dd'] },
    { number: 13, title: 'Governing Software', keyConceptsSummary: ['apt', 'dnf/yum', 'Compiling from source', 'Repositories', 'dpkg/rpm'] },
    { number: 14, title: 'Tending Kernel Modules', keyConceptsSummary: ['lsmod', 'modprobe', 'modinfo', 'Kernel parameters', '/proc', '/sys'] },
    { number: 15, title: 'Applying Ownership and Permissions', keyConceptsSummary: ['chmod', 'chown', 'chgrp', 'Octal notation', 'SUID/SGID', 'Sticky bit', 'ACLs'] },
    { number: 16, title: 'Looking at Access and Authentication Methods', keyConceptsSummary: ['PAM', 'SSH keys', 'LDAP', 'Kerberos', 'MFA'] },
    { number: 17, title: 'Implementing Logging Services', keyConceptsSummary: ['rsyslog', 'journald', 'journalctl', 'Log rotation', 'Remote logging'] },
    { number: 18, title: 'Overseeing Linux Firewalls', keyConceptsSummary: ['iptables', 'nftables', 'firewalld', 'Chains', 'Rules', 'Zones'] },
    { number: 19, title: 'Embracing Best Security Practices', keyConceptsSummary: ['Hardening', 'SELinux/AppArmor', 'Vulnerability scanning', 'Patch management'] },
    { number: 20, title: 'Analyzing System Properties and Remediation', keyConceptsSummary: ['ping', 'traceroute', 'netstat/ss', 'tcpdump', 'Network troubleshooting'] },
    { number: 21, title: 'Optimizing Performance', keyConceptsSummary: ['top', 'htop', 'ps', 'nice/renice', 'Memory management', 'swap'] },
    { number: 22, title: 'Investigating User Issues', keyConceptsSummary: ['Access troubleshooting', 'Password issues', 'Shell problems', 'Environment variables'] },
    { number: 23, title: 'Dealing with Linux Devices', keyConceptsSummary: ['/dev', 'udev', 'lsblk', 'lsusb', 'lspci', 'Device drivers'] },
    { number: 24, title: 'Troubleshooting Application and Hardware Issues', keyConceptsSummary: ['Storage issues', 'Application crashes', 'Hardware diagnostics', 'dmesg'] },
    { number: 25, title: 'Deploying Bash Scripts', keyConceptsSummary: ['Shebang', 'Variables', 'Conditionals', 'Loops', 'Functions', 'Exit codes'] },
    { number: 26, title: 'Python Concepts', keyConceptsSummary: ['Python environment', 'pip', 'Variables', 'Data types', 'Control flow', 'File I/O'] },
    { number: 27, title: 'Automating Jobs', keyConceptsSummary: ['cron', 'crontab', 'at', 'anacron', 'Background processes', 'nohup'] },
    { number: 28, title: 'Controlling Versions with Git', keyConceptsSummary: ['git init', 'git add/commit', 'Branches', 'Merging', 'Remote repos', 'GitHub'] },
    { number: 29, title: 'Understanding Cloud and Virtualization Concepts', keyConceptsSummary: ['IaaS/PaaS/SaaS', 'Hypervisors', 'Cloud providers', 'Containers'] },
    { number: 30, title: 'Inspecting Cloud and Virtualization Services', keyConceptsSummary: ['libvirt', 'KVM', 'QEMU', 'Docker', 'Vagrant'] },
    { number: 31, title: 'Orchestrating the Environment', keyConceptsSummary: ['Ansible', 'Puppet', 'Chef', 'Terraform', 'CI/CD'] },
];

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

    // Find the CMIT 291 brand
    const { data: brand } = await supabase
        .from('brands')
        .select('id')
        .eq('name', 'CMIT 291 Introduction to Linux')
        .single();

    if (!brand) {
        console.error('CMIT 291 brand not found. Run migration 010 first.');
        process.exit(1);
    }

    // Find or create the instructor persona
    let personaId: string;
    const { data: existingPersona } = await supabase
        .from('personas')
        .select('id')
        .eq('brand', 'CMIT 291 Introduction to Linux')
        .single();

    if (existingPersona) {
        personaId = existingPersona.id;
        console.log(`Using existing persona: ${personaId}`);
    } else {
        const { data: newPersona, error: personaError } = await supabase
            .from('personas')
            .insert({
                name: 'Prof. Pierce',
                brand: 'CMIT 291 Introduction to Linux',
                tagline: 'Bridging Linux theory to real-world IT operations',
                expertise_areas: [
                    'Linux System Administration',
                    'CompTIA Linux+ (XK0-006)',
                    'Cloud Infrastructure',
                    'Network Security',
                    'DevOps & Automation',
                    'Drone Technology & Field Operations',
                ],
                voice_style: 'Approachable professor with real-world experience. Explains technical concepts clearly with practical examples. Uses analogies to make complex topics accessible. Occasionally shares field stories to illustrate why concepts matter.',
                content_guidelines: 'Educational lecture format. Mix theoretical explanation with practical demonstration. Always connect concepts to real-world sysadmin tasks. Encourage hands-on practice.',
                platform_accounts: { youtube: 'true' },
                voice_pool: [
                    'onwK4e9ZLuTAKqWW03F9',  // Daniel
                    'pqHfZKP75CvOlQylNhV4',  // Bill
                    'nPczCjzI2devNBz1zQrb',  // Brian
                ],
                brand_id: brand.id,
                is_active: true,
            })
            .select()
            .single();

        if (personaError || !newPersona) {
            console.error('Error creating persona:', personaError?.message);
            process.exit(1);
        }
        personaId = newPersona.id;
        console.log(`Created persona: ${personaId}`);
    }

    // Seed chapters
    let inserted = 0;
    for (const ch of CHAPTERS) {
        const mapping = CHAPTER_WEEK_MAP[ch.number];
        if (!mapping) continue;

        const { error } = await supabase.from('lecture_chapters').insert({
            brand_id: brand.id,
            persona_id: personaId,
            chapter_number: ch.number,
            title: ch.title,
            week_number: mapping.week,
            slide_content: [],  // Will be populated by PPT extraction
            key_concepts: ch.keyConceptsSummary,
            learning_objectives: [],  // Will be enriched from PPT content
            field_connections: mapping.fieldConnections,
            estimated_duration_min: 25,
            status: 'pending',
        } as never);

        if (error) {
            console.error(`Error inserting chapter ${ch.number}:`, error.message);
        } else {
            inserted++;
            console.log(`OK Chapter ${ch.number}: ${ch.title} (Week ${mapping.week})`);
        }
    }

    console.log(`\nSeeded ${inserted}/${CHAPTERS.length} chapters.`);
    console.log('Next: run the PPT extraction script to populate slide_content.');
}

main();
