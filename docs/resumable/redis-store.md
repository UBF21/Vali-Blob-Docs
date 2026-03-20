---
title: Redis Session Store
sidebar_label: Redis Store
sidebar_position: 3
---

# Redis Session Store

`ValiBlob.Redis` provides `RedisResumableSessionStore`, a production-ready session store backed by Redis via [StackExchange.Redis](https://github.com/StackExchange/StackExchange.Redis). Sessions are serialized to JSON and stored as Redis string keys with a configurable sliding TTL.

Use the Redis store when your application runs on multiple instances or containers — it ensures all pods share the same session state, so a chunk can be uploaded to a different instance than the one that started the session.

---

## Installation

```bash
dotnet add package ValiBlob.Redis
```

---

## Registration

```csharp
using ValiBlob.Core;
using ValiBlob.AWS;
using ValiBlob.Redis;

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", o =>
    {
        o.BucketName = builder.Configuration["AWS:BucketName"]!;
        o.Region     = builder.Configuration["AWS:Region"]!;
        o.AccessKey  = builder.Configuration["AWS:AccessKey"]!;
        o.SecretKey  = builder.Configuration["AWS:SecretKey"]!;
    })
    .AddRedisSessionStore(opts =>
    {
        opts.ConnectionString  = builder.Configuration["Redis:ConnectionString"]!;
        opts.KeyPrefix         = "valiblob:session:";
        opts.SlidingExpiration = TimeSpan.FromHours(24);
    });
```

---

## Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `ConnectionString` | `string` | `"localhost:6379"` | StackExchange.Redis connection string |
| `KeyPrefix` | `string` | `"valiblob:session:"` | Prefix prepended to every Redis key |
| `SlidingExpiration` | `TimeSpan` | `24 hours` | TTL reset on every chunk upload |
| `DatabaseIndex` | `int` | `0` | Redis logical database index |
| `JsonOptions` | `JsonSerializerOptions?` | `null` | Custom JSON serialization options |

---

## Connection String Formats

### Standalone Redis

```
localhost:6379
my-redis.example.com:6379,password=secret,ssl=true,abortConnect=false
```

### Redis Sentinel (High Availability)

```
sentinel1.example.com:26379,sentinel2.example.com:26379,serviceName=mymaster,password=secret
```

### Redis Cluster

```
cluster-node1.example.com:6379,cluster-node2.example.com:6379,password=secret,abortConnect=false
```

### Azure Cache for Redis

```
my-cache.redis.cache.windows.net:6380,password=<access-key>,ssl=true,abortConnect=false
```

### AWS ElastiCache

```
my-elasticache.abc123.ng.0001.use1.cache.amazonaws.com:6379,abortConnect=false
```

---

## TTL Behavior

Sessions are stored as Redis keys with a sliding TTL:

- **Created** (`SaveAsync`) → TTL set to `SlidingExpiration`
- **Read or updated** (`GetAsync`, `UpdateAsync`) → TTL reset to `SlidingExpiration`
- **Deleted** (`DeleteAsync`) → key removed immediately

Active uploads (where chunks arrive regularly) never expire. Only uploads that go stale — no chunk arrives for the full TTL window — are automatically cleaned up by Redis with no background job required.

```
Session created:       TTL = 24h
Chunk 1 uploaded:      TTL reset to 24h
Chunk 2 uploaded:      TTL reset to 24h
...
24h with no activity → key expires → GetAsync returns null → session gone
```

### Tuning TTL for large uploads on slow connections

```csharp
opts.SlidingExpiration = TimeSpan.FromDays(7);  // allow up to 7 days to complete
```

---

## Stored Session Format

Sessions are serialized to compact JSON, typically under 512 bytes per session:

```json
{
  "uploadId": "abc123",
  "path": "uploads/videos/my-video.mp4",
  "totalSize": 104857600,
  "uploadedBytes": 52428800,
  "contentType": "video/mp4",
  "createdAt": "2026-03-18T10:00:00Z",
  "updatedAt": "2026-03-18T10:05:00Z",
  "status": "InProgress"
}
```

Inspect sessions from the Redis CLI:

```bash
# List all active sessions
redis-cli KEYS "valiblob:session:*"

# Inspect a specific session
redis-cli GET "valiblob:session:abc123"

# Check remaining TTL
redis-cli TTL "valiblob:session:abc123"
```

---

## Reusing an Existing IConnectionMultiplexer

If your application already registers `IConnectionMultiplexer` (e.g., for distributed caching or pub/sub), ValiBlob will reuse it automatically:

```csharp
// Register shared connection globally
builder.Services.AddSingleton<IConnectionMultiplexer>(
    ConnectionMultiplexer.Connect(builder.Configuration["Redis:ConnectionString"]!));

// ValiBlob resolves and reuses the registered multiplexer
builder.Services
    .AddValiBlob(...)
    .AddRedisSessionStore(opts =>
    {
        opts.KeyPrefix         = "valiblob:session:";
        opts.SlidingExpiration = TimeSpan.FromHours(24);
        // ConnectionString not needed — multiplexer resolved from DI
    });
```

---

## Multi-Instance Kubernetes Deployment

All pods share the same Redis instance. A client can start an upload on Pod A and send chunks to Pod B — all pods will find the same session in Redis:

```yaml
# kubernetes/deployment.yaml
env:
  - name: Redis__ConnectionString
    valueFrom:
      secretKeyRef:
        name: app-secrets
        key: redis-connection-string
```

```csharp
// Program.cs — identical on all pods
builder.Services
    .AddValiBlob(...)
    .AddRedisSessionStore(opts =>
    {
        opts.ConnectionString  = builder.Configuration["Redis:ConnectionString"]!;
        opts.KeyPrefix         = "myapp:valiblob:session:";
        opts.SlidingExpiration = TimeSpan.FromHours(24);
    });
```

:::tip Unique KeyPrefix per application
When multiple applications share the same Redis instance, always set a distinct `KeyPrefix` (include the app name) to avoid session key collisions between applications.
:::

---

## Health Check Integration

```csharp
builder.Services
    .AddHealthChecks()
    .AddRedis(builder.Configuration["Redis:ConnectionString"]!, name: "redis-session-store")
    .AddValiBlob("storage-aws", factory => factory.Create("aws")); // storage provider health

app.MapHealthChecks("/health");
```

---

## Diagnosing Connection Issues

### Confirm the correct store is registered

```csharp
// In development, verify the store type
var store = app.Services.GetRequiredService<IResumableSessionStore>();
Console.WriteLine(store.GetType().Name);
// Should print: RedisResumableSessionStore
// If it prints: InMemoryResumableSessionStore — AddRedisSessionStore was not called
```

### Add connection timeouts for remote Redis

```
my-redis.example.com:6379,connectTimeout=5000,syncTimeout=5000,abortConnect=false
```

---

## When to Use Redis vs EF Core

| Scenario | Redis | EF Core |
|---|---|---|
| Multiple app instances / pods | Yes | Yes |
| Already running Redis | Yes | — |
| Already running a SQL database, no Redis | — | Yes |
| Automatic TTL cleanup (no background job) | Yes | No (needs background job) |
| Query sessions by path or user | No | Yes |
| Embedded SQLite (no external service) | — | Yes |

---

## Related

- [Session Stores](./session-stores.md) — Full comparison of session store options
- [EF Core Store](./efcore-store.md) — Database-backed session store
- [Resumable Uploads Overview](./overview.md) — Three-step upload flow and API examples
