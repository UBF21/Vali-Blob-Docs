# ValiBlob Docs

Documentation site for [ValiBlob](https://valiblob.github.io) — a provider-agnostic cloud storage abstraction library for .NET 8 and .NET 9.

ValiBlob gives you a single, unified API to work with Amazon S3, Azure Blob Storage, Google Cloud Storage, Oracle Cloud Infrastructure, Supabase, and the local filesystem, with a composable middleware pipeline for validation, compression, encryption, deduplication, virus scanning, quotas, and more.

Built with [Docusaurus](https://docusaurus.io/).

## Installation

```bash
yarn
```

## Local Development

```bash
yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

Using SSH:

```bash
USE_SSH=true yarn deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.
