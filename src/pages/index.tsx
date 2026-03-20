import type { ReactNode } from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Head from '@docusaurus/Head';

import styles from './index.module.css';

// ─── Feature data ────────────────────────────────────────────────────────────

interface Feature {
  icon: string;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: '☁',
    title: 'Provider Abstraction',
    description:
      'Switch between AWS S3, Azure Blob, GCP, OCI, Supabase, and Local storage with a single interface. Zero code changes when you migrate providers.',
  },
  {
    icon: '⚡',
    title: 'Storage Pipeline',
    description:
      'Compose middleware layers: validation, compression, encryption, deduplication, virus scan, quota, and conflict resolution — all declarative.',
  },
  {
    icon: '↑',
    title: 'Resumable Uploads',
    description:
      'TUS-compatible chunked uploads with pluggable session stores: InMemory, Redis, or EF Core. Pause, resume, and recover from network failures.',
  },
  {
    icon: '🔒',
    title: 'AES-256 Encryption',
    description:
      'Transparent encryption on upload and decryption on download. Keys and IVs are stored in file metadata — no extra infrastructure required.',
  },
  {
    icon: '🖼',
    title: 'Image Processing',
    description:
      'Resize, convert formats, and generate thumbnails via SixLabors.ImageSharp middleware. Hook it into the pipeline in one line.',
  },
  {
    icon: '📡',
    title: 'Observability Ready',
    description:
      'ActivitySource, Metrics, and structured events — plug in OpenTelemetry in one line and get full distributed tracing out of the box.',
  },
];

// ─── Package data ─────────────────────────────────────────────────────────────

interface Package {
  name: string;
  description: string;
  nuget: string;
}

const PACKAGES: Package[] = [
  { name: 'ValiBlob.Core', description: 'Core interfaces, pipeline, result pattern, and DI extensions.', nuget: 'https://www.nuget.org/packages/ValiBlob.Core' },
  { name: 'ValiBlob.AWS', description: 'Amazon S3 storage provider.', nuget: 'https://www.nuget.org/packages/ValiBlob.AWS' },
  { name: 'ValiBlob.Azure', description: 'Azure Blob Storage provider.', nuget: 'https://www.nuget.org/packages/ValiBlob.Azure' },
  { name: 'ValiBlob.GCP', description: 'Google Cloud Storage provider.', nuget: 'https://www.nuget.org/packages/ValiBlob.GCP' },
  { name: 'ValiBlob.OCI', description: 'Oracle Cloud Infrastructure Object Storage provider.', nuget: 'https://www.nuget.org/packages/ValiBlob.OCI' },
  { name: 'ValiBlob.Supabase', description: 'Supabase Storage provider.', nuget: 'https://www.nuget.org/packages/ValiBlob.Supabase' },
  { name: 'ValiBlob.Local', description: 'Local filesystem provider — great for development.', nuget: 'https://www.nuget.org/packages/ValiBlob.Local' },
  { name: 'ValiBlob.Redis', description: 'Redis resumable upload session store.', nuget: 'https://www.nuget.org/packages/ValiBlob.Redis' },
  { name: 'ValiBlob.EFCore', description: 'EF Core resumable upload session store (any database).', nuget: 'https://www.nuget.org/packages/ValiBlob.EFCore' },
  { name: 'ValiBlob.Testing', description: 'In-memory provider and helpers for unit tests.', nuget: 'https://www.nuget.org/packages/ValiBlob.Testing' },
  { name: 'ValiBlob.HealthChecks', description: 'ASP.NET Core health check integration.', nuget: 'https://www.nuget.org/packages/ValiBlob.HealthChecks' },
  { name: 'ValiBlob.ImageSharp', description: 'Image processing middleware (resize, convert, thumbnails).', nuget: 'https://www.nuget.org/packages/ValiBlob.ImageSharp' },
];

// ─── Pipeline steps ───────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { label: 'Validation',            color: 'indigo', icon: '✓', desc: 'size · extension · content-type' },
  { label: 'Compression',           color: 'violet', icon: '⇩', desc: 'gzip · deflate · brotli' },
  { label: 'Encryption',            color: 'violet', icon: '🔒', desc: 'AES-256-CBC · per-file IV' },
  { label: 'ContentTypeDetection',  color: 'violet', icon: '◉', desc: 'magic bytes · MIME sniff' },
  { label: 'Deduplication',         color: 'violet', icon: '⊕', desc: 'SHA-256 · short-circuit' },
  { label: 'VirusScan',             color: 'violet', icon: '⛨', desc: 'ClamAV · VirusTotal' },
  { label: 'Quota',                 color: 'violet', icon: '⊘', desc: 'per-user · per-provider' },
  { label: 'ConflictResolution',    color: 'violet', icon: '⇄', desc: 'replace · keep · rename' },
  { label: 'Provider',              color: 'cyan',   icon: '☁', desc: 'AWS · Azure · GCP · Local' },
];

// ─── Canvas particle system ───────────────────────────────────────────────────

function useParticles(canvasRef: React.RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let w = 0, h = 0;

    interface Particle {
      x: number; y: number;
      vx: number; vy: number;
      r: number;
      color: string;
      alpha: number;
    }

    const COLORS = ['rgba(99,102,241,', 'rgba(139,92,246,', 'rgba(34,211,238,'];
    let particles: Particle[] = [];

    function resize() {
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width = w * window.devicePixelRatio;
      canvas.height = h * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    function spawn(): Particle {
      const c = COLORS[Math.floor(Math.random() * COLORS.length)];
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.8 + 0.6,
        color: c,
        alpha: Math.random() * 0.5 + 0.2,
      };
    }

    function init() {
      const count = Math.floor((w * h) / 8000);
      particles = Array.from({ length: Math.min(count, 90) }, spawn);
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            const opacity = (1 - dist / 120) * 0.18;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(99,102,241,${opacity})`;
            ctx.lineWidth = 0.8;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        ctx.beginPath();
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        grad.addColorStop(0, `${p.color}${p.alpha})`);
        grad.addColorStop(1, `${p.color}0)`);
        ctx.fillStyle = grad;
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.fillStyle = `${p.color}${p.alpha + 0.3})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        // Move
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    init();
    draw();

    const ro = new ResizeObserver(() => { resize(); init(); });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [canvasRef]);
}

// ─── Syntax-highlighted C# code ──────────────────────────────────────────────

type Token = { text: string; cls: string };

const CODE_TOKENS: Token[][] = [
  [{ text: 'builder', cls: 'cVar' }, { text: '.', cls: 'cPunc' }, { text: 'Services', cls: 'cType' }, { text: '.', cls: 'cPunc' }, { text: 'AddValiBlob', cls: 'cMethod' }, { text: '(o => {', cls: 'cPunc' }],
  [{ text: '    o', cls: 'cVar' }, { text: '.', cls: 'cPunc' }, { text: 'DefaultProvider', cls: 'cProp' }, { text: ' = ', cls: 'cPunc' }, { text: '"s3"', cls: 'cString' }, { text: ';', cls: 'cPunc' }],
  [{ text: '})', cls: 'cPunc' }],
  [{ text: '.', cls: 'cPunc' }, { text: 'AddProvider', cls: 'cMethod' }, { text: '<', cls: 'cPunc' }, { text: 'AWSS3Provider', cls: 'cType' }, { text: '>(', cls: 'cPunc' }, { text: '"s3"', cls: 'cString' }, { text: ', opts => {', cls: 'cPunc' }],
  [{ text: '    opts', cls: 'cVar' }, { text: '.', cls: 'cPunc' }, { text: 'BucketName', cls: 'cProp' }, { text: ' = ', cls: 'cPunc' }, { text: '"my-bucket"', cls: 'cString' }, { text: ';', cls: 'cPunc' }],
  [{ text: '    opts', cls: 'cVar' }, { text: '.', cls: 'cPunc' }, { text: 'Region', cls: 'cProp' }, { text: '     = ', cls: 'cPunc' }, { text: '"us-east-1"', cls: 'cString' }, { text: ';', cls: 'cPunc' }],
  [{ text: '})', cls: 'cPunc' }],
  [{ text: '.', cls: 'cPunc' }, { text: 'WithPipeline', cls: 'cMethod' }, { text: '(p => p', cls: 'cPunc' }],
  [{ text: '    .', cls: 'cPunc' }, { text: 'UseValidation', cls: 'cMethod' }, { text: '(v => v.', cls: 'cPunc' }, { text: 'MaxFileSizeBytes', cls: 'cProp' }, { text: ' = ', cls: 'cPunc' }, { text: '100_000_000', cls: 'cNum' }, { text: ')', cls: 'cPunc' }],
  [{ text: '    .', cls: 'cPunc' }, { text: 'UseCompression', cls: 'cMethod' }, { text: '()', cls: 'cPunc' }],
  [{ text: '    .', cls: 'cPunc' }, { text: 'UseEncryption', cls: 'cMethod' }, { text: '(e => e.', cls: 'cPunc' }, { text: 'Key', cls: 'cProp' }, { text: ' = ', cls: 'cPunc' }, { text: 'secretKey', cls: 'cVar' }, { text: ')', cls: 'cPunc' }],
  [{ text: '    .', cls: 'cPunc' }, { text: 'UseContentTypeDetection', cls: 'cMethod' }, { text: '()', cls: 'cPunc' }],
  [{ text: '    .', cls: 'cPunc' }, { text: 'UseDeduplication', cls: 'cMethod' }, { text: '()', cls: 'cPunc' }],
  [{ text: '    .', cls: 'cPunc' }, { text: 'UseVirusScan', cls: 'cMethod' }, { text: '()', cls: 'cPunc' }],
  [{ text: '    .', cls: 'cPunc' }, { text: 'UseConflictResolution', cls: 'cMethod' }, { text: '(', cls: 'cPunc' }, { text: 'ConflictResolution', cls: 'cType' }, { text: '.', cls: 'cPunc' }, { text: 'ReplaceExisting', cls: 'cProp' }, { text: ')', cls: 'cPunc' }],
  [{ text: ');', cls: 'cPunc' }],
];

function CodeBlock(): ReactNode {
  const [copied, setCopied] = useState(false);
  const raw = `builder.Services.AddValiBlob(o => {
    o.DefaultProvider = "s3";
})
.AddProvider<AWSS3Provider>("s3", opts => {
    opts.BucketName = "my-bucket";
    opts.Region     = "us-east-1";
})
.WithPipeline(p => p
    .UseValidation(v => v.MaxFileSizeBytes = 100_000_000)
    .UseCompression()
    .UseEncryption(e => e.Key = secretKey)
    .UseContentTypeDetection()
    .UseDeduplication()
    .UseVirusScan()
    .UseConflictResolution(ConflictResolution.ReplaceExisting)
);`;

  return (
    <div className={styles.codeCard}>
      {/* Window chrome */}
      <div className={styles.codeChrome}>
        <span className={styles.chromeDot} data-color="red" />
        <span className={styles.chromeDot} data-color="yellow" />
        <span className={styles.chromeDot} data-color="green" />
        <span className={styles.codeFile}>Program.cs</span>
        <button
          className={styles.codeCopyBtn}
          onClick={() => {
            navigator.clipboard.writeText(raw).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          aria-label="Copy code"
        >
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* Code */}
      <div className={styles.codeBody}>
        <div className={styles.codeLineNumbers}>
          {CODE_TOKENS.map((_, i) => (
            <span key={i} className={styles.codeLineNum}>{i + 1}</span>
          ))}
        </div>
        <pre className={styles.codePre}>
          <code>
            {CODE_TOKENS.map((line, li) => (
              <div key={li} className={styles.codeLine}>
                {line.map((tok, ti) => (
                  <span key={ti} className={styles[tok.cls]}>{tok.text}</span>
                ))}
              </div>
            ))}
          </code>
        </pre>
      </div>

      {/* Bottom glow bar */}
      <div className={styles.codeGlowBar} />
    </div>
  );
}

// ─── Pipeline Section (premium animated) ─────────────────────────────────────

function PipelineSection(): ReactNode {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stepsRef = useRef<HTMLDivElement[]>([]);
  const packetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState<number>(-1);
  const animLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useParticles(canvasRef as React.RefObject<HTMLCanvasElement>);

  // GSAP entrance animation on scroll
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let gsapMod: typeof import('gsap') | null = null;

    import('gsap').then((mod) => {
      gsapMod = mod;
      const { gsap } = mod;

      // Try to load ScrollTrigger
      import('gsap/ScrollTrigger').then(({ ScrollTrigger }) => {
        gsap.registerPlugin(ScrollTrigger);

        if (!sectionRef.current) return;

        // Header fade in
        gsap.fromTo(
          headerRef.current,
          { opacity: 0, y: 30 },
          {
            opacity: 1, y: 0, duration: 0.8, ease: 'power3.out',
            scrollTrigger: { trigger: sectionRef.current, start: 'top 75%' },
          }
        );

        // Steps stagger in from left
        gsap.fromTo(
          stepsRef.current,
          { opacity: 0, x: -30 },
          {
            opacity: 1, x: 0, duration: 0.55, stagger: 0.07, ease: 'power2.out',
            scrollTrigger: { trigger: sectionRef.current, start: 'top 70%' },
          }
        );

        // Code slide in from right
        gsap.fromTo(
          codeRef.current,
          { opacity: 0, x: 40 },
          {
            opacity: 1, x: 0, duration: 0.8, ease: 'power3.out', delay: 0.3,
            scrollTrigger: { trigger: sectionRef.current, start: 'top 70%' },
          }
        );
      }).catch(() => {
        // Fallback without ScrollTrigger
        gsap.fromTo(headerRef.current, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' });
        gsap.fromTo(stepsRef.current, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.55, stagger: 0.07, ease: 'power2.out' });
        gsap.fromTo(codeRef.current, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.8, ease: 'power3.out', delay: 0.3 });
      });
    });

    return () => {
      if (gsapMod) {
        try {
          // @ts-ignore
          gsapMod.gsap?.globalTimeline?.clear();
        } catch { /* ignore */ }
      }
    };
  }, []);

  // Data packet loop animation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let step = 0;
    let mounted = true;

    function advance() {
      if (!mounted) return;
      setActiveStep(step);
      step = (step + 1) % PIPELINE_STEPS.length;
      animLoopRef.current = setTimeout(advance, 650);
    }

    const initial = setTimeout(() => advance(), 1200);

    return () => {
      mounted = false;
      clearTimeout(initial);
      if (animLoopRef.current) clearTimeout(animLoopRef.current);
    };
  }, []);

  const setStepRef = useCallback((el: HTMLDivElement | null, i: number) => {
    if (el) stepsRef.current[i] = el;
  }, []);

  return (
    <section ref={sectionRef} className={styles.pipelineSection}>
      {/* Particle canvas */}
      <canvas ref={canvasRef as React.RefObject<HTMLCanvasElement>} className={styles.pipelineCanvas} aria-hidden="true" />

      {/* Ambient glows */}
      <div className={styles.pipelineGlow1} aria-hidden="true" />
      <div className={styles.pipelineGlow2} aria-hidden="true" />

      <div className={clsx('container', styles.pipelineContainer)}>
        {/* Header */}
        <div ref={headerRef} className={clsx(styles.sectionHeader, styles.pipelineHeader)}>
          <div className={styles.pipelineBadge}>
            <span className={styles.pipelineBadgePulse} />
            middleware chain
          </div>
          <h2 className={styles.sectionTitle}>Composable storage pipeline</h2>
          <p className={styles.sectionSubtitle}>
            Add, remove, and reorder middleware without touching your business logic.
            Each layer is independent and fully testable.
          </p>
        </div>

        {/* Two-column layout */}
        <div className={styles.pipelineLayout}>

          {/* Left: animated pipeline */}
          <div className={styles.pipelineSteps}>
            {/* Upload node at top */}
            <div className={styles.pipelineUpload}>
              <div className={styles.pipelineUploadDot} />
              <span className={styles.pipelineUploadLabel}>UploadRequest</span>
              <div className={styles.pipelineUploadArrow} />
            </div>

            {/* Steps */}
            {PIPELINE_STEPS.map((step, i) => {
              const isActive = activeStep === i;
              const isPast = activeStep > i;
              const isLast = i === PIPELINE_STEPS.length - 1;
              return (
                <div
                  key={step.label}
                  ref={(el) => setStepRef(el, i)}
                  className={clsx(
                    styles.pipelineStep,
                    isActive && styles.pipelineStepActive,
                    isPast && styles.pipelineStepPast,
                    isLast && styles.pipelineStepLast,
                    styles[`pipelineStep--${step.color}`],
                  )}
                >
                  {/* Connector line */}
                  {!isLast && (
                    <div className={clsx(styles.pipelineConnector, isActive && styles.pipelineConnectorActive)}>
                      {/* Travelling packet */}
                      {isActive && (
                        <div ref={i === activeStep ? packetRef : undefined} className={styles.pipelinePacket} />
                      )}
                    </div>
                  )}

                  <div className={styles.pipelineStepInner}>
                    <div className={styles.pipelineStepIcon}>{step.icon}</div>
                    <div className={styles.pipelineStepText}>
                      <span className={styles.pipelineStepLabel}>{step.label}</span>
                      <span className={styles.pipelineStepDesc}>{step.desc}</span>
                    </div>
                    {isActive && <div className={styles.pipelineStepPing} />}
                  </div>
                </div>
              );
            })}

            {/* Result node */}
            <div className={styles.pipelineResult}>
              <div className={styles.pipelineResultLine} />
              <div className={styles.pipelineResultNode}>
                <span className={styles.pipelineResultCheck}>✓</span>
                <span>StorageResult</span>
              </div>
            </div>
          </div>

          {/* Right: code block */}
          <div ref={codeRef} className={styles.pipelineCodeCol}>
            <CodeBlock />

            {/* Small info pills below code */}
            <div className={styles.pipelinePills}>
              {['IStorageMiddleware', 'StoragePipelineBuilder', 'IStorageProvider'].map((t) => (
                <span key={t} className={styles.pipelinePill}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FeatureCard({ icon, title, description, index }: Feature & { index: number }): ReactNode {
  const num = String(index + 1).padStart(2, '0');
  return (
    <div className={styles.featureCard}>
      <span className={styles.featureNumber}>{num}</span>
      <div className={styles.featureIconWrap}>
        <span className={styles.featureIconGlyph}>{icon}</span>
      </div>
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureDescription}>{description}</p>
    </div>
  );
}

function CopyButton({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={styles.copyButton}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function PackageCard({ name, description, nuget }: Package): ReactNode {
  const installCommand = `dotnet add package ${name}`;
  return (
    <div className={styles.packageCard}>
      <div className={styles.packageAccent} aria-hidden="true" />
      <div className={styles.packageHeader}>
        <a href={nuget} target="_blank" rel="noopener noreferrer" className={styles.packageName}>
          <span className={styles.packageChip}>{name}</span>
        </a>
      </div>
      <p className={styles.packageDescription}>{description}</p>
      <div className={styles.packageInstall}>
        <code className={styles.packageInstallCode}>{installCommand}</code>
        <CopyButton text={installCommand} />
      </div>
    </div>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

const PROVIDERS = ['AWS', 'Azure', 'GCP', 'OCI', 'Supabase', 'Local'];

function Hero(): ReactNode {
  const [copied, setCopied] = useState(false);
  const installCmd = 'dotnet add package ValiBlob.Core';
  return (
    <section className={styles.hero}>
      {/* Perspective grid background */}
      <div className={styles.heroGrid} aria-hidden="true" />

      {/* Large floating orbs */}
      <div className={styles.heroOrb1} aria-hidden="true" />
      <div className={styles.heroOrb2} aria-hidden="true" />
      <div className={styles.heroOrb3} aria-hidden="true" />

      <div className={styles.heroInner}>
        {/* Badge */}
        <div className={styles.heroBadge}>
          <span className={styles.heroBadgePulse} />
          <span className={styles.heroBadgeDot} />
          .NET 7 · .NET 8 · .NET 9
        </div>

        {/* Title */}
        <h1 className={styles.heroTitle}>Vali-Blob</h1>

        {/* Tagline */}
        <p className={styles.heroTagline}>
          <span className={styles.heroTaglineComment}>{'// '}</span>
          cloud storage abstraction for .NET
        </p>

        <p className={styles.heroSubtitle}>One interface. Any provider. Full pipeline control.</p>

        {/* Provider pills marquee */}
        <div className={styles.heroProviders} aria-label="Supported providers">
          <div className={styles.heroProvidersTrack}>
            {[...PROVIDERS, ...PROVIDERS].map((p, i) => (
              <span key={i} className={styles.providerPill}>{p}</span>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <span className={styles.heroStatValue}>12</span>
            <span className={styles.heroStatLabel}>packages</span>
          </div>
          <div className={styles.heroStatDivider} aria-hidden="true" />
          <div className={styles.heroStat}>
            <span className={styles.heroStatValue}>6</span>
            <span className={styles.heroStatLabel}>providers</span>
          </div>
          <div className={styles.heroStatDivider} aria-hidden="true" />
          <div className={styles.heroStat}>
            <span className={styles.heroStatValue}>.NET 7+8+9</span>
            <span className={styles.heroStatLabel}>supported</span>
          </div>
        </div>

        {/* CTA buttons */}
        <div className={styles.heroCta}>
          <Link className={clsx('button', styles.btnPrimary)} to="/docs/quick-start">Get started →</Link>
          <Link className={clsx('button', styles.btnSecondary)} to="/docs/introduction">Read the docs</Link>
        </div>

        {/* Install block */}
        <div className={styles.heroInstallWrap}>
          <div className={styles.heroInstall}>
            <span className={styles.heroInstallPrompt}>$</span>
            <code className={styles.heroInstallCode}>{installCmd}</code>
            <button
              className={styles.heroInstallCopy}
              onClick={() => {
                navigator.clipboard.writeText(installCmd).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              aria-label="Copy"
            >
              {copied
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              }
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Features section ─────────────────────────────────────────────────────────

function FeaturesSection(): ReactNode {
  return (
    <section className={styles.featuresSection}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Everything you need for cloud storage</h2>
          <p className={styles.sectionSubtitle}>Built for .NET developers who need production-grade file handling without vendor lock-in.</p>
        </div>
        <div className={styles.featuresGrid}>
          {FEATURES.map((f, i) => <FeatureCard key={f.title} {...f} index={i} />)}
        </div>
      </div>
    </section>
  );
}

// ─── Packages section ─────────────────────────────────────────────────────────

function PackagesSection(): ReactNode {
  return (
    <section className={styles.packagesSection}>
      <div className={styles.packagesDivider} aria-hidden="true" />
      <div className="container">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>12 NuGet packages. Install only what you need.</h2>
          <p className={styles.sectionSubtitle}>Each package is independent — add the providers and features your project requires.</p>
        </div>
        <div className={styles.packagesGrid}>
          {PACKAGES.map((p) => <PackageCard key={p.name} {...p} />)}
        </div>
      </div>
    </section>
  );
}

// ─── Author section ───────────────────────────────────────────────────────────

function AuthorSection(): ReactNode {
  return (
    <section className={styles.authorSection}>
      <div className={styles.authorDivider} aria-hidden="true" />
      <div className="container">
        <div className={styles.authorCard}>
          <div className={styles.avatarRingWrap}>
            <div className={styles.avatarRing} aria-hidden="true" />
            <div className={styles.authorAvatar}>
              <span className={styles.authorAvatarInitials}>FM</span>
            </div>
          </div>
          <div className={styles.authorInfo}>
            <p className={styles.authorBuiltBy}>Built by</p>
            <a href="https://github.com/UBF21" target="_blank" rel="noopener noreferrer" className={styles.authorName}>Felipe Montenegro</a>
            <p className={styles.authorBio}>.NET developer and open-source contributor. Also the author of{' '}<a href="https://github.com/UBF21/Vali-Mediator" target="_blank" rel="noopener noreferrer" className={styles.authorLink}>Vali-Mediator</a>.</p>
          </div>
          <div className={styles.authorLinks}>
            <a href="https://github.com/UBF21" target="_blank" rel="noopener noreferrer" className={clsx(styles.authorSocialLink, styles.authorSocialLinkGithub)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" /></svg>
              GitHub
            </a>
            <a href="https://www.nuget.org/profiles/UBF21" target="_blank" rel="noopener noreferrer" className={clsx(styles.authorSocialLink, styles.authorSocialLinkNuget)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L20 8.5v7L12 19.82 4 15.5v-7L12 4.18z"/></svg>
              NuGet
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

const SEO_TITLE = 'Vali-Blob — Cloud Storage Abstraction for .NET';
const SEO_DESC  = 'Provider-agnostic cloud storage library for .NET 7, 8 & 9. Unified API for AWS S3, Azure Blob, GCP, OCI, Supabase and local filesystem with pipeline middleware for validation, compression, encryption, deduplication, resumable uploads and image processing.';
const SEO_URL   = 'https://valiblob.github.io';
const SEO_IMAGE = `${SEO_URL}/img/docusaurus-social-card.jpg`;

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <>
      <Head>
        {/* Primary */}
        <title>{SEO_TITLE}</title>
        <meta name="description" content={SEO_DESC} />
        <meta name="robots" content="index, follow" />
        <meta name="theme-color" content="#6366f1" />
        <link rel="canonical" href={SEO_URL} />

        {/* Open Graph */}
        <meta property="og:type"        content="website" />
        <meta property="og:url"         content={SEO_URL} />
        <meta property="og:title"       content={SEO_TITLE} />
        <meta property="og:description" content={SEO_DESC} />
        <meta property="og:image"       content={SEO_IMAGE} />
        <meta property="og:image:width"  content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:locale"          content="en_US" />
        <meta property="og:locale:alternate" content="es_ES" />
        <meta property="og:site_name" content="Vali-Blob" />

        {/* Twitter / X */}
        <meta name="twitter:card"        content="summary_large_image" />
        <meta name="twitter:title"       content={SEO_TITLE} />
        <meta name="twitter:description" content={SEO_DESC} />
        <meta name="twitter:image"       content={SEO_IMAGE} />

        {/* hreflang i18n */}
        <link rel="alternate" hrefLang="en" href={SEO_URL} />
        <link rel="alternate" hrefLang="es" href={`${SEO_URL}/es/`} />
        <link rel="alternate" hrefLang="x-default" href={SEO_URL} />

        {/* JSON-LD Structured Data */}
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "Vali-Blob",
          "description": SEO_DESC,
          "url": SEO_URL,
          "applicationCategory": "DeveloperApplication",
          "operatingSystem": ".NET 7, .NET 8, .NET 9",
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
          "author": {
            "@type": "Organization",
            "name": "UBF21",
            "url": "https://github.com/UBF21"
          }
        })}</script>
      </Head>

      <Layout title={siteConfig.title} description={SEO_DESC}>
        <Hero />
        <main>
          <FeaturesSection />
          <PipelineSection />
          <PackagesSection />
          <AuthorSection />
        </main>
      </Layout>
    </>
  );
}
