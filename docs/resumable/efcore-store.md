---
title: EF Core Session Store
sidebar_label: EF Core Store
sidebar_position: 4
---

# EF Core Session Store

`ValiBlob.EFCore` provides `EfCoreResumableSessionStore`, which persists resumable upload sessions in a relational database via Entity Framework Core. It works with any EF Core-supported database: PostgreSQL, MySQL, SQL Server, and SQLite.

Use the EF Core store when your application already uses EF Core and you prefer a SQL database for session persistence over running a separate Redis instance.

---

## Installation

```bash
dotnet add package ValiBlob.EFCore
```

Also install the EF Core provider for your target database:

```bash
# PostgreSQL
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL

# MySQL / MariaDB
dotnet add package Pomelo.EntityFrameworkCore.MySql

# SQL Server
dotnet add package Microsoft.EntityFrameworkCore.SqlServer

# SQLite (embedded)
dotnet add package Microsoft.EntityFrameworkCore.Sqlite
```

---

## Setup

### Step 1: Add to DbContext

Add `ResumableUploadSessionEntity` to your existing `DbContext` and call `modelBuilder.ConfigureValiBlob()` to apply the table schema:

```csharp
using ValiBlob.EFCore;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    // ValiBlob resumable session table
    public DbSet<ResumableUploadSessionEntity> ResumableUploadSessions
        => Set<ResumableUploadSessionEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ConfigureValiBlob();   // registers table, indexes, column types
        // ... your other entity configurations ...
    }
}
```

### Step 2: Register in DI

```csharp
// PostgreSQL example
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseNpgsql(builder.Configuration.GetConnectionString("Default")!));

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", o =>
    {
        o.BucketName = builder.Configuration["AWS:BucketName"]!;
        o.Region     = builder.Configuration["AWS:Region"]!;
        o.AccessKey  = builder.Configuration["AWS:AccessKey"]!;
        o.SecretKey  = builder.Configuration["AWS:SecretKey"]!;
    })
    .AddEfCoreSessionStore<AppDbContext>();
```

### Step 3: Create and Apply Migration

```bash
dotnet ef migrations add AddValiBlob
dotnet ef database update
```

This creates the `ResumableUploadSessions` table alongside your existing application tables.

---

## Database Connection Strings

### PostgreSQL

```json
{
  "ConnectionStrings": {
    "Default": "Host=localhost;Port=5432;Database=myapp;Username=postgres;Password=secret"
  }
}
```

```csharp
opts.UseNpgsql(connectionString);
```

### MySQL / MariaDB

```json
{
  "ConnectionStrings": {
    "Default": "Server=localhost;Port=3306;Database=myapp;User=root;Password=secret;"
  }
}
```

```csharp
opts.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString));
```

### SQL Server

```json
{
  "ConnectionStrings": {
    "Default": "Server=localhost,1433;Database=myapp;User Id=sa;Password=Secret123!;TrustServerCertificate=True"
  }
}
```

```csharp
opts.UseSqlServer(connectionString);
```

### SQLite (embedded, no server required)

```json
{
  "ConnectionStrings": {
    "Default": "Data Source=app.db"
  }
}
```

```csharp
opts.UseSqlite(connectionString);
```

:::tip SQLite for single-instance deployments
SQLite is ideal for on-premise applications, edge deployments, or simple single-instance services that want restart-safe sessions without running a database server or Redis. The database is a single `.db` file.
:::

---

## Table Schema

`ConfigureValiBlob()` creates the following schema:

| Column | Type | Constraints | Description |
|---|---|---|---|
| `Id` | `int` (PK) | Auto-increment | Internal surrogate key |
| `UploadId` | `varchar(128)` | Unique, Not null | Session identifier |
| `Path` | `varchar(2048)` | Not null | Destination storage path |
| `TotalSize` | `bigint` | Not null | Total file size in bytes |
| `UploadedBytes` | `bigint` | Not null, Default 0 | Bytes received so far |
| `ContentType` | `varchar(256)` | Nullable | MIME type |
| `CreatedAt` | `datetime` | Not null | Session creation timestamp (UTC) |
| `UpdatedAt` | `datetime` | Not null | Last chunk timestamp (UTC) |
| `Status` | `varchar(32)` | Not null | `Pending`, `InProgress`, `Complete`, `Aborted` |

Indexes:
- Unique index on `UploadId` (for fast per-session lookups)
- Composite index on `(Status, UpdatedAt)` (for stale session cleanup queries)

### Custom table name or schema

```csharp
modelBuilder.ConfigureValiBlob(tableName: "upload_sessions", schema: "vali");
```

---

## Using a Dedicated DbContext

To keep ValiBlob tables separate from your application schema:

```csharp
public class ValiDbContext : DbContext
{
    public ValiDbContext(DbContextOptions<ValiDbContext> options) : base(options) { }

    public DbSet<ResumableUploadSessionEntity> ResumableUploadSessions
        => Set<ResumableUploadSessionEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
        => modelBuilder.ConfigureValiBlob();
}

// Registration
builder.Services.AddDbContext<ValiDbContext>(opts =>
    opts.UseNpgsql(builder.Configuration.GetConnectionString("Default")!));

builder.Services
    .AddValiBlob(...)
    .AddEfCoreSessionStore<ValiDbContext>();
```

Run the migration against the dedicated context:

```bash
dotnet ef migrations add AddValiBlob --context ValiDbContext
dotnet ef database update --context ValiDbContext
```

---

## Cleaning Up Stale Sessions

Unlike Redis, EF Core does not expire rows automatically. Add a background `IHostedService` to clean up sessions that were never completed or aborted:

```csharp
public class StaleSessionCleanupService(
    IServiceProvider services,
    ILogger<StaleSessionCleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromHours(1), ct);

            try
            {
                await using var scope = services.CreateAsyncScope();
                var db      = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var cutoff  = DateTime.UtcNow.AddHours(-48);  // sessions older than 48h

                var deleted = await db.ResumableUploadSessions
                    .Where(s => s.Status == "InProgress" && s.UpdatedAt < cutoff)
                    .ExecuteDeleteAsync(ct);

                if (deleted > 0)
                    logger.LogInformation("Cleaned up {Count} stale upload sessions.", deleted);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error during stale session cleanup.");
            }
        }
    }
}

// Register
builder.Services.AddHostedService<StaleSessionCleanupService>();
```

---

## Querying Sessions Directly

A key advantage over Redis: sessions are queryable via LINQ or raw SQL:

```csharp
// All in-progress sessions for a user's files
var activeSessions = await db.ResumableUploadSessions
    .Where(s => s.Path.StartsWith($"users/{userId}/") && s.Status == "InProgress")
    .OrderByDescending(s => s.CreatedAt)
    .ToListAsync();

// Dashboard: total bytes currently in-flight
var inFlightBytes = await db.ResumableUploadSessions
    .Where(s => s.Status == "InProgress")
    .SumAsync(s => s.UploadedBytes);

// Abandoned sessions (in-progress for > 24h)
var abandoned = await db.ResumableUploadSessions
    .Where(s => s.Status == "InProgress" && s.UpdatedAt < DateTime.UtcNow.AddHours(-24))
    .ToListAsync();
```

---

## Comparison: EF Core vs Redis

| Concern | EF Core | Redis |
|---|---|---|
| Automatic expiry | No (background job required) | Yes (sliding TTL) |
| Queryable via LINQ/SQL | Yes | No (key-based only) |
| Requires separate infrastructure | No (uses existing DB) | Yes (Redis server) |
| Per-operation latency | Higher (~1–10 ms) | Lower (~0.5–2 ms) |
| Multi-instance safe | Yes | Yes |
| Best for | SQL-centric apps, audit queries | High-throughput, stateless pods |

---

## Migration Notes

- `dotnet ef migrations add AddValiBlob` scaffolds only the `ResumableUploadSessions` table — your existing entities are not affected.
- When upgrading ValiBlob to a version that changes the schema, a new migration is required.
- If you use `dotnet ef migrations bundle` for production deployments, include the ValiBlob migration in your bundle.

---

## Related

- [Session Stores](./session-stores.md) — Full comparison of session store options
- [Redis Store](./redis-store.md) — Redis-backed session store
- [Resumable Uploads Overview](./overview.md) — Three-step upload flow and API examples
