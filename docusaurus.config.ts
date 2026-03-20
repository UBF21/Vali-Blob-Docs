import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Vali-Blob',
  tagline: '// cloud storage abstraction for .NET',
  favicon: 'img/favicon.ico',


  url: 'https://valiblob.github.io',
  baseUrl: '/',

  organizationName: 'valiblob',
  projectName: 'valiblob',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  stylesheets: [
    {
      href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Space+Mono:wght@400;500&display=swap',
      type: 'text/css',
    },
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    localeConfigs: {
      en: { label: 'English', direction: 'ltr', htmlLang: 'en' },
      es: { label: 'Español', direction: 'ltr', htmlLang: 'es' },
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
          editUrl: 'https://github.com/UBF21/Vali-Blob/tree/main/',
          showLastUpdateTime: false,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: true },
    navbar: {
      title: 'Vali-Blob',
      logo: { alt: 'Vali-Blob', src: 'img/logo.png' },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        { type: 'localeDropdown', position: 'right' },
        {
          href: 'https://www.nuget.org/packages/ValiBlob.Core',
          label: 'NuGet',
          position: 'right',
        },
        {
          href: 'https://github.com/UBF21/Vali-Blob',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Introduction', to: '/docs/introduction' },
            { label: 'Quick Start', to: '/docs/quick-start' },
            { label: 'Pipeline', to: '/docs/pipeline/overview' },
            { label: 'Providers', to: '/docs/providers/aws' },
          ],
        },
        {
          title: 'Packages',
          items: [
            { label: 'ValiBlob.Core', href: 'https://www.nuget.org/packages/ValiBlob.Core' },
            { label: 'ValiBlob.AWS', href: 'https://www.nuget.org/packages/ValiBlob.AWS' },
            { label: 'ValiBlob.Azure', href: 'https://www.nuget.org/packages/ValiBlob.Azure' },
            { label: 'ValiBlob.Local', href: 'https://www.nuget.org/packages/ValiBlob.Local' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'Vali-Validation', href: 'https://github.com/UBF21/Vali-Validation' },
            { label: 'Vali-Mediator', href: 'https://github.com/UBF21/Vali-Mediator' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} The Vali-Blob Contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['csharp', 'bash', 'json', 'yaml', 'markup'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
