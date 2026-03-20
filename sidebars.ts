import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'introduction',
    'quick-start',
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: false,
      items: [
        'core/storage-result',
        'core/storage-path',
        'core/upload',
        'core/download',
        'core/metadata',
        'core/listing',
        'core/events',
      ],
    },
    {
      type: 'category',
      label: 'Pipeline',
      items: [
        'pipeline/overview',
        'pipeline/validation',
        'pipeline/compression',
        'pipeline/encryption',
        'pipeline/content-type-detection',
        'pipeline/deduplication',
        'pipeline/virus-scan',
        'pipeline/quota',
        'pipeline/conflict-resolution',
      ],
    },
    {
      type: 'category',
      label: 'Resumable Uploads',
      items: [
        'resumable/overview',
        'resumable/session-stores',
        'resumable/redis-store',
        'resumable/efcore-store',
      ],
    },
    {
      type: 'category',
      label: 'Providers',
      items: [
        'providers/aws',
        'providers/azure',
        'providers/gcp',
        'providers/oci',
        'providers/supabase',
        'providers/local',
      ],
    },
    {
      type: 'category',
      label: 'Advanced',
      items: [
        'advanced/presigned-urls',
        'advanced/migration',
        'advanced/cdn',
        'advanced/image-processing',
        'advanced/observability',
        'advanced/resilience',
        'advanced/health-checks',
        'advanced/testing',
      ],
    },
    'packages',
  ],
};

export default sidebars;
